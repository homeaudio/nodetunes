import { ServerParser } from 'httplike'
import { inspect } from 'util'
import { Socket } from 'net'
import { RtpServer } from './rtp'
import { mapRtspMethods, RtspMethods } from './rtspmethods'
import { NodeTunes, NodeTunesOptions } from '.'
import { OutputStream } from './streams/output'

let debug = require('debug')('nodetunes:rtsp')
const error = require('debug')('nodetunes:error')


export interface RtspMetadata {
    artwork?: Buffer
    volume?: number
    progress?: string
    clientName?: string
}

export class RtspServer {

    external: NodeTunes
    options: NodeTunesOptions
    rtp: RtpServer
    macAddress: string
    socket: Socket
    handling: Socket | null = null
    ports: number[] = []
    outputStream: OutputStream | null = null
    controlTimeout: number
    clientConnected: Socket | null = null
    ipv6 = false  // true iff ipv6 usage is detected.
    methodMapping: RtspMethods
    audioAesKey: string
    audioAesIv: Buffer
    audioCodec: string
    audioOptions: string[]
    metadata: RtspMetadata = {}

    constructor(options: NodeTunesOptions, external: NodeTunes) {
        // HACK: need to reload debug here (https://github.com/visionmedia/debug/issues/150)
        debug = require('debug')('nodetunes:rtsp')
        this.external = external
        this.options = options
        this.rtp = new RtpServer(this)
        this.macAddress = options.macAddress
        this.controlTimeout = options.controlTimeout
        this.methodMapping = mapRtspMethods(this)
    }

    connectHandler(socket: Socket) {
        if (this.handling && !this.clientConnected) {
            socket.end()
            return
        }

        this.socket = socket
        this.handling = this.socket

        socket.id = new Date().getTime()

        const parser = new ServerParser(socket, {
            protocol: 'RTSP/1.0',
            statusMessages: {
                453: 'NOT ENOUGH BANDWIDTH',
            },
        })

        parser.on('message', (req, res) => {

            res.set('CSeq', req.getHeader('CSeq'))
            res.set('Server', 'AirTunes/105.1')

            // TODO maybe this typing should be enforced further down?
            const methodType: keyof RtspMethods = req.method
            const method = this.methodMapping[methodType]

            if (method) {
                debug('received method %s (CSeq: %s)\n%s', req.method, req.getHeader('CSeq'), inspect(req.headers))
                method(req, res)
            } else {
                error('received unknown method:', req.method)
                res.send(400)
                socket.end()
            }

        })

        socket.on('close', () => this.disconnectHandler(socket))
    }

    timeoutHandler() {
        debug('client timeout detected (no ping in %s seconds)', this.controlTimeout)
        if (this.clientConnected)
            this.clientConnected.destroy()
    }

    disconnectHandler(socket: Socket) {
        // handle case where multiple connections are being sought,
        // but none have fully connected yet
        if (socket === this.handling) {
            this.handling = null
        }

        // handle case where "connected" client has been disconnected
        if (this.socket === this.clientConnected) {
            debug('client disconnected')

            this.clientConnected = null
            this.outputStream = null
            this.rtp.stop()
            this.external.emit('clientDisconnected')
        }

    }

    stop() {
        this.rtp.stop()
    }

}
