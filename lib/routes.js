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

const STATUS_PATH = '/api/memledger/status'
const ENTRIES_PATH = '/api/memledger/entries'
const MAP_PATH = '/api/memledger/map'
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

async function resolveRoot(ctx, url) {
  const explicit = url.searchParams.get('root')
  if (typeof explicit === 'string' && explicit.length > 0) return { root: resolve(explicit), source: 'query' }

  const sessionId = url.searchParams.get('session')
  const fromSession = liveSessionCwd(ctx, sessionId) ?? (await restoredSessionCwd(ctx, sessionId))
  if (fromSession !== undefined) return { root: resolve(fromSession), source: 'session' }

  if (process.env.MEMLEDGER_ROOT) return { root: resolve(process.env.MEMLEDGER_ROOT), source: 'env' }

  let cursor = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(cursor, LEDGER_RELATIVE)) || existsSync(join(cursor, MAP_RELATIVE))) {
      return { root: cursor, source: 'walk' }
    }
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
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

  // 3. Map route
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
            let markdown = ''
            if (existsSync(mapPath)) {
              markdown = readFileSync(mapPath, 'utf-8')
            }
            const mapData = scanCodebaseMap(root, {})
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
            })
          } catch (cause) {
            sendJson(response, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
          }
        },
      }),
    'memledger: map route',
  )

  return true
}
