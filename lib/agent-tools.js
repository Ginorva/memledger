// dsh-memledger — agent tools.
//
// Registers the ledger tools the model can call. The shape follows dsh-unlag's
// working registration (ctx.tools.register(spec, label) inside ctx.effect, with
// a JSON-schema `parameters` and an `output.schema` plus `execute`), not a guess
// of my own.
//
// The point of these tools is iteration quality, not reporting: `ledger_check`
// answers "has this been done already, and has an earlier fix been reverted?"
// *before* the change, which is the only moment the answer is still cheap.
//
// Safety rules that are deliberate:
//
//  * Nothing here ever overwrites an existing ledger. `ledger_bootstrap`
//    refuses unless `force: true`, because scaffolding is destructive and a
//    real ledger with dozens of decisions is not a tool call's to discard.
//  * Creation requires an explicit `root`. Guessing a workspace before writing
//    files is how you write into the wrong repository.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { LedgerManager } from './ledger-manager.js'
import { parseLedgerMarkdown } from './markdown-parser.js'
import { scanGitHistory, convertGitCommitsToLedger } from './scanner-git.js'
import { importExistingDocs } from './scanner-docs.js'
import { anchorPathsOf, anchorStatus, normalizePath, samePath, symbolOf } from './anchors.js'
import { MAP_RELATIVE, scanCodebaseMap, updateProjectMapFile } from './scanner-map.js'
import { STATUS_WEIGHT, DECAY_IMMUNE_STATUSES } from './schema.js'
import { statsRegistry } from './stats.js'
import {
  createRequirement,
  isValidRequirementId,
  linkSubitem,
  listRequirements,
  requirementPath,
  requirementsDir,
  REQUIREMENT_STATUSES,
} from './requirements.js'

const LEDGER_RELATIVE = join('docs', '变更台账.md')
const PENDING = ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中']

/* ---- v2: scoring engine ---- */

const CHECK_MAX_ENTRIES = 8      // hard cap on entries returned per path
const CHECK_MAX_CHARS = 1200     // hard cap on total message characters
const MAP_MAX_CHARS = 6000       // hard cap on the skeleton map message
const SEARCH_MAX_CHARS = 1200    // hard cap on a search answer
const SCORE_THRESHOLD = 0.1      // entries below this are folded into a count
const HALF_LIFE_DAYS = 14        // time decay half-life

/**
 * Score an entry by status weight × anchor precision × time decay.
 * Higher score = more relevant to surface.
 */
function scoreEntry(entry, targetPath) {
  const weight = STATUS_WEIGHT[entry.status] ?? 0.3

  // Anchor precision: exact path > directory match > symbol-only
  const entryPaths = anchorPathsOf(entry.anchor)
  let anchorScore = 0.3
  for (const p of entryPaths) {
    if (p === targetPath) { anchorScore = 1.0; break }
    if (p.endsWith('/' + targetPath) || targetPath.endsWith('/' + p)) { anchorScore = 0.8; break }
    if (p.startsWith(targetPath + '/') || targetPath.startsWith(p + '/')) { anchorScore = 0.7 }
  }

  // Time decay: half-life of 14 days, but immune statuses don't decay
  let timeDecay = 1.0
  if (!DECAY_IMMUNE_STATUSES.has(entry.status) && entry.date) {
    const daysSince = Math.max(0, (Date.now() - new Date(entry.date).getTime()) / 86400000)
    timeDecay = Math.pow(0.5, daysSince / HALF_LIFE_DAYS)
  }

  return weight * anchorScore * timeDecay
}

/**
 * Build a compact index line for an entry (≤80 chars).
 * Includes status icon, title snippet, and core reason for non-landed entries.
 */
