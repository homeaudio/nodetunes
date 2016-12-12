import * as crypto from 'crypto'
import * as fs from 'fs'
import * as forge from 'node-forge'

let debug = require('debug')('nodetunes:helper')

export function parseSdp(msg: string) {
    const multi = ['a', 'p', 'b']
    const lines = msg.split('\r\n')
    const output: { [key: string]: string | string[]} = {}

    for (let i = 0; i < lines.length; i++) {

        const sp = lines[i].split(/=(.+)?/)
        if (sp.length == 3) { // for some reason there's an empty item?
            if (multi.indexOf(sp[0]) != -1) { // some attributes are multiline...
                if (!output[sp[0]])
                    output[sp[0]] = []

                output[sp[0]].push(sp[1])
            } else {
                output[sp[0]] = sp[1]
            }
        }
    }

    return output
}

const DMAP_TYPES = {
    mper: 8,
    asal: 'str',
    asar: 'str',
    ascp: 'str',
    asgn: 'str',
    minm: 'str',
    astn: 2,
    asdk: 1,
    caps: 1,
    astm: 4,
}

export function parseDmap(buffer: Buffer) {
    const output = {}

    for (let i = 8; i < buffer.length;) {
        const itemType = buffer.slice(i, i + 4)
        const itemLength = buffer.slice(i + 4, i + 8).readUInt32BE(0)
        if (itemLength !== 0) {
            const data = buffer.slice(i + 8, i + 8 + itemLength)
            if (DMAP_TYPES[itemType] == 'str') {
                output[itemType.toString()] = data.toString()
            } else if (DMAP_TYPES[itemType] == 1) {
                output[itemType.toString()] = data.readUInt8(0)
            } else if (DMAP_TYPES[itemType] == 2) {
                output[itemType.toString()] = data.readUInt16BE(0)
            } else if (DMAP_TYPES[itemType] == 4) {
                output[itemType.toString()] = data.readUInt32BE(0)
            } else if (DMAP_TYPES[itemType] == 8) {
                output[itemType.toString()] = (data.readUInt32BE(0) << 8) + data.readUInt32BE(4)
            }
        }

        i += 8 + itemLength
    }

    return output
}

function getPrivateKey() {
    const keyFile = fs.readFileSync(__dirname + '/../private.key')
    return forge.pki.privateKeyFromPem(keyFile)
}

export const PRIVATE_KEY = getPrivateKey()

export function generateAppleResponse(challengeBuf: Buffer, ipAddr: Buffer, macAddr: Buffer) {
    // HACK: need to reload debug here (https://github.com/visionmedia/debug/issues/150)
    debug = require('debug')('nodetunes:helper') 
    debug('building challenge for %s (ip: %s, mac: %s)', challengeBuf.toString('base64'), ipAddr.toString('hex'), macAddr.toString('hex'))

    const fullChallengeUnpadded = Buffer.concat([challengeBuf, ipAddr, macAddr])

    // im sure there's an easier way to pad this buffer
    const padding = []
    for (let i = fullChallengeUnpadded.length; i < 32; i++) {
        padding.push(0)
    }

    const fullChallenge = Buffer.concat([fullChallengeUnpadded, new Buffer(padding)]).toString('binary')
    const response = forge.pki.rsa.encrypt(fullChallenge, PRIVATE_KEY, 0x01)
    debug('computed challenge: %s', forge.util.encode64(response))

    return forge.util.encode64(response)
}


function md5(content: string) {
    return crypto.createHash('md5').update(content).digest().toString('hex')
}

export function generateRfc2617Response(username: string, realm: string, password: string, 
                                        nonce: string, uri: string, method: string) {
    const ha1 = md5(username + ':' + realm + ':' + password)
    const ha2 = md5(method + ':' + uri)
    return md5(ha1 + ':' + nonce + ':' + ha2)
}

export function getDecoderOptions(audioOptions: string[]) {
    return !audioOptions ? {} : {
        frameLength: parseInt(audioOptions[1], 10),
        compatibleVersion: parseInt(audioOptions[2], 10),
        bitDepth: parseInt(audioOptions[3], 10),
        pb: parseInt(audioOptions[4], 10),
        mb: parseInt(audioOptions[5], 10),
        kb: parseInt(audioOptions[6], 10),
        channels: parseInt(audioOptions[7], 10),
        maxRun: parseInt(audioOptions[8], 10),
        maxFrameBytes: parseInt(audioOptions[9], 10),
        avgBitRate: parseInt(audioOptions[10], 10),
        sampleRate: parseInt(audioOptions[11], 10)
    }
}

export function decryptAudioData(data: Buffer, audioAesKey: string, 
                                 audioAesIv: Buffer, headerSize = 12) {
    const tmp = new Buffer(16)
    const remainder = (data.length - headerSize) % 16
    const endOfEncodedData = data.length - remainder

    const audioAesKeyBuffer = new Buffer(audioAesKey, 'binary')
    const decipher = crypto.createDecipheriv('aes-128-cbc', audioAesKeyBuffer, audioAesIv)
    decipher.setAutoPadding(false)

    for (let i = headerSize, l = endOfEncodedData - 16; i <= l; i += 16) {
        data.copy(tmp, 0, i, i + 16)
        decipher.update(tmp).copy(data, i, 0, 16)
    }

    return data.slice(headerSize)
}
