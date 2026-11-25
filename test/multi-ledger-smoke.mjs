// Smoke test: a workspace may configure EXTRA ledgers (see lib/ledger-sources.js).
//
// Why this exists (2026-11-18)
// ---------------------------
// The plugin used to assume one ledger per workspace (`docs/变更台账.md`). But a
// workspace can span several git repos, each with its own ledger — and their CL
// numbering rules differ (the main one counts globally, the others restart per
// day), so **the same CL id can mean different things in different ledgers**.
//
// Two properties matter:
//   1. entries from the extra ledgers must be searchable — otherwise 300+ past
//      decisions are invisible and the agent redoes finished work;
//   2. two entries sharing an id must BOTH survive — the index used to be keyed
//      by id, so the second ledger silently overwrote the first one's entry.
//
// And the default must not move: without `.dsh/memledger.json` nothing changes.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-multi-ledger')
const REPO = join(LAB, 'workspace')

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

function ledgerEntry(id, title, why, anchor, keywords) {
  return [
    '### ' + id + ' · ' + title,
    '',
    '- **日期**：2026-01-01',
    '- **类型**：决策',
    '- **状态**：已落地',
    '- **仓**：包装仓',
    '- **背景**：背景',
    '- **改动**：改动',
    '- **为什么**：' + why,
    '- **取舍**：取舍',
    '- **锚点**：`' + anchor + '`',
    '- **commit**：abc1234',
    '- **验收**：见脚本',
    '- **关键词**：' + keywords,
    '',
  ].join('\n')
}

function writeLedger(path, entries) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, entries.join('\n'), 'utf-8')
}

