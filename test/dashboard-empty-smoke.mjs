// Smoke test for the dashboard's zero-data rendering.
//
// The effectiveness panel used to hide whole cards when a counter was zero,
// so a freshly restarted DSH rendered an almost blank page. This test pins the
// opposite contract: with a brand-new process (all counters zero, no history)
// every card must still render and explain itself in Chinese.

import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

/* ------------------------------------------------------------ fake react -- */

const ZERO_STATS = {
  startedAt: Date.now(),
  uptimeSeconds: 12,
  totalCalls: 0,
  effectivenessScore: 0,
  calls: {
    ledger_map: 0,
    ledger_check: 0,
    ledger_search: 0,
    ledger_add: 0,
    ledger_verify: 0,
    ledger_bootstrap: 0,
  },
  map: { cacheHits: 0, cacheMisses: 0, cacheHitRate: null },
  check: {
    verdicts: {
      'rollback-risk': 0,
      'repeated-repair': 0,
      'already-done': 0,
      shelved: 0,
      'foreign-anchor': 0,
      unrecorded: 0,
    },
    pathsScanned: 0,
    entriesMatched: 0,
    riskyBlocked: 0,
  },
  add: { recorded: 0, duplicatesBlocked: 0 },
  verify: { runs: 0, anchorsMissing: 0 },
  cumulative: { totalCalls: 5, riskyBlocked: 0, addRecorded: 1, duplicatesBlocked: 0, sessionsCount: 2 },
  value: { rollbacksPrevented: 0, duplicateWorkSaved: 0, decisionsPreserved: 0, shelvedRespected: 0, tokensEstimatedSaved: 0, hoursEstimatedSaved: 0 },
  ml: null,
  sessionHistory: [],
  recentEvents: [],
  root: 'D:\\demo\\workspace',
}

// useState values, in call order: entries, map, stats, suites, query, onlyPending, tab, openFiles, openEntries
const stateQueue = [
  { loading: false, list: [], root: 'D:\\demo\\workspace', error: null },
  { loading: false, files: [], fileCount: 0, symbolCount: 0, error: null },
  { loading: false, data: ZERO_STATS, error: null },
  { loading: false, data: null, error: null },
  '',
  false,
  'dashboard',
  {},
  {},
]

const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children }
  },
  useState(initial) {
    const next = stateQueue.length > 0 ? stateQueue.shift() : initial
    return [next, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useReducer(state) {
    return [state, () => {}]
  },
}

function fakeRequire(id) {
  if (id === 'react') return fakeReact
  throw new Error('unexpected require: ' + id)
}

/* ---------------------------------------------------------------- helpers -- */

/** Collect every text leaf in a rendered tree. */
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node === 'object') {
    if (typeof node.type === 'function') {
      // Render the nested component the way React would.
      const rendered = node.type(node.props)
      collectText(rendered, out)
      return out
    }
    collectText(node.children, out)
  }
  return out
}

/* -------------------------------------------------------------------- run -- */

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec
    },
  },
}

async function main() {
  await import(pathToFileURL(join(ROOT, 'lib', 'client.js')).href + '?t=' + Date.now())
  const module = captured.factory(fakeRequire)

  const registered = []
  module.apply({
    get: (name) => (name === 'slots'
      ? {
          inject(_slot, fn) { if (typeof fn === 'function') fn() },
          register(options, Component) {
            registered.push({ options, Component })
          },
        }
      : undefined),
    effect: () => () => {},
  })

  const Component = registered[0].Component
  const tree = Component(registered[0].options.inject('session-demo'))
  const text = collectText(tree).join(' | ')

  console.log('zero-data dashboard:')
  check('renders without throwing', tree !== null)
  // The dashboard uses a KPI-strip layout with score ring + metric cards.
  // Zero-data renders: intro + score ring + 运行状态 card with idle guidance + cumulative footer.
  check('shows intro description', text.includes('记忆台账') || text.includes('预检'))
  check('shows KPI metrics', text.includes('工具调用') || text.includes('预检次数'))
  check('shows status section', text.includes('运行状态') || text.includes('防护记录'))
  check('shows idle guidance', text.includes('等待首次调用') || text.includes('待激活'))
  check('shows cumulative history', text.includes('历史累计') || text.includes('会话'))
  check('no raw ledger_* tool ids leak into the UI', !/ledger_(map|check|search|add|verify|bootstrap)/.test(text), '')

  if (failures > 0) {
    console.log('\n' + failures + ' CHECK(S) FAILED')
    process.exitCode = 1
    return
  }
  console.log('\nALL DASHBOARD CHECKS PASSED')
}

main().catch((cause) => {
  console.error(cause)
  process.exitCode = 1
})
