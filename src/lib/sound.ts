import type {SyntheticEvent} from 'react'

export type SoundMode = 'alerts' | 'all' | 'off'
export const soundModes: ReadonlyArray<SoundMode> = ['off', 'alerts', 'all']
export const shouldPlaySound = (mode: SoundMode, name: SoundName) => mode === 'all' || mode === 'alerts' && name !== 'click'

export type SoundName = 'click' | 'connect' | 'error' | 'lost' | 'restored' | 'signal'

type Note = {
  /** seconds after the start of the effect */
  at: number
  duration: number
  frequency: number
  /** target frequency for a glide */
  glide?: number
  type?: OscillatorType
  volume?: number
}

const effects: Record<SoundName, Array<Note>> = {
  click: [{
    at: 0,
    duration: 0.03,
    frequency: 1800,
    type: 'triangle',
    volume: 0.05,
  }],
  connect: [
    {
      at: 0,
      duration: 0.09,
      frequency: 660,
      type: 'sine',
    },
    {
      at: 0.08,
      duration: 0.14,
      frequency: 990,
      type: 'sine',
    },
  ],
  restored: [
    {
      at: 0,
      duration: 0.08,
      frequency: 520,
      type: 'sine',
    },
    {
      at: 0.07,
      duration: 0.08,
      frequency: 780,
      type: 'sine',
    },
    {
      at: 0.14,
      duration: 0.16,
      frequency: 1040,
      type: 'sine',
    },
  ],
  lost: [
    {
      at: 0,
      duration: 0.16,
      frequency: 440,
      glide: 330,
      type: 'triangle',
    },
    {
      at: 0.17,
      duration: 0.24,
      frequency: 330,
      glide: 220,
      type: 'triangle',
    },
  ],
  error: [{
    at: 0,
    duration: 0.22,
    frequency: 180,
    glide: 140,
    type: 'square',
    volume: 0.05,
  }],
  signal: [{
    at: 0,
    duration: 0.18,
    frequency: 900,
    glide: 120,
    type: 'sawtooth',
    volume: 0.05,
  }],
}
let context: AudioContext | undefined

/**
 * Plays a tiny synthesized sound effect. No assets are needed and nothing plays until the page received a user gesture.
 */
export const playSound = (name: SoundName, mode: SoundMode = 'all') => {
  if (!shouldPlaySound(mode, name)) {
    return
  }
  if (typeof AudioContext === 'undefined') {
    return
  }
  try {
    context ??= new AudioContext
    if (context.state === 'suspended') {
      void context.resume().catch(() => {})
    }
    const start = context.currentTime + 0.01
    for (const note of effects[name]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = note.type ?? 'sine'
      oscillator.frequency.setValueAtTime(note.frequency, start + note.at)
      if (note.glide) {
        oscillator.frequency.exponentialRampToValueAtTime(note.glide, start + note.at + note.duration)
      }
      const volume = note.volume ?? 0.08
      gain.gain.setValueAtTime(0, start + note.at)
      gain.gain.linearRampToValueAtTime(volume, start + note.at + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.duration)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start + note.at)
      oscillator.stop(start + note.at + note.duration + 0.02)
    }
  } catch {}
}

/** One quiet cue per menu action; typing and passive hover never beep. */
export const menuSoundHandlers = (mode: SoundMode, interactive = true) => (!interactive || mode !== 'all' ? {} : {
  onClickCapture: (event: SyntheticEvent) => {
    const target = event.target
    if (target instanceof Element && target.closest('button:not(:disabled), a[href], summary, [data-process-key]') && !target.closest('input, select, textarea')) {
      playSound('click', mode)
    }
  },
  onChangeCapture: (event: SyntheticEvent) => {
    const target = event.target
    if (target instanceof Element && target.matches('select, input[type=checkbox], input[type=radio]')) {
      playSound('click', mode)
    }
  },
})
