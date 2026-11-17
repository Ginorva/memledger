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
      'Generate, refresh, or inspect the compact codebase skeleton map (classes, exported functions, signatures) of the workspace. Call this before exploring or modifying code to avoid expensive full-repo scans and hallucinating project topology.',
    parameters: {
      type: 'object',
      properties: {
        _: { type: 'boolean' },
        root: {
          type: 'string',
          description: 'Absolute path to workspace root. If omitted, traverses upward from cwd to locate project root.',
        },
        refresh: {
          type: 'boolean',
          description: 'Write the updated skeleton map to docs/项目结构.md. Default true.',
        },
        scope: {
          type: 'string',
          description: 'Optional file or directory path to return only a partial skeleton for. Omit for the full map.',
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

      return {
        ok: true,
        root,
        mapPath,
        fileCount: result.fileCount,
        symbolCount: result.symbolCount,
        cached: false,
        summary,
        result: stats.toCompactSummary(),
        message: headline + '\n\n' + outputMarkdown,
      }
    },
  }
}

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
        requirement: {
          type: 'string',
          description:
            'Requirement id (RQ-YYYYMMDD-NN) this change belongs to. The requirement file must already exist under docs/需求/ — create it with ledger_requirement first. Entries sharing one requirement are sub-items of the same request, so the duplicate-symbol guard is relaxed within it (a second round on the same function is a follow-up, not a re-do).',
        },
        force: {
          type: 'boolean',
          description: 'Record even though the same anchor and symbol already has an outstanding entry. Only when the new decision genuinely differs from the earlier one; say how in `why`.',
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
      'Turn a user request into a normalized requirement document (docs/需求/RQ-YYYYMMDD-NN.md). Ledger entries then attach to it as sub-items, giving the ledger a table of contents and a join key that survives multi-repository work. Create one before the first `ledger_add` when the request needs more than one entry, crosses repositories, or has acceptance criteria to verify later. Keep the raw ask verbatim in `ask`; put the normalized version in scope/acceptance/notDoing.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute repository root. Omit to use the session workspace.' },
        action: { type: 'string', enum: ['create', 'list'], description: 'create a requirement document, or list the ones this workspace has.' },
        title: { type: 'string', description: 'One-line title, in the user\'s words where possible.' },
        id: { type: 'string', description: 'Optional explicit id (RQ-YYYYMMDD-NN); defaults to the next free id for the date.' },
        date: { type: 'string', description: 'YYYY-MM-DD; defaults to today.' },
        status: { type: 'string', enum: REQUIREMENT_STATUSES, description: 'Initial status; defaults to 进行中.' },
        ask: { type: 'string', description: 'The original wording of the request, verbatim. Never paraphrase here.' },
        scope: { type: 'string', description: 'Normalized scope: what this request actually covers.' },
        acceptance: { type: 'string', description: 'How completion will be judged — the thing later entries are verified against.' },
        notDoing: { type: 'string', description: 'Explicitly out of scope. This is what keeps a normalized requirement from growing promises the user never made.' },
        repo: { type: 'string', description: 'Owning repository, if it is not the workspace itself.' },
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
      'Call this BEFORE changing code. Given the files you are about to touch, it reports what the ledger already decided about them: whether a landed change already covers this code (do not redo it), whether an earlier fix is no longer present in the file (the fix was reverted, do not repeat the same hole), or whether a plan was shelved and should stay shelved until its restart condition holds.',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Absolute repository root. Omit to use the nearest ledger above the process cwd.' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files or directories you are about to change, absolute or repo-relative. Backslashes and forward slashes both work.',
        },
        query: { type: 'string', description: 'Optional extra keyword to widen the search (an error signature, a symbol, a domain word).' },
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
