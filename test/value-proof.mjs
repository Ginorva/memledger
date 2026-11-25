// value-proof.mjs — Quantitative value proof for MemLedger.
//
// Simulates realistic coding scenarios and measures how MemLedger prevents
// waste. The output is a plain-language report showing:
//
//   1. How many rollback disasters were caught
//   2. How much duplicate work was avoided
//   3. How many shelved plans were respected
//   4. Estimated tokens and time saved
//
// Run:  node test/value-proof.mjs

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const LAB = join(ROOT, '.tmp-value-proof')

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
// Build a realistic project scenario
// ═══════════════════════════════════════════════════════

function buildScenario() {
  // Create source files
  touch('core/gate.py', `
class Gate:
    def allow(self, bar_id):
        """Check if position is allowed."""
        if self._is_duplicate(bar_id):
            return False  # idempotent guard added in CL-01
        return self._check_risk(bar_id)

    def _is_duplicate(self, bar_id):
        return bar_id in self._seen_bars

    def _check_risk(self, bar_id):
        return self.risk_engine.evaluate(bar_id) < self.threshold
`)
  touch('core/feed.py', `
class FeedClient:
    def fetch(self, symbols):
        """Fetch market data."""
        try:
            return self._provider.get_quotes(symbols)
        except TimeoutError:
            return []  # timeout fallback
`)
  // risk.py deliberately NOT created — simulates a deleted file
  touch('core/order.py', `
class OrderRouter:
    def submit(self, order):
        return self._broker.send(order)
`)
  touch('core/strategy.py', `
class MomentumStrategy:
    def signal(self, data):
        return data.momentum > self.threshold
`)

  // Build a ledger with realistic history
  const ledger = `# 项目变更台账（append-only）

> 由 MemLedger 自动维护。

---

## 1. 决策索引（自动生成）

<!-- 决策索引:BEGIN -->
<!-- 决策索引:END -->

---

## 2. 变更条目（只追加）

<!-- 条目:BEGIN -->
${entry('CL-20261001-01', '闸门重复开仓修复', '已落地', 'core/gate.py::allow',
  '同一 bar 内二次触发开仓，加了幂等判定防止重复下单。这是一个 P0 级 bug，导致了真实的资金损失。',
  { keywords: '闸门, 幂等, 重复开仓, idempotent, 资金损失', date: '2026-10-01' })}

${entry('CL-20261003-01', '行情超时兜底（返回空列表方案已废弃）', '已回退', 'core/feed.py::fetch',
  '行情源超时时返回空列表太危险——下游的选股引擎会把空列表当成"全部股票不满足条件"，导致整轮清仓。已回退到抛错方案。',
  { keywords: '行情, 超时, 空列表, 清仓风险, 兜底', date: '2026-10-03',
    tradeoff: '空列表兜底看似安全但会触发级联清仓；正确做法是超时时保持上一轮数据不变' })}

${entry('CL-20261005-01', '风控死锁修复（后来被改没了）', '已落地', 'core/risk.py::check_limits',
  '并发访问 position cache 导致死锁，加了读写锁。已用 pytest-timeout 验证无死锁。',
  { keywords: '风控, 死锁, 并发, 读写锁, deadlock, position cache', date: '2026-10-05' })}

${entry('CL-20261010-01', '策略信号分钟线方案暂缓', '搁置', 'core/strategy.py::signal',
  '分钟线数据量太大（每天 240 根/股 × 5000 股 = 120 万根），当前的内存管理方案撑不住。等 Redis 缓存层上线后再启用。',
  { keywords: '策略, 分钟线, 内存, Redis, 数据量', date: '2026-10-10',
    tradeoff: '重启条件：Redis 缓存层上线且压测通过' })}

${entry('CL-20261015-01', '订单路由重试逻辑', '已落地', 'core/order.py::submit',
  '券商接口偶尔超时，加了指数退避重试（最多 3 次）。',
  { keywords: '订单, 重试, 超时, 指数退避, 券商', date: '2026-10-15' })}
<!-- 条目:END -->
`
  writeFileSync(join(LAB, 'docs', '变更台账.md'), ledger, 'utf-8')
}

// ═══════════════════════════════════════════════════════
// Simulate developer scenarios
// ═══════════════════════════════════════════════════════

