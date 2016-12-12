import { PassThrough, Transform } from 'stream'
import { BaseDecoderStream } from './base'

export class OutputStream extends PassThrough {

    baseStream: BaseDecoderStream
    decoder: Transform | null

    constructor() {
        super()
        this.baseStream = new BaseDecoderStream()
        this.decoder = null
    }

    setDecoder(decoder: Transform) {
        this.decoder = decoder
        this.baseStream.pipe(decoder).pipe(this)
    }

    add(chunk: any, sequenceNumber: number) {
        this.baseStream.add(chunk, sequenceNumber)
    }
}