function indexLine(entry) {
  const icon = {
    '搁置': '⚠搁置', '已回退': '⚠回退', '已废弃': '⚠废弃',
    '进行中': '🔵进行中', '待验证': '🟡待验证', '未做': '⚪未做',
    '已落地': '✓落地',
  }[entry.status] || entry.status

  const titleSnip = entry.title.length > 30 ? entry.title.slice(0, 28) + '…' : entry.title

  // For negative-memory statuses, append the core reason (critical for anti-rollback)
  if (DECAY_IMMUNE_STATUSES.has(entry.status) && entry.why) {
    const whySnip = entry.why.length > 35 ? entry.why.slice(0, 33) + '…' : entry.why
    return `${entry.id}[${icon}] ${titleSnip}: ${whySnip}`
  }
  return `${entry.id}[${icon}] ${titleSnip}`
}

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Fold a full skeleton map into a file-level outline that fits a budget.
 *
 * The full map always lands in docs/项目结构.md; only the *tool message* costs
 * context, so the message keeps the topology (which files exist, how heavy they
 * are) and drops the signatures. `scope=` gets the signatures back one file or
 * directory at a time — the layered index/detail split from the v2 report.
 */
function outlineOfMarkdown(fullMarkdown, budget) {
  const lines = fullMarkdown.split('\n')
  const header = []
  const files = []
  let current = null
  for (const line of lines) {
    const heading = /^### `([^`]+)` \((\d+) 行\)$/.exec(line)
    if (heading) {
      current = { path: heading[1], lineCount: heading[2], symbols: 0 }
      files.push(current)
      continue
    }
    const config = /^-\s+\*\*`([^`]+)`\*\*: 关键入口\/配置 \((\d+) 行\)$/.exec(line)
    if (config) {
      files.push({ path: config[1], lineCount: config[2], symbols: 0 })
      current = null
      continue
    }
    if (current === null) {
      // The outline supplies its own section heading; keeping the original one
      // would read as two competing "here is the map" titles.
      if (line.startsWith('## 📂')) continue
      header.push(line)
      continue
    }
    const more = /^-\s+\*\.\.\. 还有 (\d+) 个符号\*$/.exec(line)
    if (more) {
      current.symbols += Number(more[1])
      continue
    }
    if (line.startsWith('- `')) current.symbols += 1
  }

  const rows = []
  let used = header.join('\n').length + 220
  let listed = 0
  for (const file of files) {
    const row = `- \`${file.path}\` (${file.lineCount} 行 · ${file.symbols} 符号)`
    if (used + row.length + 1 > budget) break
    rows.push(row)
    used += row.length + 1
    listed += 1
  }
  const rest = files.length - listed
  const body = [
    header.join('\n').trimEnd(),
    '',
    '## 📁 文件清单（符号已折叠）',
    '',
    ...rows,
  ]
  if (rest > 0) body.push(`- …另有 ${rest} 个文件（用 \`scope=<目录>\` 逐个查看）`)
  return body.join('\n')
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
/**
 * The workspace the calling session was opened in, if the harness tells us.
 *
 * The DSH host process itself may run with a completely different cwd
 * (the profile directory), so `process.cwd()` is *not* the user's workspace.
 * Tool execution receives the owning agent as `exec.agent`, whose session
 * header carries the real cwd.
 */
function sessionRoot(exec) {
  try {
    const cwd = exec?.agent?.session?.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) return resolve(cwd)
  } catch {
    // fall through — cwd is a best-effort signal
  }
  return undefined
}

/**
 * Resolve a root for a read-only call.
 *
 * Reading may guess (an upward walk that finds a ledger); writing may not, so
 * the creation path uses explicitRoot and refuses when it is absent.
 */
function readRoot(args, exec) {
  const named = explicitRoot(args)
  if (named !== undefined) return named
  const base = sessionRoot(exec) ?? process.cwd()
  let cursor = base
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(cursor, LEDGER_RELATIVE)) || existsSync(join(cursor, MAP_RELATIVE))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return base
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

