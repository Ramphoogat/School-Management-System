import { useEffect, useState } from 'react'

/** Loudness (0 to 1) of one block of samples, as the root mean square of bytes centred on 128 (silence). */
export function level(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) { const v = (samples[i] - 128) / 128; sum += v * v }
  return Math.sqrt(sum / samples.length)
}

/** Above this someone is talking. Low enough for a quiet voice, high enough to ignore steady background hiss. */
export const SPEAKING_LEVEL = 0.04
/** Keep showing "speaking" briefly after the last loud moment so the ring does not flicker between words. */
export const HOLD_MS = 350

/** Decides speaking or not from a stream of levels, with the short hold. */
export function createSpeakingGate(now: () => number = Date.now) {
  let last = -Infinity
  return (lvl: number): boolean => {
    const t = now()
    if (lvl >= SPEAKING_LEVEL) last = t
    return t - last <= HOLD_MS
  }
}

let ctx: AudioContext | null = null
const audioContext = () => {
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return (ctx = Ctor ? new Ctor() : null)
}

/** True while the stream's audio is loud enough to be speech. Never plays anything; it only listens to the level. */
export function useSpeaking(stream: MediaStream | null, active = true): boolean {
  const [speaking, setSpeaking] = useState(false)
  useEffect(() => {
    if (!stream || !active) { setSpeaking(false); return }
    const ac = audioContext()
    if (!ac || stream.getAudioTracks().length === 0) return
    let node: MediaStreamAudioSourceNode
    try { node = ac.createMediaStreamSource(stream) } catch { return }
    const analyser = ac.createAnalyser()
    analyser.fftSize = 512
    node.connect(analyser) // not connected onwards, so nothing is heard twice
    const buf = new Uint8Array(analyser.fftSize)
    const gate = createSpeakingGate()
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(buf)
      setSpeaking(gate(level(buf)))
    }, 120)
    return () => { clearInterval(timer); node.disconnect(); setSpeaking(false) }
  }, [stream, active])
  return speaking
}
