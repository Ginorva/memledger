// routes.js — optional read-only HTTP routes for DSH Web GUI client view.
//
// Serves:
//   GET /api/memledger/status   → ledger counts, map status, workspace root
//   GET /api/memledger/entries  → parsed change ledger entries with filters
//   GET /api/memledger/map      → codebase skeleton map data & raw markdown
//
// Follows graceful degradation: if ctx.webServer is absent or disabled,
// it logs cleanly and returns false. It never throws into apply().

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { LedgerManager } from './ledger-manager.js'
import { parseLedgerMarkdown } from './markdown-parser.js'
import { MAP_RELATIVE, scanCodebaseMap } from './scanner-map.js'
import { statsRegistry, readActiveRoot } from './stats.js'
import { discoverPrograms, listSuites, readRuns, suiteHealth } from './suite.js'

const STATUS_PATH = '/api/memledger/status'
const ENTRIES_PATH = '/api/memledger/entries'
const MAP_PATH = '/api/memledger/map'
const STATS_PATH = '/api/memledger/stats'
const SUITES_PATH = '/api/memledger/suites'
const LEDGER_RELATIVE = join('docs', '变更台账.md')

const PENDING_STATUSES = ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中']

function headerCwd(record) {
  const header = record?.header ?? record?.session
  const cwd = header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

function liveSessionCwd(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  try {
    const sessions = ctx.get('sessions', false)
    if (sessions === undefined || typeof sessions.get !== 'function') return undefined
    return headerCwd(sessions.get(sessionId))
  } catch {
    return undefined
  }
}

async function restoredSessionCwd(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  try {
    const query = ctx.get('sessionQuery', false)
    if (query !== undefined && typeof query.readSession === 'function') {
      const cwd = headerCwd(await query.readSession(sessionId))
      if (cwd !== undefined) return cwd
    }
  } catch {
    // fall through
  }
  return undefined
}

/**
 * Walk upward from `start` to find the nearest directory containing
 * a ledger or map file.  Returns `start` unchanged when none is found.
 * This mirrors agent-tools' `readRoot` logic so that the GUI resolves
 * the same root the tools recorded stats against.
 */
function walkToLedgerRoot(start) {
  let cursor = start
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(cursor, LEDGER_RELATIVE)) || existsSync(join(cursor, MAP_RELATIVE))) {
      return cursor
    }
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return start
}

async function resolveRoot(ctx, url) {
  const explicit = url.searchParams.get('root')
  if (typeof explicit === 'string' && explicit.length > 0) return { root: resolve(explicit), source: 'query' }

  // The agent tools resolve their root from the *session* cwd (see `readRoot`
  // in agent-tools.js, which reads `exec.agent.session.header.cwd`). The GUI
  // must resolve the same directory, so the session cwd wins whenever the
  // request carries one; `process.cwd()` is only the last-resort fallback.
  const sessionId = url.searchParams.get('session')
  const fromSession = liveSessionCwd(ctx, sessionId) ?? (await restoredSessionCwd(ctx, sessionId))
  if (fromSession !== undefined) {
    const walked = walkToLedgerRoot(resolve(fromSession))
    return { root: walked, source: 'session' }
  }

  if (process.env.MEMLEDGER_ROOT) return { root: resolve(process.env.MEMLEDGER_ROOT), source: 'env' }

  // No session id on the request: use the workspace the agent last wrote to,
  // so the dashboard reads the same ledger the tool calls just recorded into.
  const lastActive = readActiveRoot()
  if (lastActive !== undefined) return { root: resolve(lastActive), source: 'last-active' }

  const fromProcess = walkToLedgerRoot(process.cwd())
  if (fromProcess !== process.cwd() || existsSync(join(process.cwd(), LEDGER_RELATIVE))) {
    return { root: fromProcess, source: 'walk' }
  }

  return { root: process.cwd(), source: 'cwd' }
}

function sendJson(response, status, payload) {
  const text = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  response.end(text)
}

