import * as crypto from 'crypto'
import * as dgram from 'dgram'

const tools = require('./helper')
let debug = require('debug')('nodetunes:rtp')
import { RtspServer } from './rtsp'

export class RtpServer {

    rtspServer: RtspServer
    baseServer: dgram.Socket
    controlServer: dgram.Socket
    timingServer: dgram.Socket
    timeoutCounter: number
    timeoutChecker: NodeJS.Timer | null

    constructor(rtspServer: RtspServer) {
        this.rtspServer = rtspServer
        // HACK: need to reload debug here (https://github.com/visionmedia/debug/issues/150)
        debug = require('debug')('nodetunes:rtp')
    }

    start() {
        debug('starting rtp servers')

        const socketType = this.rtspServer.ipv6 ? 'udp6' : 'udp4'

        this.baseServer = dgram.createSocket(socketType)
        this.controlServer = dgram.createSocket(socketType)
        this.timingServer = dgram.createSocket(socketType)

        this.baseServer.bind(this.rtspServer.ports[0])
        this.controlServer.bind(this.rtspServer.ports[1])
        this.timingServer.bind(this.rtspServer.ports[2])

        this.timeoutCounter = -1
        this.timeoutChecker = null

        this.baseServer.on('message', msg => {
            const seq = msg.readUInt16BE(2)
            const audio = tools.decryptAudioData(msg, this.rtspServer.audioAesKey,
                                                 this.rtspServer.audioAesIv)
            this.rtspServer.outputStream.add(audio, seq)

        })

        this.controlServer.on('message', msg => {

            // timeout logic for socket disconnects
            if (this.timeoutCounter === -1 && this.rtspServer.controlTimeout) {

                this.timeoutChecker = setInterval(() => {
                    this.timeoutCounter += 1
                    if (this.timeoutCounter >= this.rtspServer.controlTimeout) {
                        this.rtspServer.timeoutHandler()
                    }

                }, 1000)

            }

            this.timeoutCounter = 0

        })

        // TODO why the empty callback here?
        this.timingServer.on('message', msg => {})

    }

    stop() {
        if (this.baseServer) {

            debug('stopping rtp servers')

            try {
                if (this.timeoutChecker) {
                    clearInterval(this.timeoutChecker)
                }
                this.baseServer.close()
                this.controlServer.close()
                this.timingServer.close()
            } catch (err) {

            }
        }
    }

}
