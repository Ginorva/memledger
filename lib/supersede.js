// supersede.js — one live version per anchor key.
//
// The ledger is append-only, so a symbol tuned three times keeps three entries.
// Keeping all three is the point (each round explains itself), but surfacing all
// three is noise: ledger_check would answer one question with three verdicts.
// This module derives which entry is live for an anchor key, without rewriting
// any history.
//
// Two sources of supersession:
//  * derived — two 已落地 entries share the same `anchor path::symbol`; the later
//    id wins (ids are date+sequence, so lexical order is chronological). This is
//    the common case and needs no discipline from anyone writing entries.
//  * explicit — an entry names `取代: CL-…` after a refactor moved the symbol.
//    Only a human (or a careful agent) can know that two different anchors mean
//    one thing, so this one is opt-in.

import { anchorPathsOf, symbolOf } from './anchors.js'

/** Stable identity of the code a landed entry claims to cover. */
export function anchorKeyOf(entry) {
  const raw = typeof entry?.anchor === 'string' ? entry.anchor : ''
  if (!raw) return ''
  const path = anchorPathsOf(raw)[0]
  if (!path) return ''
  return `${path}::${symbolOf(raw)}`
}

/**
 * Map of superseded entry id → the id that replaced it (resolved to the ultimate
 * live entry, so chains never point at a dead link).
 */
export function supersessionMap(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const supersededBy = new Map()

  for (const entry of entries) {
    const target = entry.supersedes
    if (target && byId.has(target) && !supersededBy.has(target)) {
      supersededBy.set(target, entry.id)
    }
  }

  const groups = new Map()
  for (const entry of entries) {
    if (entry.status !== '已落地') continue
    const key = anchorKeyOf(entry)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.id.localeCompare(b.id))
    const latest = list[list.length - 1]
    for (const older of list.slice(0, -1)) {
      // Explicit links win over the derivation.
      if (!supersededBy.has(older.id)) supersededBy.set(older.id, latest.id)
    }
  }

  // Collapse multi-hop chains (A ← B ← C) to the live tip.
  for (const id of [...supersededBy.keys()]) {
    let cursor = supersededBy.get(id)
    const seen = new Set([id])
    while (supersededBy.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor)
      cursor = supersededBy.get(cursor)
    }
    supersededBy.set(id, cursor)
  }
  return supersededBy
}

/** Entries that are still the live record for their anchor key. */
export function liveEntries(entries) {
  const supersededBy = supersessionMap(entries)
  return entries.filter((entry) => !supersededBy.has(entry.id))
}
