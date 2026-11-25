// Smoke test for keeping a growing ledger readable without deleting history:
//
//   1. Two landed entries on the same `path::symbol` are one decision, not two.
//      The later one is the live record; the older ones are collapsed — still in
//      section 2, still searchable, just not competing in the index or in
//      ledger_check.
//   2. A symbol that moved in a refactor can be hand-linked with `取代: CL-…`,
//      and the retired entry stops being verified (its anchor is expected to be
//      gone — that is what "replaced" means).
//   3. Keywords must be searchable: at least two, and not merely the type enum.
//      A ledger whose 300 entries all say "修复" has no search index at all.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LedgerManager } from '../lib/ledger-manager.js'
import { parseLedgerMarkdown, buildDecisionIndex } from '../lib/markdown-parser.js'
import { anchorKeyOf, supersessionMap } from '../lib/supersede.js'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-supersede')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

function entry({ id, title, anchor, status = '已落地', why = '测试用原因，足够长。', supersedes = '', keywords = '测试, 锚点' }) {
  return `
### ${id} · ${title}

- **日期**：2026-11-17
- **类型**：修复
- **状态**：${status}
- **仓**：本仓
${supersedes ? `- **取代**：${supersedes}\n` : ''}- **背景**：测试用
- **改动**：测试用
- **为什么**：${why}
- **取舍**：无
- **锚点**：${anchor}
- **commit**：deadbee
- **验收**：无
- **关键词**：${keywords}
`
}

const ROUNDS = [
  entry({ id: 'CL-20261101-01', title: '第一轮：空数组兜底', anchor: 'core/x.py::fn' }),
  entry({ id: 'CL-20261102-01', title: '第二轮：补空仓展示', anchor: 'core/x.py::fn' }),
  entry({ id: 'CL-20261103-01', title: '第三轮：清仓后不再回退', anchor: 'core/x.py::fn' }),
  entry({ id: 'CL-20261104-01', title: '旧符号上的修复（后来搬走）', anchor: 'core/gone.py::fn' }),
  entry({ id: 'CL-20261105-01', title: '搬到新符号后的修复', anchor: 'core/live.py::fn', supersedes: 'CL-20261104-01' }),
]

function write(relative, body) {
  const target = join(LAB, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, body, 'utf-8')
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
      if (strict === false) return undefined
      return undefined
    },
    logger: () => ({ warn: () => {} }),
  }
}

async function main() {
  rmSync(LAB, { recursive: true, force: true })
  write('core/x.py', 'def fn():\n    return 1\n')
  write('core/live.py', 'def fn():\n    return 2\n')
  write('docs/变更台账.md', `# 项目变更台账（append-only）

<!-- 决策索引:BEGIN -->
<!-- 决策索引:END -->

<!-- 条目:BEGIN -->
${ROUNDS.join('')}
<!-- 条目:END -->
`)

  const entries = parseLedgerMarkdown(readFileSync(join(LAB, 'docs', '变更台账.md'), 'utf-8'))

  console.log('same symbol, later entry is the live one:')
  const map = supersessionMap(entries)
  check('round 1 folds into round 3', map.get('CL-20261101-01') === 'CL-20261103-01', map.get('CL-20261101-01'))
  check('round 2 folds into round 3', map.get('CL-20261102-01') === 'CL-20261103-01', map.get('CL-20261102-01'))
  check('round 3 stays live', !map.has('CL-20261103-01'))
  check('explicit 取代 is honoured', map.get('CL-20261104-01') === 'CL-20261105-01', map.get('CL-20261104-01'))
  check('unrelated entries are untouched', !map.has('CL-20261105-01'))

  console.log('index keeps one row per anchor:')
  const index = buildDecisionIndex(entries)
  check('live round is listed', index.includes('CL-20261103-01'))
  check('superseded rounds are not rows', !/\| \[CL-20261101-01\]/.test(index), index.slice(0, 400))
  check('footnote explains the fold', index.includes('已被取代（折叠 3 条）'), index.slice(0, 600))
  check('footnote points at the live id', index.includes('CL-20261101-01→CL-20261103-01'))

  console.log('verify skips what a successor already covers:')
  const manager = new LedgerManager(LAB)
  const outcome = manager.verify()
  const supersededText = (outcome.superseded ?? []).join(' ')
  check('does not fail on the retired anchor', outcome.ok === true, JSON.stringify(outcome.fails))
  check('says the old entry was superseded', supersededText.includes('CL-20261104-01'), supersededText)
  check('still checks the live anchor', (outcome.oks ?? []).some((line) => line.includes('core/live.py')))

  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const ctx = fakeCtx()
  module.apply(ctx)
  const checkTool = ctx.registered.get('ledger_check')
  const search = ctx.registered.get('ledger_search')
  const add = ctx.registered.get('ledger_add')

  console.log('check answers with one round, not three:')
  const verdict = await checkTool.execute({ root: LAB, paths: ['core/x.py'] })
  check('keeps the live round', (verdict.verdicts[0]?.entries ?? []).length === 1, JSON.stringify(verdict.verdicts[0]?.entries?.map((e) => e.id)))
  check('marks it as repeatedly repaired', verdict.verdicts[0]?.verdict === 'repeated-repair', verdict.verdicts[0]?.verdict)
  check('message counts the folded rounds', verdict.message.includes('另有 2 轮已被取代'), verdict.message)

  console.log('search metabolic pruning (RSI) folds superseded history by default:')
  const foundDefault = await search.execute({ root: LAB, query: '测试', limit: 10 })
  check('default search prunes superseded round', !foundDefault.entries.some((e) => e.id === 'CL-20261101-01'))
  check('default search returns live round', foundDefault.entries.some((e) => e.id === 'CL-20261103-01'))
  check('default search reports metabolic pruning note', foundDefault.message.includes('代谢系统已自动折叠') && foundDefault.message.includes('all=true'))

  console.log('search with all=true reveals full history and marks superseded entries:')
  const found = await search.execute({ root: LAB, query: '测试', limit: 10, all: true })
  check('old round is still findable with all=true', found.entries.some((e) => e.id === 'CL-20261101-01'))
  check('marked as superseded', found.message.includes('已被 CL-20261103-01 取代'), found.message)

  console.log('keywords must be a search index, not a genre label:')
  const base = {
    root: LAB,
    title: '关键词校验用条目',
    type: '修复',
    status: '已落地',
    anchor: 'core/y.py::fn',
    why: '验证关键词规则是否真的会拦下无法检索的标签。',
  }
  const noKeywords = await add.execute({ ...base })
  check('rejects a missing keyword list', noKeywords.ok === false && /关键词/.test(noKeywords.message), noKeywords.message)
  const oneKeyword = await add.execute({ ...base, keywords: ['修复'] })
  check('rejects a single keyword', oneKeyword.ok === false && /至少给 2 个/.test(oneKeyword.message), oneKeyword.message)
  const typeOnly = await add.execute({ ...base, keywords: ['修复', '重构'] })
  check('rejects type enums as keywords', typeOnly.ok === false && /类型枚举/.test(typeOnly.message), typeOnly.message)
  const good = await add.execute({ ...base, keywords: ['关键词校验', 'ledger_add'] })
  check('accepts two searchable keywords', good.ok === true, JSON.stringify(good).slice(0, 160))

  rmSync(LAB, { recursive: true, force: true })

  if (failures > 0) {
    console.log('\n' + failures + ' check(s) failed')
    process.exitCode = 1
  } else {
    console.log('\nall supersede/keyword checks passed')
  }
}

main().catch((cause) => {
  console.error(cause)
  process.exitCode = 1
})
