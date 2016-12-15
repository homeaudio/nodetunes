import * as AlacDecoderStream from 'alac2pcm'
import * as crypto from 'crypto'
import * as debug from 'debug'
import { ServerRequest, Response } from 'httplike'
import * as ipaddr from 'ipaddr.js'
import { Transform } from 'stream'

import { RtspServer } from './rtsp'
import { OutputStream } from './streams/output'
import { PcmDecoderStream } from './streams/pcm'
import * as tools from './tools'

const log = require('debug')('nodetunes:rtspmethods')

const DECODER_STREAMS: { [x: string]: typeof Transform } = {
    '96 AppleLossless': AlacDecoderStream,
    '96 L16/44100/2': PcmDecoderStream
}

function options(rtspServer: RtspServer, req: ServerRequest, res: Response) {

    res.headers['public'] = 'ANNOUNCE, SETUP, RECORD, PAUSE, FLUSH, TEARDOWN, OPTIONS, GET_PARAMETER, SET_PARAMETER, POST, GET'

    if (req.headers['apple-challenge']) {

        // challenge response consists of challenge + ip address + mac address + padding to 32 bytes,
        // encrypted with the ApEx private key (private encryption mode w/ PKCS1 padding)

        const challengeBuf = new Buffer(req.headers['apple-challenge'], 'base64')

        let ipAddrRepr = ipaddr.parse(rtspServer.socket.address().address)
        if (ipAddrRepr.kind() === 'ipv6' && ipAddrRepr.isIPv4MappedAddress()) {
            ipAddrRepr = ipAddrRepr.toIPv4Address()
        }

        const ipAddr = new Buffer(ipAddrRepr.toByteArray())

        const macAddr = new Buffer(rtspServer.macAddress.replace(/:/g, ''), 'hex')
        res.headers['apple-response'] = tools.generateAppleResponse(challengeBuf, ipAddr, macAddr)
    }

    res.send()
}

function announceParse(rtspServer: RtspServer, req: ServerRequest, res: Response) {

    const sdp = tools.parseSdp(req.content.toString())

    for (let i = 0; i < sdp.a.length; i++) {
        const spIndex = sdp.a[i].indexOf(':')
        const aKey = sdp.a[i].substring(0, spIndex)
        const aValue = sdp.a[i].substring(spIndex + 1)

        if (aKey == 'rsaaeskey') {

            rtspServer.audioAesKey = tools.PRIVATE_KEY.decrypt(new Buffer(aValue, 'base64').toString('binary'), 'RSA-OAEP')

        } else if (aKey == 'aesiv') {

            rtspServer.audioAesIv = new Buffer(aValue, 'base64')

        } else if (aKey == 'rtpmap') {

            rtspServer.audioCodec = aValue

            if (aValue.indexOf('L16') === -1 && aValue.indexOf('AppleLossless') === -1) {
                //PCM: L16/(...)
                //ALAC: 96 AppleLossless
                rtspServer.external.emit('error', { code: 415, message: 'Codec not supported (' + aValue + ')' })
                res.statusCode = 415
                res.send()
            }

        } else if (aKey == 'fmtp') {

            rtspServer.audioOptions = aValue.split(' ')

        }

    }

    if (sdp.i) {
        rtspServer.metadata.clientName = sdp.i
        log('client name reported (%s)', rtspServer.metadata.clientName)
        rtspServer.external.emit('clientNameChange', sdp.i)
    }

    if (sdp.c) {
        if (sdp.c.indexOf('IP6') !== -1) {
            log('ipv6 usage detected')
            rtspServer.ipv6 = true
        }
    }

    const decoderOptions = tools.getDecoderOptions(rtspServer.audioOptions)
    const decoderStream = new DECODER_STREAMS[rtspServer.audioCodec](decoderOptions)

    rtspServer.clientConnected = res.socket
    rtspServer.outputStream = new OutputStream()
    log('client considered connected')
    rtspServer.outputStream.setDecoder(decoderStream)
    rtspServer.external.emit('clientConnected', rtspServer.outputStream)

    res.send()
}


function setup(rtspServer: RtspServer, req: ServerRequest, res: Response) {
    rtspServer.ports = []

    const getRandomPort = () => {
        const min = 5000
        const max = 9999
        return Math.floor(Math.random() * (max - min + 1)) + min
    }

    rtspServer.ports = [getRandomPort(), getRandomPort(), getRandomPort()]

    if (rtspServer.ports.length >= 3) {

        rtspServer.rtp.start()

        log('setting udp ports (audio: %s, control: %s, timing: %s)', rtspServer.ports[0], rtspServer.ports[1], rtspServer.ports[2])

        res.headers['transport'] = 'RTP/AVP/UDP;unicast;mode=record;server_port=' + rtspServer.ports[0] + ';control_port=' + rtspServer.ports[1] + ';timing_port=' + rtspServer.ports[2]
        res.headers['session'] = '1'
        res.headers['audio-jack-status'] = 'connected'
        res.send()

    }
}

