import { expect, test } from 'claude-code/testing'

import { PALETTES } from '../hooks/palette.ts'
import { FIREWORK_SECS, holidayOf, litLight, seasonOf, seasonTones, weather } from '../hooks/seasons.ts'
import type { Season } from '../hooks/seasons.ts'

/** Epoch seconds for a local date and time (month 1-based), unambiguous in any zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime() / 1000

const SEASONS: Season[] = ['winter', 'spring', 'summer', 'autumn', 'none']

test('seasons: auto follows the local month', () => {
  const want: [number, Season][] = [[1, 'winter'], [2, 'winter'], [3, 'spring'], [5, 'spring'], [6, 'summer'], [7, 'summer'], [8, 'summer'], [9, 'autumn'], [11, 'autumn'], [12, 'winter']]
  for (const [m, s] of want) {
    expect(seasonOf(at(2026, m, 15))).toBe(s)
    expect(seasonOf(at(2026, m, 15), 'auto')).toBe(s)
  }
  expect(seasonOf(at(2026, 7, 15))).toBe('summer')
})

test('seasons: a fixed setting wins over the date; an unknown one falls back to auto', () => {
  for (const s of SEASONS) expect(seasonOf(at(2026, 7, 15), s)).toBe(s)
  expect(seasonOf(at(2026, 1, 15), 'monsoon')).toBe('winter')
})

test('seasons: holidays by the local date', () => {
  expect(holidayOf(at(2026, 10, 31))).toBe('halloween')
  expect(holidayOf(at(2026, 10, 31, 0, 0, 1))).toBe('halloween')
  expect(holidayOf(at(2026, 10, 30, 23, 59, 59))).toBe(null)
  expect(holidayOf(at(2026, 11, 1))).toBe(null)
  expect(holidayOf(at(2026, 12, 19, 23, 59))).toBe(null)
  expect(holidayOf(at(2026, 12, 20, 0, 0))).toBe('lights')
  expect(holidayOf(at(2026, 12, 24))).toBe('lights')
  expect(holidayOf(at(2026, 12, 31, 23, 59, 59))).toBe('lights')
  expect(holidayOf(at(2027, 1, 1, 0, 0, 0))).toBe('newyear')
  expect(holidayOf(at(2027, 1, 1, 0, 0, FIREWORK_SECS - 1))).toBe('newyear')
  expect(holidayOf(at(2027, 1, 1, 0, 0, FIREWORK_SECS))).toBe('lights')
  expect(holidayOf(at(2027, 1, 1, 18))).toBe('lights')
  expect(holidayOf(at(2027, 1, 2))).toBe(null)
  expect(holidayOf(at(2026, 7, 15))).toBe(null)
})

test('seasons: weather stays in the window, is deterministic per frame and moves', () => {
  const t = at(2026, 7, 15)
  for (const [w, h] of [[12, 3], [24, 8], [3, 1], [40, 16]] as [number, number][]) {
    for (const s of SEASONS) {
      for (let f = 0; f < 40; f++) {
        const sp = weather(s, null, t, f, w, h)
        expect(sp).toEqual(weather(s, null, t, f, w, h))
        for (const p of sp) if (!(p.x >= 0 && p.x < w && p.y >= 0 && p.y < h && Number.isInteger(p.x) && Number.isInteger(p.y))) throw new Error(`${s} ${w}×${h} frame ${f}: ${JSON.stringify(p)}`)
      }
    }
  }
  expect(weather('summer', null, t, 3, 12, 3)).toEqual([])
  expect(weather('none', null, t, 3, 12, 3)).toEqual([])
  expect(weather('autumn', null, t, 3, 12, 3).length).toBe(2) // two leaves
  expect(weather('spring', null, t, 3, 12, 3).length).toBe(4) // two clouds, two pixels each
  expect(weather('winter', null, t, 3, 12, 3).length >= 3).toBe(true)
  const moves = (s: Season) => [0, 5, 10, 15, 20].some(f => JSON.stringify(weather(s, null, t, f, 24, 8)) !== JSON.stringify(weather(s, null, t, 0, 24, 8)))
  for (const s of ['winter', 'spring', 'autumn'] as Season[]) expect(moves(s)).toBe(true)
  expect(weather('winter', null, t, 0, 2, 3)).toEqual([]) // too small a window: nothing
})

test('seasons: the firework is one ring of sparks around the middle that grows', () => {
  const t0 = at(2027, 1, 1, 0, 0, 0)
  const t8 = at(2027, 1, 1, 0, 0, 8)
  const a = weather('winter', 'newyear', t0, 0, 24, 8)
  const b = weather('winter', 'newyear', t8, 0, 24, 8)
  expect(a.length).toBe(9)
  const spread = (sp: { x: number }[]) => Math.max(...sp.map(p => p.x)) - Math.min(...sp.map(p => p.x))
  expect(spread(b) > spread(a)).toBe(true)
  for (const p of weather('none', 'newyear', t8, 0, 12, 3)) expect(p.x >= 0 && p.x < 12 && p.y >= 0 && p.y < 3).toBe(true)
})

test('seasons: tones come from the palette, once per palette', () => {
  for (const p of Object.values(PALETTES)) {
    const s = seasonTones(p)
    expect(seasonTones(p)).toBe(s)
    expect(s.sky.none).toBe(p.sky)
    expect(s.speck[0]).toBe(p.star)
    expect(s.lights).toEqual([p.bad, p.good, p.warn])
    expect(s.speck.length).toBe(4)
    expect(s.sparks.length).toBe(4)
  }
  expect(seasonTones(PALETTES.paper).daySky).not.toBe(seasonTones(PALETTES.night).daySky)
})

test('seasons: the string of lights takes turns', () => {
  expect([0, 4, 8, 12].map(litLight)).toEqual([0, 1, 2, 0])
})
