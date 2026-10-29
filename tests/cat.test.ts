import { expect, test } from 'claude-code/testing'

import { activity } from '../hooks/activity.ts'
import { CAT_H, CAT_W, FLICK_EVERY, catFrames, catPose, catSprite } from '../hooks/cat.ts'
import { PALETTES } from '../hooks/palette.ts'
import type { Sprite } from '../hooks/sprite.ts'
import { FAILED, FINISHED, NOLOG, RUNNING, T, THINKING } from './fixtures.ts'

const cells = (sp: Sprite): (number | null)[][] => Array.from({ length: sp.h }, (_, y) => Array.from({ length: sp.w }, (_, x) => sp.at(x, y)))

test('cat: every frame fits the box and is drawn in inkDim with ink eyes', () => {
  for (const p of Object.values(PALETTES)) {
    const f = catFrames(p)
    expect(catFrames(p)).toBe(f) // parsed once per palette
    for (const sp of [f.asleep, f.sitting, f.flick]) {
      expect(sp.w <= CAT_W && sp.h <= CAT_H).toBe(true)
      for (const c of cells(sp).flat()) if (c != null && c !== p.inkDim && c !== p.ink) throw new Error(`${p.id}: colour ${c.toString(16)}`)
    }
    const eyes = (sp: Sprite) => cells(sp).flat().filter(c => c === p.ink).length
    expect(eyes(f.asleep)).toBe(0) // asleep: eyes closed
    expect(eyes(f.sitting)).toBe(2)
    expect(eyes(f.flick)).toBe(2)
  }
})

test('cat: two ears on top, a tail at the back, and the flick moves only the tail', () => {
  const p = PALETTES.night
  const f = catFrames(p)
  for (const sp of [f.asleep, f.sitting, f.flick]) {
    // Ears: the top row holds exactly two pixels with a gap between them.
    const top = cells(sp)[0]!.map((c, x) => (c == null ? -1 : x)).filter(x => x >= 0)
    expect(top.length).toBe(2)
    expect(top[1]! - top[0]! >= 2).toBe(true)
  }
  // Sitting: a tail pixel in the first column, apart from the body above the bottom row.
  for (const sp of [f.sitting, f.flick]) expect(cells(sp).slice(0, -1).some(row => row[0] != null && row[1] == null)).toBe(true)
  const a = cells(f.sitting)
  const b = cells(f.flick)
  let changed = 0
  for (let y = 0; y < a.length; y++) for (let x = 0; x < 2; x++) if (a[y]![x] !== b[y]![x]) changed++
  expect(changed > 0).toBe(true)
  // The head (columns 2 and on, top three rows) is the same in both.
  for (let y = 0; y < 3; y++) for (let x = 2; x < a[y]!.length; x++) expect(b[y]![x]).toBe(a[y]![x]!)
})

test('cat: asleep while the worker waits or thinks, sitting during a tool call and once done', () => {
  const pose = (s: typeof RUNNING) => catPose(activity(s, T), 12).pose
  expect(activity(RUNNING, T).state).toBe('tool')
  expect(pose(RUNNING)).toBe('sitting')
  expect(pose(THINKING)).toBe('asleep')
  expect(pose(FINISHED)).toBe('sitting')
  expect(pose(FAILED)).toBe('sitting')
  expect(pose(NOLOG)).toBe('asleep')
  for (const state of ['waiting', 'prefill', 'thinking', 'stalled', 'nolog'] as const) {
    expect(catPose({ ...activity(RUNNING, T), state }, 0)).toEqual({ pose: 'asleep', flick: false })
  }
})

test('cat: the tail flicks for two frames in every FLICK_EVERY while awake, never asleep', () => {
  const tool = activity(RUNNING, T)
  const flicks = Array.from({ length: FLICK_EVERY * 3 }, (_, f) => catPose(tool, f).flick)
  expect(flicks.filter(Boolean).length).toBe(6)
  expect(catPose(tool, 0).flick).toBe(true)
  expect(catPose(tool, 2).flick).toBe(false)
  const think = activity(THINKING, T)
  for (let f = 0; f < FLICK_EVERY; f++) expect(catPose(think, f).flick).toBe(false)
  const p = PALETTES.night
  expect(catSprite(p, 'sitting', true)).toBe(catFrames(p).flick)
  expect(catSprite(p, 'sitting', false)).toBe(catFrames(p).sitting)
  expect(catSprite(p, 'asleep', true)).toBe(catFrames(p).asleep)
})