// TODO get rid of this global?
let nonce = ''


function announce(rtspServer: RtspServer, req: ServerRequest, res: Response) {
    log(req.content.toString())

    if (rtspServer.clientConnected) {

        log('already streaming; rejecting new client')
        res.statusCode = 453
        res.send()

    } else if (rtspServer.options.password && !req.headers['authorization']) {

        const md5sum = crypto.createHash('md5')
        md5sum.update(crypto.randomBytes(256))
        nonce = md5sum.digest('hex')

        res.statusCode = 401
        res.headers['www-authenticate'] = `Digest realm="roap", nonce="${nonce}"`
        res.send()

    } else if (rtspServer.options.password && req.headers['authorization']) {

        const auth = req.headers['authorization']

        const params = auth.split(/, /g)
        const map = {}
        params.forEach(param => {
            const pair = param.replace(/["]/g, '').split('=')
            map[pair[0]] = pair[1]
        })

        const expectedResponse = tools.generateRfc2617Response('iTunes', 'roap',
                                                               rtspServer.options.password,
                                                               nonce, map["uri"], 'ANNOUNCE')
        const receivedResponse = map["response"]

        if (expectedResponse === receivedResponse) {
            announceParse(rtspServer, req, res)
        } else {
            res.statusCode = 401
            res.send()
        }

    } else {
        announceParse(rtspServer, req, res)
    }
}

function record(req: ServerRequest, res: Response) {
    if (!req.headers['rtp-info']) {
        // jscs:disable
        // it seems like iOS airplay does something else
    } else {
        const rtpInfo = req.headers['rtp-info'].split(';')
        const initSeq = rtpInfo[0].split('=')[1]
        const initRtpTime = rtpInfo[1].split('=')[1]
        if (!initSeq || !initRtpTime) {
            res.statusCode = 400
            res.send()
        } else {
            res.headers['audio-latency'] = '0' // FIXME
        }
    }

    res.send()
}

function flush(req: ServerRequest, res: Response) {
    res.headers['rtp-info'] = 'rtptime=1147914212' // FIXME
    res.send()
}

function teardown(rtspServer: RtspServer, req: ServerRequest, res: Response) {
    rtspServer.rtp.stop()
    res.send()
}


function setParameter(rtspServer: RtspServer, req: ServerRequest, res: Response) {
    if (req.headers['content-type'] == 'application/x-dmap-tagged') {

        // metadata dmap/daap format
        const dmapData = tools.parseDmap(req.content)
        rtspServer.metadata = dmapData
        rtspServer.external.emit('metadataChange', rtspServer.metadata)
        log('received metadata (%s)', JSON.stringify(rtspServer.metadata))

    } else if (req.headers['content-type'] == 'image/jpeg') {

        rtspServer.metadata.artwork = req.content
        rtspServer.external.emit('artworkChange', req.content)
        log('received artwork (length: %s)', rtspServer.metadata.artwork.length)

    } else if (req.headers['content-type'] == 'text/parameters') {

        const data = req.content.toString().split(': ')
        rtspServer.metadata = rtspServer.metadata || {}

        log('received text metadata (%s: %s)', data[0], data[1].trim())

        if (data[0] == 'volume') {
            rtspServer.metadata.volume = parseFloat(data[1])
            rtspServer.external.emit('volumeChange', rtspServer.metadata.volume)

        } else if (data[0] == 'progress') {

            rtspServer.metadata.progress = data[1]
            rtspServer.external.emit('progressChange', rtspServer.metadata.progress)

        }

    } else {
        log(`uncaptured SET_PARAMETER method: ${req.content.toString().trim()}`)
    }

    res.send()
}

function getParameter(req: ServerRequest, res: Response) {
    log(`uncaptured GET_PARAMETER method: ${req.content.toString().trim()}`)
    res.send()
}

export type MethodCallback = (req: ServerRequest, res: Response) => void

export interface RtspMethods {
    OPTIONS: MethodCallback
    ANNOUNCE: MethodCallback
    SETUP: MethodCallback
    RECORD: MethodCallback
    FLUSH: MethodCallback
    TEARDOWN: MethodCallback
    SET_PARAMETER: MethodCallback
    GET_PARAMETER: MethodCallback
}

export function mapRtspMethods(rtspServer: RtspServer): RtspMethods {
    return {
        OPTIONS: options.bind(null, rtspServer),
        ANNOUNCE: announce.bind(null, rtspServer),
        SETUP: setup.bind(null, rtspServer),
        RECORD: record,
        FLUSH: flush,
        TEARDOWN: teardown.bind(null, rtspServer),
        SET_PARAMETER: setParameter.bind(null, rtspServer), // metadata, volume control
        GET_PARAMETER: getParameter, // asked for by iOS?
    }
}
