// stats.js — session-level effectiveness statistics for MemLedger.
//
// Tracks how many times each tool is called, what verdicts ledger_check
// returns, how many rollback risks are caught, and how much context budget
// is saved by the codebase map cache. These numbers answer the question
// "is the plugin actually working, and is it working well?"
//
// The stats object lives in the plugin process (one per DSH session fork),
// and is exposed through:
//   - Every tool's output (a compact `_stats` summary)
//   - The `/api/memledger/status` route (full stats dump)
//   - The client view (visual health indicators)
//
// Persistence: stats are periodically flushed to a JSON file alongside the
// ledger (docs/.memledger-stats.json) so that accumulated effectiveness
// data survives process restarts and can be reviewed across sessions.
//
// Design: append-only counters + a ring buffer of recent events. No locks
// needed because Node is single-threaded and the harness serialises tool
// calls within a session.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * @typedef {Object} ToolCallEvent
 * @property {string} tool - Tool name
 * @property {number} ts - Timestamp (ms)
 * @property {string} [verdict] - For ledger_check: the verdict
 * @property {boolean} [cached] - For ledger_map: whether cache was hit
 * @property {boolean} [refused] - For ledger_add: whether duplicate was caught
 */

const MAX_RECENT_EVENTS = 50
const FLUSH_INTERVAL_MS = 60_000  // flush every 60s
const STATS_FILENAME = '.memledger-stats.json'

class SessionStats {
  constructor() {
    this.startedAt = Date.now()

    // Per-tool call counts
    this.calls = {
      ledger_map: 0,
      ledger_check: 0,
      ledger_search: 0,
      ledger_add: 0,
      ledger_requirement: 0,
      ledger_verify: 0,
      ledger_bootstrap: 0,
    }

    // ledger_map effectiveness
    this.mapCacheHits = 0
    this.mapCacheMisses = 0

    // ledger_check effectiveness — these are the core value metrics
    this.checkVerdicts = {
      'rollback-risk': 0,
      'repeated-repair': 0,
      'already-done': 0,
      'shelved': 0,
      'foreign-anchor': 0,
      'unrecorded': 0,
    }
    this.checkPathsScanned = 0
    this.checkEntriesMatched = 0
    this.checkRiskyBlocked = 0  // times a risky verdict was returned

    // ledger_add effectiveness
    this.addRecorded = 0
    this.addDuplicatesBlocked = 0  // collision guard fired

    // ledger_verify effectiveness
    this.verifyRuns = 0
    this.verifyAnchorsMissing = 0

    // Cross-session cumulative stats (loaded from disk)
    this.cumulative = {
      totalCalls: 0,
      riskyBlocked: 0,
      addRecorded: 0,
      duplicatesBlocked: 0,
      sessionsCount: 0,
    }

    // Recent event ring buffer
    /** @type {ToolCallEvent[]} */
    this.recentEvents = []

    // Persistence state
    this.root = null
    this._persistPath = null
    this._flushTimer = null
    this._flushSoon = null
    this._dirty = false
  }

  /**
   * Bind to a workspace root for persistence.
   * Loads existing cumulative stats from disk and starts periodic flushing.
   */
  bindWorkspace(root) {
    if (!root || typeof root !== 'string') return

    this.root = root
    const statsPath = join(root, 'docs', STATS_FILENAME)
    this._persistPath = statsPath

    // Load existing cumulative stats
    try {
      if (existsSync(statsPath)) {
        const raw = readFileSync(statsPath, 'utf-8')
        const saved = JSON.parse(raw)
        if (saved && typeof saved.cumulative === 'object') {
          Object.assign(this.cumulative, saved.cumulative)
        }
        // Also restore historical session summaries
        if (Array.isArray(saved.sessionHistory)) {
          this._sessionHistory = saved.sessionHistory.slice(-20)  // keep last 20 sessions
        }
      }
    } catch {
      // Corrupted file — start fresh
    }

    // Increment session counter
    this.cumulative.sessionsCount += 1

    // Start periodic flush (unref so it doesn't keep the process alive)
    if (!this._flushTimer) {
      this._flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
      if (this._flushTimer.unref) this._flushTimer.unref()
    }
  }

