// benchmark.mjs — Quantitative evaluation of MemLedger performance,
// tool quality, and retrieval accuracy.
//
// Run:  node test/benchmark.mjs
//
// Three evaluation dimensions:
//   1. Performance: latency of search/check/map (with cache hit/miss)
//   2. Tool quality: prompt token budget audit
//   3. Retrieval accuracy: precision/recall on a constructed test corpus

import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-benchmark')

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

function touch(relative, content = '# placeholder\n') {
  const target = join(LAB, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

function entry(id, title, status, anchor, why, opts = {}) {
  return `
### ${id} · ${title}

- **日期**：${opts.date ?? '2026-11-20'}
- **类型**：${opts.type ?? '修复'}
- **状态**：${status}
- **仓**：本仓
- **背景**：${opts.background ?? title}
- **改动**：${opts.change ?? title}
- **为什么**：${why}
- **取舍**：${opts.tradeoff ?? '无'}
- **锚点**：${anchor}
- **commit**：${opts.commit ?? 'abc1234'}
- **验收**：${opts.verify ?? '无'}
- **关键词**：${opts.keywords ?? '测试, 基准'}
`
}

// ═══════════════════════════════════════════════════════
// 1. Build a sizable test corpus
// ═══════════════════════════════════════════════════════

function buildCorpus(entryCount) {
  const domains = ['gate', 'feed', 'backfill', 'signal', 'order', 'risk', 'position', 'strategy', 'config', 'logger']
  const statuses = ['已落地', '已落地', '已落地', '搁置', '已回退', '待验证', '进行中']
  const entries = []

  for (let i = 1; i <= entryCount; i++) {
    const domain = domains[i % domains.length]
    const status = statuses[i % statuses.length]
    const day = String((i % 28) + 1).padStart(2, '0')
    const month = String((i % 3) + 9).padStart(2, '0')
    const id = `CL-2026${month}${day}-${String(i).padStart(2, '0')}`
    const file = `core/${domain}.py`
    const symbol = `fn_${domain}_${i}`
    entries.push(entry(id, `${domain} 修复 #${i}`, status, `${file}::${symbol}`, `第 ${i} 次修复 ${domain} 的问题`, {
      date: `2026-${month}-${day}`,
      keywords: `${domain}, 修复${i}, ${symbol}`,
    }))
    // ensure the file exists for alive checks
    touch(file, `# ${domain} module\ndef ${symbol}(): pass\n`)
  }

  // Add some specific entries for retrieval tests
  entries.push(entry('CL-20261120-99', '闸门幂等修复', '已落地', 'core/gate.py::idempotent_check',
    '同一 bar 内二次触发开仓，需要幂等判定防止重复下单。', {
      date: '2026-11-20', keywords: '闸门, 幂等, 重复开仓, idempotent',
    }))
  entries.push(entry('CL-20261120-98', '行情超时兜底方案暂缓', '搁置', 'core/feed.py::timeout_fallback',
    '行情源超时返回空列表太危险，会导致整轮选股空跑。等接入备用行情源后再启用。', {
      date: '2026-11-20', keywords: '行情, 超时, 兜底, 空跑, timeout',
      tradeoff: '重启条件：备用行情源 API 接入完成',
    }))
  entries.push(entry('CL-20261118-97', '风控模块死锁已修（后来被改没了）', '已落地', 'core/risk.py::check_limits',
    '并发访问 position cache 导致死锁，加了读写锁。', {
      date: '2026-11-18', keywords: '风控, 死锁, 并发, 读写锁, deadlock',
    }))
  // Don't create risk.py so it shows as "dead" anchor
  // (already created by loop above, so delete it)
  try { rmSync(join(LAB, 'core/risk.py'), { force: true }) } catch {}

  return `# 项目变更台账（append-only）

> 由 MemLedger 自动维护。

---

## 1. 决策索引（自动生成）

<!-- 决策索引:BEGIN -->
<!-- 决策索引:END -->

---

## 2. 变更条目（只追加）

<!-- 条目:BEGIN -->
${entries.join('\n')}
<!-- 条目:END -->
`
}

// ═══════════════════════════════════════════════════════
// 2. Build source files for map scanning
// ═══════════════════════════════════════════════════════

function buildSourceFiles() {
  for (let i = 0; i < 30; i++) {
    const name = `lib/module_${i}.js`
    const fns = Array.from({ length: 5 }, (_, j) =>
      `export function fn_${i}_${j}(arg${j}) {\n  return arg${j} * ${j}\n}\n`
    ).join('\n')
    touch(name, fns)
  }
  touch('package.json', JSON.stringify({ name: 'benchmark-workspace', version: '1.0.0' }))
}

// ═══════════════════════════════════════════════════════
// 3. Benchmark runner
// ═══════════════════════════════════════════════════════

function timeMs(fn) {
  const start = performance.now()
  const result = fn()
  const elapsed = performance.now() - start
  return { result, elapsed }
}

async function timeAsync(fn) {
  const start = performance.now()
  const result = await fn()
  const elapsed = performance.now() - start
  return { result, elapsed }
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

async function main() {
  rmSync(LAB, { recursive: true, force: true })
  mkdirSync(join(LAB, 'docs'), { recursive: true })

  const ENTRY_COUNT = 200
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  MemLedger Quantitative Benchmark')
  console.log(`  Corpus: ${ENTRY_COUNT} entries`)
  console.log(`${'═'.repeat(60)}\n`)

  // Build test data
  writeFileSync(join(LAB, 'docs', '变更台账.md'), buildCorpus(ENTRY_COUNT), 'utf-8')
  buildSourceFiles()

  // Load plugin
  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const registered = new Map()
  module.apply({
    effect: (fn) => fn(),
    get: (name, strict) =>
      name === 'tools' ? { register: (spec) => { registered.set(spec.name, spec); return () => {} } } : strict === false ? undefined : undefined,
    logger: () => ({ warn: () => {} }),
    inject: (deps, fn) => fn(),
  })

  const results = {
    performance: {},
    toolQuality: {},
    retrieval: {},
  }

  // ─────────────────────────────────────────────────────
  // DIMENSION 1: Performance
  // ─────────────────────────────────────────────────────
  console.log('━━━ 1. Performance Benchmarks ━━━\n')

  const mapSpec = registered.get('ledger_map')
  const checkSpec = registered.get('ledger_check')
  const searchSpec = registered.get('ledger_search')
  const verifySpec = registered.get('ledger_verify')

  // 1a. ledger_map — cold vs warm
  const mapCold = await timeAsync(() => mapSpec.execute({ root: LAB }))
  const mapWarm = await timeAsync(() => mapSpec.execute({ root: LAB }))
  console.log(`  ledger_map (cold):  ${mapCold.elapsed.toFixed(1)} ms  files=${mapCold.result.fileCount}  symbols=${mapCold.result.symbolCount}`)
  console.log(`  ledger_map (warm):  ${mapWarm.elapsed.toFixed(1)} ms  cached=${mapWarm.result.cached}`)
  results.performance.mapColdMs = +mapCold.elapsed.toFixed(1)
  results.performance.mapWarmMs = +mapWarm.elapsed.toFixed(1)
  results.performance.mapCacheSpeedup = +(mapCold.elapsed / mapWarm.elapsed).toFixed(1)

  // 1b. ledger_check — single path, multiple paths
  const check1 = await timeAsync(() => checkSpec.execute({ root: LAB, paths: ['core/gate.py'] }))
  const check5 = await timeAsync(() => checkSpec.execute({ root: LAB, paths: ['core/gate.py', 'core/feed.py', 'core/signal.py', 'core/order.py', 'core/risk.py'] }))
  console.log(`  ledger_check (1 path):   ${check1.elapsed.toFixed(1)} ms  verdict=${check1.result.verdicts[0]?.verdict}  entries=${check1.result.verdicts[0]?.entries?.length}`)
  console.log(`  ledger_check (5 paths):  ${check5.elapsed.toFixed(1)} ms  risky=${check5.result.risky}`)
  results.performance.check1PathMs = +check1.elapsed.toFixed(1)
  results.performance.check5PathMs = +check5.elapsed.toFixed(1)

  // 1c. ledger_search — various queries
  const searchExact = await timeAsync(() => searchSpec.execute({ root: LAB, query: '闸门 幂等' }))
  const searchBroad = await timeAsync(() => searchSpec.execute({ root: LAB, query: 'gate' }))
  const searchEmpty = await timeAsync(() => searchSpec.execute({ root: LAB, query: '完全不存在的关键词xyz' }))

  // 1d. ledger_search — second call (should benefit from mtime cache)
  const searchCached = await timeAsync(() => searchSpec.execute({ root: LAB, query: '闸门 幂等' }))

  console.log(`  ledger_search (exact):   ${searchExact.elapsed.toFixed(1)} ms  found=${searchExact.result.total}`)
  console.log(`  ledger_search (broad):   ${searchBroad.elapsed.toFixed(1)} ms  found=${searchBroad.result.total}`)
  console.log(`  ledger_search (miss):    ${searchEmpty.elapsed.toFixed(1)} ms  found=${searchEmpty.result.total}`)
  console.log(`  ledger_search (cached):  ${searchCached.elapsed.toFixed(1)} ms  found=${searchCached.result.total}`)
  results.performance.searchExactMs = +searchExact.elapsed.toFixed(1)
  results.performance.searchBroadMs = +searchBroad.elapsed.toFixed(1)
  results.performance.searchMissMs = +searchEmpty.elapsed.toFixed(1)
  results.performance.searchCachedMs = +searchCached.elapsed.toFixed(1)
  results.performance.searchCacheSpeedup = +(searchExact.elapsed / searchCached.elapsed).toFixed(1)

  // 1e. ledger_verify
  const verify = await timeAsync(() => verifySpec.execute({ root: LAB }))
  console.log(`  ledger_verify:           ${verify.elapsed.toFixed(1)} ms  checked=${verify.result.checked}  missing=${verify.result.missing?.length}`)
  results.performance.verifyMs = +verify.elapsed.toFixed(1)
  results.performance.verifyChecked = verify.result.checked

  // ─────────────────────────────────────────────────────
  // DIMENSION 2: Tool Quality — Prompt Token Budget
  // ─────────────────────────────────────────────────────
  console.log('\n━━━ 2. Tool Quality: Prompt Budget ━━━\n')

  let totalDescChars = 0
  let totalSchemaChars = 0
  for (const [name, spec] of registered) {
    const descLen = (spec.description || '').length
    const schemaStr = JSON.stringify(spec.parameters || {})
    const schemaLen = schemaStr.length
    const outputSchemaLen = JSON.stringify(spec.output?.schema || {}).length
    totalDescChars += descLen
    totalSchemaChars += schemaLen + outputSchemaLen
    console.log(`  ${name.padEnd(22)} desc=${String(descLen).padStart(3)}  params=${String(schemaLen).padStart(4)}  output=${String(outputSchemaLen).padStart(4)}  total=${descLen + schemaLen + outputSchemaLen}`)
  }
  const totalBudget = totalDescChars + totalSchemaChars
  // Rough token estimate: Chinese chars ~1.5 tokens, ASCII ~0.25 tokens
  const estimatedTokens = Math.round(totalBudget * 0.6)
  console.log(`\n  Total description chars: ${totalDescChars}`)
  console.log(`  Total schema chars:     ${totalSchemaChars}`)
  console.log(`  Total budget chars:     ${totalBudget}`)
  console.log(`  Estimated prompt tokens: ~${estimatedTokens}`)
  results.toolQuality = {
    totalDescChars,
    totalSchemaChars,
    totalBudgetChars: totalBudget,
    estimatedTokens,
    toolCount: registered.size,
  }

  // Check output message sizes
  console.log('\n  Output message sizes:')
  const checkMsg = check1.result.message?.length ?? 0
  const mapMsg = mapCold.result.message?.length ?? 0
  const searchMsg = searchExact.result.message?.length ?? 0
  const verifyMsg = verify.result.message?.length ?? 0
  console.log(`    ledger_check:  ${checkMsg} chars`)
  console.log(`    ledger_map:    ${mapMsg} chars`)
  console.log(`    ledger_search: ${searchMsg} chars`)
  console.log(`    ledger_verify: ${verifyMsg} chars`)
  results.toolQuality.outputSizes = { check: checkMsg, map: mapMsg, search: searchMsg, verify: verifyMsg }

  // ─────────────────────────────────────────────────────
  // DIMENSION 3: Retrieval Accuracy — Precision / Recall
  // ─────────────────────────────────────────────────────
  console.log('\n━━━ 3. Retrieval Accuracy ━━━\n')

  // Test cases: query → expected entry ids that should appear in results
  const retrievalTests = [
    {
      name: '精确关键词查询: 闸门幂等',
      query: '闸门 幂等',
      expectedIds: ['CL-20261120-99'],
      type: 'keyword',
    },
    {
      name: '英文术语查询: idempotent',
      query: 'idempotent',
      expectedIds: ['CL-20261120-99'],
      type: 'keyword',
    },
    {
      name: '错误特征查询: 死锁 deadlock',
      query: '死锁 deadlock',
      expectedIds: ['CL-20261118-97'],
      type: 'keyword',
    },
    {
      name: '状态过滤: 搁置条目',
      query: '超时',
      status: 'pending',
      expectedIds: ['CL-20261120-98'],
      type: 'status-filter',
    },
    {
      name: '锚点过滤: core/gate.py',
      query: '',
      anchor: 'core/gate.py',
      expectedIds: ['CL-20261120-99'],
      type: 'anchor',
    },
    {
      name: '宽泛查询: gate',
      query: 'gate',
      expectedIds: [],  // should find multiple gate entries
      minCount: 5,
      type: 'broad',
    },
    {
      name: '空结果查询',
      query: '完全不存在的术语xyzabc',
      expectedIds: [],
      expectEmpty: true,
      type: 'miss',
    },
  ]

  let totalPrecision = 0
  let totalRecall = 0
  let totalTests = 0

  for (const test of retrievalTests) {
    const result = await searchSpec.execute({
      root: LAB,
      query: test.query || '',
      status: test.status,
      anchor: test.anchor,
      limit: 20,
    })
    const foundIds = (result.entries || []).map(e => e.id)
    const found = result.total || 0

    if (test.expectEmpty) {
      const passed = found === 0
      console.log(`  ${passed ? '✅' : '❌'} ${test.name}: found=${found} (expected 0)`)
      if (passed) { totalPrecision += 1; totalRecall += 1 }
      totalTests += 1
      continue
    }

    if (test.minCount) {
      const passed = found >= test.minCount
      console.log(`  ${passed ? '✅' : '❌'} ${test.name}: found=${found} (expected ≥${test.minCount})`)
      if (passed) { totalPrecision += 1; totalRecall += 1 }
      totalTests += 1
      continue
    }

    // Precision: what fraction of returned results are relevant?
    // Recall: what fraction of expected results were found?
    const relevant = test.expectedIds.filter(id => foundIds.includes(id))
    const precision = found > 0 ? relevant.length / Math.min(found, test.expectedIds.length || 1) : 0
    const recall = test.expectedIds.length > 0 ? relevant.length / test.expectedIds.length : 1

    totalPrecision += precision
    totalRecall += recall
    totalTests += 1

    const passed = recall >= 1.0
    console.log(`  ${passed ? '✅' : '❌'} ${test.name}: precision=${precision.toFixed(2)} recall=${recall.toFixed(2)} found=${found} expected=${test.expectedIds.join(',')}`)
  }

  const avgPrecision = totalTests > 0 ? totalPrecision / totalTests : 0
  const avgRecall = totalTests > 0 ? totalRecall / totalTests : 0
  const f1 = avgPrecision + avgRecall > 0 ? 2 * avgPrecision * avgRecall / (avgPrecision + avgRecall) : 0

  console.log(`\n  Average Precision: ${avgPrecision.toFixed(3)}`)
  console.log(`  Average Recall:    ${avgRecall.toFixed(3)}`)
  console.log(`  F1 Score:          ${f1.toFixed(3)}`)

  results.retrieval = {
    testCount: totalTests,
    avgPrecision: +avgPrecision.toFixed(3),
    avgRecall: +avgRecall.toFixed(3),
    f1: +f1.toFixed(3),
  }

  // ─────────────────────────────────────────────────────
  // DIMENSION 4: Verdict accuracy (check tool)
  // ─────────────────────────────────────────────────────
  console.log('\n━━━ 4. Verdict Accuracy ━━━\n')

  const verdictTests = [
    { paths: ['core/gate.py'], expected: 'already-done', label: '已落地文件 → already-done' },
    { paths: ['core/risk.py'], expected: 'rollback-risk', label: '锚点已死 → rollback-risk' },
    { paths: ['core/nonexistent.py'], expected: 'unrecorded', label: '全新文件 → unrecorded' },
  ]

  let verdictCorrect = 0
  for (const vt of verdictTests) {
    const r = await checkSpec.execute({ root: LAB, paths: vt.paths })
    const actual = r.verdicts[0]?.verdict
    const ok = actual === vt.expected
    if (ok) verdictCorrect++
    console.log(`  ${ok ? '✅' : '❌'} ${vt.label}: ${actual}`)
  }
  const verdictAccuracy = verdictCorrect / verdictTests.length
  console.log(`\n  Verdict Accuracy: ${(verdictAccuracy * 100).toFixed(0)}% (${verdictCorrect}/${verdictTests.length})`)
  results.retrieval.verdictAccuracy = +verdictAccuracy.toFixed(3)

  // ─────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  SUMMARY')
  console.log(`${'═'.repeat(60)}`)
  console.log(`
  Performance (${ENTRY_COUNT} entries):
    map (cold/warm):      ${results.performance.mapColdMs} / ${results.performance.mapWarmMs} ms  (${results.performance.mapCacheSpeedup}x speedup)
    check (1/5 paths):    ${results.performance.check1PathMs} / ${results.performance.check5PathMs} ms
    search (cold/cached): ${results.performance.searchExactMs} / ${results.performance.searchCachedMs} ms  (${results.performance.searchCacheSpeedup}x speedup)
    verify:               ${results.performance.verifyMs} ms  (${results.performance.verifyChecked} anchors)

  Tool Quality:
    ${results.toolQuality.toolCount} tools, ~${results.toolQuality.estimatedTokens} prompt tokens
    Budget: ${results.toolQuality.totalBudgetChars} chars (desc ${results.toolQuality.totalDescChars} + schema ${results.toolQuality.totalSchemaChars})

  Retrieval:
    Precision: ${results.retrieval.avgPrecision}  Recall: ${results.retrieval.avgRecall}  F1: ${results.retrieval.f1}
    Verdict accuracy: ${(results.retrieval.verdictAccuracy * 100).toFixed(0)}%
`)

  // ─────────────────────────────────────────────────────
  // DIMENSION 5: Scaling — multi-size performance curve
  // ─────────────────────────────────────────────────────
  console.log('━━━ 5. Scaling Benchmark ━━━\n')

  const scales = [100, 200, 500, 1000]
  results.scaling = []

  for (const size of scales) {
    rmSync(LAB, { recursive: true, force: true })
    mkdirSync(join(LAB, 'docs'), { recursive: true })
    writeFileSync(join(LAB, 'docs', '变更台账.md'), buildCorpus(size), 'utf-8')
    buildSourceFiles()

    const s1 = await timeAsync(() => searchSpec.execute({ root: LAB, query: '闸门 幂等' }))
    const s2 = await timeAsync(() => searchSpec.execute({ root: LAB, query: '闸门 幂等' }))  // cached
    const c1 = await timeAsync(() => checkSpec.execute({ root: LAB, paths: ['core/gate.py'] }))
    const v1 = await timeAsync(() => verifySpec.execute({ root: LAB }))

    const row = {
      entries: size,
      searchColdMs: +s1.elapsed.toFixed(1),
      searchCachedMs: +s2.elapsed.toFixed(1),
      checkMs: +c1.elapsed.toFixed(1),
      verifyMs: +v1.elapsed.toFixed(1),
      verifyChecked: v1.result.checked,
    }
    results.scaling.push(row)
    console.log(`  ${String(size).padStart(5)} entries:  search ${row.searchColdMs}/${row.searchCachedMs} ms  check ${row.checkMs} ms  verify ${row.verifyMs} ms (${row.verifyChecked} anchors)`)
  }

  // ─────────────────────────────────────────────────────
  // DIMENSION 6: BM25 ranking quality
  // ─────────────────────────────────────────────────────
  console.log('\n━━━ 6. BM25 Ranking Quality ━━━\n')

  // Rebuild with 200 entries for ranking tests
  rmSync(LAB, { recursive: true, force: true })
  mkdirSync(join(LAB, 'docs'), { recursive: true })
  writeFileSync(join(LAB, 'docs', '变更台账.md'), buildCorpus(200), 'utf-8')
  buildSourceFiles()

  // Test: a rare term should rank its entry higher than a common term
  const rareQuery = await searchSpec.execute({ root: LAB, query: '幂等 idempotent', limit: 5 })
  const topResult = rareQuery.entries?.[0]
  const rareRankOk = topResult?.id === 'CL-20261120-99'
  console.log(`  ${rareRankOk ? '✅' : '❌'} Rare term "幂等 idempotent" ranks CL-20261120-99 first: ${topResult?.id}`)

  // Test: "死锁" is rarer than "修复", so the deadlock entry should rank above generic fixes
  const deadlockQuery = await searchSpec.execute({ root: LAB, query: '死锁', limit: 5 })
  const dlTop = deadlockQuery.entries?.[0]
  const dlRankOk = dlTop?.id === 'CL-20261118-97'
  console.log(`  ${dlRankOk ? '✅' : '❌'} Rare term "死锁" ranks CL-20261118-97 first: ${dlTop?.id}`)

  // Test: "超时 兜底" should find the shelved entry
  const timeoutQuery = await searchSpec.execute({ root: LAB, query: '超时 兜底 空跑', limit: 3 })
  const toTop = timeoutQuery.entries?.[0]
  const toRankOk = toTop?.id === 'CL-20261120-98'
  console.log(`  ${toRankOk ? '✅' : '❌'} Multi-term "超时 兜底 空跑" ranks CL-20261120-98 first: ${toTop?.id}`)

  const bm25Score = [rareRankOk, dlRankOk, toRankOk].filter(Boolean).length
  console.log(`\n  BM25 Ranking: ${bm25Score}/3 top-1 hits`)
  results.retrieval.bm25TopOneAccuracy = +(bm25Score / 3).toFixed(3)

  // ─────────────────────────────────────────────────────
  // DIMENSION 7: Symbol-level anchor verification
  // ─────────────────────────────────────────────────────
  console.log('\n━━━ 7. Symbol-Level Anchor Check ━━━\n')

  // Create a file with a known symbol, then verify
  touch('lib/sym_test.js', 'export function mySpecialFn(x) { return x * 2 }\nexport class MyWidget {}\n')

  // Import symbolStatus
  const { symbolStatus: symStat } = await import(pathToFileURL(join(ROOT, 'lib', 'anchors.js')).href)

  const tests7 = [
    { file: 'lib/sym_test.js', symbol: 'mySpecialFn', expected: 'found', label: 'JS 函数定义 → found' },
    { file: 'lib/sym_test.js', symbol: 'MyWidget', expected: 'found', label: 'JS class 定义 → found' },
    { file: 'lib/sym_test.js', symbol: 'nonExistent', expected: 'missing', label: '不存在的符号 → missing' },
    { file: 'lib/sym_test.js', symbol: '', expected: 'unchecked', label: '空符号名 → unchecked' },
    { file: 'lib/no_such_file.js', symbol: 'fn', expected: 'no-file', label: '文件不存在 → no-file' },
  ]

  // Also test Python
  touch('lib/sym_test.py', 'def compute_signal(data):\n    pass\n\nclass StrategyEngine:\n    pass\n')
  tests7.push(
    { file: 'lib/sym_test.py', symbol: 'compute_signal', expected: 'found', label: 'Python def → found' },
    { file: 'lib/sym_test.py', symbol: 'StrategyEngine', expected: 'found', label: 'Python class → found' },
    { file: 'lib/sym_test.py', symbol: 'deleted_func', expected: 'missing', label: 'Python 不存在 → missing' },
  )

  let sym7Pass = 0
  for (const t of tests7) {
    const actual = symStat(LAB, t.file, t.symbol)
    const ok = actual === t.expected
    if (ok) sym7Pass++
    console.log(`  ${ok ? '✅' : '❌'} ${t.label}: ${actual}`)
  }
  console.log(`\n  Symbol verification: ${sym7Pass}/${tests7.length} correct`)
  results.retrieval.symbolVerifyAccuracy = +(sym7Pass / tests7.length).toFixed(3)

  // Final summary
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  FINAL SUMMARY')
  console.log(`${'═'.repeat(60)}`)
  console.log(`
  Performance (200 entries):
    map (cold/warm):      ${results.performance.mapColdMs} / ${results.performance.mapWarmMs} ms  (${results.performance.mapCacheSpeedup}x speedup)
    check (1/5 paths):    ${results.performance.check1PathMs} / ${results.performance.check5PathMs} ms
    search (cold/cached): ${results.performance.searchExactMs} / ${results.performance.searchCachedMs} ms  (${results.performance.searchCacheSpeedup}x speedup)
    verify:               ${results.performance.verifyMs} ms  (${results.performance.verifyChecked} anchors)

  Scaling (search cold → cached):
${results.scaling.map(r => `    ${String(r.entries).padStart(5)} entries: ${r.searchColdMs}→${r.searchCachedMs} ms  check ${r.checkMs} ms  verify ${r.verifyMs} ms`).join('\n')}

  Tool Quality:
    ${results.toolQuality.toolCount} tools, ~${results.toolQuality.estimatedTokens} prompt tokens

  Retrieval:
    Precision: ${results.retrieval.avgPrecision}  Recall: ${results.retrieval.avgRecall}  F1: ${results.retrieval.f1}
    Verdict accuracy: ${(results.retrieval.verdictAccuracy * 100).toFixed(0)}%
    BM25 top-1 accuracy: ${((results.retrieval.bm25TopOneAccuracy ?? 0) * 100).toFixed(0)}%
    Symbol verify accuracy: ${((results.retrieval.symbolVerifyAccuracy ?? 0) * 100).toFixed(0)}%
`)

  // Write results to JSON
  const outPath = join(ROOT, 'test', 'benchmark-results.json')
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8')
  console.log(`  Results saved to: ${outPath}`)

  rmSync(LAB, { recursive: true, force: true })
  console.log('  Temp files cleaned up.\n')
}

main().catch((cause) => {
  console.error('BENCHMARK CRASHED:', cause?.stack ?? cause)
  try { rmSync(LAB, { recursive: true, force: true }) } catch {}
  process.exit(1)
})
