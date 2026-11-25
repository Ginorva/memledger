// Smoke test for the dsh-memledger client half (conversation.view).
//
// Simulates the browser contract DSH's client loader provides: a
// `window.__ModuleLoader__.load({ id, factory })` call, a `require` that
// resolves 'react', and a cordis-like context whose `slots` service is reached
// through `ctx.get('slots')`.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

/* ---------------------------------------------------------- fake browser -- */

const styleTags = []
globalThis.document = {
  head: { appendChild: (tag) => styleTags.push(tag) },
  querySelector: () => null,
  createElement: () => {
    const tag = { dataset: {}, textContent: '', remove() {} }
    return tag
  },
}

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec
    },
  },
}

/* -------------------------------------------------------------- fake react -- */

const reactCalls = { createElement: 0 }
const fakeReact = {
  createElement(type, props, ...children) {
    reactCalls.createElement += 1
    return { type, props, children }
  },
  useState(initial) {
    return [initial, () => {}]
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

/* ---------------------------------------------------------- tree helpers -- */

function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (node.children) collectText(node.children, out)
  return out
}

function findByName(node, name) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByName(child, name)
      if (hit) return hit
    }
    return null
  }
  if (typeof node.type === 'function' && node.type.name === name) return node
  return node.children ? findByName(node.children, name) : null
}

function findByClass(node, className) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByClass(child, className)
      if (hit) return hit
    }
    return null
  }
  const cls = node.props?.className
  if (typeof cls === 'string' && cls.split(/\s+/).includes(className)) return node
  return node.children ? findByClass(node.children, className) : null
}

/* -------------------------------------------------------------------- run -- */

