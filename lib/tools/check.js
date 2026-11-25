// dsh-memledger — ledger_check tool.
//
// Pre-change check: surfaces existing decisions for paths about to be modified.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LedgerManager } from '../ledger-manager.js'
import { anchorPathsOf, normalizePath, samePath, symbolOf } from '../anchors.js'
import { supersessionMap, entryKey } from '../supersede.js'
import { DECAY_IMMUNE_STATUSES } from '../schema.js'
import { statsRegistry } from '../stats.js'
import { coverRootPath, latestRun, listSuites } from '../suite.js'
import { CFG, scoreEntry, indexLine, extractCheckFeatures } from '../scoring.js'
import { readRoot, ledgerPathOf, readEntries } from '../workspace-resolver.js'
import { modelRegistry } from '../ml-model.js'

const PENDING = ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中']

export function checkTool() {
  return {
    name: 'ledger_check',
    description:
      '改动前必查：这些路径的锚点上已有过什么决策。已落地=别再重做；已回退/锚点已死=别重踩同一个坑；搁置=先核对重启条件。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录；省略则从 cwd 向上找。' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: '准备改的文件或目录（绝对或仓内相对路径均可）。',
        },
        query: { type: 'string', description: '可选：额外关键词（报错特征、符号、领域词）。' },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          hasLedger: { type: 'boolean' },
          risky: { type: 'number' },
          verdicts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                verdict: {
                  type: 'string',
                  enum: ['rollback-risk', 'already-done', 'repeated-repair', 'shelved', 'foreign-anchor', 'unrecorded'],
                },
                entries: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      status: { type: 'string' },
                      title: { type: 'string' },
                      why: { type: 'string' },
                      tradeoff: { type: 'string' },
                      anchor: { type: 'string' },
                      anchorAlive: { type: 'boolean' },
                      anchorStatus: { type: 'string', enum: ['alive', 'dead', 'unknown', 'none'] },
                      commit: { type: 'string' },
                      date: { type: 'string' },
                    },
                    required: ['id', 'status'],
                    additionalProperties: false,
                  },
                },
                folded: { type: 'number' },
                superseded: { type: 'array', items: { type: 'string' } },
              },
              required: ['path', 'verdict'],
              additionalProperties: false,
            },
          },
          _telemetry: {
            type: 'object',
            properties: {
              totalEntries: { type: 'number' },
              matched: { type: 'number' },
              returned: { type: 'number' },
              folded: { type: 'number' },
              chars: { type: 'number' },
            },
          },
          message: { type: 'string' },
        },
        required: ['ok', 'message'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const root = readRoot(args, exec)
      const stats = statsRegistry.get(root)
      stats.recordCall('ledger_check')
      const hasLedger = existsSync(ledgerPathOf(root))
      const entries = readEntries(root)
      const supersededBy = supersessionMap(entries)

      // Contract coverage: when a path is guarded by acceptance cases, the check
      // answer must say so — that is the difference between "we already fixed
      // this" and "we can prove it still works". One line per path, no detail.
      const suites = listSuites(root)
      const runCache = new Map()
      const lastRunOf = (program) => {
        if (!runCache.has(program)) runCache.set(program, latestRun(root, program))
        return runCache.get(program)
      }
      const contractHits = (target) => {
        const hits = []
        for (const suite of suites) {
          for (const c of suite.cases) {
            if (c.status === 'retired') continue
            if (c.covers.some((cover) => samePath(coverRootPath(suite.program, cover), target))) {
              hits.push({ program: suite.program, id: c.id, weight: c.weight ?? 1, from: c.from })
            }
          }
        }
        return hits
      }
      const contractsByPath = new Map()

      const targets = Array.isArray(args?.paths)
        ? args.paths.map((value) => normalizePath(value)).filter((value) => value.length > 0)
        : []
      if (targets.length === 0) {
        return { ok: false, root, hasLedger, risky: 0, verdicts: [], message: 'ledger_check 需要至少一个 paths 条目。' }
      }

      // P1: Per-call existsSync cache — avoids repeating filesystem checks for
      // the same path across multiple entries within one ledger_check invocation.
      const existsCache = new Map()
      const cachedExists = (path) => {
        if (existsCache.has(path)) return existsCache.get(path)
        const result = existsSync(path)
        existsCache.set(path, result)
        return result
      }
      const cachedAnchorStatus = (anchorRoot, paths) => {
        if (paths.length === 0) return 'none'
        if (paths.some((p) => cachedExists(join(anchorRoot, p)))) return 'alive'
        // dead = top directory exists here but the file doesn't
        const dead = paths.filter((p) => {
          const top = p.split('/')[0]
          if (top.length === 0 || p.includes('..')) return false
          return cachedExists(join(anchorRoot, top)) && !cachedExists(join(anchorRoot, p))
        })
        if (dead.length > 0) return 'dead'
        return 'unknown'
      }
      if (!hasLedger) {
        const unrecordedVerdicts = targets.map((path) => ({ path, verdict: 'unrecorded', entries: [] }))
        stats.recordCheckResult(unrecordedVerdicts, null)
        return {
          ok: true,
          root,
          hasLedger: false,
          risky: 0,
          verdicts: unrecordedVerdicts,
          message: `该仓库还没有台账（${root}），所以无从查重。改动之后用 ledger_add 入册，下次就能查了。`,
        }
      }

      const extra = typeof args?.query === 'string' ? args.query.trim() : ''
      const verdicts = []
      let totalMatched = 0
      let totalReturned = 0
      let totalFolded = 0

      for (const target of targets) {
        const matched = entries.filter((entry) => anchorPathsOf(entry.anchor).some((path) => samePath(path, target)))
        totalMatched += matched.length

        // One question, one answer: entries a later entry already replaced are
        // folded into a count instead of competing with the live one.
        const supersededTargets = matched
          .filter((entry) => supersededBy.has(entryKey(entry)))
          .map((entry) => entry.id)
        const liveMatched = matched.filter((entry) => !supersededBy.has(entryKey(entry)))

        // v2: Score and sort entries, apply threshold
        const scored = liveMatched.map((entry) => {
          const paths = anchorPathsOf(entry.anchor)
          const status = cachedAnchorStatus(root, paths)

          // Extract ML features for this entry and record to recentEvents
          let mlFeatures = null
          try {
            mlFeatures = extractCheckFeatures(entry, target, {})
            stats.recentEvents.push({
              tool: 'ledger_check_ml',
              ts: Date.now(),
              entryId: entry.id,
              target,
              features: mlFeatures,
            })
            if (stats.recentEvents.length > 50) stats.recentEvents.shift()
          } catch {
            // ML feature extraction is best-effort
          }

          return {
            id: entry.id,
            status: entry.status,
            title: entry.title,
            why: entry.why,
            tradeoff: entry.tradeoff,
            anchor: entry.anchor,
            anchorAlive: status === 'alive',
            anchorStatus: status,
            commit: entry.commit,
            date: entry.date,
            _score: scoreEntry(entry, target, {}, root),
          }
        }).sort((a, b) => b._score - a._score)

        // Split into surfaced vs folded.
        // Entries that drive a non-trivial verdict (negative memory, dead anchors,
        // repeated repairs, live landed anchors) must always surface — otherwise
        // the verdict says "already-done" or "rollback-risk" but the entries array
        // is empty, which is useless. At least one entry per verdict category
        // must survive the threshold.
        const verdictDrivers = scored.filter((e) =>
          DECAY_IMMUNE_STATUSES.has(e.status) ||
          e.anchorStatus === 'dead' ||
          PENDING.includes(e.status) ||
          (e.status === '已落地' && e.anchorStatus === 'alive')
        )
        const thresholdSurfaced = scored.filter((e) => e._score >= CFG.scoreThreshold)
        // Merge: verdict drivers + threshold-passed, deduplicated, capped
        const surfacedIds = new Set()
        const surfaced = []
        for (const e of [...verdictDrivers, ...thresholdSurfaced]) {
          if (!surfacedIds.has(e.id) && surfaced.length < CFG.checkMaxEntries) {
            surfacedIds.add(e.id)
            surfaced.push(e)
          }
        }
        const foldedCount = scored.length - surfaced.length
        totalReturned += surfaced.length
        totalFolded += foldedCount

        // Clean up internal score before returning
        const shaped = surfaced.map(({ _score, ...rest }) => rest)

        const landed = scored.filter((entry) => entry.status === '已落地')
        const deadLanded = landed.filter((entry) => entry.anchorStatus === 'dead')
        const liveLanded = landed.filter((entry) => entry.anchorStatus === 'alive')
        const foreignLanded = landed.filter((entry) => entry.anchorStatus === 'unknown')
        const pendingEntries = scored.filter((entry) => PENDING.includes(entry.status))

        const bySymbol = new Map()
        for (const entry of liveLanded) {
          const symbol = symbolOf(entry.anchor)
          bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + 1)
        }
        const repeatedSymbol = [...bySymbol.values()].some((count) => count >= 2) || supersededTargets.length > 0

        let verdict = 'unrecorded'
        if (deadLanded.length > 0) verdict = 'rollback-risk'
        else if (repeatedSymbol) verdict = 'repeated-repair'
        else if (liveLanded.length > 0) verdict = 'already-done'
        else if (pendingEntries.length > 0) verdict = 'shelved'
        else if (foreignLanded.length > 0) verdict = 'foreign-anchor'

        verdicts.push({
          path: target,
          verdict,
          entries: shaped,
          ...(foldedCount > 0 ? { folded: foldedCount } : {}),
          ...(supersededTargets.length > 0 ? { superseded: supersededTargets } : {}),
        })
        contractsByPath.set(target, contractHits(target))

        // Record a per-target ML event so that subsequent ledger_add on this
        // path always produces a training sample, even when no entries matched.
        // This broadens the learning signal beyond "matched entry → add" pairs.
        if (scored.length === 0) {
          try {
            stats.recentEvents.push({
              tool: 'ledger_check_ml',
              ts: Date.now(),
              entryId: '__unrecorded__',
              target,
              features: [0.3, 0.3, 1.0, 0, 0, 0, 0, 0],  // baseline feature vector
            })
            if (stats.recentEvents.length > 50) stats.recentEvents.shift()
          } catch { /* best-effort */ }
        }
      }

      // v2: Keyword-related entries, also scored and budget-limited
      let related = []
      if (extra.length > 0) {
        const manager = new LedgerManager(root)
        const alreadyShown = new Set(verdicts.flatMap((verdict) => verdict.entries.map((entry) => entry.id)))
        related = manager
          .search({ query: extra, limit: 3 })
          .filter((entry) => !alreadyShown.has(entry.id))
      }

      const risky = verdicts.filter((verdict) => verdict.verdict === 'rollback-risk' || verdict.verdict === 'repeated-repair').length

      // v2: Build compact index-line message instead of full dump
      const lines = verdicts.map((verdict) => {
        const label = {
          'rollback-risk': '🔴 【倒车风险】',
          'repeated-repair': '🟡 【重复修复】',
          'already-done': '🟢 【已落地】',
          shelved: '⚠️ 【曾决定不做】',
          'foreign-anchor': '⚪ 【外部仓锚点】',
          unrecorded: '⚪ 【无记录/新场景】',
        }[verdict.verdict]

        let res = `${label} \`${verdict.path}\``

        // v2: Use compact index lines instead of full entry dumps
        for (const entry of verdict.entries) {
          res += '\n  ' + indexLine(entry)
          // Only expand tradeoff/restart-condition for negative-memory entries
          if (DECAY_IMMUNE_STATUSES.has(entry.status) && entry.tradeoff && entry.tradeoff !== '无') {
            const tradeSnip = entry.tradeoff.length > 60 ? entry.tradeoff.slice(0, 58) + '…' : entry.tradeoff
            res += `\n    ↳ 重启条件: ${tradeSnip}`
          }
        }
        if (verdict.folded > 0) {
          res += `\n  …另有 ${verdict.folded} 条低相关记录（用 ledger_search 查看）`
        }
        if (verdict.superseded && verdict.superseded.length > 0) {
          res += `\n  ↳ 另有 ${verdict.superseded.length} 轮已被取代（${verdict.superseded.join('、')}），以本条为准`
        }
        const hits = contractsByPath.get(verdict.path) ?? []
        if (hits.length > 0) {
          const byProgram = new Map()
          for (const hit of hits) {
            if (!byProgram.has(hit.program)) byProgram.set(hit.program, [])
            byProgram.get(hit.program).push(hit.id)
          }
          const [program, ids] = [...byProgram.entries()].sort((a, b) => b[1].length - a[1].length)[0]
          const last = lastRunOf(program)
          const shown = ids.slice(0, 3).join('/') + (ids.length > 3 ? ` 等 ${ids.length} 例` : '')
          res += `\n  🧪 契约 ${shown}（${program}${last ? ` · 上次 ${last.score} 分` : ' · 未跑分'}）`
        }
        const hasRollback = verdict.entries.some((entry) => entry.status === '已回退')
        if (hasRollback) {
          const antibodies = hits.filter((h) => (h.weight ?? 1) >= 5)
          if (antibodies.length > 0) {
            res += `\n  🛡️ 倒车抗体已就位：${antibodies.map((h) => h.id).join('/')}（防倒车权重 5）`
          } else {
            res += `\n  🚨 免疫抗体缺失：该路径有历史回退记录，尚未建立防倒车契约！`
          }
        }
        return res
      })

      if (related.length > 0) {
        lines.push('\n🔍 **关键词相关**:')
        for (const entry of related) {
          lines.push('  ' + indexLine(entry))
        }
      }

      const headline =
        risky > 0
          ? `🛡️ **[预检] ⚠️ ${risky} 处倒车/重复修复风险！**`
          : verdicts.every((verdict) => verdict.verdict === 'unrecorded')
            ? '🛡️ **[预检] 🟢 全新场景，无历史踩坑。**'
            : '🛡️ **[预检] ℹ️ 命中历史记录：**'

      // v2: Budget-truncate the message
      let message = headline + (lines.length > 0 ? '\n' + lines.join('\n') : '')
      if (message.length > CFG.checkMaxChars) {
        message = message.slice(0, CFG.checkMaxChars - 30) + '\n…(已截断，用 ledger_search 查完整记录)'
      }

      // v3: Record effectiveness stats
      const telemetry = {
        totalEntries: entries.length,
        matched: totalMatched,
        returned: totalReturned,
        folded: totalFolded,
        chars: message.length,
      }
      stats.recordCheckResult(verdicts, telemetry)

      // Append compact stats line to message
      if (stats.totalCalls > 1) {
        message += '\n\n' + stats.toCompactSummary()
      }

      // Append ML model status if the model is active
      try {
        const model = modelRegistry.get(root)
        if (model && model.isReady) {
          const summary = model.summary()
          const weightPairs = Object.entries(summary.weights)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
          message += `\n🤖 ML 模型活跃（${summary.sampleCount} 样本训练，权重：${weightPairs}）`
        }
      } catch {
        // ML status is best-effort
      }

      return {
        ok: true,
        root,
        hasLedger: true,
        risky,
        verdicts,
        _telemetry: telemetry,
        message,
      }
    },
  }
}