function mapTool() {
  // v3: Content-hash cache using MD5 for reliable change detection
  let lastMapHash = ''

  return {
    name: 'ledger_map',
    description:
      '生成/刷新代码骨架地图（docs/项目结构.md）。默认只回文件清单，用 scope 取某个文件或目录的符号签名。改代码前用它定位，不要全盘扫。',
    parameters: {
      type: 'object',
      properties: {
        _: { type: 'boolean' },
        root: {
          type: 'string',
          description: '仓库根目录；省略则从 cwd 向上找。',
        },
        refresh: {
          type: 'boolean',
          description: '是否写入 docs/项目结构.md（默认 true）。',
        },
        scope: {
          type: 'string',
          description: '只看某个文件/目录的骨架；省略给全量。',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          mapPath: { type: 'string' },
          fileCount: { type: 'number' },
          symbolCount: { type: 'number' },
          cached: { type: 'boolean' },
          budgeted: { type: 'boolean' },
          summary: { type: 'string' },
          result: { type: 'string' },
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
      stats.recordCall('ledger_map')
      const scope = typeof args?.scope === 'string' && args.scope.length > 0 ? normalizePath(args.scope) : null
      const result = updateProjectMapFile(root, {})

      if (!result.ok) {
        stats.recordMapResult(false)
        return {
          ok: false,
          root,
          fileCount: result.fileCount,
          symbolCount: result.symbolCount,
          message: `❌ 生成代码骨架地图失败: ${result.error}`,
        }
      }

      const mapPath = result.path
      const fullMarkdown = result.markdown

      // v3: Use MD5 content hash for reliable change detection
      const contentHash = createHash('md5').update(fullMarkdown).digest('hex')
      if (!scope && contentHash === lastMapHash) {
        stats.recordMapResult(true)
        return {
          ok: true,
          root,
          mapPath,
          fileCount: result.fileCount,
          symbolCount: result.symbolCount,
          cached: true,
          summary: `${result.fileCount} 模块, ${result.symbolCount} 符号`,
          result: stats.toCompactSummary(),
          message: `🗺️ 项目结构未变化（${result.fileCount} 模块, ${result.symbolCount} 符号）。无需重复查看。`,
        }
      }
      lastMapHash = contentHash
      stats.recordMapResult(false)

      // v2: If scope is specified, filter to only relevant files
      let outputMarkdown = fullMarkdown
      if (scope) {
        const lines = fullMarkdown.split('\n')
        const filtered = []
        let inRelevantSection = false
        let headerCount = 0
        for (const line of lines) {
          // Keep the document header
          if (headerCount < 8) { filtered.push(line); headerCount++; continue }

          if (line.startsWith('### `')) {
            const pathMatch = line.match(/^### `([^`]+)`/)
            if (pathMatch) {
              const filePath = normalizePath(pathMatch[1])
              inRelevantSection = samePath(filePath, scope) ||
                filePath.startsWith(scope + '/') || scope.startsWith(filePath + '/')
            } else {
              inRelevantSection = false
            }
          }
          if (line.startsWith('- **`') && line.includes('`**:')) {
            const pathMatch = line.match(/`([^`]+)`/)
            if (pathMatch) {
              const filePath = normalizePath(pathMatch[1])
              inRelevantSection = samePath(filePath, scope)
            }
          }

          if (inRelevantSection) filtered.push(line)
        }
        outputMarkdown = filtered.length > headerCount
          ? filtered.join('\n')
          : `（scope="${scope}" 未匹配到骨架条目，可能不是代码文件）`
      }

      const summary = `${result.fileCount} 模块, ${result.symbolCount} 符号`
      const headline = scope
        ? `🗺️ **[局部骨架]** scope=\`${scope}\` | ${summary}`
        : `🗺️ **[项目骨架地图]** ${summary} | \`${mapPath}\``

      // Budget: the full map is on disk either way; the message is the part
      // that eats context. Over budget, send the file-level outline instead and
      // point at `scope=` for signatures.
      let message = headline + '\n\n' + outputMarkdown
      let budgeted = false
      if (!scope && outputMarkdown.length > MAP_MAX_CHARS) {
        budgeted = true
        message =
          `${headline}\n\n${outlineOfMarkdown(outputMarkdown, MAP_MAX_CHARS - 500)}` +
          `\n\n> 📦 完整骨架 ${outputMarkdown.length} 字符已折叠为文件清单（${result.fileCount} 个文件 / ${result.symbolCount} 个符号）。` +
          `用 \`scope=<目录或文件>\` 取局部符号，或直接读 \`${mapPath}\`。`
      }

      return {
        ok: true,
        root,
        mapPath,
        fileCount: result.fileCount,
        symbolCount: result.symbolCount,
        cached: false,
        budgeted,
        summary,
        result: stats.toCompactSummary(),
        message,
      }
    },
  }
}

function bootstrapTool(ctx) {
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

function searchTool() {
  return {
    name: 'ledger_search',
    description:
      '按关键词、错误特征或代码锚点检索历史决策（未决与已回退优先）。默认回索引行；需要原因时传 detail=true。改到可能被前文决策覆盖的代码前先查。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录；省略则从 cwd 向上找。' },
        query: { type: 'string', description: '关键词、报错特征、文件路径或符号。' },
        status: { type: 'string', enum: ['pending', '已落地', '进行中', '待验证', '搁置', '未做', '已回退', '已废弃'], description: '只看某个状态；pending=所有未完成。' },
        anchor: { type: 'string', description: '按锚点包含的字符串过滤。' },
        limit: { type: 'number', description: '最多返回几条（默认 10）。' },
        detail: { type: 'boolean', description: '展开每条的原因/锚点/日期；默认只给索引行。' },
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
      let message = detail
        ? `命中 ${results.length} 条：\n` +
          results
            .map((entry) =>
              [
                `${entry.id}[${entry.status}] ${entry.title}`,
                `  锚点: ${entry.anchor}`,
                `  日期: ${entry.date}`,
                `  为什么: ${entry.why}`,
              ].join('\n'),
            )
            .join('\n')
        : `命中 ${results.length} 条：\n` + results.map((entry) => '  ' + indexLine(entry)).join('\n')
      if (!detail) message += '\n（需要原因/锚点/日期时传 detail=true）'
      if (message.length > SEARCH_MAX_CHARS) {
        message = message.slice(0, SEARCH_MAX_CHARS - 30) + '\n…(已截断，用 limit/status 缩小范围)'
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
          requirement: entry.requirement,
          why: entry.why,
          date: entry.date,
        })),
        message,
      }
    },
  }
}

function addTool() {
  return {
    name: 'ledger_add',
    description:
      '追加一条决策记录（为什么这样做）。落地、否决、搁置都要记；routine 改动（格式/注释/依赖升级）跳过。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录；省略则从 cwd 向上找。' },
        title: { type: 'string', description: '一行概括这次改动/决策。' },
        type: { type: 'string', enum: ['修复', '新功能', '重构', '口径', '部署', '决策', '埋点', '演练', '文档'], description: '条目类型。' },
        status: { type: 'string', enum: ['已落地', '进行中', '待验证', '搁置', '未做', '已回退', '已废弃'], description: '当前状态。' },
        anchor: { type: 'string', description: '代码锚点：path/to/file.py::symbol。' },
        why: { type: 'string', description: '为什么这样做/为什么不做；未完成状态必须写足。' },
        background: { type: 'string', description: '问题是什么。' },
        change: { type: 'string', description: '实际改了什么。' },
        tradeoff: { type: 'string', description: '代价；搁置条目写重启条件。' },
        repo: { type: 'string', description: '所属仓库。' },
        commit: { type: 'string', description: '提交哈希（有则填）。' },
        verify: { type: 'string', description: '怎么验证的。' },
        keywords: { type: 'array', items: { type: 'string' }, description: '检索标签。' },
        requirement: {
          type: 'string',
          description:
            '所属需求 id（RQ-YYYYMMDD-NN），需求文档须先用 ledger_requirement 建好。同一需求内多轮改同一函数不算重复。',
        },
        force: {
          type: 'boolean',
          description: '同锚点+符号已有未完成条目时仍要记录；仅在结论确实不同时用，并在 why 里说明差异。',
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
        stats.recordAddResult(false, false)
        return { ok: false, root, message: '入册失败：' + String(outcome.error ?? '校验未通过') }
      }
      stats.recordAddResult(true, false)
      let linkNote = ''
      if (requirement.length > 0) {
        const link = linkSubitem(root, requirement, entryId, String(args.title), String(args.status) === '已落地')
        linkNote = link.ok
          ? `\n已挂到需求 ${requirement} 的子项清单。`
          : `\n（需求子项挂载失败：${link.reason}）`
      }
      return {
        ok: true,
        root,
        entryId,
        message: `已入册 ${entryId}：${args.title}` + continuationNote + linkNote,
      }
    },
  }
}