  /**
   * Mark stats dirty and schedule a debounced flush.
   *
   * A restart can happen immediately after a tool call, so waiting for the
   * 60s interval loses the session summary. Debouncing keeps write volume low
   * (one write per burst of calls) while making the persisted history fresh.
   */
  _touch() {
    this._dirty = true
    if (!this._persistPath) return
    if (this._flushSoon) return
    this._flushSoon = setTimeout(() => {
      this._flushSoon = null
      this.flush()
    }, 500)
    if (this._flushSoon.unref) this._flushSoon.unref()
  }

  /** Record a tool invocation. */
  recordCall(tool, meta = {}) {
    if (tool in this.calls) {
      this.calls[tool] += 1
    }
    this.cumulative.totalCalls += 1
    this._touch()

    /** @type {ToolCallEvent} */
    const event = { tool, ts: Date.now(), ...meta }
    this.recentEvents.push(event)
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.shift()
    }
  }

  /** Record a ledger_check result. */
  recordCheckResult(verdicts, telemetry) {
    for (const v of verdicts) {
      if (v.verdict in this.checkVerdicts) {
        this.checkVerdicts[v.verdict] += 1
      }
      if (v.verdict === 'rollback-risk' || v.verdict === 'repeated-repair') {
        this.checkRiskyBlocked += 1
        this.cumulative.riskyBlocked += 1
      }
    }
    this.checkPathsScanned += verdicts.length
    if (telemetry) {
      this.checkEntriesMatched += (telemetry.matched || 0)
    }
    this._touch()
  }

  /** Record a ledger_map cache hit/miss. */
  recordMapResult(cached) {
    if (cached) this.mapCacheHits += 1
    else this.mapCacheMisses += 1
    this._touch()
  }

  /** Record a ledger_add result. */
  recordAddResult(ok, refused) {
    if (ok) {
      this.addRecorded += 1
      this.cumulative.addRecorded += 1
    }
    if (refused) {
      this.addDuplicatesBlocked += 1
      this.cumulative.duplicatesBlocked += 1
    }
    this._touch()
  }

  /** Record a ledger_verify result. */
  recordVerifyResult(missingCount) {
    this.verifyRuns += 1
    this.verifyAnchorsMissing += missingCount
    this._touch()
  }

  /** Total tool calls across all tools. */
  get totalCalls() {
    return Object.values(this.calls).reduce((sum, n) => sum + n, 0)
  }

  /** How long the plugin has been active (seconds). */
  get uptimeSeconds() {
    return Math.round((Date.now() - this.startedAt) / 1000)
  }

  /**
   * Effectiveness score: 0–100.
   *
   * Measures whether the plugin is being used AND producing value.
   * A score of 0 means "not doing anything"; 100 means "fully engaged
   * and catching real problems."
   *
   * Components:
   *  - Usage (40%): are the tools being called at all?
   *  - Coverage (30%): is the ledger being maintained (add calls)?
   *  - Protection (30%): are checks catching real issues?
   */
  get effectivenessScore() {
    // Usage: have the core tools been called?
    const usageScore = Math.min(100,
      (this.calls.ledger_check > 0 ? 30 : 0) +
      (this.calls.ledger_map > 0 ? 20 : 0) +
      (this.calls.ledger_add > 0 ? 25 : 0) +
      (this.calls.ledger_search > 0 ? 15 : 0) +
      (this.calls.ledger_verify > 0 ? 10 : 0)
    )

    // Coverage: are decisions being recorded?
    const coverageScore = this.addRecorded > 0
      ? Math.min(100, this.addRecorded * 20 + (this.addDuplicatesBlocked > 0 ? 20 : 0))
      : 0

    // Protection: are checks finding things?
    const totalChecks = Object.values(this.checkVerdicts).reduce((s, n) => s + n, 0)
    const meaningfulChecks = totalChecks - this.checkVerdicts.unrecorded
    const protectionScore = totalChecks > 0
      ? Math.min(100, Math.round((meaningfulChecks / totalChecks) * 80) + (this.checkRiskyBlocked > 0 ? 20 : 0))
      : 0

    return Math.round(usageScore * 0.4 + coverageScore * 0.3 + protectionScore * 0.3)
  }

  /**
   * Compact summary string for tool output.
   * Shows the most important numbers in a single line.
   */
  toCompactSummary() {
    const parts = [`📊 MemLedger 会话统计`]
    parts.push(`调用 ${this.totalCalls} 次`)

    if (this.checkRiskyBlocked > 0) {
      parts.push(`🛡️ 拦截 ${this.checkRiskyBlocked} 次倒车/重复风险`)
    }
    if (this.addDuplicatesBlocked > 0) {
      parts.push(`🚫 挡住 ${this.addDuplicatesBlocked} 次重复入册`)
    }
    if (this.mapCacheHits > 0) {
      parts.push(`⚡ 地图缓存命中 ${this.mapCacheHits}/${this.mapCacheHits + this.mapCacheMisses}`)
    }
    if (this.addRecorded > 0) {
      parts.push(`📝 沉淀 ${this.addRecorded} 条决策`)
    }

    const score = this.effectivenessScore
    const grade = score >= 80 ? '🟢' : score >= 50 ? '🟡' : score >= 20 ? '🟠' : '🔴'
    parts.push(`效能 ${grade} ${score}/100`)

    // Show cumulative if there's cross-session history
    if (this.cumulative.sessionsCount > 1) {
      parts.push(`(累计 ${this.cumulative.sessionsCount} 会话, ${this.cumulative.totalCalls} 调用, ${this.cumulative.riskyBlocked} 拦截)`)
    }

    return parts.join(' | ')
  }

  /**
   * Full stats object for API responses.
   */
  toJSON() {
    return {
      startedAt: this.startedAt,
      uptimeSeconds: this.uptimeSeconds,
      totalCalls: this.totalCalls,
      effectivenessScore: this.effectivenessScore,
      calls: { ...this.calls },
      map: {
        cacheHits: this.mapCacheHits,
        cacheMisses: this.mapCacheMisses,
        cacheHitRate: this.mapCacheHits + this.mapCacheMisses > 0
          ? Math.round((this.mapCacheHits / (this.mapCacheHits + this.mapCacheMisses)) * 100)
          : null,
      },
      check: {
        verdicts: { ...this.checkVerdicts },
        pathsScanned: this.checkPathsScanned,
        entriesMatched: this.checkEntriesMatched,
        riskyBlocked: this.checkRiskyBlocked,
      },
      add: {
        recorded: this.addRecorded,
        duplicatesBlocked: this.addDuplicatesBlocked,
      },
      verify: {
        runs: this.verifyRuns,
        anchorsMissing: this.verifyAnchorsMissing,
      },
      cumulative: { ...this.cumulative },
      root: this.root,
      sessionHistory: Array.isArray(this._sessionHistory) ? this._sessionHistory.slice(-10) : [],
      recentEvents: this.recentEvents.slice(-20),
    }
  }

  /**
   * Flush current stats to disk.
   * Safe to call often — only writes when dirty and path is bound.
   */
  flush() {
    if (!this._dirty || !this._persistPath) return

    const sessionSummary = {
      startedAt: this.startedAt,
      endedAt: Date.now(),
      totalCalls: this.totalCalls,
      score: this.effectivenessScore,
      riskyBlocked: this.checkRiskyBlocked,
      addRecorded: this.addRecorded,
    }

    const history = Array.isArray(this._sessionHistory) ? this._sessionHistory : []
    // Only add if this session had any activity
    if (this.totalCalls > 0) {
      // Replace the last entry if it's from this same session
      const lastIdx = history.findIndex(h => h.startedAt === this.startedAt)
      if (lastIdx >= 0) {
        history[lastIdx] = sessionSummary
      } else {
        history.push(sessionSummary)
      }
    }
    // Keep only last 50 sessions
    while (history.length > 50) history.shift()

    const payload = {
      version: 1,
      cumulative: { ...this.cumulative },
      sessionHistory: history,
      lastFlush: new Date().toISOString(),
    }

    try {
      const dir = dirname(this._persistPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this._persistPath, JSON.stringify(payload, null, 2), 'utf-8')
      this._dirty = false
      this._sessionHistory = history
    } catch {
      // Write failures are non-fatal — stats are not critical data
    }
  }

  /**
   * Stop the flush timer and do a final flush.
   */
  dispose() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer)
      this._flushTimer = null
    }
    if (this._flushSoon) {
      clearTimeout(this._flushSoon)
      this._flushSoon = null
    }
    this.flush()
  }
}

