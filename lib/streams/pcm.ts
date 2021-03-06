import { Transform } from 'stream'

export class PcmDecoderStream extends Transform {

    _transform(pcmData: Buffer, encoding: string, callback: Function) {
        const swapBuf = new Buffer(pcmData.length)

        // endian hack
        for (let i = 0; i < pcmData.length; i += 2) {
            swapBuf[i] = pcmData[i + 1]
            swapBuf[i + 1] = pcmData[i]
        }

        callback(null, swapBuf)
    }

}
