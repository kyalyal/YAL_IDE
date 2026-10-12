import { DEFAULT_APP_SETTINGS } from '../../../shared/settings'

export interface ToneEvent {
  frequency: number
  startOffset: number
  duration: number
  waveform: OscillatorType
  gain: number
}

const tone = (frequency: number, startOffset: number, duration: number, gain = 0.3,
  waveform: OscillatorType = 'sine'): ToneEvent => ({ frequency, startOffset, duration, waveform, gain })

export function buildSchedule(soundId: string): ToneEvent[] {
  switch (soundId) {
    case 'bell': return [tone(880, 0, 0.85, 0.3), tone(1760, 0, 0.55, 0.08), tone(2640, 0, 0.3, 0.04)]
    case 'ping': return [tone(1320, 0, 0.38, 0.32)]
    case 'pop': return [tone(440, 0, 0.09, 0.38, 'triangle'), tone(660, 0.035, 0.08, 0.2)]
    case 'success': return [tone(523.25, 0, 0.28), tone(659.25, 0.15, 0.28), tone(783.99, 0.3, 0.28), tone(1046.5, 0.45, 0.45)]
    case 'soft': return [tone(261.63, 0, 0.55, 0.22), tone(329.63, 0.28, 0.6, 0.22)]
    case 'chime':
    default: return [tone(659.25, 0, 0.5), tone(987.77, 0.18, 0.65, 0.25)]
  }
}

let context: AudioContext | undefined

export async function playSound(soundId: string, volume: number): Promise<void> {
  try {
    if (typeof AudioContext === 'undefined') return
    if (!context || context.state === 'closed') context = new AudioContext()
    const audio = context
    if (audio.state === 'suspended') await audio.resume()
    const master = audio.createGain()
    master.gain.value = Number.isFinite(volume)
      ? Math.min(1, Math.max(0, volume)) : DEFAULT_APP_SETTINGS.sound.volume
    master.connect(audio.destination)
    const schedule = buildSchedule(soundId)
    const baseTime = audio.currentTime + 0.01
    let remaining = schedule.length
    for (const event of schedule) {
      const oscillator = audio.createOscillator()
      const envelope = audio.createGain()
      const start = baseTime + event.startOffset
      const end = start + event.duration
      oscillator.type = event.waveform
      oscillator.frequency.setValueAtTime(event.frequency, start)
      envelope.gain.setValueAtTime(0, start)
      envelope.gain.linearRampToValueAtTime(event.gain, start + 0.008)
      envelope.gain.exponentialRampToValueAtTime(0.0001, end - 0.01)
      envelope.gain.linearRampToValueAtTime(0, end)
      oscillator.connect(envelope)
      envelope.connect(master)
      oscillator.onended = () => {
        oscillator.disconnect()
        envelope.disconnect()
        if (--remaining === 0) master.disconnect()
      }
      oscillator.start(start)
      oscillator.stop(end)
    }
  } catch { /* Audio support or an output device may be unavailable. */ }
}
