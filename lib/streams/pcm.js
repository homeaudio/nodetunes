'use strict'

const Transform = require('readable-stream').Transform

class PcmDecoderStream extends Transform {

    _transform(pcmData, enc, cb) {
        const swapBuf = new Buffer(pcmData.length)

        // endian hack
        for (var i = 0; i < pcmData.length; i += 2) {
            swapBuf[i] = pcmData[i + 1]
            swapBuf[i + 1] = pcmData[i]
        }

        cb(null, swapBuf)
    }

}

module.exports = PcmDecoderStream
