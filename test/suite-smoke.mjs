// Smoke test for the contract-suite layer (RQ-20261117-06).
//
// The feature exists to turn the ledger's 「验收」 prose into something that can
// be re-run. So the test is written around the four questions that decide
// whether the feature is real:
//
//   1. register + run  → does a case produce a score, a run record and a card?
//   2. selection       → does touching one anchor run only the cases that cover it?
//   3. integrity       → is a hand-weakened assertion visible as drift?
//   4. wiring          → do check/verify/add actually mention the contract?
//
// Nothing here needs the network, a clock, or a port: a suite that only works on
// a good day is a suite that gets ignored on a bad one.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-suite')

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

function entry(id, title, status, anchor, why) {
  return `
### ${id} · ${title}

- **日期**：2026-11-17
- **类型**：修复
- **状态**：${status}
- **仓**：prog
- **背景**：测试用
- **改动**：测试用
- **为什么**：${why}
- **取舍**：无
- **锚点**：${anchor}
- **commit**：deadbee
- **验收**：无
- **关键词**：契约, 测试
`
}

function buildLedger() {
  return `# 项目变更台账（append-only）

<!-- 决策索引:BEGIN -->
<!-- 决策索引:END -->

<!-- 条目:BEGIN -->
${entry('CL-20261101-01', 'x 的 alpha 已修好', '已落地', 'prog/lib/x.js::alpha', '没有幂等判定会重复触发。')}
${entry('CL-20261102-01', 'y 的 beta 从没用例守过', '已落地', 'prog/lib/y.js::beta', '当时来不及写用例。')}
${entry('CL-20261103-01', '给 smoke 测试本身加了断言', '已落地', 'prog/test/smoke.mjs', '测试即契约，不需要再被别的用例覆盖。')}
<!-- 条目:END -->
`
}

