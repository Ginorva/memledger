// Validate `ledger_check` against a real, messy ledger.
//
// A fixture proves the code does what I wrote down; it does not prove the anchor
// parser survives a ledger written by a human over months. Real anchors here mix
// backticks, CJK prefixes (`引擎 ...`), several paths per entry, directory-level
// anchors and prose-only anchors (`（无代码改动）...`).
//
// The two numbers that matter:
//
//   coverage  — how many entries yield at least one usable file path
//   recall    — for an entry with an existing path, does ledger_check on that
//               path find that same entry
//
// Recall below 100% is the dangerous case: the tool would answer "no history
// here" about work that does have history, which is exactly how a project
// repeats work it already did.
//
//   node test/real-ledger.mjs /path/to/repo

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { anchorPathsOf } from '../lib/anchors.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label + (detail === undefined ? '' : '  (' + detail + ')'))
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : '  (' + detail + ')'))
  }
}

async function loadTools() {
  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const registered = new Map()
  module.apply({
    effect: (fn) => fn(),
    get: (name, strict) =>
      name === 'tools'
        ? { register: (spec) => { registered.set(spec.name, spec); return () => {} } }
        : strict === false
          ? undefined
          : undefined,
    logger: () => ({ warn: () => {} }),
  })
  return registered
}

/**
 * Use the shipped anchor parser directly. It used to be lifted out of
 * agent-tools.js source text, which was fragile; it now lives in its own module.
 */
function loadAnchorPathsOf() {
  return anchorPathsOf
}

async function main() {
  const repo = process.argv[2]
  if (!repo) {
    console.log('usage: node test/real-ledger.mjs <repo-root>')
    process.exit(2)
  }

  const registered = await loadTools()
  const checkTool = registered.get('ledger_check')
  const searchTool = registered.get('ledger_search')
  const verifyTool = registered.get('ledger_verify')
  if (!checkTool || !searchTool || !verifyTool) {
    console.log('FAIL: tools did not register')
    process.exit(1)
  }

  const everything = await searchTool.execute({ root: repo, limit: 500 })
  const { parseLedgerMarkdown } = await import(pathToFileURL(join(ROOT, 'lib', 'markdown-parser.js')).href)
  const entries = parseLedgerMarkdown(readFileSync(join(repo, 'docs', '变更台账.md'), 'utf-8'))

  console.log('ledger:')
  check('parsed a non-trivial number of entries', everything.total >= 40, 'total=' + everything.total)
  check('tool and parser agree', entries.length === everything.total, entries.length + ' vs ' + everything.total)

  const anchorPathsOf = loadAnchorPathsOf()

  let withPaths = 0
  let proseOnly = 0
  const samples = []
  for (const entry of entries) {
    const paths = anchorPathsOf(entry.anchor)
    if (paths.length > 0) {
      withPaths += 1
      if (samples.length < 6 && existsSync(join(repo, paths[0]))) samples.push({ entry, path: paths[0] })
    } else if (String(entry.anchor).includes('无代码改动')) {
      proseOnly += 1
    }
  }

  console.log('\nanchor parsing on real data:')
  check('most entries yield a usable path', withPaths >= entries.length * 0.7, withPaths + '/' + entries.length)
  check('prose-only anchors are recognised, not mangled', proseOnly >= 1, String(proseOnly))
  console.log('   entries=' + entries.length + '  withPath=' + withPaths + '  proseOnly=' + proseOnly)

  console.log('\nrecall - ledger_check must find an entry by its own path:')
  let recallChecked = 0
  let recallHit = 0
  const misses = []
  for (const entry of entries) {
    const paths = anchorPathsOf(entry.anchor)
    if (paths.length === 0) continue
    if (!existsSync(join(repo, paths[0]))) continue
    recallChecked += 1
    const result = await checkTool.execute({ root: repo, paths: [paths[0]] })
    const ids = (result.verdicts?.[0]?.entries ?? []).map((e) => e.id)
    if (ids.includes(entry.id)) recallHit += 1
    else if (misses.length < 5) misses.push(entry.id + ' @ ' + paths[0] + ' -> ' + result.verdicts?.[0]?.verdict)
  }
  check('recall is total', recallChecked > 0 && recallHit === recallChecked, recallHit + '/' + recallChecked)
  for (const miss of misses) console.log('   miss: ' + miss)

  console.log('\nsample verdicts on real paths:')
  for (const sample of samples) {
    const result = await checkTool.execute({ root: repo, paths: [sample.path] })
    const verdict = result.verdicts?.[0]
    const count = verdict?.entries?.length ?? 0
    console.log('   ' + String(verdict?.verdict ?? '?').padEnd(15) + sample.path + '  (' + count + ' 条)')
    check('  ' + sample.path + ' resolves', count > 0, String(count))
  }

  console.log('\ncross-repository anchors are not called regressions:')
  const dirResult = await checkTool.execute({ root: repo, paths: ['ai_core/factors'] })
  const dirCount = dirResult.verdicts?.[0]?.entries?.length ?? 0
  console.log('   ' + String(dirResult.verdicts?.[0]?.verdict ?? '?').padEnd(15) + 'ai_core/factors  (' + dirCount + ' 条)')
  check('directory target matches directory anchors', dirCount > 0, String(dirCount))
  check('anchors absent from this repo are foreign, not rollback-risk', dirResult.verdicts?.[0]?.verdict !== 'rollback-risk', String(dirResult.verdicts?.[0]?.verdict))
  check('the whole directory is not counted as risky', dirResult.risky === 0, String(dirResult.risky))

  console.log('\nverify on the real ledger:')
  const verified = await verifyTool.execute({ root: repo })
  const unverifiable = verified.unverifiable ?? []
  console.log('   ok=' + verified.ok + '  checked=' + verified.checked + '  missing=' + verified.missing.length + '  unverifiable=' + unverifiable.length)
  check('verify returns a message', typeof verified.message === 'string' && verified.message.length > 0)
  check('cross-repo anchors are reported as unverifiable', unverifiable.length >= 1, String(unverifiable.length))
  check(
    'cross-repo anchors are not reported as missing',
    !verified.missing.some((line) => String(line).includes('ai_core')),
    JSON.stringify(verified.missing.filter((line) => String(line).includes('ai_core')).slice(0, 2)),
  )

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
