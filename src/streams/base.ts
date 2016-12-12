import * as PriorityQueue from 'priorityqueuejs'
import { Readable } from 'stream'


export interface Data {
    chunk: any,
    sequenceNumber: number
}

export class BaseDecoderStream extends Readable {

    isFlowing = true
    bufferQueue: PriorityQueue<Data>

    constructor() {
        super()
        this.bufferQueue = new PriorityQueue<Data>((a, b) => b.sequenceNumber -
                                                             a.sequenceNumber)
    }

    add(chunk: any, sequenceNumber: number, isRetransmit?: boolean) {
        this._push({ chunk: chunk, sequenceNumber: sequenceNumber })
    }

    _push(data: Data) {
        if (this.isFlowing) {
            const result = this.push(data.chunk)
            if (!result) {
                this.isFlowing = false
            }
            return result
        } else {
            this.bufferQueue.enq(data)
            return false
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
