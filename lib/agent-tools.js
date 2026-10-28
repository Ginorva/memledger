// dsh-memledger — agent tools.
//
// Registers the four ledger tools the model can call. The shape follows
// dsh-unlag's working registration (ctx.tools.register(spec, label) inside
// ctx.effect, with a JSON-schema `parameters` and an `output.schema` plus
// `execute`), not a guess of my own.
//
// Two safety rules are deliberate:
//
//  * Nothing here ever overwrites an existing ledger. `ledger_bootstrap`
//    refuses unless `force: true`, because scaffolding is destructive
//    (initWorkspace rewrites the file) and a real ledger with dozens of
//    decisions is not something a tool call gets to discard by accident.
//  * Creation requires an explicit `root`. Guessing a workspace before
//    writing files is how you write into the wrong repo.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { LedgerManager } from './ledger-manager.js'
import { parseLedgerMarkdown } from './markdown-parser.js'
import { scanGitHistory, convertGitCommitsToLedger } from './scanner-git.js'
import { importExistingDocs } from './scanner-docs.js'

const LEDGER_RELATIVE = join('docs', '变更台账.md')
const PENDING = ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中']

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Resolve a root the caller named outright. */
function explicitRoot(args) {
  const raw = args?.root
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  return resolve(raw)
}

/**
 * Resolve a root for a read-only call.
 *
 * Reading may guess (an upward walk that finds a ledger); writing may not, so
 * the creation path uses explicitRoot and refuses when it is absent.
 */
function readRoot(args) {
  const named = explicitRoot(args)
  if (named !== undefined) return named
  let cursor = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(cursor, LEDGER_RELATIVE))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return process.cwd()
}

function ledgerPathOf(root) {
  return join(root, LEDGER_RELATIVE)
}

function readEntries(root) {
  const ledgerPath = ledgerPathOf(root)
  if (!existsSync(ledgerPath)) return []
  try {
    return parseLedgerMarkdown(readFileSync(ledgerPath, 'utf-8'))
  } catch {
    return []
  }
}

/* --------------------------------------------------------------- specs -- */

function bootstrapTool(ctx) {
  return {
    name: 'ledger_bootstrap',
    description:
      'Create the change ledger (docs/变更台账.md) for a repository by reconstructing it from git history or from an existing markdown log. Refuses to overwrite an existing ledger unless force is true, because scaffolding rewrites the whole file.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute path to the repository root. Required: the ledger is written under this directory.' },
        source: { type: 'string', enum: ['git', 'doc'], description: 'Where entries come from. "git" scans commit history; "doc" imports an existing markdown file.' },
        docPath: { type: 'string', description: 'For source=doc: absolute path of the markdown file to import.' },
        maxCommits: { type: 'number', description: 'For source=git: how many matching commits to scan (default 30).' },
        force: { type: 'boolean', description: 'Overwrite an existing ledger. Destructive; leave false unless the caller intends to discard the current entries.' },
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
    async execute(args) {
      const root = explicitRoot(args)
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

function searchTool() {
  return {
    name: 'ledger_search',
    description:
      'Search the change ledger for past decisions by keyword, error signature, or code anchor. Pending entries (未做/搁置/待验证/已回退) are ranked first. Call this BEFORE changing code that a previous decision may have touched.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute repository root. Omit to use the nearest ledger above the process cwd.' },
        query: { type: 'string', description: 'Free text: keywords, an error signature, a file path, a symbol.' },
        status: { type: 'string', enum: ['pending', '已落地', '进行中', '待验证', '搁置', '未做', '已回退', '已废弃'], description: 'Restrict to one status; "pending" means any unfinished status.' },
        anchor: { type: 'string', description: 'Restrict to entries whose code anchor contains this string.' },
        limit: { type: 'number', description: 'Maximum entries to return (default 10).' },
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
                why: { type: 'string' },
                date: { type: 'string' },
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
    async execute(args) {
      const root = readRoot(args)
      const manager = new LedgerManager(root)
      const limit = Number.isFinite(args?.limit) && args.limit > 0 ? Math.floor(args.limit) : 10
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
      return {
        ok: true,
        root,
        total: results.length,
        found: true,
        entries: results.map((entry) => ({
          id: entry.id,
          title: entry.title,
          status: entry.status,
          anchor: entry.anchor,
          why: entry.why,
          date: entry.date,
        })),
        message: `命中 ${results.length} 条：` + results.map((entry) => `${entry.id}[${entry.status}]`).join('、'),
      }
    },
  }
}

function addTool() {
  return {
    name: 'ledger_add',
    description:
      'Append one decision to the change ledger. Use it when a change lands, or when a plan is shelved or reverted — the "why" is the point, so a non-landed status needs a real reason and restart condition.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute repository root. Omit to use the nearest ledger above the process cwd.' },
        title: { type: 'string', description: 'One-line summary of the change or decision.' },
        type: { type: 'string', enum: ['修复', '新功能', '重构', '口径', '部署', '决策', '埋点', '演练', '文档'], description: 'Entry type.' },
        status: { type: 'string', enum: ['已落地', '进行中', '待验证', '搁置', '未做', '已回退', '已废弃'], description: 'Where the change stands.' },
        anchor: { type: 'string', description: 'Physical code anchor: "path/to/file.py::symbol".' },
        why: { type: 'string', description: 'Why this way, or why not done. Required to be substantive for unfinished statuses.' },
        background: { type: 'string', description: 'What the problem was.' },
        change: { type: 'string', description: 'What was actually changed.' },
        tradeoff: { type: 'string', description: 'Cost, or the restart condition for a shelved entry.' },
        repo: { type: 'string', description: 'Which repository this belongs to.' },
        commit: { type: 'string', description: 'Commit hash, if any.' },
        verify: { type: 'string', description: 'How it was verified.' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Search tags.' },
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
          message: { type: 'string' },
        },
        required: ['ok', 'message'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const root = readRoot(args)
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

      const outcome = manager.add({
        id: entryId,
        title: String(args.title),
        date: today,
        type: args.type,
        status: args.status,
        repo: typeof args.repo === 'string' && args.repo.length > 0 ? args.repo : '本仓',
        background: typeof args.background === 'string' && args.background.length > 0 ? args.background : String(args.title),
        change: typeof args.change === 'string' && args.change.length > 0 ? args.change : String(args.title),
        why: String(args.why),
        tradeoff: typeof args.tradeoff === 'string' && args.tradeoff.length > 0 ? args.tradeoff : '无',
        anchor: String(args.anchor),
        commit: typeof args.commit === 'string' && args.commit.length > 0 ? args.commit : 'HEAD',
        verify: typeof args.verify === 'string' && args.verify.length > 0 ? args.verify : '自动记录',
        keywords: Array.isArray(args.keywords) && args.keywords.length > 0 ? args.keywords.map(String) : [String(args.type)],
      })

      if (!outcome.success) {
        return { ok: false, root, message: '入册失败：' + String(outcome.error ?? '校验未通过') }
      }
      return { ok: true, root, entryId, message: `已入册 ${entryId}：${args.title}` }
    },
  }
}

