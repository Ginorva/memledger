// dsh-memledger — host half.
//
// Registers two read-only HTTP routes that the client view
// (`conversation.view` id `memledger`) fetches its data from:
//
//   GET /api/memledger/status   → counts, ledger path, health
//   GET /api/memledger/entries  → the parsed ledger, filtered by ?q= / ?status=
//
// The route shape follows dsh-plugin-message-edit's proven pattern: an
// `inject` array naming the `webServer` service, and `ctx.effect(...)` so the
// route is torn down with the plugin. Nothing here writes to disk.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { LedgerManager } from './ledger-manager.js'
import { parseLedgerMarkdown } from './markdown-parser.js'

export const name = 'dsh-memledger'

/** Services this plugin's host half requires from the loader. */
export const inject = ['webServer']

const STATUS_PATH = '/api/memledger/status'
const ENTRIES_PATH = '/api/memledger/entries'
const LEDGER_RELATIVE = join('docs', '变更台账.md')

/**
 * Pick the workspace root whose ledger we should serve.
 *
 * An explicit `?root=` is authoritative: a caller that names a root gets that
 * root even when it has no ledger yet, so two workspaces can never leak into
 * each other. Only when no root is named do we fall back to `MEMLEDGER_ROOT`,
 * then the host's cwd, then a short upward walk (so a plugin started from a
 * subdirectory still finds the repo's ledger).
 */
function resolveRoot(explicit) {
  if (typeof explicit === 'string' && explicit.length > 0) return resolve(explicit)

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
    if (existsSync(join(candidate, LEDGER_RELATIVE))) return candidate
  }
  return candidates[0] ?? process.cwd()
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

function handleStatus(request, response) {
  try {
    const url = new URL(request.url ?? STATUS_PATH, 'http://127.0.0.1')
    const root = resolveRoot(url.searchParams.get('root'))
    const entries = readEntries(root)
    const pending = entries.filter((entry) =>
      ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中'].includes(entry.status))
    return sendJson(response, 200, {
      ok: true,
      root,
      ledgerPath: join(root, LEDGER_RELATIVE),
      hasLedger: existsSync(join(root, LEDGER_RELATIVE)),
      totalCount: entries.length,
      pendingCount: pending.length,
    })
  } catch (cause) {
    return sendJson(response, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
  }
}

function handleEntries(request, response) {
  try {
    const url = new URL(request.url ?? ENTRIES_PATH, 'http://127.0.0.1')
    const root = resolveRoot(url.searchParams.get('root'))
    if (!existsSync(join(root, LEDGER_RELATIVE))) {
      return sendJson(response, 200, { ok: true, root, entries: [] })
    }
    const manager = new LedgerManager(root)
    const query = url.searchParams.get('q') ?? ''
    const status = url.searchParams.get('status')
    const entries = manager.search({ query, status: status || undefined })
    return sendJson(response, 200, { ok: true, root, entries })
  } catch (cause) {
    return sendJson(response, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
  }
}

export function apply(ctx) {
  if (ctx.webServer === undefined) {
    throw new Error('[dsh-memledger] Missing DSH webServer service. Check the plugin inject list and restart DSH.')
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: STATUS_PATH, handler: handleStatus }),
    'memledger: status route',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ENTRIES_PATH, handler: handleEntries }),
    'memledger: entries route',
  )
}

export { LedgerManager }
export * from './schema.js'
export * from './mem0-adapter.js'
export * from './tools.js'