/**
 * Registry that manages per-workspace SessionStats instances.
 *
 * Each workspace root gets its own stats so that different projects
 * show independent effectiveness numbers in the GUI.
 */
class StatsRegistry {
  constructor() {
    /** @type {Map<string, SessionStats>} normalized root → stats */
    this._byRoot = new Map()
    /** Fallback instance when root is unknown. */
    this._default = new SessionStats()
  }

  /**
   * Normalize a root path to a stable map key.
   * On Windows, drives are lowercased and backslashes converted to forward slashes
   * so that `D:\foo` and `d:/foo` resolve to the same instance.
   */
  _key(root) {
    if (typeof root !== 'string' || root.length === 0) return ''
    return root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  }

  /**
   * Get (or create) the stats instance for a workspace root.
   * If root is empty/undefined, returns the default instance.
   */
  get(root) {
    const key = this._key(root)
    if (!key) return this._default

    let stats = this._byRoot.get(key)
    if (!stats) {
      stats = new SessionStats()
      stats.bindWorkspace(root)
      this._byRoot.set(key, stats)
    }
    rememberActiveRoot(root)
    return stats
  }

  /**
   * Bind a specific workspace root (used during init).
   * Ensures the instance exists and is bound for persistence.
   */
  bind(root) {
    return this.get(root)
  }

