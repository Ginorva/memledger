// Smoke test for the dsh-memledger host half.
//
// Loads lib/index.js under plain Node, runs apply() against a fake cordis
// context, then drives the two registered routes with fake Node req/res
// objects against a throwaway ledger. No DSH profile is touched.
//
// The workspace-resolution checks are the point: the host runs from the profile
// directory, so a cwd-based guess reports an empty ledger no matter which
// project is open. `?session=` must beat every other strategy.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const FIXTURE = join(ROOT, '.tmp-test')
const OTHER = join(FIXTURE, 'other-workspace')

const LEDGER = `# 项目变更台账（append-only）

<!-- 决策索引:BEGIN -->
<!-- 决策索引:END -->

<!-- 条目:BEGIN -->

### CL-20261028-01 · 修掉闸门重复开仓

- **日期**：2026-10-28
- **类型**：修复
- **状态**：已落地
- **仓**：包装仓
- **背景**：同一 bar 内二次触发
- **改动**：加幂等锁
- **为什么**：状态未提交就再次轮询
- **取舍**：无
- **锚点**：omw_quant/gate/lock.py
- **commit**：abc1234
- **验收**：回归通过
- **关键词**：闸门, 重复开仓

### CL-20261028-02 · 分钟线补数方案搁置

- **日期**：2026-10-28
- **类型**：决策
- **状态**：搁置
- **仓**：引擎仓
- **背景**：数据源限流
- **改动**：暂不做
- **为什么**：限流期间补数会污染缓存，等 Q4 券商接口上线再重启
- **取舍**：重启条件＝拿到正式接口
- **锚点**：omw_quant/data/backfill.py
- **commit**：无
- **验收**：无
- **关键词**：补数, 限流

<!-- 条目:END -->
`

const OTHER_LEDGER = `# 项目变更台账（append-only）

<!-- 条目:BEGIN -->

### CL-20261028-09 · 另一个工作区的条目

- **日期**：2026-10-28
- **类型**：修复
- **状态**：已落地
- **仓**：别的仓
- **背景**：证明会话 cwd 生效
- **改动**：改了一处
- **为什么**：这条只应出现在 OTHER 里
- **取舍**：无
- **锚点**：other/file.py
- **commit**：def5678
- **验收**：无
- **关键词**：另一个工作区

<!-- 条目:END -->
`

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

function fakeRes() {
  const collected = { status: 0, headers: null, body: '' }
  return {
    collected,
    writeHead(status, headers) {
      collected.status = status
      collected.headers = headers
    },
    end(text) {
      collected.body = text
    },
  }
}

/** A cordis-like context: services through ctx.get, effects run eagerly. */
function fakeCtx(services) {
  const routes = new Map()
  return {
    routes,
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    effect(fn) {
      return fn()
    },
    get(name, strict) {
      const service = services.get(name)
      if (service === undefined && strict !== false) throw new Error('missing service: ' + name)
      return service
    },
  }
}

async function call(ctx, path, query = {}) {
  const url = new URL(path, 'http://127.0.0.1')
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  const response = fakeRes()
  await ctx.routes.get(path)({ url: url.pathname + url.search }, response)
  return { status: response.collected.status, headers: response.collected.headers, body: JSON.parse(response.collected.body) }
}