function requirementTool() {
  return {
    name: 'ledger_requirement',
    description:
      '把一条诉求规范化成需求文档（docs/需求/RQ-YYYYMMDD-NN.md），台账条目可挂为它的子项，形成目录与跨仓连接键。多改动、跨仓、或有事后验收口径时，在第一次 ledger_add 前先建。ask 保留原话，规范化写进 scope/acceptance/notDoing。',
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

function verifyTool() {
  return {
    name: 'ledger_verify',
    description:
      '锚点体检：已落地条目的代码是否还在。锚点缺失说明早前的修复可能被静默改没——这是防回退的检查。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录；省略则从 cwd 向上找。' },
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
          warnings: { type: 'array', items: { type: 'string' } },
          unverifiable: { type: 'array', items: { type: 'string' } },
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
      stats.recordCall('ledger_verify')
      const manager = new LedgerManager(root)
      const outcome = manager.verify()
      const unknown = outcome.unknown ?? []
      const warns = outcome.warns ?? []
      stats.recordVerifyResult(outcome.fails.length)
      const parts = []
      if (outcome.ok) parts.push(`锚点体检通过：${outcome.oks.length} 处已落地锚点文件齐全。`)
      else parts.push(`发现 ${outcome.fails.length} 处锚点缺失：` + outcome.fails.join('；'))
      if (unknown.length > 0) parts.push(`${unknown.length} 处锚点指向其它仓库，本仓无法核验（不计为倒车）。`)
      if (warns.length > 0) {
        const shown = warns.slice(0, 4).join('；') + (warns.length > 4 ? `；…另 ${warns.length - 4} 条` : '')
        parts.push(`⚠️ ${warns.length} 处提醒：${shown}`)
      }
      return {
        ok: outcome.ok,
        root,
        checked: outcome.oks.length + outcome.fails.length,
        missing: outcome.fails,
        warnings: warns,
        unverifiable: unknown,
        message: parts.join(' '),
      }
    },
  }
}

