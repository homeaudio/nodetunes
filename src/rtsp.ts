import { ServerParser, ServerRequest, Response } from 'httplike'
import * as debug from 'debug'
import { inspect } from 'util'
import { Socket } from 'net'
import { RtpServer } from './rtp'
import { mapRtspMethods, RtspMethods } from './rtspmethods'
import { NodeTunes, NodeTunesOptions } from '.'
import { OutputStream } from './streams/output'

const log = debug('nodetunes:rtsp')
const error = debug('nodetunes:error')

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

        // I don't think this guy is needed?
        // socket.id = new Date().getTime()

        const parser = new ServerParser(socket, {
            protocol: 'RTSP/1.0',
            statusMessages: {
                453: 'NOT ENOUGH BANDWIDTH',
            },
        })

        parser.on('message', (req: ServerRequest, res: Response) => {

            res.headers['cseq'] = req.headers['cseq']
            res.headers['server'] = 'AirTunes/105.1'

            // TODO maybe this typing should be enforced further down?
            const methodType: keyof RtspMethods = req.method
            const method = this.methodMapping[methodType]

            if (method) {
                log(`received method ${req.method} (CSeq: ${req.headers['cseq']})\n${inspect(req.headers)}`)
                method(req, res)
            } else {
                error('received unknown method:', req.method)
                res.statusCode = 400
                res.send()
                socket.end()
            }

        })

        socket.on('close', () => this.disconnectHandler(socket))
    }

    timeoutHandler() {
        log('client timeout detected (no ping in %s seconds)', this.controlTimeout)
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
            log('client disconnected')

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
