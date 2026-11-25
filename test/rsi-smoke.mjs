// Smoke test for the RSI (Recursive Self-Improvement) upgrades:
//  1. Antibody / Immunity System:
//     - Rollback entries trigger antibody alerts and guidance.
//     - ledger_verify detects regressionDebts (unprotected rollbacks).
//     - ledger_check warns about unprotected rollbacks, and confirms protection once a weight=5 case exists.
//  2. Metabolic Pruning & Active Consensus:
//     - Default ledger_search prunes superseded / closed history, projecting active consensus.
//     - all=true reveals full historical trace with superseded marks.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-rsi')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

function write(relative, content) {
  const target = join(LAB, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

function fakeCtx() {
  const registered = new Map()
  return {
    registered,
    webServer: { register: () => () => {} },
    effect(fn) { return fn() },
    get(name, strict) {
      if (name === 'tools') return { register: (spec) => { registered.set(spec.name, spec); return () => registered.delete(spec.name) } }
      if (name === 'sessions') return undefined
      if (name === 'sessionQuery') return undefined
      if (strict === false) return undefined
      throw new Error('missing service: ' + name)
    },
    logger: () => ({ warn: () => {} }),
  }
}

async function main() {
  rmSync(LAB, { recursive: true, force: true })

  // Scaffold workspace with program 'prog'
  write('prog/package.json', JSON.stringify({ name: 'prog', version: '1.0.0', description: '测试程序' }, null, 2))
  write('prog/lib/core.js', 'export function run() { return 42 }\n')
  write('prog/lib/cache.js', 'export function get() { return null }\n')
  write('prog/test-pass.mjs', 'process.exit(0)\n')
  write('docs/变更台账.md', '# 项目变更台账（append-only）\n\n<!-- 决策索引:BEGIN -->\n<!-- 决策索引:END -->\n\n<!-- 条目:BEGIN -->\n<!-- 条目:END -->\n')
  write('docs/需求/RQ-20261125-01.md', '# RQ-20261125-01 · RSI 升级测试\n')

  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const ctx = fakeCtx()
  module.apply(ctx)

  const add = ctx.registered.get('ledger_add')
  const checkTool = ctx.registered.get('ledger_check')
  const verify = ctx.registered.get('ledger_verify')
  const suite = ctx.registered.get('ledger_suite')
  const search = ctx.registered.get('ledger_search')

  /* ==============================================================
   * Part 1: Immunity / Antibody System (Rollback-to-Antibody)
   * ============================================================== */
  console.log('\n--- 1. Immunity / Antibody System ---')

  // Initialize suite for prog
  const baseline = await suite.execute({
    root: LAB,
    program: 'prog',
    action: 'add',
    title: '基线健全契约',
    covers: ['lib/core.js::run'],
    run: 'node test-pass.mjs',
    expect: { exit: 0 },
  })
  check('baseline suite registered', baseline.ok === true, JSON.stringify(baseline))

  // 1.1 Add a rolled-back entry without antibody contract
  const rollbackAdd = await add.execute({
    root: LAB,
    repo: 'prog',
    title: '尝试改用异步但造成阻塞',
    type: '修复',
    status: '已回退',
    anchor: 'prog/lib/core.js::run',
    why: '并发测试中发生死锁，回退到原逻辑。',
    keywords: ['死锁', '回退测试'],
    requirement: 'RQ-20261125-01',
  })

  check('rollback entry added', rollbackAdd.ok === true, JSON.stringify(rollbackAdd))
  check('rollback alert in message', rollbackAdd.message.includes('倒车免疫警报'), rollbackAdd.message)
  check('provides suite add guidance', rollbackAdd.message.includes('ledger_suite action=add weight=5'), rollbackAdd.message)

  // 1.2 Verify checks regressionDebts
  const verify1 = await verify.execute({ root: LAB })
  check('verify reports regression debts', (verify1.regressionDebts ?? []).length === 1, JSON.stringify(verify1.regressionDebts))
  check('verify message highlights missing antibody', verify1.message.includes('免疫抗体缺失') && verify1.message.includes(rollbackAdd.entryId), verify1.message)

  // 1.3 Check path warns about missing antibody
  const check1 = await checkTool.execute({ root: LAB, paths: ['prog/lib/core.js'] })
  check('check warns missing antibody for rolled back path', check1.message.includes('🚨 免疫抗体缺失'), check1.message)

  // 1.4 Add antibody contract (weight = 5)
  const antibodyAdd = await suite.execute({
    root: LAB,
    program: 'prog',
    action: 'add',
    weight: 5,
    from: rollbackAdd.entryId,
    title: '防死锁倒车契约',
    covers: ['lib/core.js::run'],
    run: 'node test-pass.mjs',
    expect: { exit: 0 },
  })
  check('antibody case registered', antibodyAdd.ok === true, JSON.stringify(antibodyAdd))

  // 1.5 Verify regression debt cleared
  const verify2 = await verify.execute({ root: LAB })
  check('regression debts cleared', (verify2.regressionDebts ?? []).length === 0, JSON.stringify(verify2.regressionDebts))
  check('verify message clear of antibody warning', !verify2.message.includes('免疫抗体缺失'), verify2.message)

  // 1.6 Check confirms antibody protection
  const check2 = await checkTool.execute({ root: LAB, paths: ['prog/lib/core.js'] })
  check('check confirms antibody in place', check2.message.includes('🛡️ 倒车抗体已就位'), check2.message)

  /* ==============================================================
   * Part 2: Metabolic Pruning & Active Consensus
   * ============================================================== */
  console.log('\n--- 2. Metabolic Pruning & Active Consensus ---')

  // Land a solution v1
  const v1 = await add.execute({
    root: LAB,
    repo: 'prog',
    title: '第一版缓存方案',
    type: '修复',
    status: '已落地',
    anchor: 'prog/lib/cache.js::get',
    why: '引入 LRU 缓存。',
    keywords: ['LRU', '缓存方案'],
    force: true,
  })

  // Supersede with v2
  const v2 = await add.execute({
    root: LAB,
    repo: 'prog',
    title: `改用 TTL 缓存（结案 ${v1.entryId}）`,
    type: '修复',
    status: '已落地',
    anchor: 'prog/lib/cache.js::get',
    why: `LRU 内存未释放，改用 TTL 缓存替代。结案 ${v1.entryId}。`,
    keywords: ['TTL', '缓存方案'],
    force: true,
  })

  // 2.1 Default search: metabolic pruning
  const defaultSearch = await search.execute({ root: LAB, query: '缓存' })
  check('default search returns live entry', defaultSearch.entries.some((e) => e.id === v2.entryId), JSON.stringify(defaultSearch.entries))
  check('default search prunes superseded entry', !defaultSearch.entries.some((e) => e.id === v1.entryId))
  check('default search indicates pruned count', defaultSearch.message.includes('代谢系统已自动折叠') && defaultSearch.message.includes('all=true'), defaultSearch.message)

  // 2.2 Search with all=true: reveals full history
  const allSearch = await search.execute({ root: LAB, query: '缓存', all: true })
  check('all=true returns live entry', allSearch.entries.some((e) => e.id === v2.entryId))
  check('all=true returns superseded entry', allSearch.entries.some((e) => e.id === v1.entryId))
  check('all=true marks superseded entry', allSearch.message.includes(`已被 ${v2.entryId} 取代`), allSearch.message)

  rmSync(LAB, { recursive: true, force: true })

  if (failures > 0) {
    console.log('\n' + failures + ' check(s) failed')
    process.exitCode = 1
  } else {
    console.log('\nALL RSI SMOKE CHECKS PASSED!')
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})