/* --------------------------------------------------------------- check -- */

function checkTool() {
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

      const targets = Array.isArray(args?.paths)
        ? args.paths.map((value) => normalizePath(value)).filter((value) => value.length > 0)
        : []
      if (targets.length === 0) {
        return { ok: false, root, hasLedger, risky: 0, verdicts: [], message: 'ledger_check 需要至少一个 paths 条目。' }
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

        // v2: Score and sort entries, apply threshold
        const scored = matched.map((entry) => {
          const paths = anchorPathsOf(entry.anchor)
          const status = anchorStatus(root, paths)
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
            _score: scoreEntry(entry, target),
          }
        }).sort((a, b) => b._score - a._score)

        // Split into surfaced vs folded
        const surfaced = scored.filter((e) => e._score >= SCORE_THRESHOLD).slice(0, CHECK_MAX_ENTRIES)
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
        const repeatedSymbol = [...bySymbol.values()].some((count) => count >= 2)

        let verdict = 'unrecorded'
        if (deadLanded.length > 0) verdict = 'rollback-risk'
        else if (repeatedSymbol) verdict = 'repeated-repair'
        else if (liveLanded.length > 0) verdict = 'already-done'
        else if (pendingEntries.length > 0) verdict = 'shelved'
        else if (foreignLanded.length > 0) verdict = 'foreign-anchor'

        verdicts.push({ path: target, verdict, entries: shaped, ...(foldedCount > 0 ? { folded: foldedCount } : {}) })
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
      if (message.length > CHECK_MAX_CHARS) {
        message = message.slice(0, CHECK_MAX_CHARS - 30) + '\n…(已截断，用 ledger_search 查完整记录)'
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

/* ------------------------------------------------------------ register -- */

/**
 * Register the ledger tools, degrading gracefully.
 *
 * Tools are the whole product now — the dashboard half is gone. If this DSH
 * build exposes no `tools` service there is nothing useful left to do, so a
 * missing service logs and returns false instead of throwing into apply().
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

  const specs = [mapTool(), checkTool(), searchTool(), addTool(), requirementTool(), verifyTool(), bootstrapTool(ctx)]
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