async function main() {
  // Evaluate the client bundle the way the browser would:
  await import(pathToFileURL(join(ROOT, 'lib', 'client.js')).href + '?t=' + Date.now())

  console.log('loader contract:')
  check('client.js called __ModuleLoader__.load', captured !== null)
  check('loader spec has an id', typeof captured?.id === 'string', String(captured?.id))
  check('loader id is the package name', captured?.id === 'dsh-memledger', String(captured?.id))
  check('loader spec has a factory', typeof captured?.factory === 'function')

  const module = captured.factory(fakeRequire)
  console.log('module shape:')
  check('factory returns an object', module !== null && typeof module === 'object')
  check('module declares inject', Array.isArray(module.inject), JSON.stringify(module.inject))
  check("module injects 'slots'", Array.isArray(module.inject) && module.inject.includes('slots'), JSON.stringify(module.inject))
  check('module.apply is a function', typeof module.apply === 'function')

  console.log('apply() against a cordis-like ctx:')
  const registered = []
  const injected = []
  const slots = {
    inject(name, callback) {
      injected.push(name)
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    register(options, Component) {
      registered.push({ options, Component })
      return () => {}
    },
  }
  const services = new Map([['slots', slots]])
  const ctx = {
    get(name) {
      return services.get(name)
    },
    effect(fn) {
      return fn()
    },
  }

  let applyError = null
  try {
    module.apply(ctx)
  } catch (cause) {
    applyError = cause
  }
  check('apply does not throw', applyError === null, applyError && applyError.message)
  check('injected into a slot', injected.length === 1, JSON.stringify(injected))
  check('injected slot is conversation.view', injected[0] === 'conversation.view', String(injected[0]))
  check('registered exactly one component', registered.length === 1, String(registered.length))
  check('register options name matches the slot', registered[0]?.options?.name === 'conversation.view', String(registered[0]?.options?.name))
  check('register options carry an id', registered[0]?.options?.id === 'dsh-memledger', String(registered[0]?.options?.id))
  check('register options carry an order', typeof registered[0]?.options?.order === 'number', String(registered[0]?.options?.order))
  check('register options label is callable', typeof registered[0]?.options?.label === 'function')
  check(
    'label returns 台账与地图',
    registered[0]?.options?.label?.() === '台账与地图',
    String(registered[0]?.options?.label?.()),
  )
  check('register options expose an inject mapper', typeof registered[0]?.options?.inject === 'function')
  check(
    'inject passes the open session down',
    registered[0]?.options?.inject?.('session-123')?.sessionId === 'session-123',
    JSON.stringify(registered[0]?.options?.inject?.('session-123')),
  )
  check('component is a function', typeof registered[0]?.Component === 'function')
  check('styles were inserted', styleTags.length === 1, String(styleTags.length))
  check('style tag carries ml- css classes', typeof styleTags[0]?.textContent === 'string' && (styleTags[0].textContent.includes('.ml-root') || styleTags[0].textContent.includes('.ml-container')))

  console.log('contract tab renders (🧪 契约跑分):')
  // The tab state starts as the literal 'dashboard'; swap it for 'suites' so the
  // contract pane is the one that renders. No hook-order counting involved.
  const baseUseState = fakeReact.useState
  fakeReact.useState = (initial) => [initial === 'dashboard' ? 'suites' : initial, () => {}]
  let tree = null
  let renderError = null
  try {
    tree = registered[0].Component({ sessionId: 's1' })
  } catch (cause) {
    renderError = cause
  } finally {
    fakeReact.useState = baseUseState
  }
  check('component renders without throwing', renderError === null, renderError && renderError.message)
  const tabTexts = collectText(tree)
  check('tab bar carries the contract tab', tabTexts.includes('🧪 契约跑分'), JSON.stringify(tabTexts.slice(0, 12)))

  const panel = findByName(tree, 'SuitePanel')
  check('contract panel is mounted', panel !== null)
  if (panel !== null) {
    // 12 条用例 + 1 条停用：超过旧版「只显示前 8 条」的截断上限。
    const manyCases = []
    for (let i = 1; i <= 12; i += 1) {
      manyCases.push({
        id: 'C-' + String(i).padStart(3, '0'),
        title: '用例标题 ' + i + '（这条标题故意写得很长，用来验证不再被省略号截断）',
        covers: ['lib/x.js::f' + i],
        weight: i % 5 === 0 ? 5 : i % 3 === 0 ? 3 : 1,
        status: 'active',
        seenFail: true,
        last: { ok: i % 4 !== 0, ms: 12 * i, reason: i % 4 === 0 ? '退出码 1（期望 0）' : '' },
      })
    }
    manyCases.push({
      id: 'C-013',
      title: '已停用的老用例',
      covers: [],
      weight: 1,
      status: 'retired',
      seenFail: false,
      last: null,
    })

    const fixture = {
      programs: [{
        program: 'mem-ledger',
        description: '决策台账工具',
        version: 9,
        drift: false,
        cases: manyCases,
        last: { ts: '2026-11-17T08:50:00.000Z', score: 80, passed: 8, total: 10 },
        history: [
          { ts: '2026-11-16T08:50:00.000Z', score: 90, passed: 9, total: 10 },
          { ts: '2026-11-17T08:50:00.000Z', score: 80, passed: 8, total: 10 },
        ],
        debts: [{ id: 'CL-20261117-18', title: '收口通道修复' }],
      }],
      totalCases: manyCases.length,
    }
    const tree2 = panel.type({ data: fixture })
    const rendered = collectText(tree2)
    check('shows the program name', rendered.includes('mem-ledger'), JSON.stringify(rendered.slice(0, 10)))
    check('shows the score', rendered.includes('80'), JSON.stringify(rendered.slice(0, 10)))
    check('shows a failing case', rendered.some((text) => text.includes('失败')), JSON.stringify(rendered.slice(0, 12)))
    check('debt line is not shown to user', !rendered.some((text) => text.includes('没有用例')))
    check('empty state is graceful', collectText(panel.type({ data: null })).some((text) => text.includes('暂未连接')))

    console.log('contract cases are shown in full (RQ-20261118-01):')
    const missing = manyCases.map((c) => c.id).filter((id) => !rendered.includes(id))
    check('every case id is rendered (no 8-case cap)', missing.length === 0, 'missing: ' + missing.join(','))
    check('retired case is rendered too', rendered.some((text) => text.includes('停用')), JSON.stringify(rendered.filter((text) => text.includes('停用'))))
    check('no "…另 N 例" truncation note', !rendered.some((text) => text.includes('另 ') && text.includes('例')))
    check('case list has its own scroll container', findByClass(tree2, 'ml-cases') !== null)
    check('case list carries a column header', findByClass(tree2, 'ml-case-head') !== null)

    console.log('weight is readable (RQ-20261118-01):')
    check('weight column is labelled 权重', rendered.includes('权重'))
    check('legend explains the weight scale', rendered.some((text) => text.includes('权重和') && text.includes('总分')))
    check('no cryptic w-prefixed weight badge', !rendered.some((text) => /^w\d+$/.test(text.trim())), JSON.stringify(rendered.filter((text) => /^w\d+$/.test(text.trim()))))

    console.log('styles ship the scrollbar rules:')
    const css = styleTags[0]?.textContent || ''
    check('css defines .ml-cases scroll area', css.includes('.ml-cases') && css.includes('overflow-y:auto'))
    check('css defines the weight pill', css.includes('.ml-case-w'))
    check('css no longer ellipsizes the case title', !/\.ml-case-title\{[^}]*text-overflow:ellipsis/.test(css))

    console.log('antibody & regression alert view (RQ-20261125-02):')
    const antibodyFixture = {
      programs: [{
        program: 'mem-ledger',
        description: '台账核心工具',
        cases: [
          { id: 'C-001', title: '普通契约', weight: 1, status: 'active', last: { ok: true } },
          { id: 'C-002', title: '防死锁回退契约', weight: 5, status: 'active', last: { ok: true } },
        ],
        regressionDebts: [{ id: 'CL-20261125-01', title: '尝试改用异步但造成阻塞' }],
      }],
      totalCases: 2,
    }
    const treeAntibody = panel.type({ data: antibodyFixture })
    const renderedAntibody = collectText(treeAntibody)
    check('renders antibody badge for weight>=5', renderedAntibody.some((text) => text.includes('🛡️防踩坑')), JSON.stringify(renderedAntibody))
    check('renders regression alert for unprotected rollbacks', renderedAntibody.some((text) => text.includes('缺防踩坑保护') && text.includes('CL-20261125-01')), JSON.stringify(renderedAntibody))
    check('css defines antibody pill', css.includes('.ml-case-w--antibody'))
    check('css defines regression alert card', css.includes('.ml-reg-debt'))
  }

  console.log('')
  if (failures === 0) {
    console.log('ALL CLIENT VIEW CHECKS PASSED')
    process.exit(0)
  }
  console.log(failures + ' CHECK(S) FAILED')
  process.exit(1)
}

main().catch((cause) => {
  console.log('TEST HARNESS CRASHED: ' + (cause && cause.stack ? cause.stack : cause))
  process.exit(1)
})
