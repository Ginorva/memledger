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

/**
 * 「结案 CL-…」的正文约定。
 *
 * 为什么用正文而不是新增一个工具参数：工具定义有**prompt 预算的棘轮**
 * （见 test/budget-smoke.mjs：每加一个字都要从别处省），而"显式废掉一条旧结论"
 * 这个能力早就在被使用（各项目都在正文里写「结案 CL-x」）。让工具认这个约定，
 * 比给它开一个新参数便宜得多，也不改变写作者的用法。
 */
const CLOSE_RE = /结案\s*(CL-\d{8}-\d+)/g

/** 正文里点名被结案的条目 id。 */
export function supersededIdsInText(text) {
  const out = []
  for (const match of String(text ?? '').matchAll(CLOSE_RE)) {
    if (!out.includes(match[1])) out.push(match[1])
  }
  return out
}

/** Stable identity of the code a landed entry claims to cover. */
export function anchorKeyOf(entry) {
  const raw = typeof entry?.anchor === 'string' ? entry.anchor : ''
  if (!raw) return ''
  const path = anchorPathsOf(raw)[0]
  if (!path) return ''
  return `${path}::${symbolOf(raw)}`
}

/**
 * Composite key that distinguishes entries from different ledgers even when
 * they share the same CL id (each sub-ledger may use independent numbering).
 * Within a single ledger (source is falsy) the key is just the id.
 */
export function entryKey(entry) {
  return entry.source ? `${entry.source}\0${entry.id}` : entry.id
}

/**
 * Map of superseded entry key → the key that replaced it (resolved to the
 * ultimate live entry, so chains never point at a dead link).
 *
 * Returns a **key-based** Map. Call `isSuperseded(entry)` on the returned
 * helper instead of raw `.has(entry.id)` — that helper resolves the source-
 * aware composite key automatically.
 */
export function supersessionMap(entries) {
  const byKey = new Map(entries.map((entry) => [entryKey(entry), entry]))
  const supersededBy = new Map()

  for (const entry of entries) {
    const target = entry.supersedes
    if (target) {
      // Explicit supersede targets are bare CL ids.  They only apply WITHIN
      // the same source ledger — otherwise CL-01 in ledger A would kill the
      // identically-numbered CL-01 in ledger B.
      const targetKey = entry.source ? `${entry.source}\0${target}` : target
      if (byKey.has(targetKey) && !supersededBy.has(targetKey)) {
        supersededBy.set(targetKey, entryKey(entry))
      }
    }
    // 正文约定：「结案 CL-…」也算显式取代（写作者的老习惯，见 CLOSE_RE 注释）
    for (const id of supersededIdsInText(`${entry.title ?? ''}\n${entry.why ?? ''}\n${entry.change ?? ''}`)) {
      const closedKey = entry.source ? `${entry.source}\0${id}` : id
      if (byKey.has(closedKey) && !supersededBy.has(closedKey)) {
        supersededBy.set(closedKey, entryKey(entry))
      }
    }
  }

  // Derived supersession: same anchor key AND same source ledger.
  const groups = new Map()
  for (const entry of entries) {
    if (entry.status !== '已落地') continue
    const aKey = anchorKeyOf(entry)
    if (!aKey) continue
    // Source-scoped grouping: entries from different ledgers never supersede
    // each other, even if they happen to touch the same file::symbol.
    const groupKey = `${entry.source || ''}\0${aKey}`
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(entry)
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.id.localeCompare(b.id))
    const latest = list[list.length - 1]
    const latestKey = entryKey(latest)
    for (const older of list.slice(0, -1)) {
      const olderKey = entryKey(older)
      // Explicit links win over the derivation.
      if (!supersededBy.has(olderKey)) supersededBy.set(olderKey, latestKey)
    }
  }

  // Collapse multi-hop chains (A ← B ← C) to the live tip.
  for (const key of [...supersededBy.keys()]) {
    let cursor = supersededBy.get(key)
    const seen = new Set([key])
    while (supersededBy.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor)
      cursor = supersededBy.get(cursor)
    }
    supersededBy.set(key, cursor)
  }

  // Expose a helper that resolves the composite key for external callers.
  supersededBy._entryKey = entryKey
  return supersededBy
}

/** Entries that are still the live record for their anchor key. */
export function liveEntries(entries) {
  const supersededBy = supersessionMap(entries)
  const ek = supersededBy._entryKey || entryKey
  return entries.filter((entry) => !supersededBy.has(ek(entry)))
}
