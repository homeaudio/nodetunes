'use strict'

const net = require('net')
const ServerParser = require('httplike')
const tools = require('./helper')
const RtpServer = require('./rtp')
const httplike = require('httplike')
let debug = require('debug')('nodetunes:rtsp')
const error = require('debug')('nodetunes:error')
const util = require('util')

class RtspServer {

    constructor(options, external) {
        // HACK: need to reload debug here (https://github.com/visionmedia/debug/issues/150)
        debug = require('debug')('nodetunes:rtsp')

        this.external = external
        this.options = options

        this.ports = []

        this.rtp = new RtpServer(this)
        this.macAddress = options.macAddress
        this.metadata = {}
        this.outputStream = null

        this.handling = null
        this.clientConnected = null
        this.controlTimeout = options.controlTimeout

        this.methodMapping = require('./rtspmethods')(this)
    }

    connectHandler(socket) {
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

        parser.on('message', function (req, res) {

            res.set('CSeq', req.getHeader('CSeq'))
            res.set('Server', 'AirTunes/105.1')

            const method = this.methodMapping[req.method]

            if (method) {
                debug('received method %s (CSeq: %s)\n%s', req.method, req.getHeader('CSeq'), util.inspect(req.headers))
                method(req, res)
            } else {
                error('received unknown method:', req.method)
                res.send(400)
                socket.end()
            }

        }.bind(this))

        socket.on('close', this.disconnectHandler.bind({ self: this, socket: socket }))
    }

    timeoutHandler() {
        debug('client timeout detected (no ping in %s seconds)', this.controlTimeout)
        if (this.clientConnected)
            this.clientConnected.destroy()
    }

    disconnectHandler() {
        // keep in mind 'this' is bound to an object that looks like { self: this, socket: socket }
        // (see above)

        // handle case where multiple connections are being sought,
        // but none have fully connected yet
        if (this.socket === this.self.handling) {
            this.self.handling = null
        }

        // handle case where "connected" client has been disconnected
        if (this.socket === this.self.clientConnected) {
            debug('client disconnected')

            this.self.clientConnected = null
            this.self.outputStream = null
            this.self.rtp.stop()
            this.self.external.emit('clientDisconnected')
        }

    }

    stop() {
        this.rtp.stop()
    }

}

module.exports = RtspServer
