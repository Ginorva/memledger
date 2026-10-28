// Smoke test for the dsh-memledger host half.
//
// Loads lib/index.js under plain Node, runs apply() against a fake cordis
// context, then drives the two registered routes with fake Node req/res
// objects against a throwaway ledger. No DSH profile is touched.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const FIXTURE = join(ROOT, '.tmp-test')

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

async function main() {
  rmSync(FIXTURE, { recursive: true, force: true })
  mkdirSync(join(FIXTURE, 'docs'), { recursive: true })
  writeFileSync(join(FIXTURE, 'docs', '变更台账.md'), LEDGER, 'utf-8')

  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  console.log('module shape:')
  check('exports name', module.name === 'dsh-memledger', module.name)
  check('inject declares webServer', Array.isArray(module.inject) && module.inject.includes('webServer'), JSON.stringify(module.inject))
  check('apply is a function', typeof module.apply === 'function')

  const routes = new Map()
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    effect(fn) {
      return fn()
    },
  }

  console.log('apply():')
  let applyError = null
  try {
    module.apply(ctx)
  } catch (cause) {
    applyError = cause
  }
  check('apply does not throw', applyError === null, applyError && applyError.message)
  check('registered status route', routes.has('/api/memledger/status'))
  check('registered entries route', routes.has('/api/memledger/entries'))

  console.log('missing webServer service:')
  let guarded = false
  try {
    module.apply({ effect() {} })
  } catch {
    guarded = true
  }
  check('apply throws a clear error when webServer is absent', guarded)

  process.env.MEMLEDGER_ROOT = FIXTURE

  console.log('GET /status:')
  const statusRes = fakeRes()
  await routes.get('/api/memledger/status')({ url: '/api/memledger/status?root=' + encodeURIComponent(FIXTURE) }, statusRes)
  const statusBody = JSON.parse(statusRes.collected.body)
  check('status 200', statusRes.collected.status === 200, String(statusRes.collected.status))
  check('status hasLedger', statusBody.hasLedger === true)
  check('status totalCount = 2', statusBody.totalCount === 2, String(statusBody.totalCount))
  check('status pendingCount = 1', statusBody.pendingCount === 1, String(statusBody.pendingCount))
  check('status sets no-store', String(statusRes.collected.headers['Cache-Control']).includes('no-store'))

  console.log('GET /entries (all):')
  const allRes = fakeRes()
  await routes.get('/api/memledger/entries')({ url: '/api/memledger/entries?root=' + encodeURIComponent(FIXTURE) }, allRes)
  const allBody = JSON.parse(allRes.collected.body)
  check('entries 200', allRes.collected.status === 200, String(allRes.collected.status))
  check('entries returns 2', allBody.entries.length === 2, String(allBody.entries.length))
  check('entry carries anchor', allBody.entries.some((e) => String(e.anchor).includes('lock.py')))

  console.log('GET /entries?q=闸门:')
  const qRes = fakeRes()
  await routes.get('/api/memledger/entries')(
    { url: '/api/memledger/entries?q=' + encodeURIComponent('闸门') + '&root=' + encodeURIComponent(FIXTURE) },
    qRes,
  )
  const qBody = JSON.parse(qRes.collected.body)
  check('query narrows to 1', qBody.entries.length === 1, String(qBody.entries.length))
  check('query hit is the gate entry', String(qBody.entries[0]?.id).endsWith('-01'), String(qBody.entries[0]?.id))

  console.log('GET /entries?status=pending:')
  const pRes = fakeRes()
  await routes.get('/api/memledger/entries')(
    { url: '/api/memledger/entries?status=pending&root=' + encodeURIComponent(FIXTURE) },
    pRes,
  )
  const pBody = JSON.parse(pRes.collected.body)
  check('pending filters to 1', pBody.entries.length === 1, String(pBody.entries.length))
  check('pending hit is the shelved entry', pBody.entries[0]?.status === '搁置', pBody.entries[0]?.status)

  console.log('GET /entries on a root with no ledger:')
  const emptyRes = fakeRes()
  const emptyRoot = join(FIXTURE, 'empty')
  mkdirSync(emptyRoot, { recursive: true })
  await routes.get('/api/memledger/entries')(
    { url: '/api/memledger/entries?root=' + encodeURIComponent(emptyRoot) },
    emptyRes,
  )
  const emptyBody = JSON.parse(emptyRes.collected.body)
  check('empty root returns 200 with no entries', emptyRes.collected.status === 200 && emptyBody.entries.length === 0)

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
