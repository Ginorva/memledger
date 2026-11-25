// dsh-memledger — ledger_bootstrap tool.
//
// Scaffolds a ledger from git history or existing markdown documentation.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { LedgerManager } from '../ledger-manager.js'
import { scanGitHistory, convertGitCommitsToLedger } from '../scanner-git.js'
import { importExistingDocs } from '../scanner-docs.js'
import { statsRegistry } from '../stats.js'
import { messageOf } from '../scoring.js'
import { explicitRoot, ledgerPathOf, readEntries } from '../workspace-resolver.js'

export function bootstrapTool(ctx) {
  return {
    name: 'ledger_bootstrap',
    description:
      '从 git 历史或已有 markdown 重建台账。默认拒绝覆盖已有台账；force=true 才会覆盖（会丢历史）。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录（必填，台账写在这里）。' },
        source: { type: 'string', enum: ['git', 'doc'], description: 'git=扫描提交历史；doc=导入已有 markdown。' },
        docPath: { type: 'string', description: 'source=doc 时要导入的 markdown 路径。' },
        maxCommits: { type: 'number', description: 'source=git 时扫描多少条提交（默认 30）。' },
        force: { type: 'boolean', description: '覆盖已有台账。破坏性操作，非必要不传。' },
      },
      required: ['root'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          ledgerPath: { type: 'string' },
          entryCount: { type: 'number' },
          refused: { type: 'boolean' },
          message: { type: 'string' },
        },
        required: ['ok', 'message'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const root = explicitRoot(args)
      const stats = statsRegistry.get(root)
      stats.recordCall('ledger_bootstrap')
      if (root === undefined) {
        return {
          ok: false,
          refused: true,
          message: 'ledger_bootstrap 需要显式 root（仓库绝对路径）。生成会写文件，不接受猜测路径。',
        }
      }

      const ledgerPath = ledgerPathOf(root)
      const existed = existsSync(ledgerPath)
      if (existed && args?.force !== true) {
        const existing = readEntries(root)
        return {
          ok: false,
          refused: true,
          root,
          ledgerPath,
          entryCount: existing.length,
          message: `已存在台账（${existing.length} 条），拒绝覆盖。确要重建请传 force: true。`,
        }
      }

      const source = args?.source === 'doc' ? 'doc' : 'git'
      let entries = []
      try {
        if (source === 'doc') {
          const docPath = args?.docPath
          if (typeof docPath !== 'string' || docPath.length === 0) {
            return { ok: false, refused: true, message: 'source=doc 时必须提供 docPath。' }
          }
          entries = importExistingDocs(resolve(docPath))
        } else {
          const limit = Number.isFinite(args?.maxCommits) && args.maxCommits > 0 ? Math.floor(args.maxCommits) : 30
          entries = convertGitCommitsToLedger(scanGitHistory(root, limit))
        }
      } catch (cause) {
        return { ok: false, root, ledgerPath, message: '采集失败：' + messageOf(cause) }
      }

      try {
        const manager = new LedgerManager(root)
        manager.initWorkspace(entries)
        manager.reindex()
      } catch (cause) {
        return { ok: false, root, ledgerPath, message: '写台账失败：' + messageOf(cause) }
      }

      const written = readEntries(root)
      return {
        ok: true,
        root,
        ledgerPath,
        entryCount: written.length,
        message: `已生成台账：${written.length} 条 → ${ledgerPath}（来源 ${source}${existed ? '，覆盖了旧文件' : ''}）`,
      }
    },
  }
}
