import * as crypto from 'crypto'
import * as debug from 'debug'
import { createSocket, Socket } from 'dgram'

import { decryptAudioData } from './tools'
import { RtspServer } from './rtsp'

const log = debug('nodetunes:rtp')

export class RtpServer {

    rtspServer: RtspServer
    baseServer: Socket
    controlServer: Socket
    timingServer: Socket
    timeoutCounter: number
    timeoutChecker: NodeJS.Timer | null

    constructor(rtspServer: RtspServer) {
        this.rtspServer = rtspServer

    }

    start() {
        log('starting rtp servers')

        const socketType = this.rtspServer.ipv6 ? 'udp6' : 'udp4'

        this.baseServer = createSocket(socketType)
        this.controlServer = createSocket(socketType)
        this.timingServer = createSocket(socketType)

        this.baseServer.bind(this.rtspServer.ports[0])
        this.controlServer.bind(this.rtspServer.ports[1])
        this.timingServer.bind(this.rtspServer.ports[2])

        this.timeoutCounter = -1
        this.timeoutChecker = null

        this.baseServer.on('message', (msg: Buffer) => {
            const seq = msg.readUInt16BE(2)
            const audio = decryptAudioData(msg, this.rtspServer.audioAesKey,
                                           this.rtspServer.audioAesIv)
            if (this.rtspServer.outputStream) {
                this.rtspServer.outputStream.add(audio, seq)
            }

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

            log('stopping rtp servers')

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
