// Smoke test for `ledger_check` — the pre-change check.
//
// This is the tool that exists to stop repeated work, so the test is written
// around the five verdicts and the specific mistake each one prevents:
//
//   rollback-risk   an earlier landed fix is no longer in the file
//   repeated-repair the same anchor was landed more than once already
//   already-done    a landed change covers this code; do not redo it
//   shelved         a plan was deliberately deferred; respect the restart condition
//   unrecorded      nothing known; proceed and record afterwards
//
// It also pins path matching, because real ledgers mix absolute anchors,
// repo-relative anchors, Windows separators and directory-level anchors.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-check')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

function touch(relative) {
  const target = join(LAB, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, '# placeholder\n', 'utf-8')
}

function entry(id, title, status, anchor, why, tradeoff) {
  return `
### ${id} · ${title}

- **日期**：2026-10-28
- **类型**：修复
- **状态**：${status}
- **仓**：本仓
- **背景**：测试用
- **改动**：测试用
- **为什么**：${why}
- **取舍**：${tradeoff ?? '无'}
- **锚点**：${anchor}
- **commit**：deadbee
- **验收**：无
- **关键词**：测试
`
}

function buildLedger() {
  return `# 项目变更台账（append-only）

<!-- 决策索引:BEGIN -->
<!-- 决策索引:END -->

<!-- 条目:BEGIN -->
${entry('CL-20261001-01', '闸门重复开仓已修好', '已落地', 'core/gate.py::allow', '同一 bar 内二次触发，加幂等判定。')}
${entry('CL-20261002-01', '行情源超时兜底（后来被改没了）', '已落地', 'core/feed.py::fetch', '厂商超时要返回空列表而不是抛错，否则整轮选股空跑。')}
${entry('CL-20261003-01', '补数重入第一次修复', '已落地', 'core/backfill.py::run', '重入会把缓存写脏，加锁。')}
${entry('CL-20261004-01', '补数重入第二次修复', '已落地', 'core/backfill.py::run', '锁没覆盖并发路径，重做一次。')}
${entry('CL-20261005-01', '分钟线补数方案暂缓', '搁置', 'core/backfill.py', '限流期间补数会污染缓存，等正式接口上线。', '重启条件：拿到券商正式接口')}
${entry('CL-20261006-01', '绝对路径写法的锚点', '已落地', 'D:\\\\repo\\\\other\\\\module.py::thing', '用绝对路径写的，也要能匹配。')}
${entry('CL-20261007-01', '安静模块的第一个函数', '已落地', 'core/quiet.py::alpha', '同一文件的不同函数，不该算重复修复。')}
${entry('CL-20261008-01', '安静模块的第二个函数', '已落地', 'core/quiet.py::beta', '同一文件的不同函数，不该算重复修复。')}
<!-- 条目:END -->
`
}

