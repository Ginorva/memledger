// dsh-memledger — host half.
//
// Registers two read-only HTTP routes that the client view
// (`conversation.view` id `dsh-memledger`) fetches its data from:
//
//   GET /api/memledger/status   → counts, ledger path, health
//   GET /api/memledger/entries  → the parsed ledger, filtered by ?q= / ?status=
//
// The route shape follows dsh-plugin-message-edit's proven pattern: an
// `inject` array naming the services it needs, and `ctx.effect(...)` so the
// routes are torn down with the plugin. Nothing here writes to disk.
//
// Which workspace does it read? The open session's own `header.cwd`, not the
// host process's cwd: the host runs from the profile directory, so a cwd-based
// guess points at ~/.dsh/profiles/desktop and reports an empty ledger no matter
// which project the user has open. An explicit `?root=` still wins, so a caller
// can pin a workspace deliberately.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { LedgerManager } from './ledger-manager.js'
import { parseLedgerMarkdown } from './markdown-parser.js'

export const name = 'dsh-memledger'

/**
 * Services this plugin's host half requires.
 *
 * `webServer` is mandatory (the routes need it). `sessions` and `sessionQuery`
 * are the two ways DSH exposes a session's cwd — live first, then restored —
 * and all three are injected by a plugin that ships working today, so the
 * loader will not stall on them.
 */
export const inject = ['webServer', 'sessions', 'sessionQuery']

const STATUS_PATH = '/api/memledger/status'
const ENTRIES_PATH = '/api/memledger/entries'
const LEDGER_RELATIVE = join('docs', '变更台账.md')

const PENDING_STATUSES = ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中']

function headerCwd(record) {
  const header = record?.header ?? record?.session
  const cwd = header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** cwd straight off a live session, when the session is still in memory. */
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

/** cwd of a restored session, for a tab opened before the session is live. */
async function restoredSessionCwd(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  try {
    const query = ctx.get('sessionQuery', false)
    if (query !== undefined && typeof query.readSession === 'function') {
      const cwd = headerCwd(await query.readSession(sessionId))
      if (cwd !== undefined) return cwd
    }
  } catch {
    // fall through to the next strategy
  }
  try {
    const query = ctx.get('sessionQuery', false)
    if (query !== undefined && typeof query.observeSession === 'function') {
      const observation = await query.observeSession(sessionId, { projectionMode: 'none' })
      try {
        return headerCwd(observation)
      } finally {
        observation[Symbol.dispose]?.()
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Decide which workspace root to serve, in priority order:
 *
 *  1. `?root=` — the caller pinned a workspace on purpose.
 *  2. the open session's cwd — the workspace the user actually has in front.
 *  3. `MEMLEDGER_ROOT` — a manual override for headless use.
 *  4. the host cwd, then a short upward walk for a ledger.
 */
async function resolveRoot(ctx, url) {
  const explicit = url.searchParams.get('root')
  if (typeof explicit === 'string' && explicit.length > 0) return { root: resolve(explicit), source: 'query' }

  const sessionId = url.searchParams.get('session')
  const fromSession = liveSessionCwd(ctx, sessionId) ?? (await restoredSessionCwd(ctx, sessionId))
  if (fromSession !== undefined) return { root: resolve(fromSession), source: 'session' }

  const candidates = []
  if (process.env.MEMLEDGER_ROOT) candidates.push(resolve(process.env.MEMLEDGER_ROOT))
  let cursor = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    candidates.push(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, LEDGER_RELATIVE))) {
      return { root: candidate, source: candidate === resolve(process.env.MEMLEDGER_ROOT ?? '') ? 'env' : 'walk' }
    }
  }
  return { root: candidates[0] ?? process.cwd(), source: 'cwd' }
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

function makeStatusHandler(ctx) {
  return async function handleStatus(request, response) {
    try {
      const url = new URL(request.url ?? STATUS_PATH, 'http://127.0.0.1')
      const { root, source } = await resolveRoot(ctx, url)
      const entries = readEntries(root)
      const pending = entries.filter((entry) => PENDING_STATUSES.includes(entry.status))
      sendJson(response, 200, {
        ok: true,
        root,
        rootSource: source,
        ledgerPath: join(root, LEDGER_RELATIVE),
        hasLedger: existsSync(join(root, LEDGER_RELATIVE)),
        totalCount: entries.length,
        pendingCount: pending.length,
      })
    } catch (cause) {
      sendJson(response, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }
}

function makeEntriesHandler(ctx) {
  return async function handleEntries(request, response) {
    try {
      const url = new URL(request.url ?? ENTRIES_PATH, 'http://127.0.0.1')
      const { root, source } = await resolveRoot(ctx, url)
      if (!existsSync(join(root, LEDGER_RELATIVE))) {
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
  }
}

export function apply(ctx) {
  if (ctx.webServer === undefined) {
    throw new Error('[dsh-memledger] Missing DSH webServer service. Check the plugin inject list and restart DSH.')
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: STATUS_PATH, handler: makeStatusHandler(ctx) }),
    'memledger: status route',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ENTRIES_PATH, handler: makeEntriesHandler(ctx) }),
    'memledger: entries route',
  )
}

export { LedgerManager }
export * from './schema.js'
export * from './mem0-adapter.js'
export * from './tools.js'
