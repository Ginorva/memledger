// dsh-memledger — ledger_search tool.
//
// Keyword/anchor/status search across ledger entries.

import { LedgerManager } from '../ledger-manager.js'
import { supersessionMap, entryKey } from '../supersede.js'
import { statsRegistry } from '../stats.js'
import { CFG, indexLine } from '../scoring.js'
import { readRoot } from '../workspace-resolver.js'

export function searchTool() {
  return {
    name: 'ledger_search',
    description:
      '按关键词、报错特征或锚点检索历史决策（未决与回退优先）。默认回索引行，展开原因传 detail=true，包含已取代历史传 all=true。多台账时一并检索。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录；省略则从 cwd 向上找。' },
        query: { type: 'string', description: '关键词、报错特征、文件路径或符号。' },
        status: { type: 'string', enum: ['pending', '已落地', '进行中', '待验证', '搁置', '未做', '已回退', '已废弃'], description: '只看某个状态；pending=所有未完成。' },
        anchor: { type: 'string', description: '按锚点包含的字符串过滤。' },
        limit: { type: 'number', description: '最多返回几条（默认 10）。' },
        detail: { type: 'boolean', description: '展开每条的原因/锚点/日期；默认只给索引行。' },
        all: { type: 'boolean', description: '包含已取代/结案历史。' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          total: { type: 'number' },
          found: { type: 'boolean' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                status: { type: 'string' },
                anchor: { type: 'string' },
                requirement: { type: 'string' },
                why: { type: 'string' },
                date: { type: 'string' },
                source: { type: 'string', description: '来自哪本台账（多台账时才有）。' },
              },
              required: ['id'],
              additionalProperties: false,
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
      stats.recordCall('ledger_search')
      const manager = new LedgerManager(root)
      const limit = Number.isFinite(args?.limit) && args.limit > 0 ? Math.floor(args.limit) : 10
      const detail = args?.detail === true
      const results = manager.search({
        query: typeof args?.query === 'string' ? args.query : '',
        status: typeof args?.status === 'string' ? args.status : undefined,
        anchor: typeof args?.anchor === 'string' ? args.anchor : undefined,
        limit,
      })
      if (results.length === 0) {
        return {
          ok: true,
          root,
          total: 0,
          found: false,
          entries: [],
          message: '未检索到匹配的台账记录。若是新场景，做完记得用 ledger_add 入册。',
        }
      }
      // Index lines by default: ids alone are not recall, and full entries are
      // the dumps the v2 report set out to remove. detail=true buys the "why".
      const allEntries = manager.reload()
      const supersededBy = supersessionMap(allEntries)
      const showAll = args?.all === true

      // Metabolic Pruning (RSI): by default, fold away entries that later
      // decisions already superseded or closed, projecting active consensus.
      let prunedCount = 0
      let displayResults = results
      if (!showAll) {
        displayResults = results.filter((entry) => {
          if (supersededBy.has(entryKey(entry))) {
            prunedCount += 1
            return false
          }
          return true
        })
      }

      if (displayResults.length === 0 && results.length > 0) {
        return {
          ok: true,
          root,
          total: 0,
          found: false,
          entries: [],
          message: `未检索到当前有效记录（命中的 ${results.length} 条已在后续改动中被取代结案，已自动代谢剪枝；传 all=true 可展开查看历史）。`,
        }
      }

      // 同一个 CL 编号在多本台账里出现（编号规则不同：主台账全局连续、另两本当天重排）
      // ⇒ 含义可能完全不同。逐条打标记，而不是只在「两条都进了结果窗口」时才提示 ——
      // 排序经常把它们挤散，那样等于没提示。
      const sourcesById = new Map()
      for (const e of allEntries) {
        if (!sourcesById.has(e.id)) sourcesById.set(e.id, new Set())
        sourcesById.get(e.id).add(e.source || '主台账')
      }
      const mark = (entry) => {
        let s = ''
        if (supersededBy.has(entryKey(entry))) s += ` ↳已被 ${supersededBy.get(entryKey(entry))} 取代`
        const srcs = sourcesById.get(entry.id)
        if (srcs && srcs.size > 1) s += ` ↳⚠同号（${[...srcs].join('+')}）`
        return s
      }
      const srcTag = (entry) => (entry.source ? `[${entry.source}]` : '')
      // 同号 ID 在多本台账里含义不同 —— 命中里出现就必须说清楚，否则会张冠李戴。
      // 告警放在**最前面**：消息有字符上限（CFG.searchMaxChars），放末尾会被截掉。
      const byId = new Map()
      for (const entry of displayResults) {
        if (!byId.has(entry.id)) byId.set(entry.id, new Set())
        byId.get(entry.id).add(entry.source || '主台账')
      }
      const collisions = [...byId.entries()].filter(([, srcs]) => srcs.size > 1)
      const collisionNote = collisions.length > 0
        ? `⚠️ 其中 ${collisions.length} 个编号在多本台账里同号共存（含义不同，引用前先确认是哪本）：` +
          collisions.map(([id, srcs]) => `${id} → ${[...srcs].join('+')}`).join('、') + '\n'
        : ''
      let message = detail
        ? `命中 ${displayResults.length} 条：\n${collisionNote}` +
          displayResults
            .map((entry) =>
              [
                `${entry.id}[${entry.status}]${srcTag(entry)} ${entry.title}${mark(entry)}`,
                `  锚点: ${entry.anchor}`,
                `  日期: ${entry.date}`,
                `  为什么: ${entry.why}`,
              ].join('\n'),
            )
            .join('\n')
        : `命中 ${displayResults.length} 条：\n${collisionNote}` +
          displayResults.map((entry) => '  ' + indexLine(entry) + mark(entry)).join('\n')
      if (prunedCount > 0) {
        message += `\n（🌱 代谢系统已自动折叠 ${prunedCount} 条失效/被取代历史，传 all=true 可展开全量）`
      }
      if (!detail) message += '\n（需要原因/锚点/日期时传 detail=true）'
      if (message.length > CFG.searchMaxChars) {
        message = message.slice(0, CFG.searchMaxChars - 30) + '\n…(已截断，用 limit/status 缩小范围)'
      }
      return {
        ok: true,
        root,
        total: displayResults.length,
        found: true,
        entries: displayResults.map((entry) => ({
          id: entry.id,
          title: entry.title,
          status: entry.status,
          anchor: entry.anchor,
          requirement: entry.requirement,
          why: entry.why,
          date: entry.date,
          source: entry.source || '',
        })),
        message,
      }
    },
  }
}