async function main() {
  rmSync(FIXTURE, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'docs'), { recursive: true })
  writeFileSync(join(FIXTURE, 'docs', '变更台账.md'), LEDGER, 'utf-8')
  mkdirSync(join(OTHER, 'docs'), { recursive: true })
  writeFileSync(join(OTHER, 'docs', '变更台账.md'), OTHER_LEDGER, 'utf-8')

  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  console.log('module shape:')
  check('exports name', module.name === 'dsh-memledger', module.name)
  check('inject declares webServer', module.inject.includes('webServer'), JSON.stringify(module.inject))
  check('inject declares sessions', module.inject.includes('sessions'), JSON.stringify(module.inject))
  check('inject declares sessionQuery', module.inject.includes('sessionQuery'), JSON.stringify(module.inject))
  check('apply is a function', typeof module.apply === 'function')

  // Live session 'live-1' sits in FIXTURE; 'live-2' sits in OTHER.
  const liveSessions = new Map([
    ['live-1', { header: { id: 'live-1', cwd: FIXTURE } }],
    ['live-2', { header: { id: 'live-2', cwd: OTHER } }],
  ])
  const restored = { 'restored-1': { header: { id: 'restored-1', cwd: OTHER } } }
  const services = new Map([
    ['sessions', { get: (id) => liveSessions.get(id) }],
    ['sessionQuery', { readSession: async (id) => restored[id] }],
  ])

  const ctx = fakeCtx(services)
  console.log('apply():')
  let applyError = null
  try {
    module.apply(ctx)
  } catch (cause) {
    applyError = cause
  }
  check('apply does not throw', applyError === null, applyError && applyError.message)
  check('registered status route', ctx.routes.has('/api/memledger/status'))
  check('registered entries route', ctx.routes.has('/api/memledger/entries'))

  console.log('apply() when webServer is absent:')
  let guarded = false
  try {
    module.apply({ effect() {}, get: () => undefined })
  } catch {
    guarded = true
  }
  check('throws a clear error', guarded)

  console.log('root resolution - explicit ?root= wins:')
  const explicit = await call(ctx, '/api/memledger/status', { root: FIXTURE })
  check('source is query', explicit.body.rootSource === 'query', explicit.body.rootSource)
  check('totalCount = 2', explicit.body.totalCount === 2, String(explicit.body.totalCount))
  check('pendingCount = 1', explicit.body.pendingCount === 1, String(explicit.body.pendingCount))

  console.log('root resolution - ?session= beats the guessed cwd:')
  const viaSession = await call(ctx, '/api/memledger/entries', { session: 'live-1' })
  check('source is session', viaSession.body.rootSource === 'session', viaSession.body.rootSource)
  check('root is the session cwd', viaSession.body.root === FIXTURE, viaSession.body.root)
  check('returned the session workspace ledger', viaSession.body.entries.length === 2, String(viaSession.body.entries.length))

  const otherSession = await call(ctx, '/api/memledger/entries', { session: 'live-2' })
  check('a second session resolves its own workspace', otherSession.body.root === OTHER, otherSession.body.root)
  check('and returns that workspace entry', otherSession.body.entries.length === 1, String(otherSession.body.entries.length))
  check('not the first workspace entries', otherSession.body.entries[0]?.anchor === 'other/file.py', String(otherSession.body.entries[0]?.anchor))

  const restoredSession = await call(ctx, '/api/memledger/entries', { session: 'restored-1' })
  check('a restored session falls back to sessionQuery', restoredSession.body.root === OTHER, restoredSession.body.root)
  check('restored session still resolves by session', restoredSession.body.rootSource === 'session', restoredSession.body.rootSource)

  const unknownSession = await call(ctx, '/api/memledger/entries', { session: 'nope' })
  check('an unknown session does not claim session source', unknownSession.body.rootSource !== 'session', unknownSession.body.rootSource)

  console.log('entries:')
  const all = await call(ctx, '/api/memledger/entries', { root: FIXTURE })
  check('HTTP 200', all.status === 200, String(all.status))
  check('returns 2', all.body.entries.length === 2, String(all.body.entries.length))
  check('entry carries anchor', all.body.entries.some((e) => String(e.anchor).includes('lock.py')))
  check('sets no-store', String(all.headers['Cache-Control']).includes('no-store'))

  console.log('search:')
  const q = await call(ctx, '/api/memledger/entries', { q: '闸门', root: FIXTURE })
  check('query narrows to 1', q.body.entries.length === 1, String(q.body.entries.length))
  check('hit is the gate entry', String(q.body.entries[0]?.id).endsWith('-01'), String(q.body.entries[0]?.id))

  const p = await call(ctx, '/api/memledger/entries', { status: 'pending', root: FIXTURE })
  check('pending filters to 1', p.body.entries.length === 1, String(p.body.entries.length))
  check('hit is the shelved entry', p.body.entries[0]?.status === '搁置', p.body.entries[0]?.status)

  console.log('empty workspace:')
  const EMPTY = join(FIXTURE, 'empty')
  mkdirSync(EMPTY, { recursive: true })
  const empty = await call(ctx, '/api/memledger/entries', { root: EMPTY })
  check('200 with no entries', empty.status === 200 && empty.body.entries.length === 0)
  check('reports the pinned root, not a neighbour', empty.body.root === EMPTY, empty.body.root)

  rmSync(FIXTURE, { recursive: true, force: true })

  console.log('')
  if (failures === 0) {
    console.log('ALL CHECKS PASSED')
    process.exit(0)
  }
  console.log(failures + ' CHECK(S) FAILED')
  process.exit(1)
}

main().catch((cause) => {
  console.log('TEST HARNESS CRASHED: ' + (cause && cause.stack ? cause.stack : cause))
  process.exit(1)
})
