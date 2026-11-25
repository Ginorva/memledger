// dsh-memledger — ledger_requirement tool.
//
// Creates and lists requirement documents.

import { statsRegistry } from '../stats.js'
import {
  createRequirement,
  listRequirements,
  requirementsDir,
  REQUIREMENT_STATUSES,
} from '../requirements.js'
import { readRoot } from '../workspace-resolver.js'

export function requirementTool() {
  return {
    name: 'ledger_requirement',
    description:
      '把诉求规范化成需求文档（docs/需求/RQ-YYYYMMDD-NN.md），台账条目可挂为子项。多改动/跨仓/有验收口径时，在第一次 ledger_add 前先建；ask 保留原话。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录；省略用会话工作区。' },
        action: { type: 'string', enum: ['create', 'list'], description: 'create=建需求；list=列出现有需求。' },
        title: { type: 'string', description: '一行标题，尽量用用户原话。' },
        id: { type: 'string', description: '指定 id（RQ-YYYYMMDD-NN），默认取当天下一个空号。' },
        date: { type: 'string', description: 'YYYY-MM-DD，默认今天。' },
        status: { type: 'string', enum: REQUIREMENT_STATUSES, description: '初始状态，默认进行中。' },
        ask: { type: 'string', description: '用户原话，逐字保留，不许改写。' },
        scope: { type: 'string', description: '规范化范围：这条诉求到底覆盖什么。' },
        acceptance: { type: 'string', description: '验收口径：怎么算做完。' },
        notDoing: { type: 'string', description: '明确不做的事（防止需求膨胀）。' },
        repo: { type: 'string', description: '所属仓库（非工作区时填）。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          id: { type: 'string' },
          path: { type: 'string' },
          requirements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                status: { type: 'string' },
                subitems: { type: 'number' },
                open: { type: 'number' },
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
      stats.recordCall('ledger_requirement')
      const action = String(args?.action ?? '')

      if (action === 'list') {
        const items = listRequirements(root)
        const shaped = items.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          subitems: item.subitems.length,
          open: item.subitems.filter((sub) => sub.open).length,
        }))
        if (shaped.length === 0) {
          return {
            ok: true,
            root,
            requirements: [],
            message: `该工作区还没有需求（${requirementsDir(root)}）。提出一条需求时用 action=create 建一个。`,
          }
        }
        const openCount = shaped.filter((item) => item.open > 0).length
        const lines = shaped.map((item) => `  ${item.id} [${item.status}] ${item.title}（子项 ${item.subitems}，未勾 ${item.open}）`)
        return {
          ok: true,
          root,
          requirements: shaped,
          message: `共 ${shaped.length} 个需求，${openCount} 个还有未勾选子项：\n${lines.join('\n')}`,
        }
      }

      if (action !== 'create') {
        return { ok: false, root, message: `未知 action：${action}（可选 create / list）` }
      }

      const created = createRequirement(root, {
        title: args?.title,
        id: args?.id,
        date: args?.date,
        status: args?.status,
        ask: args?.ask,
        scope: args?.scope,
        acceptance: args?.acceptance,
        notDoing: args?.notDoing,
        repo: args?.repo,
      })
      if (!created.ok) {
        return { ok: false, root, message: `建需求失败：${created.reason}` }
      }

      const missingAsk = typeof args?.ask !== 'string' || args.ask.trim().length === 0
      return {
        ok: true,
        root,
        id: created.id,
        path: created.path,
        message:
          `已建立需求 ${created.id}：${String(args.title).trim()}（${created.path}）\n` +
          `下一步：入册时传 requirement="${created.id}"，子项会自动挂到需求文件里。` +
          (missingAsk ? '\n注意：没有提供原始诉求原文，需求文件里的「原始诉求」是空的——回头补上，否则规范化缺一个可核对的锚。' : ''),
      }
    },
  }
}
