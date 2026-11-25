// dsh-memledger — ledger_add tool.
//
// Appends a new decision record to the ledger.

import { existsSync } from 'node:fs'
import { LedgerManager } from '../ledger-manager.js'
import { anchorPathsOf, samePath, symbolOf } from '../anchors.js'
import { supersededIdsInText } from '../supersede.js'
import { findConflictingEarlier } from '../fact-claims.js'
import { statsRegistry } from '../stats.js'
import { coverRootPath, isTestPath, latestRun, loadSuite, programOfEntry } from '../suite.js'
import {
  isValidRequirementId,
  linkSubitem,
  requirementPath,
} from '../requirements.js'
import { readRoot, readEntries } from '../workspace-resolver.js'
import { modelRegistry } from '../ml-model.js'

export function addTool() {
  return {
    name: 'ledger_add',
    description:
      '追加一条决策记录（为什么这样做）。落地、否决、搁置都要记；routine 改动跳过。值内避免未转义双引号。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录；省略则从 cwd 向上找。' },
        title: { type: 'string', description: '一行概括这次改动/决策。' },
        type: { type: 'string', enum: ['修复', '新功能', '重构', '口径', '部署', '决策', '埋点', '演练', '文档', '事实'], description: '条目类型；「事实」= 会过期的事实。' },
        status: { type: 'string', enum: ['已落地', '进行中', '待验证', '搁置', '未做', '已回退', '已废弃'], description: '当前状态。' },
        anchor: { type: 'string', description: '代码锚点：path/to/file.py::symbol。' },
        why: { type: 'string', description: '为什么这样做/为什么不做；未完成状态必须写足。' },
        background: { type: 'string', description: '问题是什么。' },
        change: { type: 'string', description: '实际改了什么。' },
        tradeoff: { type: 'string', description: '代价；搁置条目写重启条件。' },
        repo: { type: 'string', description: '所属仓库。' },
        commit: { type: 'string', description: '提交哈希（有则填）。' },
        verify: {
          type: 'string',
          description:
            '怎么验证的。否定式能力事实（某台机没有凭据 / 不能自己连 / 需人工处理）必须在这里写一条能重跑、且指向同一对象的命令。',
        },
        keywords: { type: 'array', items: { type: 'string' }, description: '检索标签，至少 2 个（领域词/报错特征/符号名），不能只写类型。' },
        requirement: {
          type: 'string',
          description:
            '所属需求 id（RQ-YYYYMMDD-NN）；须先用 ledger_requirement 建好。',
        },
        force: {
          type: 'boolean',
          description: '同锚点已有未完成条目时仍要记录；仅在结论确实不同时用，并在 why 里说明差异。',
        },
      },
      required: ['title', 'type', 'status', 'anchor', 'why'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          entryId: { type: 'string' },
          refused: { type: 'boolean' },
          collidesWith: { type: 'array', items: { type: 'string' } },
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
      stats.recordCall('ledger_add')
      const manager = new LedgerManager(root)
      const today = new Date().toISOString().slice(0, 10)
      const day = today.replace(/-/g, '')
      const existing = readEntries(root)
      const used = new Set(existing.map((entry) => entry.id))
      let sequence = existing.length + 1
      let entryId = `CL-${day}-${String(sequence).padStart(2, '0')}`
      while (used.has(entryId)) {
        sequence += 1
        entryId = `CL-${day}-${String(sequence).padStart(2, '0')}`
      }

      // Refuse to record the same symbol twice as outstanding work.
      //
      // This is where a ledger rots: one function gets "landed" four times, the
      // entries dilute each other, retrieval stops pointing at the real decision,
      // and the next round redoes the work. A deterministic refusal is worth far
      // more here than any scoring model, because duplicates are a fact, not a
      // probability.
      // A requirement must exist before an entry may point at it. Refusing here
      // keeps the "directory" honest: a dangling id is worse than no id, because
      // the index would link to a file that never existed.
      const requirement = typeof args?.requirement === 'string' ? args.requirement.trim() : ''
      if (requirement.length > 0) {
        if (!isValidRequirementId(requirement)) {
          return { ok: false, root, message: `需求 ID 格式错误：${requirement}（需 RQ-YYYYMMDD-NN）。` }
        }
        if (!existsSync(requirementPath(root, requirement))) {
          return {
            ok: false,
            root,
            message: `需求 ${requirement} 不存在：${requirementPath(root, requirement)}\n先调用 ledger_requirement action=create 建需求，再入册。`,
          }
        }
      }

      const newAnchor = String(args.anchor)
      const newPaths = anchorPathsOf(newAnchor)
      const newSymbol = symbolOf(newAnchor)

      // 「结案 CL-…」：与旧结论冲突时的显式挂钩。
      //
      // 用**正文约定**而不是新增工具参数：工具定义有 prompt 预算的棘轮
      // （每加一个字都要从别处省，见 test/budget-smoke.mjs），而「显式废掉一条旧结论」
      // 早就是各项目的既有写法。工具认这个约定，比开一个新参数便宜得多。
      const supersedes = supersededIdsInText(`${args.title}\n${args.why}\n${args.change}`)[0] ?? ''
      if (supersedes.length > 0 && !existing.some((entry) => entry.id === supersedes)) {
        return {
          ok: false,
          root,
          message:
            `正文里点名要结案的条目不存在：${supersedes}\n` +
            '先用 ledger_search 确认旧条目 id，再在标题/为什么里写「结案 CL-…」。',
        }
      }

      // Contract bookkeeping: a landed decision that no case covers is a promise
      // nobody can re-check. Say so at the moment the entry is written, when the
      // author still remembers what "correct" looked like.
      const program = programOfEntry(root, { repo: args.repo, anchor: newAnchor })
      const suite = program ? loadSuite(root, program) : null
      const activeCases = suite ? suite.cases.filter((entry) => entry.status !== 'retired') : []
      const coveringCases = activeCases.filter((entry) =>
        entry.covers.some((cover) => newPaths.some((path) => samePath(coverRootPath(program, cover), path))),
      )
      const lastProgramRun = suite ? latestRun(root, program) : null
      const explicitVerify = typeof args.verify === 'string' && args.verify.trim().length > 0 ? args.verify.trim() : ''
      const autoVerify =
        !explicitVerify && suite
          ? coveringCases.length > 0
            ? `契约 ${coveringCases.slice(0, 3).map((entry) => entry.id).join('/')}` +
              (lastProgramRun ? ` · ${lastProgramRun.passed}/${lastProgramRun.total} 通过 · ${lastProgramRun.score} 分` : '（未跑分）')
            : `契约套件 ${activeCases.length} 例（未覆盖本锚点）`
          : ''
      const OUTSTANDING = ['已落地', '进行中', '待验证']
      const collisions = existing.filter((entry) => {
        if (!OUTSTANDING.includes(entry.status)) return false
        if (String(args.status) === '已回退' || String(args.status) === '已废弃') return false
        const paths = anchorPathsOf(entry.anchor)
        if (!paths.some((path) => newPaths.some((target) => samePath(path, target)))) return false
        return symbolOf(entry.anchor) === newSymbol
      })

      // Sub-items of the same requirement are rounds of one request, not a
      // repeat of one decision: allow them (12 and 13 of this very ledger are
      // both DashboardPanel changes under one "dashboard is empty" request).
      // Anything from another requirement — or from before requirements existed
      // — still blocks, because that is where re-doing work hides.
      const stableRepair = (entry) => requirement.length > 0 && entry.requirement === requirement
      const blocking = collisions.filter((entry) => !stableRepair(entry))
      const continuation = collisions.length - blocking.length

      if (blocking.length > 0 && args?.force !== true) {
        const detail = blocking
          .slice(0, 4)
          .map((entry) => `  ${entry.id}[${entry.status}] ${String(entry.why).slice(0, 90)}`)
          .join('\n')
        stats.recordAddResult(false, true)
        return {
          ok: false,
          refused: true,
          root,
          collidesWith: blocking.map((entry) => entry.id),
          message:
            `拒绝入册：${newPaths[0] ?? newAnchor}${newSymbol ? '::' + newSymbol : ''} 已有 ${blocking.length} 条未回退记录：\n` +
            detail +
            '\n若这次确实与上次不同，请在「为什么」里写清差异，并传 force: true；' +
            '若它是同一条诉求的后续子项，先建需求（ledger_requirement）再用 requirement 入册。' +
            (continuation > 0 ? `\n（另有 ${continuation} 条同需求子项，已视为后续轮次，不构成重复。）` : ''),
        }
      }
      const continuationNote = continuation > 0
        ? `\n（同一需求 ${requirement} 内已有 ${continuation} 条子项，本条按后续轮次入册。）`
        : ''

      const outcome = manager.add({
        id: entryId,
        title: String(args.title),
        date: today,
        type: args.type,
        status: args.status,
        repo: typeof args.repo === 'string' && args.repo.length > 0 ? args.repo : '本仓',
        requirement,
        supersedes,
        background: typeof args.background === 'string' && args.background.length > 0 ? args.background : String(args.title),
        change: typeof args.change === 'string' && args.change.length > 0 ? args.change : String(args.title),
        why: String(args.why),
        tradeoff: typeof args.tradeoff === 'string' && args.tradeoff.length > 0 ? args.tradeoff : '无',
        anchor: String(args.anchor),
        commit: typeof args.commit === 'string' && args.commit.length > 0 ? args.commit : 'HEAD',
        verify: explicitVerify || autoVerify || '自动记录',
        // 复核命令不单独占一个字段：**验收**里那条能重跑的命令就是它
        // （工具定义有 prompt 预算的棘轮，新参数要从别处省字）。
        probe: '',
        // No silent `[type]` default: that default is precisely how 16 of this
        // ledger's entries ended up with "修复" as their only search tag.
        keywords: Array.isArray(args.keywords) ? args.keywords.map(String) : [],
      })

      if (!outcome.success) {
        stats.recordAddResult(false, false)
        return { ok: false, root, message: '入册失败：' + String(outcome.error ?? '校验未通过') }
      }
      stats.recordAddResult(true, false)

      // ML online learning: check if this anchor was previously warned by ledger_check
      try {
        const model = modelRegistry.get(root)
        if (model) {
          // Find recent check events for this anchor
          const checkEvents = stats.recentEvents.filter(
            (event) => event.tool === 'ledger_check_ml' && event.features &&
              newPaths.some((path) => samePath(event.target || '', path))
          )
          if (checkEvents.length > 0) {
            for (const event of checkEvents) {
              // force = user overrode the warning → check was a false positive (label=0)
              // no force = user accepted the warning → check was relevant (label=1)
              const label = args?.force === true ? 0 : 1
              model.update(event.features, label)
            }
            // Save the model: aggressively near the ready threshold (15-25),
            // at the threshold itself, or periodically every 5 updates
            if ((model.sampleCount >= 15 && model.sampleCount <= 25) ||
                model.sampleCount % 5 === 0) {
              model.save(root)
            }
          }
        }
      } catch {
        // ML feedback is best-effort; never block add
      }

      let linkNote = ''
      if (requirement.length > 0) {
        const link = linkSubitem(root, requirement, entryId, String(args.title), String(args.status) === '已落地')
        linkNote = link.ok
          ? `\n已挂到需求 ${requirement} 的子项清单。`
          : `\n（需求子项挂载失败：${link.reason}）`
      }
      // 与更早的肯定式记录冲突 → 提醒（不拦）：**更新的否定结论未必正确**。
      const conflict = findConflictingEarlier(existing, {
        ...args,
        id: entryId,
        date: today,
        title: String(args.title),
        background: typeof args.background === 'string' ? args.background : String(args.title),
        change: typeof args.change === 'string' ? args.change : String(args.title),
      })
      const conflictNote = conflict
        ? `\n⚠️ 与更早的 ${conflict.id} 在同一主体上结论相反（它当时记的是「${String(conflict.title).slice(0, 60)}」）：` +
          `\n   更新的否定结论未必正确 —— 先复跑复核命令再信；确认旧的对，就在标题里写「结案 ${conflict.id}」把它显式废掉。`
        : ''
      const contractNotes = []
      const verifyLine = explicitVerify || autoVerify
      if (suite && String(args.status) === '已落地') {
        if (coveringCases.length === 0 && !(newPaths.length > 0 && newPaths.every(isTestPath))) {
          contractNotes.push(
            `📋 契约欠账：${program} 已落地但没有任何用例覆盖 ${newAnchor}——补一条（ledger_suite add）才能挡住以后改回。`,
          )
        }
        if (lastProgramRun && lastProgramRun.failed > 0) {
          const failedIds = (lastProgramRun.cases ?? []).filter((entry) => !entry.ok).map((entry) => entry.id)
          contractNotes.push(
            `⚠️ ${program} 最近一次跑分 ${lastProgramRun.passed}/${lastProgramRun.total}` +
              (failedIds.length > 0 ? `（红：${failedIds.join('、')}）` : '') +
              '，确认这些不是本次改动带出来的。',
          )
        }
      }
      if (suite && String(args.status) === '已回退') {
        const antibodyCases = activeCases.filter((c) =>
          (c.weight ?? 1) >= 5 &&
          (c.from === entryId || coveringCases.some((cc) => cc.id === c.id))
        )
        if (antibodyCases.length === 0 && !(newPaths.length > 0 && newPaths.every(isTestPath))) {
          contractNotes.push(
            `🚨 倒车免疫警报：检测到「已回退」条目，系统尚未建立对应防倒车抗体！请补一条权重 5 的契约用例锁住破坏场景：\n` +
            `  ledger_suite action=add weight=5 from="${entryId}" title="防倒车契约：${args.title}" covers=["${newAnchor}"]`
          )
        }
      }
      return {
        ok: true,
        root,
        entryId,
        message:
          `已入册 ${entryId}：${args.title}` +
          continuationNote +
          linkNote +
          conflictNote +
          (verifyLine ? `\n验收：${verifyLine}` : '') +
          (contractNotes.length > 0 ? '\n' + contractNotes.join('\n') : ''),
      }
    },
  }
}
