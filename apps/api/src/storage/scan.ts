import { createConnection } from 'node:net'
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'

/**
 * Optional virus scanning through a ClamAV daemon (clamd). Set CLAMAV_HOST (and CLAMAV_PORT, default 3310) to turn it on.
 * With it on, a file is stored only if clamd says it is clean; if clamd cannot be reached the upload is refused, never waved through.
 * With it off (the default) nothing is scanned.
 */
export const scanningEnabled = () => !!process.env.CLAMAV_HOST

const CHUNK = 64 * 1024

/** Sends the bytes to clamd with its INSTREAM command and returns its verdict line, e.g. "stream: OK" or "stream: Eicar-Test-Signature FOUND". */
function askClamd(data: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: process.env.CLAMAV_HOST!, port: Number(process.env.CLAMAV_PORT ?? 3310) })
    const chunks: Buffer[] = []
    socket.setTimeout(Number(process.env.CLAMAV_TIMEOUT_MS ?? 20_000), () => { socket.destroy(); reject(new Error('scan timed out')) })
    socket.on('error', reject)
    socket.on('data', (d) => chunks.push(d))
    socket.on('close', () => (chunks.length ? resolve(Buffer.concat(chunks).toString().replace(/\0/g, '').trim()) : reject(new Error('no answer from scanner'))))
    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK)
        const len = Buffer.alloc(4)
        len.writeUInt32BE(part.length)
        socket.write(len)
        socket.write(part)
      }
      socket.write(Buffer.alloc(4)) // zero-length chunk ends the stream
    })
  })
}

/** Throws unless the file is clean (or scanning is off). */
export async function assertClean(data: Buffer) {
  if (!scanningEnabled()) return
  let verdict: string
  try {
    verdict = await askClamd(data)
  } catch {
    throw new ServiceUnavailableException('Files cannot be checked for viruses right now. Please try again shortly.')
  }
  if (/\bOK$/.test(verdict)) return
  if (/FOUND$/.test(verdict)) throw new UnprocessableEntityException('This file was blocked because it looks like a virus.')
  throw new ServiceUnavailableException('Files cannot be checked for viruses right now. Please try again shortly.')
}
