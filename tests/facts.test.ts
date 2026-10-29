// One home per fact (docs/DESIGN.md 31): what each module claims, and the test the scenes use.
import { expect, test } from 'claude-code/testing'

import { MODULE_FACTS, claimed, factsOf } from '../hooks/facts.ts'
import type { Fact } from '../hooks/facts.ts'
import { DEFAULT_ORDER, MODULES } from '../hooks/modules/index.ts'

test('facts: every module has a claim list, and every claim names a module', () => {
  expect(Object.keys(MODULE_FACTS).sort()).toEqual(Object.keys(MODULES).sort())
})

test('facts: factsOf unions the claims of the ids, skipping unknown ones', () => {
  expect([...factsOf([])]).toEqual([])
  expect([...factsOf(['clock'])]).toEqual(['elapsed'])
  expect([...factsOf(['lamps', 'counter:errors'])].sort()).toEqual(['checks', 'errors'])
  expect([...factsOf(['scope:ctx', 'dial:ctx'])]).toEqual(['ctx'])
  expect([...factsOf(['bogus', 'patchbay', 'toggles'])]).toEqual([])
})

test('facts: the default order claims the readings the wall must not repeat', () => {
  const f = factsOf(DEFAULT_ORDER)
  for (const want of ['handoff', 'turns', 'tools', 'cost', 'ctx', 'decode', 'pace', 'checks', 'errors', 'elapsed', 'recent', 'time'] as Fact[]) {
    expect([want, f.has(want)]).toEqual([want, true])
  }
})

test('facts: claimed is false for an absent set, and reads a present one', () => {
  expect(claimed(undefined, 'ctx')).toBe(false)
  expect(claimed(new Set(), 'ctx')).toBe(false)
  expect(claimed(new Set<Fact>(['ctx']), 'ctx')).toBe(true)
  expect(claimed(new Set<Fact>(['ctx']), 'turns')).toBe(false)
})
