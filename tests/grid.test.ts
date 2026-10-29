import { expect, test } from 'claude-code/testing'

import type { Summary } from '../types'
import { activity } from '../hooks/activity.ts'
import { GUTTER, drawGrid, gridColsFor, packModules } from '../hooks/grid.ts'
import type { Packed } from '../hooks/grid.ts'
import { HiCanvas } from '../hooks/hicanvas.ts'
import { DEFAULT_ORDER, MODULES } from '../hooks/modules/index.ts'
import type { ModuleCtx } from '../hooks/modules/index.ts'
import { ALL, NOLOG, RUNNING, T, THINKING, YOU_THINKING } from './fixtures.ts'

const UI = { view: 'fold', scene: 'office-hd', size: 'compact', source: 'worker' }
const ctxFor = (s: Summary, frame = 12): ModuleCtx => ({ s, a: activity(s, T), you: YOU_THINKING, frame, t: T, ui: UI })
const EVERY = Object.keys(MODULES)

function overlaps(p: Packed): string | null {
  for (let i = 0; i < p.boxes.length; i++) {
    for (let j = i + 1; j < p.boxes.length; j++) {
      const a = p.boxes[i]!.box
      const b = p.boxes[j]!.box
      if (a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h) return `${p.boxes[i]!.id} and ${p.boxes[j]!.id}`
    }
  }
  return null
}

function check(p: Packed, columns: number, label: string): void {
  const o = overlaps(p)
  if (o) throw new Error(`${label}: ${o} overlap`)
  let bottom = 0
  for (const { id, box } of p.boxes) {
    if (box.col < 0 || box.col + box.w > columns) throw new Error(`${label}: ${id} spills past ${columns} columns (${box.col}+${box.w})`)
    if (box.row < 0 || box.w <= 0 || box.h <= 0) throw new Error(`${label}: ${id} has a bad box`)
    const m = MODULES[id]!
    if (box.h < m.minH) throw new Error(`${label}: ${id} is ${box.h} rows, under its minH ${m.minH}`)
    if (box.h < 4 || box.h > 6) throw new Error(`${label}: ${id} is ${box.h} rows`)
    bottom = Math.max(bottom, box.row + box.h)
  }
  if (p.rows !== bottom) throw new Error(`${label}: rows ${p.rows}, boxes end at ${bottom}`)
}

test('grid: columns by pane width: 2 under 70, 3 under 100, 4 under 130, 5 beyond', () => {
  expect([40, 60, 69, 70, 80, 99, 100, 120, 129, 130, 144, 200].map(gridColsFor)).toEqual([2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5])
  for (const [columns, g] of [[60, 2], [80, 3], [120, 4], [144, 5]] as const) {
    expect(packModules(DEFAULT_ORDER, columns, ctxFor(RUNNING)).gridCols).toBe(g)
  }
  expect(packModules(DEFAULT_ORDER, 144, ctxFor(RUNNING), { gridCols: 3 }).gridCols).toBe(3)
})

test('grid: no overlaps, every box inside the columns, total rows consistent', () => {
  for (const columns of [40, 60, 80, 100, 120, 144, 200]) {
    for (const [name, s] of Object.entries(ALL)) {
      for (const ids of [DEFAULT_ORDER, EVERY, [...EVERY].reverse()]) {
        const p = packModules(ids, columns, ctxFor(s))
        check(p, columns, `${name} at ${columns}`)
      }
    }
  }
})

test('grid: modules are 1 or 2 grid cells wide (1 on a 2-wide grid), a cell gutter apart', () => {
  for (const columns of [60, 80, 120, 144]) {
    const p = packModules(EVERY, columns, ctxFor(RUNNING))
    const G = p.gridCols
    const cell = Math.floor((columns - (G - 1) * GUTTER) / G)
    for (const { id, box } of p.boxes) {
      const one = box.w >= cell && box.w <= cell + 1
      const two = box.w >= 2 * cell + GUTTER && box.w <= 2 * cell + GUTTER + 2
      if (!(one || two)) throw new Error(`${id} at ${columns}: width ${box.w}, cell ${cell}`)
      if (G === 2 && !one) throw new Error(`${id} at ${columns}: 2 cells on a 2-wide grid`)
    }
    // Modules side by side in a row are separated by the gutter.
    const byRow = new Map<number, { col: number; w: number }[]>()
    for (const { box } of p.boxes) byRow.set(box.row, [...(byRow.get(box.row) ?? []), box])
    for (const row of byRow.values()) {
      row.sort((a, b) => a.col - b.col)
      for (let i = 1; i < row.length; i++) expect(row[i]!.col - (row[i - 1]!.col + row[i - 1]!.w)).toBe(GUTTER)
    }
  }
})

