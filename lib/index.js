// dsh-memledger — host half.
//
// The plugin is now tool-only. There is no dashboard: the value is in the
// ledger being consulted before a change and appended after one, not in
// looking at it, and the client half was the part that kept breaking.
//
// `apply` does exactly one thing — hand the five tools to the tool registry —
// so the failure surface is as small as the feature allows.

import { registerAgentTools } from './agent-tools.js'
import { ensureAgentsRulesInjected } from './inject-rules.js'
import { registerRoutes } from './routes.js'

export const name = 'dsh-memledger'

/**
 * Required service: tools.
 * Optional services like webServer are picked up opportunistically
 * to prevent breaking headless builds while powering the Web GUI view.
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

  // 1. Core: Agent tools (ledger_check, ledger_map, etc.)
  try {
    registerAgentTools(ctx, log)
  } catch (cause) {
    log('agent tools failed to register: ' + (cause instanceof Error ? cause.message : String(cause)))
  }

  // 2. Global rules injection into ~/.dsh/AGENTS.md
  try {
    ensureAgentsRulesInjected()
  } catch (cause) {
    log('failed to sync agent rules: ' + (cause instanceof Error ? cause.message : String(cause)))
  }

  // 3. Optional: Read-only routes for the GUI client view
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], () => registerRoutes(ctx, log))
    } else {
      registerRoutes(ctx, log)
    }
  } catch (cause) {
    log('routes failed to mount: ' + (cause instanceof Error ? cause.message : String(cause)))
  }
}

export { LedgerManager } from './ledger-manager.js'
export * from './schema.js'
export * from './mem0-adapter.js'
export * from './agent-tools.js'
export * from './scanner-map.js'
export * from './inject-rules.js'
export * from './routes.js'
