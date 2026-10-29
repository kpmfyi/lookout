// The office cat (docs/DESIGN.md 28): a sprite (hooks/sprite.ts) in two frames, curled asleep and
// sitting up, plus the sitting frame with its tail flicked up. It faces right (the offices draw it
// left of the rack, facing it). Body in the palette's `inkDim`, eyes in `ink`, so it follows the
// palette (docs/DESIGN.md 27). One pixel of the picture is one Canvas pixel (1 × 2 per cell) in the
// office and a 2 × 2 sub-pixel block (half a cell) in office-hd, so both offices draw the same cat.
// With ambience on (docs/DESIGN.md 42) `catAmbient` gives it a little life: asleep, its back rises
// and falls and an ear twitches now and then; sitting, it blinks slowly.
import type { Activity } from './activity.ts'
import { ambientTones, breathe } from './ambience.ts'
import { hash, mix } from './canvas.ts'
import type { Palette, PaletteId } from './palette.ts'
import { sprite } from './sprite.ts'
import type { Sprite } from './sprite.ts'

/** Curled asleep: a loaf with its ears up at the head end (right), the tail curled under at the left. */
export const ASLEEP = `
  ..k.k
  .kkkk
  kkkkk
`

/** Sitting up, facing right: two ears, two eyes, the tail curving up behind. */
export const SITTING = `
  ..k.k
  ..kkk
  k.eke
  k.kkk
  .kkkk
`

/** Sitting with the tail flicked up. */
export const FLICK = `
  ..k.k
  k.kkk
  .keke
  ..kkk
  .kkkk
`

/** Asleep with its back (`b`) marked, the pixels whose tone rises and falls with a breath. */
export const ASLEEP_BACK = `
  ..k.k
  .bkkk
  bbkkk
`

/** Asleep with the near ear twitched flat. */
export const TWITCH = `
  ..k..
  .kkkk
  kkkkk
`

/** Sitting with its eyes closed: a slow blink. */
export const BLINK = `
  ..k.k
  ..kkk
  k.kkk
  k.kkk
  .kkkk
`

export type CatPose = 'asleep' | 'sitting'
export type CatFrames = {
  asleep: Sprite
  sitting: Sprite
  flick: Sprite
  /** Ambience (docs/DESIGN.md 42): the breath's steps, from rest (the plain loaf's tones) to the top. */
  breath: Sprite[]
  twitch: Sprite
  blink: Sprite
}

/** How many tones a breath steps through (rest to the top of the breath). */
export const BREATH_STEPS = 4

/** The widest frame and the tallest, for laying out a box that every pose fits in. */
export const CAT_W = 5
export const CAT_H = 5

const FRAMES = new Map<PaletteId, CatFrames>()

/** The three pictures in a palette's colours (parsed once per palette). */
export function catFrames(p: Palette): CatFrames {
  let f = FRAMES.get(p.id)
  if (!f) {
    const ink = { k: p.inkDim, e: p.ink }
    const back = ambientTones(p).catBack
    const breath = Array.from({ length: BREATH_STEPS }, (_, i) => sprite(ASLEEP_BACK, { k: p.inkDim, b: mix(p.inkDim, back, i / (BREATH_STEPS - 1)) }))
    f = { asleep: sprite(ASLEEP, ink), sitting: sprite(SITTING, ink), flick: sprite(FLICK, ink), breath, twitch: sprite(TWITCH, ink), blink: sprite(BLINK, ink) }
    FRAMES.set(p.id, f)
  }
  return f
}

/** The tail flicks for two frames in every 30 (about every four seconds) while the cat is awake. */
export const FLICK_EVERY = 30

/**
 * What the cat does: asleep while the worker waits, reads the prompt, thinks or stalls (and with no
 * log); sitting up during a tool call (watching the rack) and once the run is done. Awake, its tail
 * flicks now and then.
 */
export function catPose(a: Activity, frame: number): { pose: CatPose; flick: boolean } {
  const pose: CatPose = a.state === 'tool' || a.state === 'done' ? 'sitting' : 'asleep'
  return { pose, flick: pose === 'sitting' && frame % FLICK_EVERY < 2 }
}

/** The picture for a pose. */
export function catSprite(p: Palette, pose: CatPose, flick: boolean): Sprite {
  const f = catFrames(p)
  return pose === 'asleep' ? f.asleep : flick ? f.flick : f.sitting
}

/** A breath takes this long asleep. */
export const BREATH_SECS = 4
/** Sitting, the cat blinks slowly once in every BLINK_EVERY frames (about seven seconds), its eyes shut for BLINK_FRAMES. */
export const BLINK_EVERY = 58
export const BLINK_FRAMES = 3
/** Asleep, an ear may twitch once in every TWITCH_EVERY frames (twelve seconds), in about two of three. */
export const TWITCH_EVERY = 100

/**
 * The picture for a pose with ambience (docs/DESIGN.md 42): asleep, its back steps through the
 * breath's tones over BREATH_SECS and, now and then, an ear twitches flat for two frames; sitting,
 * it shuts its eyes for BLINK_FRAMES once in every BLINK_EVERY (never during a flick, which stays
 * the meaningful motion). Otherwise `catSprite`.
 */
export function catAmbient(p: Palette, pose: CatPose, flick: boolean, frame: number): Sprite {
  const f = catFrames(p)
  if (pose === 'sitting') return flick ? f.flick : (frame + 17) % BLINK_EVERY < BLINK_FRAMES ? f.blink : f.sitting
  const slot = Math.floor(frame / TWITCH_EVERY)
  const at = frame - slot * TWITCH_EVERY
  const twitch = at - Math.floor(hash(slot + 157) * (TWITCH_EVERY - 4))
  if (hash(slot + 151) < 0.65 && twitch >= 0 && twitch < 2) return f.twitch
  const step = Math.min(BREATH_STEPS - 1, Math.floor(breathe(frame, BREATH_SECS) * BREATH_STEPS))
  return f.breath[step]!
}
