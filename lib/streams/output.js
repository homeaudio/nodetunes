'use strict'

const PassThrough = require('readable-stream').PassThrough

const BaseStream = require('./base')

class OutputStream extends PassThrough {

    constructor() {
        super()
        this.baseStream = new BaseStream()
        this.decoder = null
    }

    setDecoder(decoder) {
        this.decoder = decoder
        this.baseStream.pipe(decoder).pipe(this)
    }

    add(chunk, sequenceNumber) {
        this.baseStream.add(chunk, sequenceNumber)
    }
}

module.exports = OutputStream