async function main() {
  rmSync(LAB, { recursive: true, force: true })
  mkdirSync(join(REPO, 'docs'), { recursive: true })
  mkdirSync(join(REPO, '.dsh'), { recursive: true })
  mkdirSync(join(REPO, 'agent', 'docs'), { recursive: true })
  mkdirSync(join(REPO, 'core', 'docs'), { recursive: true })
  writeFileSync(join(REPO, 'guard.py'), 'def guard():\n    return True\n', 'utf-8')
  writeFileSync(join(REPO, 'main.py'), 'def main():\n    return True\n', 'utf-8')
  writeFileSync(join(REPO, 'agent', 'wrap.py'), 'def wrap():\n    return True\n', 'utf-8')
  writeFileSync(join(REPO, 'core', 'eng.py'), 'def eng():\n    return True\n', 'utf-8')

  // The main ledger and the wrapper ledger deliberately share an id: the same
  // CL-yyyymmdd-nn means different things in different ledgers.
  writeLedger(join(REPO, 'docs', '变更台账.md'), [
    ledgerEntry('CL-20260101-01', '主台账同号条目', '主台账的原因', 'main.py', '主台账,主线,同号'),
    ledgerEntry('CL-20260101-09', '主台账独有', '主台账独有原因', 'guard.py', '主台账独有'),
  ])
  writeLedger(join(REPO, 'agent', 'docs', '变更台账.md'), [
    ledgerEntry('CL-20260101-01', '包装仓同号条目', '包装仓的原因', 'agent/wrap.py::wrap', '包装仓,副线,同号'),
    ledgerEntry('CL-20260101-02', '包装仓独有', '包装仓独有原因', 'agent/wrap.py::init', '包装仓独有'),
  ])
  writeLedger(join(REPO, 'core', 'docs', '变更台账.md'), [
    ledgerEntry('CL-20260101-03', '引擎仓独有', '引擎仓独有原因', 'core/eng.py', '引擎仓,引擎独有'),
  ])

  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const ctx = fakeCtx()
  module.apply(ctx)
  const search = ctx.registered.get('ledger_search')
  const add = ctx.registered.get('ledger_add')

  console.log('without .dsh/memledger.json (default must not move):')
  const plain = await search.execute({ root: REPO, query: '台账独有', limit: 20 })
  check('search still works', plain.ok === true, JSON.stringify(plain))
  const plainIds = plain.entries.map((e) => e.id)
  check('main ledger entry is found', plainIds.includes('CL-20260101-09'), JSON.stringify(plainIds))
  check('extra ledger is NOT searched yet', !plainIds.includes('CL-20260101-02'), JSON.stringify(plainIds))
  check('no source tag without config', plain.entries.every((e) => !e.source), JSON.stringify(plain.entries.map((e) => e.source)))

  console.log('after enabling .dsh/memledger.json:')
  writeFileSync(
    join(REPO, '.dsh', 'memledger.json'),
    JSON.stringify({
      ledgers: [
        { path: 'agent/docs/变更台账.md', label: '工程' },
        { path: 'core/docs/变更台账.md', label: '引擎' },
      ],
    }, null, 2),
    'utf-8',
  )

  const multi = await search.execute({ root: REPO, query: '独有', limit: 20 })
  check('search still works', multi.ok === true, JSON.stringify(multi))
  const ids = multi.entries.map((e) => e.id)
  check('main ledger entry is found', ids.includes('CL-20260101-09'), JSON.stringify(ids))
  check('wrapper ledger entry is found', ids.includes('CL-20260101-02'), JSON.stringify(ids))
  check('engine ledger entry is found', ids.includes('CL-20260101-03'), JSON.stringify(ids))
  const sources = Object.fromEntries(multi.entries.map((e) => [e.id, e.source]))
  check('source is labelled 工程', sources['CL-20260101-02'] === '工程', JSON.stringify(sources))
  check('source is labelled 引擎', sources['CL-20260101-03'] === '引擎', JSON.stringify(sources))
  check('main ledger has no source label', !sources['CL-20260101-09'], JSON.stringify(sources))

  console.log('same id in two ledgers must both survive:')
  const collide = await search.execute({ root: REPO, query: '同号', limit: 20 })
  const collideIds = collide.entries.map((e) => e.id).filter((id) => id === 'CL-20260101-01')
  check('both same-id entries are returned', collideIds.length === 2, JSON.stringify(collide.entries.map((e) => [e.id, e.source])))
  const collideTitles = collide.entries.filter((e) => e.id === 'CL-20260101-01').map((e) => e.title)
  check('the two titles differ', new Set(collideTitles).size === 2, JSON.stringify(collideTitles))
  check('collision is announced', String(collide.message).includes('同号共存'), collide.message)
  // 逐条标记：即使同号的另一条被排序挤出窗口，看到的那条也要自报同号
  const onlyOne = await search.execute({ root: REPO, query: '主台账同号', limit: 1 })
  check('a lone same-id entry still warns', String(onlyOne.message).includes('⚠同号'), onlyOne.message)

  console.log('writing still goes to the main ledger only:')
  const added = await add.execute({
    root: REPO,
    title: '新条目',
    type: '决策',
    status: '已落地',
    repo: '包装仓',
    background: '背景',
    change: '改动',
    why: '为什么',
    anchor: 'guard.py::guard',
    keywords: ['新条目', '回归测试'],
  })
  check('add reports ok', added.ok === true, JSON.stringify(added))
  const mainText = readFileSync(join(REPO, 'docs', '变更台账.md'), 'utf-8')
  const wrapperText = readFileSync(join(REPO, 'agent', 'docs', '变更台账.md'), 'utf-8')
  check('main ledger got the entry', mainText.includes('新条目'))
  check('wrapper ledger untouched', !wrapperText.includes('新条目'))
  check('engine ledger untouched', !readFileSync(join(REPO, 'core', 'docs', '变更台账.md'), 'utf-8').includes('新条目'))

  rmSync(LAB, { recursive: true, force: true })
  console.log(failures === 0 ? '\nmulti-ledger-smoke: all checks passed' : '\nmulti-ledger-smoke: ' + failures + ' checks FAILED')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((cause) => {
  console.error(cause)
  process.exit(1)
})
