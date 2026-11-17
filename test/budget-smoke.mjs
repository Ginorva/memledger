// Smoke test for two things that were structurally missing:
//
//  1. A record can be *closed*. 已废弃 used to stay in the 未决清单 forever and
//     ledger_verify kept complaining "待验证但锚点已死" about it, so a zombie
//     entry like CL-20261028-02 could never be retired — closing it made the
//     warning louder instead of quieter.
//  2. ledger_map had no output budget. The full skeleton went into the tool
//     message on every call, which is exactly the ~3K-token tax the v2 report
//     measured. The full map still lands on disk; the message is now outlined.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LedgerManager } from '../lib/ledger-manager.js'
import { parseLedgerMarkdown, buildDecisionIndex } from '../lib/markdown-parser.js'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-budget')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

function entry(id, status, anchor, why, extra = '') {
  return `
### ${id} · ${status} 的测试条目 ${id}

- **日期**：2026-11-17
- **类型**：修复
- **状态**：${status}
- **仓**：本仓
${extra}- **背景**：测试用
- **改动**：测试用
- **为什么**：${why}
- **取舍**：无
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
${entry('CL-20261101-01', '已落地', 'core/gate.py::allow', '幂等判定已加，别再动。')}
${entry('CL-20261102-01', '待验证', 'core/feed.py::fetch', '需要重启后看界面表现。', '- **需求**：RQ-20261101-01\n')}
${entry('CL-20261103-01', '已废弃', 'gone/plugin.js::scan', '被跟踪的插件已从工作区移除，记录作废。', '- **需求**：RQ-20261101-01\n')}
<!-- 条目:END -->
`
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
    logger: () => ({ warn: () => {} }),
  }
}

function write(relative, body) {
  const target = join(LAB, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, body, 'utf-8')
}

function section(index, from, to) {
  const start = index.indexOf(from)
  if (start < 0) return ''
  const end = to === null ? index.length : index.indexOf(to, start)
  return index.slice(start, end < 0 ? index.length : end)
}

async function main() {
  rmSync(LAB, { recursive: true, force: true })

  /* ---- 1. terminal-state closure ---- */
  write('core/gate.py', 'def allow():\n    return True\n')
  write('docs/需求/RQ-20261101-01.md', '# RQ-20261101-01 · 测试需求\n')
  write('docs/变更台账.md', buildLedger())

  const entries = parseLedgerMarkdown(readFileSync(join(LAB, 'docs', '变更台账.md'), 'utf-8'))
  const index = buildDecisionIndex(entries)

  console.log('已废弃 is terminal, not open:')
  const undecided = section(index, '### 1.2', '### 1.3')
  check('待验证 still listed in 1.2', undecided.includes('CL-20261102-01'), undecided)
  check('已废弃 left the 未决清单', !undecided.includes('CL-20261103-01'), undecided)

  const grouped = section(index, '### 1.3', null)
  const row = grouped.split('\n').find((line) => line.includes('RQ-20261101-01')) || ''
  check('1.3 counts only the genuinely open sub-item', row.includes('| 1 |'), row)
  check('1.3 still lists both sub-items', row.includes('CL-20261102-01') && row.includes('CL-20261103-01'), row)

  console.log('ledger_verify does not scold a closed record:')
  const manager = new LedgerManager(LAB)
  const outcome = manager.verify()
  const warnText = (outcome.warns || []).join(' ')
  check('warns about the 待验证 entry whose anchor vanished', warnText.includes('CL-20261102-01'), warnText)
  check('does not warn about the 已废弃 entry', !warnText.includes('CL-20261103-01'), warnText)
  check('已废弃 is not a failure either', (outcome.fails || []).every((line) => !line.includes('CL-20261103-01')))

  /* ---- 2. ledger_map output budget ---- */
  const bigRepo = join(LAB, 'big-repo')
  for (let i = 0; i < 24; i += 1) {
    const id = String(i).padStart(2, '0')
    const body = Array.from({ length: 4 }, (_, k) => `export function handler_${id}_${k}_with_a_long_name(value) { return value }`).join('\n')
    write(join('big-repo', 'src', `module-${id}.js`), body + '\n')
  }

  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const ctx = fakeCtx()
  module.apply(ctx)
  const map = ctx.registered.get('ledger_map')
  check('ledger_map registered', map !== undefined)

  console.log('large skeleton is folded into an outline:')
  const big = await map.execute({ root: bigRepo, refresh: true })
  check('reports ok', big.ok === true, JSON.stringify(big).slice(0, 200))
  check('marks the answer as budgeted', big.budgeted === true, String(big.budgeted))
  check('message stays near the budget', big.message.length < 7000, String(big.message.length))
  check('message names the files', big.message.includes('module-00.js') && big.message.includes('module-23.js'))
  check('message keeps no signatures', !big.message.includes('export function handler_00_0'), big.message.slice(0, 300))
  check('message points at scope=', big.message.includes('scope='))

  const disk = readFileSync(join(bigRepo, 'docs', '项目结构.md'), 'utf-8')
  check('the full map is still written to disk', disk.length > 6000 && disk.includes('export function handler_00_0'))

  console.log('scope= buys the signatures back for one file:')
  const scoped = await map.execute({ root: bigRepo, scope: 'src/module-07.js' })
  check('scope result is not budgeted', scoped.budgeted !== true, String(scoped.budgeted))
  check('scope result keeps the signature', scoped.message.includes('export function handler_07_0'), scoped.message.slice(0, 200))
  check('scope result stays local', !scoped.message.includes('module-08.js'))

  console.log('small repositories keep the full map:')
  const smallRepo = join(LAB, 'small-repo')
  write('small-repo/one.py', 'def alpha():\n    return 1\n\ndef beta():\n    return 2\n')
  const small = await map.execute({ root: smallRepo, refresh: true })
  check('small map is not budgeted', small.budgeted !== true, String(small.budgeted))
  check('small map shows the signatures', small.message.includes('def alpha'))

  rmSync(LAB, { recursive: true, force: true })

  if (failures > 0) {
    console.log('\n' + failures + ' check(s) failed')
    process.exitCode = 1
  } else {
    console.log('\nall budget/closure checks passed')
  }
}

main().catch((cause) => {
  console.error(cause)
  process.exitCode = 1
})