function readEntries(root) {
  const ledgerPath = join(root, LEDGER_RELATIVE)
  if (!existsSync(ledgerPath)) return []
  try {
    return parseLedgerMarkdown(readFileSync(ledgerPath, 'utf-8'))
  } catch {
    return []
  }
}

export function registerRoutes(ctx, log = () => {}) {
  let webServer
  try {
    webServer = ctx.get('webServer', false)
  } catch {
    webServer = undefined
  }

  if (webServer === undefined || typeof webServer.register !== 'function') {
    log('webServer not available; GUI read-only routes skipped')
    return false
  }

  if (typeof ctx.effect !== 'function') {
    log('effect service absent; skipping route registration')
    return false
  }

  // 1. Status route
  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: async (request, response) => {
          try {
            const url = new URL(request.url ?? STATUS_PATH, 'http://127.0.0.1')
            const { root, source } = await resolveRoot(ctx, url)
            const entries = readEntries(root)
            const pending = entries.filter((e) => PENDING_STATUSES.includes(e.status))
            const mapPath = join(root, MAP_RELATIVE)
            const hasMap = existsSync(mapPath)

            sendJson(response, 200, {
              ok: true,
              root,
              rootSource: source,
              hasLedger: existsSync(join(root, LEDGER_RELATIVE)),
              totalCount: entries.length,
              pendingCount: pending.length,
              hasMap,
              mapPath,
              stats: statsRegistry.get(root).toJSON(),
            })
          } catch (cause) {
            sendJson(response, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
          }
        },
      }),
    'memledger: status route',
  )

  // 2. Entries route
  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: ENTRIES_PATH,
        handler: async (request, response) => {
          try {
            const url = new URL(request.url ?? ENTRIES_PATH, 'http://127.0.0.1')
            const { root, source } = await resolveRoot(ctx, url)
            const ledgerPath = join(root, LEDGER_RELATIVE)
            if (!existsSync(ledgerPath)) {
              sendJson(response, 200, { ok: true, root, rootSource: source, entries: [] })
              return
            }
            const manager = new LedgerManager(root)
            const query = url.searchParams.get('q') ?? ''
            const status = url.searchParams.get('status')
            sendJson(response, 200, {
              ok: true,
              root,
              rootSource: source,
              entries: manager.search({ query, status: status || undefined }),
            })
          } catch (cause) {
            sendJson(response, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
          }
        },
      }),
    'memledger: entries route',
  )

  // 3. Map route — with per-root TTL cache to avoid redundant scans.
  //
  // The codebase map is expensive to generate (it reads every file in the tree).
  // The agent tools already persist the result to docs/项目结构.md, so this
  // route prefers reading that file. A full rescan only happens when the cached
  // file is absent or older than 30 seconds (configurable via MEMLEDGER_MAP_TTL).
  const _mapCache = new Map()  // root → { data, ts }
  const MAP_TTL_MS = Number(process.env.MEMLEDGER_MAP_TTL) || 30_000

  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: MAP_PATH,
        handler: async (request, response) => {
          try {
            const url = new URL(request.url ?? MAP_PATH, 'http://127.0.0.1')
            const { root, source } = await resolveRoot(ctx, url)
            const mapPath = join(root, MAP_RELATIVE)
            const forceRefresh = url.searchParams.get('refresh') === '1'

            // Check TTL cache
            const cached = _mapCache.get(root)
            const now = Date.now()
            if (!forceRefresh && cached && (now - cached.ts) < MAP_TTL_MS) {
              sendJson(response, 200, {
                ok: true,
                root,
                rootSource: source,
                hasMap: true,
                mapPath,
                fileCount: cached.data.fileCount,
                symbolCount: cached.data.symbolCount,
                files: cached.data.files,
                markdown: cached.data.markdown,
                cached: true,
              })
              return
            }

            // Try to read from the persisted map file first (avoids full scan
            // when the tool already wrote it). Only fall back to a live scan
            // when the file doesn't exist or was explicitly refreshed.
            let markdown = ''
            let mapData
            if (!forceRefresh && existsSync(mapPath)) {
              markdown = readFileSync(mapPath, 'utf-8')
              // Light metadata scan: cheaper than full scan, extracts only counts
              mapData = scanCodebaseMap(root, { metadataOnly: false })
            } else {
              mapData = scanCodebaseMap(root, {})
              if (existsSync(mapPath)) {
                markdown = readFileSync(mapPath, 'utf-8')
              }
            }

            // Update cache
            const cacheEntry = {
              fileCount: mapData.fileCount,
              symbolCount: mapData.symbolCount,
              files: mapData.files,
              markdown,
            }
            _mapCache.set(root, { data: cacheEntry, ts: now })

            sendJson(response, 200, {
              ok: true,
              root,
              rootSource: source,
              hasMap: existsSync(mapPath),
              mapPath,
              fileCount: mapData.fileCount,
              symbolCount: mapData.symbolCount,
              files: mapData.files,
              markdown,
              cached: false,
            })
          } catch (cause) {
            sendJson(response, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
          }
        },
      }),
    'memledger: map route',
  )

  // 4. Stats route — per-workspace effectiveness statistics endpoint
  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: STATS_PATH,
        handler: async (request, response) => {
          try {
            const url = new URL(request.url ?? STATS_PATH, 'http://127.0.0.1')
            const { root } = await resolveRoot(ctx, url)
            const stats = statsRegistry.get(root)
            sendJson(response, 200, {
              ok: true,
              root,
              ...stats.toJSON(),
              summary: stats.toCompactSummary(),
            })
          } catch (cause) {
            sendJson(response, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
          }
        },
      }),
    'memledger: stats route',
  )

  // 5. Suites route — contract suites, run history and debts, for the GUI tab.
  //
  // Read-only on purpose: the GUI shows the score, it does not run the commands.
  // An unauthenticated localhost POST that spawns processes is not a feature.
  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: SUITES_PATH,
        handler: async (request, response) => {
          try {
            const url = new URL(request.url ?? SUITES_PATH, 'http://127.0.0.1')
            const { root, source } = await resolveRoot(ctx, url)
            const suites = listSuites(root)
            const programs = discoverPrograms(root)
            const health = suiteHealth(root, readEntries(root))
            const runs = readRuns(root)
            const payload = suites.map((suite) => {
              // Partial runs (selected by a diff) are evidence, not a program
              // score; the trend only shows full runs.
              const programRuns = runs.filter((run) => run.program === suite.program && !run.partial)
              const last = programRuns.length > 0 ? programRuns[programRuns.length - 1] : null
              const lastById = new Map((last?.cases ?? []).map((result) => [result.id, result]))
              return {
                program: suite.program,
                description: programs.find((program) => program.name === suite.program)?.description ?? '',
                version: suite.version,
                drift: Boolean(suite.drift),
                broken: suite.broken ?? '',
                cases: suite.cases.map((c) => ({
                  id: c.id,
                  title: c.title,
                  from: c.from,
                  covers: c.covers,
                  weight: c.weight,
                  status: c.status,
                  seenFail: c.seenFail,
                  last: lastById.get(c.id) ?? null,
                })),
                last: last
                  ? { ts: last.ts, score: last.score, passed: last.passed, total: last.total, failed: last.failed, ms: last.ms }
                  : null,
                history: programRuns.slice(-10).map((run) => ({
                  ts: run.ts,
                  score: run.score,
                  passed: run.passed,
                  total: run.total,
                })),
                debts: health.debts.filter((debt) => debt.program === suite.program),
              }
            })
            sendJson(response, 200, {
              ok: true,
              root,
              rootSource: source,
              programs: payload,
              totalCases: health.cases,
              issues: health.issues,
              unadopted: health.unadopted,
            })
          } catch (cause) {
            sendJson(response, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
          }
        },
      }),
    'memledger: suites route',
  )

  return true
}