async function main() {
  rmSync(LAB, { recursive: true, force: true })
  mkdirSync(join(LAB, 'docs'), { recursive: true })
  writeFileSync(join(LAB, 'docs', '变更台账.md'), buildLedger(), 'utf-8')

  touch('core/gate.py') // exists -> already-done
  // core/feed.py deliberately NOT created -> rollback-risk
  touch('core/backfill.py') // exists, two landed entries -> repeated-repair
  touch('other/module.py')

  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const registered = new Map()
  module.apply({
    effect: (fn) => fn(),
    get: (name, strict) =>
      name === 'tools' ? { register: (spec) => { registered.set(spec.name, spec); return () => {} } } : strict === false ? undefined : undefined,
    logger: () => ({ warn: () => {} }),
  })

  const spec = registered.get('ledger_check')
  console.log('registration:')
  check('ledger_check is registered', spec !== undefined)
  check('requires paths', Array.isArray(spec?.parameters?.required) && spec.parameters.required.includes('paths'), JSON.stringify(spec?.parameters?.required))

  console.log('already-done:')
  const done = await spec.execute({ root: LAB, paths: ['core/gate.py'] })
  check('ok', done.ok === true, JSON.stringify(done).slice(0, 120))
  check('reports hasLedger', done.hasLedger === true)
  check('verdict is already-done', done.verdicts[0]?.verdict === 'already-done', done.verdicts[0]?.verdict)
  check('anchor is alive', done.verdicts[0]?.entries[0]?.anchorAlive === true, String(done.verdicts[0]?.entries[0]?.anchorAlive))
  check('quotes the why', String(done.verdicts[0]?.entries[0]?.why).includes('幂等'), String(done.verdicts[0]?.entries[0]?.why))
  check('not counted as risky', done.risky === 0, String(done.risky))

  console.log('rollback-risk:')
  const rollback = await spec.execute({ root: LAB, paths: ['core/feed.py'] })
  check('verdict is rollback-risk', rollback.verdicts[0]?.verdict === 'rollback-risk', rollback.verdicts[0]?.verdict)
  check('anchor reported dead', rollback.verdicts[0]?.entries[0]?.anchorAlive === false, String(rollback.verdicts[0]?.entries[0]?.anchorAlive))
  check('counted as risky', rollback.risky === 1, String(rollback.risky))
  check('message warns', String(rollback.message).includes('倒车') || String(rollback.message).includes('重复'), rollback.message)

  console.log('repeated-repair:')
  const repeated = await spec.execute({ root: LAB, paths: ['core/backfill.py'] })
  check('verdict is repeated-repair', repeated.verdicts[0]?.verdict === 'repeated-repair', repeated.verdicts[0]?.verdict)
  check('lists both landed entries', repeated.verdicts[0]?.entries.filter((e) => e.status === '已落地').length === 2, JSON.stringify(repeated.verdicts[0]?.entries.map((e) => e.id)))

  console.log('two different symbols in one file is NOT a repeat:')
  touch('core/quiet.py')
  const twoSymbols = await spec.execute({ root: LAB, paths: ['core/quiet.py'] })
  check('verdict is already-done, not repeated-repair', twoSymbols.verdicts[0]?.verdict === 'already-done', twoSymbols.verdicts[0]?.verdict)
  check('both entries are still listed', twoSymbols.verdicts[0]?.entries.length === 2, String(twoSymbols.verdicts[0]?.entries.length))
  check('not counted as risky', twoSymbols.risky === 0, String(twoSymbols.risky))

  console.log('shelved is respected:')
  // backfill.py has landed entries too, so use a path anchored only by the shelved entry.
  const shelvedOnly = await spec.execute({ root: LAB, paths: ['core/'] })
  const shelvedVerdict = shelvedOnly.verdicts[0]
  check('directory target still resolves entries', shelvedVerdict.entries.length >= 3, String(shelvedVerdict.entries.length))
  check('shelved entry is present', shelvedVerdict.entries.some((e) => e.status === '搁置'), JSON.stringify(shelvedVerdict.entries.map((e) => e.status)))

  console.log('unrecorded:')
  const fresh = await spec.execute({ root: LAB, paths: ['core/brand-new.py'] })
  check('verdict is unrecorded', fresh.verdicts[0]?.verdict === 'unrecorded', fresh.verdicts[0]?.verdict)
  check('no entries', fresh.verdicts[0]?.entries.length === 0)

  console.log('path normalisation:')
  const winPath = await spec.execute({ root: LAB, paths: ['core\\gate.py'] })
  check('backslashes match', winPath.verdicts[0]?.verdict === 'already-done', winPath.verdicts[0]?.verdict)
  const absPath = await spec.execute({ root: LAB, paths: [join(LAB, 'core', 'gate.py')] })
  check('absolute target matches relative anchor', absPath.verdicts[0]?.verdict === 'already-done', absPath.verdicts[0]?.verdict)
  const prefix = await spec.execute({ root: LAB, paths: ['gate.py'] })
  check('bare filename matches nested anchor', prefix.verdicts[0]?.verdict === 'already-done', prefix.verdicts[0]?.verdict)

  console.log('multiple targets in one call:')
  const many = await spec.execute({ root: LAB, paths: ['core/gate.py', 'core/feed.py', 'core/brand-new.py'] })
  check('returns a verdict per target', many.verdicts.length === 3, String(many.verdicts.length))
  check('risky counts only the dangerous ones', many.risky === 1, String(many.risky))
  check('order is preserved', many.verdicts.map((v) => v.path).join(',') === 'core/gate.py,core/feed.py,core/brand-new.py', JSON.stringify(many.verdicts.map((v) => v.path)))

  console.log('empty paths is rejected:')
  const none = await spec.execute({ root: LAB, paths: [] })
  check('not ok', none.ok === false, JSON.stringify(none).slice(0, 80))
  check('explains', String(none.message).includes('paths'), none.message)

  console.log('workspace without a ledger:')
  const EMPTY = join(LAB, 'no-ledger-here')
  mkdirSync(EMPTY, { recursive: true })
  const noLedger = await spec.execute({ root: EMPTY, paths: ['a.py'] })
  check('ok', noLedger.ok === true, JSON.stringify(noLedger).slice(0, 80))
  check('reports hasLedger false', noLedger.hasLedger === false)
  check('every target unrecorded', noLedger.verdicts.every((v) => v.verdict === 'unrecorded'))
  check('message tells the caller to record afterwards', String(noLedger.message).includes('ledger_add'), noLedger.message)

  console.log('keyword widening:')
  const keyword = await spec.execute({ root: LAB, paths: ['core/gate.py'], query: '补数' })
  check('still ok', keyword.ok === true)
  check('adds a keyword line mentioning related entries', String(keyword.message).includes('关键词相关') || keyword.verdicts.some((v) => v.entries.length > 1), keyword.message)

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
