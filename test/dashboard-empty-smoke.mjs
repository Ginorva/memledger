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
  cumulative: { totalCalls: 0, riskyBlocked: 0, addRecorded: 0, duplicatesBlocked: 0, sessionsCount: 1 },
  sessionHistory: [],
  recentEvents: [],
  root: 'D:\\demo\\workspace',
}

// useState values, in call order: entries, map, stats, query, onlyPending, tab
const stateQueue = [
  { loading: false, list: [], root: 'D:\\demo\\workspace', error: null },
  { loading: false, files: [], fileCount: 0, symbolCount: 0, error: null },
  { loading: false, data: ZERO_STATS, error: null },
  '',
  false,
  'dashboard',
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
  check('explains that this process has no calls yet', text.includes('本次进程还没有台账调用'), '')
  check('keeps the tool-call card', text.includes('各工具调用次数'))
  check('keeps the cache card with a placeholder', text.includes('地图缓存效率') && text.includes('还没有扫描过代码地图'))
  check('keeps the anchor card with a placeholder', text.includes('锚点存活检查') && text.includes('还没有体检过'))
  check('keeps the verdict card with a placeholder', text.includes('改前预检结果分布') && text.includes('还没有跑过改前预检'))
  check('keeps the cumulative card', text.includes('跨会话累计统计'))
  check('keeps the history card with a placeholder', text.includes('历史会话记录') && text.includes('还没有已落盘的历史会话'))
  check('adds a ledger overview card', text.includes('台账概览'))
  check('adds a recent-calls card', text.includes('最近调用') && text.includes('还没有调用记录'))
  check('still shows the process uptime', text.includes('当前进程已运行'))
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