test('grid: hidden modules are absent and unknown ids are skipped', () => {
  const ids = ['nope', ...DEFAULT_ORDER, 'counter:bogus', 'vu:prefill', 'dial:memory']
  const thinking = packModules(ids, 120, ctxFor(THINKING)).boxes.map(b => b.id)
  expect(thinking).not.toContain('nope')
  expect(thinking).not.toContain('counter:bogus')
  // THINKING has no server and no known context window.
  expect(thinking).not.toContain('vu:decode')
  expect(thinking).not.toContain('vu:prefill')
  expect(thinking).not.toContain('dial:ctx')
  expect(thinking).toContain('counter:turns')
  const running = packModules(ids, 120, ctxFor(RUNNING)).boxes.map(b => b.id)
  for (const id of [...DEFAULT_ORDER, 'vu:prefill', 'dial:memory']) expect(running).toContain(id)
  expect(running.length).toBe(DEFAULT_ORDER.length + 2)
  // No log: only the modules that need no log stay (none of the default order).
  const nolog = packModules(DEFAULT_ORDER, 80, ctxFor(NOLOG))
  expect(nolog.boxes.length).toBe(0)
  expect(nolog.rows).toBe(0)
})

test('grid: rows are row-major in the given order, as tall as their tallest module', () => {
  const p = packModules(DEFAULT_ORDER, 144, ctxFor(RUNNING))
  const rows = [...new Set(p.boxes.map(b => b.box.row))].sort((a, b) => a - b)
  for (const r of rows) {
    const inRow = p.boxes.filter(b => b.box.row === r)
    const h = Math.max(...inRow.map(b => MODULES[b.id]!.minH))
    for (const b of inRow) expect(b.box.h).toBe(h)
  }
  // The first module of the order starts the grid at the top left.
  expect(p.boxes[0]!.id).toBe(DEFAULT_ORDER[0])
  expect([p.boxes[0]!.box.col, p.boxes[0]!.box.row]).toEqual([0, 0])
})

test('grid: drawGrid fills one canvas of columns × rows and stays printable', () => {
  for (const columns of [60, 80, 120, 144]) {
    const ctx = ctxFor(RUNNING, 5)
    const p = packModules(EVERY, columns, ctx)
    const c = new HiCanvas(columns, p.rows)
    drawGrid(c, p, ctx)
    const bin = atob(c.encode())
    expect(bin.length).toBe(columns * p.rows * 12)
  }
})

test('grid: on a narrow pane a module squeezed under its minW still paints only its own box', () => {
  const NONE = 0x01000000
  for (const columns of [30, 40, 60]) {
    const ctx = ctxFor(RUNNING, 5)
    const p = packModules(EVERY, columns, ctx)
    check(p, columns, `narrow ${columns}`)
    for (const one of p.boxes) {
      const c = new HiCanvas(columns, p.rows)
      drawGrid(c, { ...p, boxes: [one] }, ctx)
      const bin = atob(c.encode())
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const words = new Uint32Array(bytes.buffer)
      const { box } = one
      for (let r = 0; r < p.rows; r++) {
        for (let col = 0; col < columns; col++) {
          if (col >= box.col && col < box.col + box.w && r >= box.row && r < box.row + box.h) continue
          const i = (r * columns + col) * 3
          if (words[i] !== 0x20 || words[i + 1] !== NONE || words[i + 2] !== NONE) throw new Error(`${one.id} at ${columns}: painted (${col}, ${r}) outside its box`)
        }
      }
    }
  }
})