async function main() {
  rmSync(LAB, { recursive: true, force: true })
  mkdirSync(join(LAB, 'docs'), { recursive: true })
  write('docs/变更台账.md', buildLedger())
  write('prog/package.json', JSON.stringify({ name: 'prog', version: '1.0.0', description: '测试程序' }, null, 2))
  write('prog/lib/x.js', 'export function alpha() { return 1 }\n')
  write('prog/lib/y.js', 'export function beta() { return 2 }\n')
  write('prog/test/smoke.mjs', "console.log('smoke')\n")
  write('prog/test/other.mjs', "console.log('other')\n")
  write('prog/pass.mjs', "console.log('OK alpha')\nprocess.exit(0)\n")
  write('prog/fail.mjs', "console.error('boom')\nprocess.exit(1)\n")

  const { registerAgentTools } = await import(new URL('../lib/agent-tools.js', import.meta.url).href)
  const registered = new Map()
  registerAgentTools(
    {
      effect: (fn) => fn(),
      get: (name) => (name === 'tools' ? { register: (spec) => { registered.set(spec.name, spec); return () => {} } } : undefined),
    },
    () => {},
  )

  const suite = registered.get('ledger_suite')
  const checkTool = registered.get('ledger_check')
  const verifyTool = registered.get('ledger_verify')
  const addTool = registered.get('ledger_add')

  console.log('registration:')
  check('ledger_suite is registered', suite !== undefined)
  check('ledger_check is registered', checkTool !== undefined)
  check('ledger_suite exposes the six actions', Array.isArray(suite?.parameters?.properties?.action?.enum) && suite.parameters.properties.action.enum.length === 6)

  console.log('add:')
  const added = await suite.execute({
    root: LAB,
    action: 'add',
    program: 'prog',
    caseId: 'C-001',
    title: '零数据也必须有输出',
    from: 'RQ-20261117-06#验收口径1',
    covers: ['lib/x.js::alpha'],
    run: 'node pass.mjs',
    expect: { exit: 0, contains: ['OK'] },
    weight: 3,
    seenFail: true,
  })
  check('case registered', added.ok === true, added.message)
  check('suite file written', existsSync(join(LAB, 'docs', '验收', 'prog.json')))
  const stored = JSON.parse(readFileSync(join(LAB, 'docs', '验收', 'prog.json'), 'utf-8'))
  check('suite is versioned', stored.version === 1, String(stored.version))
  check('suite is hash-frozen', typeof stored.frozen?.hash === 'string' && stored.frozen.hash.length > 0)

  const duplicate = await suite.execute({ root: LAB, action: 'add', program: 'prog', caseId: 'C-001', title: 'dupe', run: 'node pass.mjs' })
  check('duplicate id refused', duplicate.ok === false && String(duplicate.message).includes('已有用例'), duplicate.message)

  const unsafe = await suite.execute({
    root: LAB,
    action: 'add',
    program: 'prog',
    title: 'injection',
    run: 'node pass.mjs & node fail.mjs',
  })
  check('shell metacharacters refused', unsafe.ok === false && String(unsafe.message).includes('元字符'), unsafe.message)

  console.log('run:')
  const first = await suite.execute({ root: LAB, action: 'run', program: 'prog' })
  check('run succeeds', first.ok === true, first.message)
  check('score is 100', first.score === 100, String(first.score))
  check('one case passed', first.passed === 1 && first.total === 1, `${first.passed}/${first.total}`)
  check('message reports the score', String(first.message).includes('契约分 100'), first.message)
  check('run history written', existsSync(join(LAB, 'docs', '.memledger-runs.jsonl')))
  const runLines = readFileSync(join(LAB, 'docs', '.memledger-runs.jsonl'), 'utf-8').trim().split('\n')
  check('history has one record', runLines.length === 1, String(runLines.length))
  check('history record names the program', JSON.parse(runLines[0]).program === 'prog')
  check('program card written', existsSync(join(LAB, 'docs', '程序', 'prog.md')))
  const cardText = readFileSync(join(LAB, 'docs', '程序', 'prog.md'), 'utf-8')
  check('card lists the case', cardText.includes('C-001') && cardText.includes('零数据也必须有输出'))

  console.log('wiring — ledger_add fills 验收 from the contract:')
  const added2 = await addTool.execute({
    root: LAB,
    title: 'alpha2 小修',
    type: '修复',
    status: '已落地',
    anchor: 'prog/lib/x.js::alpha2',
    why: '同一函数的第二处判定也缺幂等。',
    keywords: ['契约', 'alpha2'],
  })
  check('entry recorded', added2.ok === true, added2.message)
  check('verify field auto-filled with the contract', String(added2.message).includes('契约 C-001'), added2.message)
  const ledgerText = readFileSync(join(LAB, 'docs', '变更台账.md'), 'utf-8')
  check('ledger stores the contract line', /- \*\*验收\*\*：契约 C-001/.test(ledgerText), (ledgerText.match(/- \*\*验收\*\*：.*/g) || []).slice(-1)[0])

  const addedTest = await addTool.execute({
    root: LAB,
    title: '给 smoke 测试本身补一条断言',
    type: '修复',
    status: '已落地',
    anchor: 'prog/test/other.mjs',
    why: '测试文件本身的改动不需要再被别的用例覆盖。',
    keywords: ['测试', '契约'],
  })
  check('a test-anchored entry is recorded', addedTest.ok === true, addedTest.message)
  check('a test-anchored entry is not nagged as a contract debt', !String(addedTest.message).includes('契约欠账'), addedTest.message)

  console.log('wiring — ledger_check surfaces the contract:')
  const checked = await checkTool.execute({ root: LAB, paths: ['prog/lib/x.js'] })
  check('check mentions the case', String(checked.message).includes('🧪 契约 C-001'), checked.message)
  check('check reports the last score', String(checked.message).includes('100 分'), checked.message)

  console.log('wiring — ledger_verify reports debts:')
  // Must run before C-002 is registered, otherwise lib/y.js is covered and the
  // debt legitimately disappears.
  const verified = await verifyTool.execute({ root: LAB })
  check('contract debts include the uncovered landed entry', Array.isArray(verified.contractDebts) && verified.contractDebts.includes('CL-20261102-01'), JSON.stringify(verified.contractDebts))
  check('a decision anchored at a test file is not a debt', !verified.contractDebts.includes('CL-20261103-01'), JSON.stringify(verified.contractDebts))
  check('verify message mentions debts', String(verified.message).includes('契约欠账'), verified.message)

  console.log('failing case:')
  const addedFail = await suite.execute({
    root: LAB,
    action: 'add',
    program: 'prog',
    caseId: 'C-002',
    title: '失败用例',
    covers: ['lib/y.js::beta'],
    run: 'node fail.mjs',
    expect: { exit: 0 },
  })
  check('failing case registered', addedFail.ok === true, addedFail.message)
  const second = await suite.execute({ root: LAB, action: 'run', program: 'prog' })
  check('score drops below 100', typeof second.score === 'number' && second.score < 100, String(second.score))
  check('failure is named', String(second.message).includes('✗ C-002'), second.message)
  check('one case failed', second.failed === 1, String(second.failed))

  console.log('selection by anchor:')
  const selected = await suite.execute({ root: LAB, action: 'run', program: 'prog', paths: ['prog/lib/x.js'] })
  check('only the covering case runs', selected.total === 1 && selected.passed === 1, `${selected.passed}/${selected.total}`)
  const none = await suite.execute({ root: LAB, action: 'run', program: 'prog', paths: ['prog/lib/zzz.js'] })
  check('uncovered path is reported, not silently green', none.ok === false && String(none.message).includes('没有用例覆盖'), none.message)

  console.log('wiring — ledger_verify reports drift:')
  const retired = await suite.execute({ root: LAB, action: 'retire', program: 'prog', caseId: 'C-002', reason: '该功能已随模块下线' })
  check('case retired', retired.ok === true, retired.message)
  const afterRetire = await suite.execute({ root: LAB, action: 'run', program: 'prog' })
  check('retired case no longer runs', afterRetire.total === 1, String(afterRetire.total))

  console.log('integrity — a hand-weakened assertion is visible:')
  const path = join(LAB, 'docs', '验收', 'prog.json')
  const edited = JSON.parse(readFileSync(path, 'utf-8'))
  edited.cases[0].run = 'node pass.mjs' // unchanged command, but the expectation is what a cheater would relax
  edited.cases[0].expect.contains = []
  writeFileSync(path, JSON.stringify(edited, null, 2), 'utf-8')
  const { loadSuite } = await import(new URL('../lib/suite.js', import.meta.url).href)
  check('drift detected on load', loadSuite(LAB, 'prog')?.drift === true)
  const verified2 = await verifyTool.execute({ root: LAB })
  check('verify reports the drift', verified2.suiteIssues.some((issue) => String(issue).includes('哈希')), JSON.stringify(verified2.suiteIssues))

  console.log('rejections:')
  const unknown = await suite.execute({ root: LAB, action: 'nope' })
  check('unknown action rejected', unknown.ok === false && String(unknown.message).includes('未知 action'), unknown.message)
  const updateNoReason = await suite.execute({ root: LAB, action: 'update', program: 'prog', caseId: 'C-001' })
  check('update requires a reason', updateNoReason.ok === false && String(updateNoReason.message).includes('reason'), updateNoReason.message)

  console.log('routes — the GUI data source:')
  const { registerRoutes } = await import(new URL('../lib/routes.js', import.meta.url).href)
  const handlers = new Map()
  registerRoutes(
    {
      get: (name) => (name === 'webServer' ? { register: (options) => { handlers.set(options.path, options.handler); return () => {} } } : undefined),
      effect: (fn) => fn(),
    },
    () => {},
  )
  const handler = handlers.get('/api/memledger/suites')
  check('suites route registered', typeof handler === 'function')
  let body = ''
  await handler(
    { url: '/api/memledger/suites?root=' + encodeURIComponent(LAB) },
    { writeHead() {}, end(text) { body = text } },
  )
  const routePayload = JSON.parse(body || '{}')
  check('route answers ok', routePayload.ok === true, body.slice(0, 160))
  check('route lists the program', Array.isArray(routePayload.programs) && routePayload.programs[0]?.program === 'prog', JSON.stringify(routePayload.programs?.map((item) => item.program)))
  check('route carries case results', Array.isArray(routePayload.programs?.[0]?.cases) && routePayload.programs[0].cases[0].last?.ok === true, JSON.stringify(routePayload.programs?.[0]?.cases?.[0]))
  check('route carries the score history', Array.isArray(routePayload.programs?.[0]?.history) && routePayload.programs[0].history.length >= 1)
  check('route carries the drift flag', routePayload.programs?.[0]?.drift === true, String(routePayload.programs?.[0]?.drift))

  rmSync(LAB, { recursive: true, force: true })
  console.log(failures === 0 ? '\nsuite-smoke: all checks passed' : `\nsuite-smoke: ${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((cause) => {
  console.error('suite-smoke crashed:', cause)
  rmSync(LAB, { recursive: true, force: true })
  process.exit(1)
})
