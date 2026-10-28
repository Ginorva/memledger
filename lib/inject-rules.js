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
    `1. **空间地图**：解决「全盘乱扫、注意力被稀释」的问题。先看轻量拓扑与符号骨架定位边界。`,
    `2. **时间台账**：解决「做重复、改回历史坑」的问题。动手前查否决记录，动手后沉淀决策依据。`,
    ``,
    `## 🚀 开工硬规则（改代码前）`,
    ``,
    `1. **先看地图定位**：`,
    `   - 改动前优先阅读 \`docs/项目结构.md\` 或调用 \`ledger_map\`，定位涉及修改的核心文件与符号。`,
    `   - **严禁未经地图定位就使用 glob/grep 进行大范围盲目扫描。**`,
    `2. **再查台账避坑**：`,
    `   - 定位到文件/符号后，必须调用 \`ledger_check\` 或检索 \`docs/变更台账.md\`。`,
    `   - 若目标曾有 **搁置 / 已回退 / 已废弃** 记录，先核对「为什么不做」与「重启条件」，**绝对禁止在未满足重启条件时重走已被否决的老路**。`,
    ``,
    `## 🏁 交付硬规则（改代码后）`,
    ``,
    `3. **决策必须入册**：`,
    `   - 改动落地后调用 \`ledger_add\` 入册，12 字段齐全。`,
    `   - 特别注意：**如果尝试了某种方案但发现走不通并放弃，必须以「搁置」或「已回退」状态记入台账**，写清为什么不做，为后续迭代留下负向记忆。`,
    `4. **结构自动刷新**：`,
    `   - 涉及新增文件或导出接口变动时，调用 \`ledger_map\` 刷新 \`docs/项目结构.md\`。`,
    ``,
    `## 🛠️ 可用工具映射`,
    ``,
    `| 工具 | 触发时机 | 核心作用 |`,
    `|---|---|---|`,
    `| \`ledger_map\` | 探索项目 / 改动前 / 交付后 | 生成或读取紧凑代码骨架图，避免全盘乱扫 |`,
    `| \`ledger_check\` | **改动代码前一秒** | 检查指定文件或符号是否有倒车风险、是否曾被否决 |`,
    `| \`ledger_search\` | 遇到疑惑想查历史时 | 检索关键词或错误特征 |`,
    `| \`ledger_add\` | 改动落地 / 方案放弃时 | 沉淀决策「为什么」与负向经验 |`,
    `| \`ledger_verify\` | 交付验收体检时 | 校验已落地条目的代码锚点是否仍然存活 |`,
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
