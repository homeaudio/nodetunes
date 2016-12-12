import { EventEmitter } from 'events'
import * as mdns from 'mdns'
import * as net from 'net'
import * as portastic from 'portastic'
import * as randomMac from 'random-mac'

import { RtspServer } from './rtsp'

let debug = require('debug')('nodetunes:server')

function geneate_txt_record(password: string | null) {
    return {
        txtvers: '1',     // txt record version?
        ch: '2',          // # channels
        cn: '0,1',        // codec; 0=pcm, 1=alac, 2=aac, 3=aac elc; fwiw Sonos supports aac; pcm required for iPad+Spotify; OS X works with pcm
        et: '0,1',        // encryption; 0=none, 1=rsa, 3=fairplay, 4=mfisap, 5=fairplay2.5; need rsa for os x
        md: '0',          // metadata; 0=text, 1=artwork, 2=progress
        pw: password !== null ? 'true' : 'false',    // password enabled
        sr: '44100',          // sampling rate (e.g. 44.1KHz)
        ss: '16',             // sample size (e.g. 16 bit?)
        tp: 'TCP,UDP',        // transport protocol
        vs: '105.1',          // server version?
        am: 'AirPort4,107',   // device model
        ek: '1',              // ? from ApEx; setting to 1 enables iTunes; seems to use ALAC regardless of 'cn' setting
        sv: 'false',          // ? from ApEx
        da: 'true',           // ? from ApEx
        vn: '65537',          // ? from ApEx; maybe rsa key modulus? happens to be the same value
        fv: '76400.10',       // ? from ApEx; maybe AirPort software version (7.6.4)
        sf: '0x5'             // ? from ApEx
    }
}


export interface NodeTunesOptions {
    serverName: string
    macAddress: string
    recordDumps: boolean
    recordMetrics: boolean
    controlTimeout: number
    password: string | null
    verbose: boolean
}

function default_options(): NodeTunesOptions {
    return {
        serverName: 'NodeTunes',
        macAddress: randomMac().toUpperCase().replace(/:/g, ''),
        recordDumps: false,
        recordMetrics: false,
        controlTimeout: 5,
        verbose: false,
        password: null
    }
}

export class NodeTunes extends EventEmitter {

    options: NodeTunesOptions
    rtspServer: RtspServer
    netServer: net.Server | null
    advertisement: mdns.Advertisement

    constructor(options: Partial<NodeTunesOptions> = {}) {
        super()
        this.options = {...options, ...default_options()}

        if (this.options.verbose) {
            require('debug').enable('nodetunes:*')
            // HACK: need to reload debug here (https://github.com/visionmedia/debug/issues/150)
            debug = require('debug')('nodetunes:server')
        }

        this.netServer = null
        this.rtspServer = new RtspServer(this.options, this)
    }

    start(callback: Function) {

        console.log('starting nodetunes server (%s)', this.options.serverName)

        portastic.find({
            min: 5000,
            max: 5050,
            retrieve: 1,
        }).then((ports: number[]) => {
            const port = ports[0]
            this.netServer = net.createServer(this.rtspServer.connectHandler.bind(this.rtspServer))

            this.netServer.on('error', err => {
                if (err.code == 'EADDRINUSE') {
                    // we didn't get the port we wanted - probably a race condition on the port.
                    // Wait a second and try again.
                    setTimeout(() => {
                        this.netServer = null
                        this.start(callback)
                    }, 1000)
                } else {
                    throw err
                }
            })

            this.netServer.listen(port, () => {
                this.advertisement = mdns.createAdvertisement(mdns.tcp('raop'), port, {
                    name: this.options.macAddress + '@' + this.options.serverName,
                    txtRecord: geneate_txt_record(this.options.password),
                })
                this.advertisement.start()

                if (callback) {
                    callback(null, {
                        port: port,
                        macAddress: this.options.macAddress,
                    })
                }
                debug('broadcasting mdns advertisement (for port %s)', port)

            })

        }).catch((err: Error) => {
            if (callback) {
                callback(err)
            } else {
                throw err
            }
        })

    }

    stop() {
        debug('stopping nodetunes server')
        if (this.netServer) {
            this.netServer.close()
        }
        this.rtspServer.stop()
        this.advertisement.stop()
    }

}