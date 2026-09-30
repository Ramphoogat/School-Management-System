/**
 * Small sound cues for call controls, made with the Web Audio API (no audio files to ship).
 * Each control has its own timbre so you can tell them apart without looking:
 *   mic       short two-note beeps (triangle)        muted = falling, unmuted = rising
 *   camera    soft chime arpeggio (sine)             on = three rising notes, off = two falling notes
 *   sharing   whoosh sweep (sawtooth, filtered)      start = sweep up, stop = sweep down
 *   joining   you: three notes up/down · others: quieter two-note blip up/down
 * They only play for you; nothing is sent to other people.
 */
export type Cue = 'mute' | 'unmute' | 'cameraOn' | 'cameraOff' | 'shareOn' | 'shareOff' | 'selfJoin' | 'selfLeave' | 'peerJoin' | 'peerLeave'

let ctx: AudioContext | null = null
const context = () => {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx ??= new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

const VOLUME = 0.12

function tone(c: AudioContext, type: OscillatorType, freq: number, start: number, dur: number, peak = VOLUME) {
  const o = c.createOscillator(), g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, start)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(peak, start + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g).connect(c.destination)
  o.start(start)
  o.stop(start + dur + 0.02)
}

function sweep(c: AudioContext, from: number, to: number, start: number, dur: number) {
  const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(from, start)
  o.frequency.exponentialRampToValueAtTime(to, start + dur)
  f.type = 'lowpass'
  f.frequency.setValueAtTime(1400, start)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(VOLUME * 0.7, start + 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(f).connect(g).connect(c.destination)
  o.start(start)
  o.stop(start + dur + 0.02)
}

export function playCue(cue: Cue) {
  try {
    const c = context()
    if (!c) return
    const t = c.currentTime + 0.01
    switch (cue) {
      case 'mute': tone(c, 'triangle', 660, t, 0.09); tone(c, 'triangle', 392, t + 0.1, 0.13); break
      case 'unmute': tone(c, 'triangle', 392, t, 0.09); tone(c, 'triangle', 660, t + 0.1, 0.13); break
      case 'cameraOn': [523, 659, 784].forEach((f, i) => tone(c, 'sine', f, t + i * 0.08, 0.16)); break
      case 'cameraOff': [659, 440].forEach((f, i) => tone(c, 'sine', f, t + i * 0.09, 0.16)); break
      case 'shareOn': sweep(c, 260, 1000, t, 0.28); tone(c, 'sine', 1200, t + 0.28, 0.1, VOLUME * 0.8); break
      case 'shareOff': sweep(c, 1000, 260, t, 0.28); break
      // Joining or leaving a call, like Discord: you get a fuller three-note version, others get a quieter two-note blip.
      case 'selfJoin': [494, 659, 880].forEach((f, i) => { tone(c, 'triangle', f, t + i * 0.07, 0.14); tone(c, 'sine', f * 2, t + i * 0.07, 0.1, VOLUME * 0.35) }); break
      case 'selfLeave': [880, 659, 440].forEach((f, i) => { tone(c, 'triangle', f, t + i * 0.07, 0.14); tone(c, 'sine', f * 2, t + i * 0.07, 0.1, VOLUME * 0.35) }); break
      case 'peerJoin': tone(c, 'sine', 587, t, 0.07, VOLUME * 0.75); tone(c, 'sine', 784, t + 0.07, 0.1, VOLUME * 0.75); break
      case 'peerLeave': tone(c, 'sine', 784, t, 0.07, VOLUME * 0.75); tone(c, 'sine', 494, t + 0.07, 0.11, VOLUME * 0.75); break
    }
  } catch {
    /* sound is a nicety; never let it break a call control */
  }
}
