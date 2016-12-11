'use strict'

var Readable = require('readable-stream').Readable
var PriorityQueue = require('priorityqueuejs')

class BaseDecoderStream extends Readable {

    constructor() {
        super()
        this.isFlowing = true
        this.bufferQueue = new PriorityQueue((a, b) => b.sequenceNumber -
                                                       a.sequenceNumber)
    }

    add(chunk, sequenceNumber, isRetransmit) {
        this._push({ chunk: chunk, sequenceNumber: sequenceNumber })
    }

    _push(data) {
        if (this.isFlowing) {
            const result = this.push(data.chunk)
            if (!result) {
                this.isFlowing = false
            }
            return result
        } else {
            this.bufferQueue.enq(data)
        }
    }

    _read() {
        this.isFlowing = true
        if (this.bufferQueue.size() === 0) return
        while (this.bufferQueue.size() > 0) {
            if (!this._push(this.bufferQueue.deq())) return
        }
    }

}

module.exports = BaseDecoderStream
