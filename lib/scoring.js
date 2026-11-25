// dsh-memledger — scoring engine and display helpers.
//
// Contains the scoring algorithm, configuration management, and compact
// formatting utilities used by multiple tool modules. Extracted from
// agent-tools.js.

import { anchorPathsOf } from './anchors.js'
import { STATUS_WEIGHT, DECAY_IMMUNE_STATUSES } from './schema.js'
import { modelRegistry, extractFeatures } from './ml-model.js'

// Default tuning constants. These can be overridden via plugin Config in
// cordis.patch.yml:
//
//   - id: dsh-memledger
//     name: dsh-memledger
//     config:
//       checkMaxEntries: 8
//       checkMaxChars: 1200
//       mapMaxChars: 6000
//       searchMaxChars: 1200
//       scoreThreshold: 0.1
//       halfLifeDays: 14
//
const DEFAULTS = {
  checkMaxEntries: 8,       // hard cap on entries returned per path
  checkMaxChars: 1200,      // hard cap on total message characters
  mapMaxChars: 6000,        // hard cap on the skeleton map message
  searchMaxChars: 1200,     // hard cap on a search answer
  scoreThreshold: 0.1,      // entries below this are folded into a count
  halfLifeDays: 14,         // time decay half-life
}

/** Active config — populated during registerAgentTools from ctx.config. */
let CFG = { ...DEFAULTS }

/**
 * Initialize CFG from the plugin's cordis config.
 * Called once during registerAgentTools.
 */
function initConfig(ctx) {
  try {
    const userConfig = ctx.config ?? {}
    for (const key of Object.keys(DEFAULTS)) {
      if (key in userConfig && typeof userConfig[key] === typeof DEFAULTS[key]) {
        CFG[key] = userConfig[key]
      }
    }
  } catch {
    // config reading is best-effort
  }
}

/**
 * Score an entry by status weight × anchor precision × time decay,
 * with optional ML fusion when the model is ready.
 *
 * ML integration:
 *   1. ruleScore = weight × anchorScore × timeDecay (always computed)
 *   2. If ML model is ready (≥ 20 samples), compute mlScore = model.predict(features)
 *   3. Fused score = ruleScore × 0.6 + mlScore × 0.4
 *   4. Negative-memory entries (搁置/已回退/已废弃) are protected: ML can only
 *      raise their score, never lower it.
 *
 * @param {object}  entry      – ledger entry
 * @param {string}  targetPath – the path being checked
 * @param {object}  [mlContext] – optional extra context for ML features
 * @param {string}  [root]     – workspace root to retrieve the ML model
 */
function scoreEntry(entry, targetPath, mlContext, root) {
  const weight = STATUS_WEIGHT[entry.status] ?? 0.3

  // Anchor precision: exact path > directory match > symbol-only
  const entryPaths = anchorPathsOf(entry.anchor)
  let anchorScore = 0.3
  for (const p of entryPaths) {
    if (p === targetPath) { anchorScore = 1.0; break }
    if (p.endsWith('/' + targetPath) || targetPath.endsWith('/' + p)) { anchorScore = 0.8; break }
    if (p.startsWith(targetPath + '/') || targetPath.startsWith(p + '/')) { anchorScore = 0.7 }
  }

  // Time decay: configurable half-life, but immune statuses don't decay
  let timeDecay = 1.0
  if (!DECAY_IMMUNE_STATUSES.has(entry.status) && entry.date) {
    const daysSince = Math.max(0, (Date.now() - new Date(entry.date).getTime()) / 86400000)
    timeDecay = Math.pow(0.5, daysSince / CFG.halfLifeDays)
  }

  const ruleScore = weight * anchorScore * timeDecay

  // ML fusion — only when model has enough training data
  if (root) {
    try {
      const model = modelRegistry.get(root)
      if (model && model.isReady) {
        const features = extractFeatures(entry, targetPath, {
          statusWeight: weight,
          anchorPrecision: anchorScore,
          timeDecay,
          ...(mlContext || {}),
        })
        const mlScore = model.predict(features)
        const fusedScore = ruleScore * 0.6 + mlScore * 0.4

        // Negative-memory entries: ML can only boost, never suppress
        if (DECAY_IMMUNE_STATUSES.has(entry.status)) {
          return Math.max(ruleScore, fusedScore)
        }
        return fusedScore
      }
    } catch {
      // ML is best-effort; fall through to pure rule score
    }
  }

  return ruleScore
}

