// dsh-memledger — agent tools registration layer.
//
// Registers the ledger tools the model can call. The shape follows dsh-unlag's
// working registration (ctx.tools.register(spec, label) inside ctx.effect, with
// a JSON-schema `parameters` and an `output.schema` plus `execute`), not a guess
// of my own.
//
// The point of these tools is iteration quality, not reporting: `ledger_check`
// answers "has this been done already, and has an earlier fix been reverted?"
// *before* the change, which is the only moment the answer is still cheap.
//
// Safety rules that are deliberate:
//
//  * Nothing here ever overwrites an existing ledger. `ledger_bootstrap`
//    refuses unless `force: true`, because scaffolding is destructive and a
//    real ledger with dozens of decisions is not a tool call's to discard.
//  * Creation requires an explicit `root`. Guessing a workspace before writing
//    files is how you write into the wrong repository.

import { initConfig, messageOf } from './scoring.js'
import { readRoot, readEntries } from './workspace-resolver.js'
import { createSuiteTool } from './suite-tool.js'
import { mapTool } from './tools/map.js'
import { checkTool } from './tools/check.js'
import { searchTool } from './tools/search.js'
import { addTool } from './tools/add.js'
import { requirementTool } from './tools/requirement.js'
import { verifyTool } from './tools/verify.js'
import { bootstrapTool } from './tools/bootstrap.js'

const PENDING = ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中']

/* ------------------------------------------------------------ register -- */

/**
 * Register the ledger tools, degrading gracefully.
 *
 * Tools are the whole product now — the dashboard half is gone. If this DSH
 * build exposes no `tools` service there is nothing useful left to do, so a
 * missing service logs and returns false instead of throwing into apply().
 */
export function registerAgentTools(ctx, log = () => {}) {
  // Apply user-tunable config from cordis.patch.yml (if available).
  // Missing or partial config gracefully falls back to DEFAULTS.
  initConfig(ctx)

  let tools
  try {
    tools = ctx.get('tools', false)
  } catch {
    tools = undefined
  }
  if (tools === undefined || tools === null || typeof tools.register !== 'function') {
    log('no tools service; ledger tools are unavailable in this build')
    return false
  }
  if (typeof ctx.effect !== 'function') {
    log('no effect service; refusing to register tools that cannot be disposed')
    return false
  }

  const specs = [
    mapTool(),
    checkTool(),
    searchTool(),
    addTool(),
    requirementTool(),
    verifyTool(),
    createSuiteTool({ readRoot, readEntries }),
    bootstrapTool(ctx),
  ]
  let registered = 0
  for (const spec of specs) {
    try {
      ctx.effect(() => tools.register(spec, `memledger: ${spec.name}`), `memledger: ${spec.name}`)
      registered += 1
    } catch (cause) {
      log(`could not register ${spec.name}: ${messageOf(cause)}`)
    }
  }
  return registered === specs.length
}

export { PENDING }
