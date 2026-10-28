// Smoke test for the dsh-memledger agent tools.
//
// Registers the tools against a fake `tools` service, then calls the specs the
// way the harness would. Two properties matter most:
//
//   * every tool is registered with a name, a parameters schema and an execute
//     function, so the model can actually call it;
//   * `ledger_bootstrap` refuses to overwrite an existing ledger, because
//     scaffolding rewrites the file and a finished ledger is not disposable.
//
// A throwaway git repository is created so the git-history path is exercised
// for real rather than mocked.

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-tools')
const REPO = join(LAB, 'demo-repo')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

function fakeCtx() {
  const registered = new Map()
  return {
    registered,
    webServer: { register: () => () => {} },
    effect(fn) {
      return fn()
    },
    get(name, strict) {
      if (name === 'tools') return { register: (spec) => { registered.set(spec.name, spec); return () => registered.delete(spec.name) } }
      if (name === 'sessions') return undefined
      if (name === 'sessionQuery') return undefined
      if (strict === false) return undefined
      throw new Error('missing service: ' + name)
    },
    logger: () => ({ warn: (m) => console.log('  [warn] ' + m) }),
  }
}

function git(cwd, args) {
  return execSync('git ' + args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
}

async function main() {
  rmSync(LAB, { recursive: true, force: true })
  mkdirSync(REPO, { recursive: true })

  // A repository whose history looks like the real thing.
  git(REPO, 'init -q')
  git(REPO, 'config user.name tester')
  git(REPO, 'config user.email tester@example.com')
  writeFileSync(join(REPO, 'guard.py'), 'def guard():\n    return True\n', 'utf-8')
  git(REPO, 'add -A')
  git(REPO, 'commit -qm "fix: guard the entry point against duplicate signals"')
  writeFileSync(join(REPO, 'feed.py'), 'def feed():\n    return []\n', 'utf-8')
  git(REPO, 'add -A')
  git(REPO, 'commit -qm "fix: feed fallback when the vendor times out"')

  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  console.log('inject list:')
  check('declares tools', module.inject.includes('tools'), JSON.stringify(module.inject))

  const ctx = fakeCtx()
  let applyError = null
  try {
    module.apply(ctx)
  } catch (cause) {
    applyError = cause
  }
  console.log('registration:')
  check('apply does not throw', applyError === null, applyError && applyError.message)
  check('registers five tools', ctx.registered.size === 5, String(ctx.registered.size))
  for (const name of ['ledger_check', 'ledger_bootstrap', 'ledger_search', 'ledger_add', 'ledger_verify']) {
    const spec = ctx.registered.get(name)
    check(name + ' registered', spec !== undefined)
    check(name + ' has a description', typeof spec?.description === 'string' && spec.description.length > 20)
    check(name + ' has a parameters schema', spec?.parameters?.type === 'object')
    check(name + ' has an execute function', typeof spec?.execute === 'function')
    check(name + ' declares an output schema', spec?.output?.schema?.type === 'object')
  }
  check(
    'bootstrap requires root in its schema',
    Array.isArray(ctx.registered.get('ledger_bootstrap')?.parameters?.required) &&
      ctx.registered.get('ledger_bootstrap').parameters.required.includes('root'),
    JSON.stringify(ctx.registered.get('ledger_bootstrap')?.parameters?.required),
  )

  const bootstrap = ctx.registered.get('ledger_bootstrap')
  const search = ctx.registered.get('ledger_search')
  const add = ctx.registered.get('ledger_add')
  const verify = ctx.registered.get('ledger_verify')

  console.log('bootstrap without root is refused:')
  const noRoot = await bootstrap.execute({})
  check('refuses', noRoot.ok === false && noRoot.refused === true, JSON.stringify(noRoot))
  check('explains why', String(noRoot.message).includes('root'), noRoot.message)

  console.log('bootstrap from git history:')
  const written = await bootstrap.execute({ root: REPO, source: 'git', maxCommits: 30 })
  check('reports ok', written.ok === true, JSON.stringify(written))
  check('created the ledger file', existsSync(join(REPO, 'docs', '变更台账.md')))
  check('recovered at least one commit', written.entryCount >= 1, String(written.entryCount))
  const ledgerText = readFileSync(join(REPO, 'docs', '变更台账.md'), 'utf-8')
  check('ledger has the decision index marker', ledgerText.includes('<!-- 决策索引:BEGIN -->'))
  check('ledger has the entry marker', ledgerText.includes('<!-- 条目:BEGIN -->'))
  check('recovered content mentions the fixture commit', ledgerText.includes('guard'), 'no "guard" in ledger')
  check('ledger carries the 12-field schema', ledgerText.includes('- **锚点**：') && ledgerText.includes('- **为什么**：'))

  console.log('bootstrap refuses to overwrite:')
  const before = readFileSync(join(REPO, 'docs', '变更台账.md'), 'utf-8')
  const again = await bootstrap.execute({ root: REPO, source: 'git' })
  check('refuses without force', again.ok === false && again.refused === true, JSON.stringify({ ok: again.ok, refused: again.refused }))
  check('reports the existing count', again.entryCount >= 1, String(again.entryCount))
  check('file is byte-identical afterwards', readFileSync(join(REPO, 'docs', '变更台账.md'), 'utf-8') === before)

  console.log('ledger_add:')
  const added = await add.execute({
    root: REPO,
    title: '把闸门前移到选股写入前',
    type: '修复',
    status: '已落地',
    anchor: 'guard.py::guard',
    why: '下游过滤导致闸门裁决晚一天才生效，选股池已被消费。',
    background: '闸门在 T+1 才写结果',
    change: '把闸门判断移到写入之前',
    keywords: ['闸门', '选股'],
  })
  check('ok', added.ok === true, JSON.stringify(added))
  check('returns an entry id', /^CL-\d{8}-\d{2,}$/.test(String(added.entryId)), String(added.entryId))
  const afterAdd = readFileSync(join(REPO, 'docs', '变更台账.md'), 'utf-8')
  check('appended the title', afterAdd.includes('把闸门前移到选股写入前'))
  check('appended the anchor', afterAdd.includes('guard.py::guard'))
  check('kept the earlier git-recovered entries', afterAdd.includes('feed') || afterAdd.includes('guard the entry'))

  console.log('ledger_add validation:')
  const badStatus = await add.execute({
    root: REPO,
    title: '状态非法',
    type: '修复',
    status: '不存在的状态',
    anchor: 'x.py::y',
    why: '这条应该被校验挡住',
  })
  check('rejects an invalid status', badStatus.ok === false, JSON.stringify(badStatus))
  check('says why it failed', String(badStatus.message).length > 0, badStatus.message)

  const thinWhy = await add.execute({
    root: REPO,
    title: '搁置但没写为什么',
    type: '决策',
    status: '搁置',
    anchor: 'y.py::z',
    why: '短',
  })
  check('rejects a shelved entry with a hollow why', thinWhy.ok === false, JSON.stringify(thinWhy))

  console.log('ledger_search:')
  const found = await search.execute({ root: REPO, query: '闸门' })
  check('ok', found.ok === true, JSON.stringify(found))
  check('finds the added entry', found.total >= 1, String(found.total))
  check('reports found', found.found === true)
  check('entry carries its anchor', found.entries.some((e) => String(e.anchor).includes('guard.py')), JSON.stringify(found.entries))

  const pendingOnly = await search.execute({ root: REPO, status: 'pending' })
  check('pending filter is applied', pendingOnly.entries.every((e) => ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中'].includes(e.status)), JSON.stringify(pendingOnly.entries.map((e) => e.status)))

  const nothing = await search.execute({ root: REPO, query: '绝不存在的关键词xyzzy' })
  check('miss reports found:false', nothing.found === false && nothing.total === 0)

  console.log('ledger_verify:')
  const verified = await verify.execute({ root: REPO })
  check('ok', verified.ok === true, JSON.stringify(verified))
  check('checked at least one anchor', verified.checked >= 1, String(verified.checked))
  check('no missing anchors', Array.isArray(verified.missing) && verified.missing.length === 0, JSON.stringify(verified.missing))

  // A landed anchor whose file vanished must be reported — and the distinction
  // matters: the directory has to exist here for this to count as a regression.
  // A missing top directory means the anchor points into another repository and
  // is merely unverifiable, not dead.
  mkdirSync(join(REPO, 'gone'), { recursive: true })
  const vanished = await add.execute({
    root: REPO,
    title: '指向一个已被删除的文件',
    type: '修复',
    status: '已落地',
    anchor: 'gone/never-existed.py::f',
    why: '用来验证锚点体检能发现文件消失。',
  })
  check('seeded the missing-anchor entry', vanished.ok === true, JSON.stringify(vanished))
  const broken = await verify.execute({ root: REPO })
  check('detects the missing anchor', broken.ok === false, JSON.stringify(broken))
  check('names the missing file', broken.missing.some((m) => String(m).includes('never-existed')), JSON.stringify(broken.missing))

  rmSync(LAB, { recursive: true, force: true })

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