function verifyTool() {
  return {
    name: 'ledger_verify',
    description:
      'Check that the code anchors of landed ledger entries still exist on disk. A missing anchor means an earlier fix may have been silently undone — this is the anti-regression check.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute repository root. Omit to use the nearest ledger above the process cwd.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          checked: { type: 'number' },
          missing: { type: 'array', items: { type: 'string' } },
          message: { type: 'string' },
        },
        required: ['ok', 'message'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const root = readRoot(args)
      const manager = new LedgerManager(root)
      const outcome = manager.verify()
      return {
        ok: outcome.ok,
        root,
        checked: outcome.oks.length + outcome.fails.length,
        missing: outcome.fails,
        message: outcome.ok
          ? `锚点体检通过：${outcome.oks.length} 处已落地锚点文件齐全。`
          : `发现 ${outcome.fails.length} 处锚点缺失：` + outcome.fails.join('；'),
      }
    },
  }
}

/* ------------------------------------------------------------ register -- */

/**
 * Register the ledger tools, degrading gracefully.
 *
 * The view and its routes are the primary feature; if this DSH build exposes
 * no `tools` service, the ledger must still be browsable. So a missing service
 * logs and returns false instead of throwing into apply().
 */
export function registerAgentTools(ctx, log = () => {}) {
  let tools
  try {
    tools = ctx.get('tools', false)
  } catch {
    tools = undefined
  }
  if (tools === undefined || tools === null || typeof tools.register !== 'function') {
    log('no tools service; ledger tools are unavailable in this build')
    return false
  }
  if (typeof ctx.effect !== 'function') {
    log('no effect service; refusing to register tools that cannot be disposed')
    return false
  }

  const specs = [bootstrapTool(ctx), searchTool(), addTool(), verifyTool()]
  let registered = 0
  for (const spec of specs) {
    try {
      ctx.effect(() => tools.register(spec, `memledger: ${spec.name}`), `memledger: ${spec.name}`)
      registered += 1
    } catch (cause) {
      log(`could not register ${spec.name}: ${messageOf(cause)}`)
    }
  }
  return registered === specs.length
}

export { PENDING }
