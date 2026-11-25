// inject-rules.js — safe, idempotent injection of MemLedger rules into ~/.dsh/AGENTS.md.
//
// Ensures that any DSH agent session automatically abides by:
//  1. Reading codebase topology map before blindly scanning the repo (ledger_map).
//  2. Checking change history and shelved/reverted decisions before touching code (ledger_check).
//  3. Logging "why" & trade-offs into the ledger upon completion, then refreshing the map.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const BEGIN_MARKER = '<!-- BEGIN DSH-MEMLEDGER-RULES -->'
export const END_MARKER = '<!-- END DSH-MEMLEDGER-RULES -->'

export function defaultAgentsMdPath() {
  return join(homedir(), '.dsh', 'AGENTS.md')
}

export function buildRuleBlock() {
  return [
    BEGIN_MARKER,
    `# 全局约定：项目地图与变更台账 (MemLedger)`,
    ``,
    `本项目群遵循「空间有地图，时间有台账」的防走偏、防回滚双闭环机制：`,
    `1. **空间地图**：先看轻量拓扑与符号骨架定位边界，不要全盘乱扫。`,
    `2. **时间台账**：动手前查否决记录避免倒车，动手后沉淀决策依据。`,
    ``,
    `## 🚀 开工规则（改代码前）`,
    ``,
    `⚠️ **串行调用约束**：严禁在同一步并发发起多个 ledger 工具，必须按序逐个调用（等前一个工具结果返回再发下一个），防止模型流式分片损坏。`,
    `0. **建需求**：一条请求需要多个改动、跨多个仓、或有需要事后验收的口径时，先调用 \`ledger_requirement\`（action=create）把它整理成 \`docs/需求/RQ-YYYYMMDD-NN.md\`：原始诉求逐字保留、写清范围 / 验收口径 / 明确不做的事。单条小修不必建需求。`,
    `1. **定位**：首次接触项目时调用 \`ledger_map\`（后续同会话内结构未变则跳过）。`,
    `2. **查重**：涉及非trivial改动时调用 \`ledger_check\`。若返回搁置/已回退条目，**先核对重启条件再决定是否继续**。`,
    `3. **先看项目根 \`AGENTS.md\`**：那是会话开场唯一会自动加载的本项目规则入口（机器/凭据/部署命令/红线都在那儿）。`,
    ``,
    `## 🏁 交付规则（改代码后）`,
    ``,
    `3. **入册**：以下情况调用 \`ledger_add\`：重要决策落地、方案被否决或搁置（负向记忆必须入册）、非trivial的bug修复。routine改动（格式、注释、依赖升级）跳过。有需求时传 \`requirement="RQ-…"\` 挂为子项；同一需求内的多轮改动不算重复修复。`,
    `4. **刷新地图**：新增/删除文件或导出接口变动时，调用 \`ledger_map\` 刷新。`,
    `5. **收口需求**：需求下所有子项 \`[x]\` 后才把需求状态改为「已交付」；\`ledger_verify\` 会提醒引用了不存在需求的条目。`,
    `6. **留契约**：状态「已落地」时，给该程序补一条可执行用例（\`ledger_suite add\`）并跑一次 \`ledger_suite run\`；纯文案/配置改动可不留。`,
    ``,
    `## 📌 台账怎么读（2026-11-19 加）`,
    ``,
    `- **日期最新 ≠ 正确**：台账 append-only，**错的事实也会永久留在里面**，而且靠「新」取胜。`,
    `- **否定式环境事实先复跑再信**：「某台机没有凭据 / 某服务不能自己连 / 需人工处理」这类结论，`,
    `  命中时条目自带一条能重跑的复核命令（写在「验收」里）—— 照着它复跑一遍，再决定要不要照做。`,
    `- **规则 ≠ 台账**：规则是**当前态**（项目根 \`AGENTS.md\`，会改）；台账是**历史**（只追加）。`,
    `  把会过期的事实写进台账时用 \`type="事实"\`，并在「验收」里写一条能重跑、指向同一对象的命令；`,
    `  与旧结论冲突时在标题/为什么里写「结案 CL-…」点名旧条目 —— 否则错的事实会靠「新」取胜。`,
    // No tool table here: every tool already carries its own description, and
    // this block is injected into every session, so repeating it is pure tax.
    END_MARKER,
  ].join('\n')
}

/**
 * Idempotently injects or updates the MemLedger rule block in the target AGENTS.md.
 * Returns { ok, path, updated, reason }.
 */
export function ensureAgentsRulesInjected(targetPath = defaultAgentsMdPath()) {
  try {
    const parent = dirname(targetPath)
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true })
    }

    const ruleBlock = buildRuleBlock()

    if (!existsSync(targetPath)) {
      writeFileSync(targetPath, ruleBlock + '\n', 'utf-8')
      return { ok: true, path: targetPath, updated: true, reason: 'created' }
    }

    const currentContent = readFileSync(targetPath, 'utf-8')

    // If marker already exists, check whether block needs updating
    const beginIdx = currentContent.indexOf(BEGIN_MARKER)
    const endIdx = currentContent.indexOf(END_MARKER)

    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      const existingBlock = currentContent.slice(beginIdx, endIdx + END_MARKER.length)
      if (existingBlock.trim() === ruleBlock.trim()) {
        return { ok: true, path: targetPath, updated: false, reason: 'up-to-date' }
      }
      const newContent =
        currentContent.slice(0, beginIdx) + ruleBlock + currentContent.slice(endIdx + END_MARKER.length)
      writeFileSync(targetPath, newContent, 'utf-8')
      return { ok: true, path: targetPath, updated: true, reason: 'block-refreshed' }
    }

    // If no markers, but legacy `# 全局约定：变更台账` is present, replace or append cleanly
    if (currentContent.includes('# 全局约定：变更台账')) {
      // Replace legacy block if it starts at beginning
      const legacyHeader = '# 全局约定：变更台账'
      const legacyIdx = currentContent.indexOf(legacyHeader)
      if (legacyIdx === 0) {
        // Upgrade legacy file into the marked block
        writeFileSync(targetPath, ruleBlock + '\n', 'utf-8')
        return { ok: true, path: targetPath, updated: true, reason: 'legacy-upgraded' }
      }
    }

    // Append to end
    const separator = currentContent.endsWith('\n') ? '\n' : '\n\n'
    writeFileSync(targetPath, currentContent + separator + ruleBlock + '\n', 'utf-8')
    return { ok: true, path: targetPath, updated: true, reason: 'appended' }
  } catch (cause) {
    return {
      ok: false,
      path: targetPath,
      updated: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    }
  }
}