  /**
   * Flush and dispose all instances.
   */
  dispose() {
    for (const stats of this._byRoot.values()) {
      stats.dispose()
    }
    this._default.dispose()
  }
}

/**
 * Pointer file recording the workspace that most recently ran a ledger tool.
 *
 * The GUI read routes may arrive without a session id (the client cannot always
 * prove which conversation is rendering). Without this pointer they fall back
 * to `process.cwd()` — the DSH profile directory — and show a different
 * workspace's (usually empty) counters. Recording the last active root keeps
 * "what the agent just wrote" and "what the dashboard reads" on the same path.
 */
const ACTIVE_ROOT_FILENAME = 'memledger-last-root.json'
let _lastRememberedKey = ''

function activeRootPointerPath() {
  const home = process.env.DSH_HOME
    || (process.env.USERPROFILE ?? process.env.HOME ?? '')
  if (!home) return null
  return join(home, ACTIVE_ROOT_FILENAME)
}

function rememberActiveRoot(root) {
  if (typeof root !== 'string' || root.length === 0) return
  const key = root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  if (key === _lastRememberedKey) return
  const path = activeRootPointerPath()
  if (path === null) return
  try {
    writeFileSync(path, JSON.stringify({ root, ts: Date.now() }, null, 2), 'utf-8')
    _lastRememberedKey = key
  } catch {
    // Pointer is an optimisation only; never fail a tool call over it
  }
}

/**
 * Read the workspace recorded by {@link rememberActiveRoot}.
 * @returns {string | undefined} an absolute root, or undefined when unknown/stale
 */
export function readActiveRoot(maxAgeMs = 24 * 60 * 60 * 1000) {
  const path = activeRootPointerPath()
  if (path === null) return undefined
  try {
    if (!existsSync(path)) return undefined
    const saved = JSON.parse(readFileSync(path, 'utf-8'))
    if (typeof saved?.root !== 'string' || saved.root.length === 0) return undefined
    if (typeof saved.ts === 'number' && Date.now() - saved.ts > maxAgeMs) return undefined
    return saved.root
  } catch {
    return undefined
  }
}

/** Singleton registry: one per DSH process, holds per-workspace stats. */
export const statsRegistry = new StatsRegistry()

/**
 * Legacy default instance for backward compatibility.
 * @deprecated Use `statsRegistry.get(root)` instead.
 */
export const sessionStats = statsRegistry._default

export { SessionStats, StatsRegistry }
