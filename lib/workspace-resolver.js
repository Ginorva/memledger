// dsh-memledger — workspace root resolution utilities.
//
// Shared logic for finding the repository root, locating the ledger file,
// and reading ledger entries. Extracted from agent-tools.js.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseLedgerMarkdown } from './markdown-parser.js'
import { MAP_RELATIVE } from './scanner-map.js'

const LEDGER_RELATIVE = join('docs', '变更台账.md')

/** Resolve a root the caller named outright. */
function explicitRoot(args) {
  const raw = args?.root
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  return resolve(raw)
}

/**
 * The workspace the calling session was opened in, if the harness tells us.
 *
 * The DSH host process itself may run with a completely different cwd
 * (the profile directory), so `process.cwd()` is *not* the user's workspace.
 * Tool execution receives the owning agent as `exec.agent`, whose session
 * header carries the real cwd.
 */
function sessionRoot(exec) {
  try {
    const cwd = exec?.agent?.session?.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) return resolve(cwd)
  } catch {
    // fall through — cwd is a best-effort signal
  }
  return undefined
}

/**
 * Resolve a root for a read-only call.
 *
 * Reading may guess (an upward walk that finds a ledger); writing may not, so
 * the creation path uses explicitRoot and refuses when it is absent.
 */
function readRoot(args, exec) {
  const named = explicitRoot(args)
  if (named !== undefined) return named
  const base = sessionRoot(exec) ?? process.cwd()
  let cursor = base
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(cursor, LEDGER_RELATIVE)) || existsSync(join(cursor, MAP_RELATIVE))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return base
}

function ledgerPathOf(root) {
  return join(root, LEDGER_RELATIVE)
}

function readEntries(root) {
  const ledgerPath = ledgerPathOf(root)
  if (!existsSync(ledgerPath)) return []
  try {
    return parseLedgerMarkdown(readFileSync(ledgerPath, 'utf-8'))
  } catch {
    return []
  }
}

export { LEDGER_RELATIVE, explicitRoot, sessionRoot, readRoot, ledgerPathOf, readEntries }