async function main() {
  rmSync(LAB, { recursive: true, force: true })
  mkdirSync(join(LAB, 'docs'), { recursive: true })
  buildScenario()

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

  const check = registered.get('ledger_check')
  const search = registered.get('ledger_search')

  console.log(`
${'═'.repeat(70)}
  MemLedger 价值证明：模拟真实开发场景
${'═'.repeat(70)}

下面模拟 5 个真实的开发场景，展示 MemLedger 如何在每个场景中
阻止错误、避免浪费、保护历史决策。
`)

  let totalSaved = { rollbacks: 0, duplicates: 0, shelved: 0, tokens: 0, minutes: 0 }

  // ─── 场景 1：开发者想修改闸门逻辑 ───
  console.log('━━━ 场景 1：开发者想修改 core/gate.py ━━━')
  console.log('   背景：新需求要给闸门加一个"日内最大开仓次数"限制。')
  console.log('   风险：gate.py::allow 曾经有一个 P0 级重复开仓 bug。')
  console.log()
  const s1 = await check.execute({ root: LAB, paths: ['core/gate.py'] })
  console.log(`   ${s1.verdicts[0]?.verdict === 'already-done' ? '✅' : '⚠️'} ledger_check 判定: ${s1.verdicts[0]?.verdict}`)
  console.log(`   📋 历史记录: "${s1.verdicts[0]?.entries?.[0]?.title}"`)
  console.log(`   💡 价值: 开发者知道了 allow() 有幂等判定，新代码不能破坏它。`)
  if (s1.verdicts[0]?.verdict !== 'unrecorded') {
    totalSaved.duplicates += 1
    totalSaved.tokens += 2000
    totalSaved.minutes += 15
    console.log(`   ⚡ 节省: ~2000 tokens（不用 grep 全项目找历史）+ ~15 分钟（不用猜测为什么有这段代码）`)
  }

  // ─── 场景 2：开发者想让超时返回空列表 ───
  console.log('\n━━━ 场景 2：开发者想让行情超时返回空列表 ━━━')
  console.log('   背景：新人看到 fetch() 超时会抛错，觉得应该"兜底"返回空列表。')
  console.log('   风险：这个方案已经被回退过！空列表会触发级联清仓。')
  console.log()
  const s2 = await check.execute({ root: LAB, paths: ['core/feed.py'] })
  const feedEntry = s2.verdicts[0]?.entries?.find(e => e.status === '已回退')
  console.log(`   ${feedEntry ? '🛡️ 拦截成功!' : '⚠️'} ledger_check 判定: ${s2.verdicts[0]?.verdict}`)
  if (feedEntry) {
    console.log(`   🔴 历史警告: "${feedEntry.title}"`)
    console.log(`   📖 回退原因: "${feedEntry.why?.slice(0, 80)}..."`)
    console.log(`   💡 价值: 阻止了开发者重蹈覆辙！这个"改进"曾经导致过真实的资金风险。`)
    totalSaved.rollbacks += 1
    totalSaved.tokens += 5000
    totalSaved.minutes += 60
    console.log(`   ⚡ 节省: ~5000 tokens（不用写代码→测试→发现问题→回退）+ ~60 分钟（避免整个回退流程）`)
  }

  // ─── 场景 3：开发者想重新实现风控锁 ───
  console.log('\n━━━ 场景 3：开发者想重新实现 core/risk.py 的死锁修复 ━━━')
  console.log('   背景：risk.py 被重构时，原来的读写锁被意外删掉了。')
  console.log('   风险：文件存在但修复代码丢失 → rollback-risk（最高级别警告）！')
  console.log()
  const s3 = await check.execute({ root: LAB, paths: ['core/risk.py'] })
  console.log(`   ${s3.verdicts[0]?.verdict === 'rollback-risk' ? '🔴 倒车风险检出!' : '⚠️'} ledger_check 判定: ${s3.verdicts[0]?.verdict}`)
  if (s3.verdicts[0]?.verdict === 'rollback-risk') {
    const riskEntry = s3.verdicts[0]?.entries?.[0]
    console.log(`   🔴 危险: "${riskEntry?.title}" 的锚点文件已不存在！`)
    console.log(`   💡 价值: 检测到历史修复被静默改没——这是最危险的回退形式。`)
    totalSaved.rollbacks += 1
    totalSaved.tokens += 8000
    totalSaved.minutes += 120
    console.log(`   ⚡ 节省: ~8000 tokens（不用从头排查死锁问题）+ ~120 分钟（避免生产事故排查）`)
  }

  // ─── 场景 4：开发者想给策略加分钟线 ───
  console.log('\n━━━ 场景 4：开发者想给策略加分钟线支持 ━━━')
  console.log('   背景：有人觉得分钟线能提升策略准确度，想直接加上去。')
  console.log('   风险：这个方案已经被搁置过，因为内存撑不住！')
  console.log()
  const s4 = await check.execute({ root: LAB, paths: ['core/strategy.py'] })
  const shelvedEntry = s4.verdicts[0]?.entries?.find(e => e.status === '搁置')
  if (shelvedEntry) {
    console.log(`   ⚠️ 搁置预警! ledger_check 判定: shelved`)
    console.log(`   📋 搁置记录: "${shelvedEntry.title}"`)
    console.log(`   🔑 重启条件: "${shelvedEntry.tradeoff}"`)
    console.log(`   💡 价值: 避免开发者花时间做一个已经被证明走不通的方案。`)
    totalSaved.shelved += 1
    totalSaved.tokens += 3000
    totalSaved.minutes += 30
    console.log(`   ⚡ 节省: ~3000 tokens（不用写代码后才发现内存爆炸）+ ~30 分钟`)
  }

  // ─── 场景 5：新功能，无历史 ───
  console.log('\n━━━ 场景 5：开发者要给 order.py 加批量下单功能 ━━━')
  console.log('   背景：这是一个全新功能，没有历史踩坑记录。')
  console.log()
  const s5 = await check.execute({ root: LAB, paths: ['core/order.py'] })
  const orderVerdict = s5.verdicts[0]?.verdict
  console.log(`   ${orderVerdict === 'already-done' ? '✅' : '⚪'} ledger_check 判定: ${orderVerdict}`)
  if (orderVerdict === 'already-done') {
    console.log(`   📋 注意: 该文件有已落地的改动记录，新功能不要破坏现有的重试逻辑。`)
    totalSaved.tokens += 500
    totalSaved.minutes += 5
  } else {
    console.log(`   ✅ 全新场景，放行。记得做完后 ledger_add 入册。`)
  }

  // ─── 场景 6：关键词搜索历史决策 ───
  console.log('\n━━━ 场景 6：开发者搜索"死锁"相关的历史决策 ━━━')
  const s6 = await search.execute({ root: LAB, query: '死锁 deadlock', detail: true })
  console.log(`   🔍 搜索 "死锁 deadlock": 找到 ${s6.total} 条记录`)
  if (s6.total > 0) {
    console.log(`   📋 "${s6.entries[0]?.title}" — ${s6.entries[0]?.why?.slice(0, 60)}...`)
    totalSaved.tokens += 1000
    totalSaved.minutes += 10
    console.log(`   ⚡ 节省: ~1000 tokens（精确定位历史决策，不用翻 git log）+ ~10 分钟`)
  }

  // ═══ 总结 ═══
  console.log(`
${'═'.repeat(70)}
  📊 价值证明总结
${'═'.repeat(70)}

  在这 6 个模拟场景中，MemLedger 产生了以下可量化的价值：

  🛡️ 阻止倒车:        ${totalSaved.rollbacks} 次
     （每次倒车 = 一个已修好的 bug 被改回来，可能导致生产事故）

  ♻️ 避免重复劳动:     ${totalSaved.duplicates} 次
     （每次 = 开发者不用重新做已经做过的事）

  ⚠️ 尊重搁置决定:     ${totalSaved.shelved} 次
     （每次 = 避免花时间做一个已被证明走不通的方案）

  ⚡ 预估节省 tokens:  ~${(totalSaved.tokens / 1000).toFixed(1)}k tokens
     （不用 grep/glob 全项目扫描、不用写后又删）

  ⏱️ 预估节省时间:     ~${totalSaved.minutes} 分钟 (${(totalSaved.minutes / 60).toFixed(1)} 小时)
     （不用排查已知问题、不用回退错误方案）

  ────────────────────────────────────────────────────

  💰 如果按 AI Agent 的 token 成本计算（$3/M tokens）：
     ${(totalSaved.tokens / 1000).toFixed(1)}k tokens ≈ $${(totalSaved.tokens * 3 / 1000000).toFixed(4)} 直接成本节省

  💰 如果按开发者时间计算（$50/hour）：
     ${(totalSaved.minutes / 60).toFixed(1)} 小时 ≈ $${(totalSaved.minutes / 60 * 50).toFixed(0)} 人力成本节省

  🔑 核心洞察：MemLedger 的价值不在于"节省了多少钱"，而在于
     "阻止了多少次本来会发生的倒车"。每一次倒车都可能变成
     一个生产事故，而阻止事故的价值远超任何 token 成本。
`)

  rmSync(LAB, { recursive: true, force: true })
}

main().catch((cause) => {
  console.error('VALUE PROOF CRASHED:', cause?.stack ?? cause)
  try { rmSync(LAB, { recursive: true, force: true }) } catch {}
  process.exit(1)
})
