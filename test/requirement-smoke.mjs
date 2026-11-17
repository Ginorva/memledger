// Smoke test for the requirement layer — the table of contents above the ledger.
//
// What this pins down, and why each one matters:
//
//  * a requirement is a real file (`docs/需求/RQ-YYYYMMDD-NN.md`), and creating
//    the same id twice is refused — a requirement is a decision record, not a
//    scratch buffer;
//  * an entry may only point at a requirement that exists, so the auto-generated
//    index never links to a file that was never written;
//  * the duplicate-symbol guard is relaxed *within* one requirement (rounds of
//    one request) and still fires *across* requirements (that is where re-doing
//    work hides);
//  * the requirement checklist updates itself when an entry lands;
//  * verify complains about dangling requirement links and about pending entries
//    whose anchor disappeared (the two ways the layer could silently rot).

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-requirement')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

function touch(relative, body = '# placeholder\n') {
  const target = join(LAB, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, body, 'utf-8')
}

async function register() {
  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const registered = new Map()
  module.apply({
    effect: (fn) => fn(),
    get: (name) =>
      name === 'tools'
        ? { register: (spec) => { registered.set(spec.name, spec); return () => {} } }
        : undefined,
    logger: () => ({ warn: () => {} }),
  })
  return registered
}

async function main() {
  rmSync(LAB, { recursive: true, force: true })
  mkdirSync(join(LAB, 'docs'), { recursive: true })
  touch('core/a.py')
  touch('core/b.py')

  const tools = await register()
  const reqTool = tools.get('ledger_requirement')
  const addTool = tools.get('ledger_add')
  const verifyTool = tools.get('ledger_verify')

  console.log('registration:')
  check('ledger_requirement is registered', reqTool !== undefined)
  check('ledger_add takes an optional requirement', addTool?.parameters?.properties?.requirement !== undefined)
  check('requirement is not required', !(addTool?.parameters?.required ?? []).includes('requirement'))

  console.log('create:')
  const created = await reqTool.execute({
    root: LAB,
    action: 'create',
    title: '持仓抽屉清仓后仍显示假数据',
    ask: '清仓之后宁波港还在面板上，是不是没刷新？',
    scope: '清仓后不再回退兜底假数据，并展示空仓防御与已清仓战报。',
    acceptance: '清仓后抽屉只显示空仓卡，不再出现宁波港/众业达。',
    notDoing: '不处理行情轮询频率。',
  })
  const reqA = created.id
  check('ok', created.ok === true, JSON.stringify(created).slice(0, 120))
  check('id looks like RQ-YYYYMMDD-NN', /^RQ-\d{8}-\d{2}$/.test(String(reqA)), String(reqA))
  check('file exists', existsSync(join(LAB, 'docs', '需求', reqA + '.md')))
  const reqText = readFileSync(join(LAB, 'docs', '需求', reqA + '.md'), 'utf-8')
  check('keeps the raw ask', reqText.includes('清仓之后宁波港还在面板上'))
  check('does not quote the template guidance as if the user said it', !reqText.includes('原文照抄'))
  check('records what is explicitly not done', reqText.includes('不处理行情轮询频率'))

  const again = await reqTool.execute({ root: LAB, action: 'create', id: reqA, title: '重复' })
  check('refuses to overwrite', again.ok === false, JSON.stringify(again).slice(0, 100))
  check('says why', String(again.message).includes('拒绝覆盖'), again.message)

  console.log('add without a real requirement is refused:')
  const orphan = await addTool.execute({
    root: LAB,
    title: '孤儿子项',
    type: '修复',
    status: '已落地',
    anchor: 'core/a.py::fn',
    why: '测试用，需求不存在时应拒绝。',
    keywords: ['孤儿', '需求校验'],
    requirement: 'RQ-19990101-09',
  })
  check('not ok', orphan.ok === false, JSON.stringify(orphan).slice(0, 100))
  check('tells the caller to create the requirement first', String(orphan.message).includes('ledger_requirement'), orphan.message)

  console.log('add with a requirement links both directions:')
  const first = await addTool.execute({
    root: LAB,
    title: '清仓空数组不再回退兜底数据',
    type: '修复',
    status: '已落地',
    anchor: 'core/a.py::fn',
    why: '空数组是合法持仓状态，不能用长度判定缺失。',
    keywords: ['空数组', '兜底假数据'],
    requirement: reqA,
  })
  check('ok', first.ok === true, JSON.stringify(first).slice(0, 140))
  const ledgerText = readFileSync(join(LAB, 'docs', '变更台账.md'), 'utf-8')
  check('entry names its requirement', ledgerText.includes('- **需求**：' + reqA))
  const reqAfter = readFileSync(join(LAB, 'docs', '需求', reqA + '.md'), 'utf-8')
  check('requirement lists the entry', reqAfter.includes(first.entryId), reqAfter.slice(-200))
  check('landed entry is checked', reqAfter.includes('- [x] ' + first.entryId))

  console.log('index gains a requirement section:')
  check('section 1.3 exists', ledgerText.includes('### 1.3 按需求分组'), ledgerText.slice(0, 200))
  check('links the requirement file', ledgerText.includes('./需求/' + reqA + '.md'))
  const rowMatch = new RegExp('\\| \\[' + reqA + '\\]\\([^)]*\\) \\| (\\d+) \\|').exec(ledgerText)
  check('counts the linked entries', rowMatch !== null && rowMatch[1] === '1', rowMatch === null ? 'no row' : rowMatch[0])

  console.log('same requirement is a follow-up, not a duplicate:')
  const second = await addTool.execute({
    root: LAB,
    title: '同一函数的第二轮修复',
    type: '修复',
    status: '已落地',
    anchor: 'core/a.py::fn',
    why: '第一轮只处理空数组，这一轮补空仓展示。',
    keywords: ['空仓展示', '清仓'],
    requirement: reqA,
  })
  check('accepted within the same requirement', second.ok === true, JSON.stringify(second).slice(0, 160))
  const reqAfter2 = readFileSync(join(LAB, 'docs', '需求', reqA + '.md'), 'utf-8')
  check('both entries are listed', reqAfter2.includes(first.entryId) && reqAfter2.includes(second.entryId))
  check('sub-items stay in one list', !/- \[[ xX]\] CL-[^\n]*\n\n- \[[ xX]\] CL-/.test(reqAfter2), 'a blank line between items would split the Markdown list')

  console.log('a different requirement still blocks:')
  const other = await reqTool.execute({ root: LAB, action: 'create', title: '另一个需求' })
  const reqB = other.id
  const blocked = await addTool.execute({
    root: LAB,
    title: '跨需求改同一函数',
    type: '修复',
    status: '已落地',
    anchor: 'core/a.py::fn',
    why: '这确实可能是重复劳动，应被挡回。',
    keywords: ['重复劳动', '跨需求'],
    requirement: reqB,
  })
  check('refused', blocked.ok === false && blocked.refused === true, JSON.stringify(blocked).slice(0, 160))
  check('names the colliding entries', Array.isArray(blocked.collidesWith) && blocked.collidesWith.length > 0)

  console.log('list:')
  const listed = await reqTool.execute({ root: LAB, action: 'list' })
  check('ok', listed.ok === true)
  check('returns both requirements', (listed.requirements ?? []).length === 2, JSON.stringify(listed.requirements))
  const summary = (listed.requirements ?? []).find((item) => item.id === reqA)
  check('counts subitems', summary?.subitems === 2, JSON.stringify(summary))

  console.log('verify:')
  const pending = await addTool.execute({
    root: LAB,
    title: '等真机截图再收口',
    type: '修复',
    status: '待验证',
    anchor: 'core/gone.py::fn',
    why: '需要真机确认样式，但锚点文件随后被删：待验证条目不应静默腐烂。',
    keywords: ['真机截图', '待验证收口'],
    requirement: reqA,
  })
  check('pending entry lands as 待验证', pending.ok === true, JSON.stringify(pending).slice(0, 120))
  const verify = await verifyTool.execute({ root: LAB })
  check('still passes overall', verify.ok === true, JSON.stringify(verify).slice(0, 160))
  check('warns about the dead pending anchor', (verify.warnings ?? []).some((w) => w.includes('待验证') && w.includes('core/gone.py')), JSON.stringify(verify.warnings))

  unlinkSync(join(LAB, 'docs', '需求', reqA + '.md'))
  const dangling = await verifyTool.execute({ root: LAB })
  check('warns about the dangling requirement link', (dangling.warnings ?? []).some((w) => w.includes('需求不存在')), JSON.stringify(dangling.warnings))

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
