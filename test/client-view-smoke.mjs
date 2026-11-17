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
