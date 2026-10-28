// dsh-memledger — host half.
//
// The plugin is now tool-only. There is no dashboard: the value is in the
// ledger being consulted before a change and appended after one, not in
// looking at it, and the client half was the part that kept breaking.
//
// `apply` does exactly one thing — hand the five tools to the tool registry —
// so the failure surface is as small as the feature allows.

import { registerAgentTools } from './agent-tools.js'

export const name = 'dsh-memledger'

/**
 * The only service this plugin needs.
 *
 * `tools` is declared rather than looked up opportunistically: dsh-better-sidebar
 * injects it the same way, which proves the service exists in this build, and
 * declaring it guarantees the registry is ready when apply() runs.
 */
export const inject = ['tools']

export function apply(ctx) {
  const log = (message) => {
    try {
      ctx.logger?.('memledger')?.warn?.(message)
    } catch {
      // logging must never mask the real work
    }
  }
  try {
    registerAgentTools(ctx, log)
  } catch (cause) {
    log('agent tools failed to register: ' + (cause instanceof Error ? cause.message : String(cause)))
  }
}

export { LedgerManager } from './ledger-manager.js'
export * from './schema.js'
export * from './mem0-adapter.js'
export * from './agent-tools.js'
