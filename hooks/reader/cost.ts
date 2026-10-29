// The API-equivalent estimate (docs/DESIGN.md 9, 22, 36): context growth priced as cache writes,
// the rest as cache reads, output from characters/4, at a model of hooks/prices.json. Pure.
import type { Summary } from '../../types'
import type { Priv } from './parse.ts'
import { PyError, isDict, pyFloat, pyRound, pyStr, truthy } from './py.ts'

export const BASIS = 'estimate: context growth priced as cache writes, the rest as cache reads, output from characters/4'

/** hooks/prices.json as read: `{ checked, source, models: { <id>: { in, out, cache_write, cache_read } } }` in $/Mtok. */
export type PriceTable = Record<string, unknown>

/** The table, or why it could not be read (the summariser raised, and the caller's safe() said null). */
export type Prices = () => PriceTable

function at(p: unknown, k: string): number {
  if (!isDict(p)) throw new PyError('TypeError')
  if (!(k in p)) throw new PyError('KeyError', k)
  return pyFloat(p[k])
}

function models(table: PriceTable): Record<string, unknown> {
  const m = truthy(table.models) ? table.models : {}
  if (!isDict(m)) throw new PyError('TypeError')
  return m
}

/** growth × cache_write + rest × cache_read + output × out, `p` in $/Mtok, rounded to 1e-4. */
export function priceUsd(priv: Priv, outEst: number | undefined, p: unknown): number {
  const usd = (priv.growth_tok * at(p, 'cache_write') + priv.rest_tok * at(p, 'cache_read') + (outEst || 0) * at(p, 'out')) / 1e6
  return pyRound(usd, 4)
}

/** The estimate at every model of prices.json, and the date the prices were checked. */
export function costAtAll(priv: Priv, outEst: number | undefined, prices: Prices): [Record<string, number>, string] {
  const table = prices()
  const out: Record<string, number> = {}
  for (const [id, row] of Object.entries(models(table))) {
    try {
      out[id] = priceUsd(priv, outEst, row)
    } catch {
      // a row it cannot price is left out
    }
  }
  return [out, (truthy(table.checked) ? table.checked : '') as string]
}

/**
 * A session's price (docs/DESIGN.md 36): its own model when prices.json knows it (a dated id or a
 * `[1m]` tag counts as the model), else `compare`; `off` stays off.
 */
export function ownPrice(model: unknown, compare: string, prices: Prices): string {
  if (!compare || compare === 'off' || !truthy(model)) return compare
  let known: Record<string, unknown>
  try {
    known = models(prices())
  } catch {
    return compare
  }
  const id = (pyStr(model).split('/').pop() ?? '').replace(/\[\w+\](?=\n?$)/, '')
  for (const cand of [id, id.replace(/-\d{8}(?=\n?$)/, '')]) if (Object.hasOwn(known, cand)) return cand
  return compare
}

/**
 * The estimate at `compare` (a prices.json id, or `custom` with `customPrices` "in,out,cw,cr"),
 * with `at_all`, the same at every model. Null when `compare` is off or cannot be priced. Throws
 * where the summariser raised (prices.json unreadable): the caller reads that as null too.
 */
export function estimateCost(priv: Priv, outEst: number | undefined, compare: string, customPrices: string, prices: Prices): Summary['cost'] {
  if (!compare || compare === 'off') return null
  let p: { in: number; out: number; cache_write: number; cache_read: number }
  let pricedAt: string
  if (compare === 'custom') {
    let vals: number[]
    try {
      vals = (customPrices || '').split(',').map(x => pyFloat(x))
    } catch {
      return null
    }
    // Not finite: Python priced at inf or nan and printed JSON nobody could read.
    if (vals.length !== 4 || vals.some(v => v < 0 || !Number.isFinite(v))) return null
    p = { in: vals[0]!, out: vals[1]!, cache_write: vals[2]!, cache_read: vals[3]! }
    pricedAt = 'custom'
  } else {
    const table = prices()
    const row = models(table)[compare]
    if (!truthy(row)) return null
    p = { in: at(row, 'in'), out: at(row, 'out'), cache_write: at(row, 'cache_write'), cache_read: at(row, 'cache_read') }
    pricedAt = (truthy(table.checked) ? table.checked : '') as string
  }
  const out: NonNullable<Summary['cost']> = { compare, usd: priceUsd(priv, outEst, p), priced_at: pricedAt, prices: p, basis: BASIS }
  try {
    out.at_all = costAtAll(priv, outEst, prices)[0]
  } catch {
    out.at_all = {}
  }
  return out
}
