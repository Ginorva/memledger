// Manual demo: run the plugin's own tool specs end to end.
//
// Not part of `npm test` — this one builds a throwaway git repository under
// the workspace, then drives the four registered tools exactly the way the
// harness would, so you can watch the ledger appear before trusting it on a
// real repository.
//
//   node test/demo.mjs [--keep]
//
// `--keep` leaves the lab repository behind so you can open the generated
// docs/变更台账.md yourself.

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WORKSPACE = fileURLToPath(new URL('../..', import.meta.url))
const LAB = join(WORKSPACE, 'ledger-lab')
const keep = process.argv.includes('--keep')

function git(cwd, args) {
  return execSync('git ' + args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function commit(cwd, message, files) {
  for (const [path, body] of Object.entries(files)) {
    const target = join(cwd, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body, 'utf-8')
  }
  git(cwd, 'add -A')
  git(cwd, `commit -qm "${message}"`)
}

function line(label, value) {
  console.log('  ' + label.padEnd(12) + ' ' + value)
}

/** Capture the specs the plugin registers, the way the harness would. */
async function loadTools() {
  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const specs = new Map()
  const ctx = {
    webServer: { register: () => () => {} },
    effect: (fn) => fn(),
    get(name, strict) {
      if (name === 'tools') return { register: (spec) => { specs.set(spec.name, spec); return () => {} } }
      if (strict === false) return undefined
      return undefined
    },
    logger: () => ({ warn: () => {} }),
  }
  module.apply(ctx)
  return specs
}

async function main() {
  console.log('1) 造一个实验仓库（不动你的任何真实项目）')
  rmSync(LAB, { recursive: true, force: true })
  mkdirSync(LAB, { recursive: true })
  git(LAB, 'init -q')
  git(LAB, 'config user.name ledger-lab')
  git(LAB, 'config user.email lab@example.com')

  commit(LAB, 'fix: 闸门重复开仓 —— 同一 bar 内二次触发', {
    'core/gate.py': 'def allow(order, seen):\n    if order["bar"] in seen:\n        return False\n    seen.add(order["bar"])\n    return True\n',
  })
  commit(LAB, 'fix: 行情源超时未兜底，导致整轮选股空跑', {
    'core/feed.py': 'TIMEOUT = 3\n\ndef fetch(vendor):\n    try:\n        return vendor.pull(timeout=TIMEOUT)\n    except TimeoutError:\n        return []\n',
  })
  commit(LAB, 'fix: 补数任务重入，缓存被写脏', {
    'core/backfill.py': 'LOCK = set()\n\ndef backfill(symbols):\n    if symbols in LOCK:\n        return 0\n    LOCK.add(symbols)\n    return len(symbols)\n',
  })
  commit(LAB, 'docs: 补充部署说明（与决策无关，用来验证过滤）', {
    'docs/deploy.md': '# 部署\n\n见 CI。\n',
  })
  console.log('   ' + LAB)
  console.log('   ' + git(LAB, 'log --oneline').trim().split('\n').length + ' commits')

  const tools = await loadTools()
  console.log('\n2) 插件注册的工具')
  for (const name of tools.keys()) console.log('   · ' + name)

  console.log('\n3) ledger_bootstrap —— 从 git 历史逆向生成')
  const boot = await tools.get('ledger_bootstrap').execute({ root: LAB, source: 'git', maxCommits: 40 })
  line('ok', String(boot.ok))
  line('entryCount', String(boot.entryCount))
  line('ledger', String(boot.ledgerPath))
  line('message', String(boot.message))

  console.log('\n4) 再跑一次（应当拒绝覆盖）')
  const again = await tools.get('ledger_bootstrap').execute({ root: LAB, source: 'git' })
  line('ok', String(again.ok))
  line('refused', String(again.refused))
  line('message', String(again.message))

  console.log('\n5) ledger_search —— 按错误特征检索')
  const hit = await tools.get('ledger_search').execute({ root: LAB, query: '超时' })
  line('total', String(hit.total))
  for (const entry of hit.entries) console.log('   · ' + entry.id + ' [' + entry.status + '] ' + entry.title)

  console.log('\n6) ledger_add —— 记一条"搁置"决策')
  const added = await tools.get('ledger_add').execute({
    root: LAB,
    title: '分钟线补数改用券商正式接口后再做',
    type: '决策',
    status: '搁置',
    anchor: 'core/backfill.py::backfill',
    why: '限流期补数会污染缓存，等 Q4 正式接口上线再重启，届时用 backfill() 的重入锁做幂等。',
    tradeoff: '重启条件：拿到正式接口；代价：这段时间分钟线缺口不补。',
    background: '数据源限流，补数任务当前被锁挡住',
    change: '本轮不做，仅记录决策',
    keywords: ['补数', '限流', '券商接口'],
  })
  line('ok', String(added.ok))
  line('entryId', String(added.entryId))
  line('message', String(added.message))

  console.log('\n7) ledger_search status=pending —— 只看未决')
  const pending = await tools.get('ledger_search').execute({ root: LAB, status: 'pending' })
  line('total', String(pending.total))
  for (const entry of pending.entries) console.log('   · ' + entry.id + ' [' + entry.status + '] ' + entry.title)

  console.log('\n8) ledger_verify —— 锚点体检')
  const verified = await tools.get('ledger_verify').execute({ root: LAB })
  line('ok', String(verified.ok))
  line('checked', String(verified.checked))
  line('message', String(verified.message))

  console.log('\n9) 生成的台账前 30 行')
  const text = readFileSync(join(LAB, 'docs', '变更台账.md'), 'utf-8')
  const head = text.split('\n').slice(0, 30)
  for (const row of head) console.log('   | ' + row)

  console.log('\n总行数：' + text.split('\n').length)

  if (keep) {
    console.log('\n实验仓库保留在：' + LAB)
    console.log('看板里切到该工作区的会话，或直接打开 docs/变更台账.md')
  } else {
    rmSync(LAB, { recursive: true, force: true })
    console.log('\n实验仓库已清理（加 --keep 可保留）')
  }
}

main().catch((cause) => {
  console.log('DEMO CRASHED: ' + (cause && cause.stack ? cause.stack : cause))
  process.exit(1)
})