/**
 * Extract ML features from a check scenario.
 *
 * This is a convenience wrapper around extractFeatures from ml-model.js,
 * computing the status/anchor/time dimensions from the entry and target path
 * so that callers (check.js, add.js) don't need to duplicate the logic.
 *
 * @param {object} entry      – ledger entry
 * @param {string} targetPath – the path being checked
 * @param {object} [context]  – extra context (repairCount, negativeCount, keywordOverlap, hasContract, bm25Affinity)
 * @returns {number[]} 8-dimensional feature vector
 */
function extractCheckFeatures(entry, targetPath, context) {
  const weight = STATUS_WEIGHT[entry.status] ?? 0.3

  const entryPaths = anchorPathsOf(entry.anchor)
  let anchorPrecision = 0.3
  for (const p of entryPaths) {
    if (p === targetPath) { anchorPrecision = 1.0; break }
    if (p.endsWith('/' + targetPath) || targetPath.endsWith('/' + p)) { anchorPrecision = 0.8; break }
    if (p.startsWith(targetPath + '/') || targetPath.startsWith(p + '/')) { anchorPrecision = 0.7 }
  }

  let timeDecay = 1.0
  if (!DECAY_IMMUNE_STATUSES.has(entry.status) && entry.date) {
    const daysSince = Math.max(0, (Date.now() - new Date(entry.date).getTime()) / 86400000)
    timeDecay = Math.pow(0.5, daysSince / CFG.halfLifeDays)
  }

  return extractFeatures(entry, targetPath, {
    statusWeight: weight,
    anchorPrecision,
    timeDecay,
    ...(context || {}),
  })
}

/**
 * Record a check feedback signal for ML online learning.
 *
 * Called from add.js when an entry that was previously surfaced by
 * ledger_check is later acted upon (positive) or force-overridden (negative).
 *
 * @param {string}  root     – workspace root
 * @param {string}  entryId  – the CL-… id of the entry
 * @param {boolean} adopted  – true = relevant (accepted), false = noise (force-overridden)
 */
function recordCheckFeedback(root, entryId, adopted) {
  // Feedback is processed in add.js via model.update() directly;
  // this function provides a stable API surface and can be extended
  // to persist feedback logs independently of the model.
  try {
    const model = modelRegistry.get(root)
    if (!model) return
    // The actual update(features, label) is done by the caller who has
    // access to the feature vector. This function is a bookkeeping hook
    // for future extensions (e.g., separate feedback log file).
  } catch {
    // best-effort
  }
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

  // 来源标签（多台账时）：不同台账的 CL 编号会撞车且含义不同，必须看得出哪本
  const src = entry.source ? `[${entry.source}]` : ''

  // For negative-memory statuses, append the core reason (critical for anti-rollback)
  if (DECAY_IMMUNE_STATUSES.has(entry.status) && entry.why) {
    const whySnip = entry.why.length > 35 ? entry.why.slice(0, 33) + '…' : entry.why
    return `${entry.id}[${icon}]${src} ${titleSnip}: ${whySnip}`
  }
  return `${entry.id}[${icon}]${src} ${titleSnip}`
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

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

export { DEFAULTS, CFG, initConfig, scoreEntry, indexLine, outlineOfMarkdown, messageOf, extractCheckFeatures, recordCheckFeedback }
