// requirements.js — the layer above ledger entries.
//
// A requirement is a *living* document (status, checklist, acceptance criteria)
// while the ledger stays append-only evidence. The join key is the requirement
// id (RQ-YYYYMMDD-NN), written on both sides: the requirement lists its child
// entries, and every child entry names its requirement.
//
// Why the id and not a shared directory: a single request can touch several
// repositories, and each repository keeps its own ledger file. Moving history
// between ledgers is forbidden (append-only), so the id is what reassembles one
// request's history across files without rewriting anything.
//
// One requirement per file, named exactly `<id>.md`, so the auto-generated index
// can link to it deterministically without knowing a title or a slug.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const REQUIREMENTS_RELATIVE = join('docs', '需求')
export const REQUIREMENT_ID_RE = /^RQ-\d{8}-\d{2}$/
export const REQUIREMENT_STATUSES = ['进行中', '已交付', '搁置', '已废弃']

const FILE_RE = /^(RQ-\d{8}-\d{2})\.md$/
const SUBITEM_RE = /^-\s+\[([ xX])\]\s+(CL-\d{8}-\d+)\s*(.*)$/gm

export function isValidRequirementId(id) {
  return typeof id === 'string' && REQUIREMENT_ID_RE.test(id)
}

export function requirementsDir(root) {
  return join(root, REQUIREMENTS_RELATIVE)
}

export function requirementPath(root, id) {
  return join(requirementsDir(root), `${id}.md`)
}

export function hasRequirement(root, id) {
  return isValidRequirementId(id) && existsSync(requirementPath(root, id))
}

/** Next free id for a given day, e.g. RQ-20261117-02. */
export function nextRequirementId(root, date) {
  const day = String(date ?? '').replace(/-/g, '')
  const dir = requirementsDir(root)
  let max = 0
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const match = FILE_RE.exec(name)
      if (match !== null && match[1].slice(3, 11) === day) {
        max = Math.max(max, Number(match[1].slice(12)))
      }
    }
  }
  return `RQ-${day}-${String(max + 1).padStart(2, '0')}`
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function bullet(label, value) {
  return `- **${label}**：${clean(value) || '—'}`
}

function quote(text) {
  const body = clean(text)
  if (body.length === 0) return ['> （未提供原文）']
  return body.split(/\r?\n/).map((line) => `> ${line}`)
}

export function renderRequirement(input) {
  const status = clean(input.status) || '进行中'
  return [
    `# ${input.id} · ${clean(input.title)}`,
    '',
    bullet('状态', status),
    bullet('提出', clean(input.date)),
    bullet('仓', clean(input.repo) || '本仓'),
    '',
    '## 1. 原始诉求（逐字保留）',
    '',
    '> 原文照抄，不做润色。规范化可以删噪声，但不能替我补上我没说过的话。',
    '',
    ...quote(input.ask),
    '',
    '## 2. 规范化需求',
    '',
    bullet('范围', input.scope),
    bullet('验收口径', input.acceptance),
    bullet('明确不做', input.notDoing),
    '',
    '## 3. 子项（台账条目）',
    '',
    '> 由 `ledger_add` 的 `requirement` 参数自动挂到这里。子项打勾 = 该条目状态为「已落地」；',
    '> 需求要收口时，先确认这里没有「[ ]」，否则说明还有待验证/进行中的子项。',
    '',
    '## 4. 代码与提交',
    '',
    bullet('分支', input.branch),
    bullet('commit', input.commits),
    '',
  ].join('\n')
}

/**
 * Create a requirement document. Refuses to overwrite: a requirement that
 * already exists is a decision record, not a scratch file.
 */
export function createRequirement(root, input) {
  const title = clean(input?.title)
  if (title.length === 0) return { ok: false, reason: '需求标题不能为空' }

  const date = clean(input?.date) || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, reason: `日期格式错误：${date}（需 YYYY-MM-DD）` }
  }

  const status = clean(input?.status) || '进行中'
  if (REQUIREMENT_STATUSES.indexOf(status) === -1) {
    return { ok: false, reason: `非法需求状态：${status}（可选：${REQUIREMENT_STATUSES.join(' / ')}）` }
  }

  const id = clean(input?.id) || nextRequirementId(root, date)
  if (!isValidRequirementId(id)) {
    return { ok: false, reason: `需求 ID 格式错误：${id}（需 RQ-YYYYMMDD-NN）` }
  }

  const path = requirementPath(root, id)
  if (existsSync(path)) {
    return { ok: false, reason: `需求已存在，拒绝覆盖：${id}` }
  }

  mkdirSync(requirementsDir(root), { recursive: true })
  writeFileSync(path, renderRequirement({ ...input, id, title, date, status }), 'utf-8')
  return { ok: true, id, path, status }
}

export function parseRequirementText(text, fallbackId = '') {
  const titleMatch = /^#\s+(RQ-\d{8}-\d{2})\s*·\s*(.+?)\s*$/m.exec(text)
  const statusMatch = /^-\s+\*\*状态\*\*：(.+?)\s*$/m.exec(text)
  const subitems = []
  SUBITEM_RE.lastIndex = 0
  let match
  while ((match = SUBITEM_RE.exec(text)) !== null) {
    subitems.push({ id: match[2], open: match[1] === ' ', title: match[3].trim() })
  }
  return {
    id: titleMatch !== null ? titleMatch[1] : fallbackId,
    title: titleMatch !== null ? titleMatch[2].trim() : '',
    status: statusMatch !== null ? statusMatch[1].trim() : '未知',
    subitems,
  }
}

export function listRequirements(root) {
  const dir = requirementsDir(root)
  if (!existsSync(dir)) return []
  const found = []
  for (const name of readdirSync(dir)) {
    const match = FILE_RE.exec(name)
    if (match === null) continue
    try {
      const text = readFileSync(join(dir, name), 'utf-8')
      found.push({ ...parseRequirementText(text, match[1]), path: join(dir, name) })
    } catch {
      found.push({ id: match[1], title: '', status: '读取失败', subitems: [], path: join(dir, name) })
    }
  }
  return found.sort((a, b) => b.id.localeCompare(a.id))
}

/**
 * Append one child entry to the requirement's checklist.
 *
 * Idempotent by entry id: adding the same entry twice never duplicates the line.
 * Landed entries get a checked box, everything else stays open.
 */
export function linkSubitem(root, requirementId, entryId, title, done) {
  if (!hasRequirement(root, requirementId)) {
    return { ok: false, reason: `需求 ${requirementId} 不存在` }
  }
  const path = requirementPath(root, requirementId)
  const text = readFileSync(path, 'utf-8')
  if (text.indexOf(entryId) !== -1) {
    return { ok: true, path, skipped: true }
  }

  const line = `- [${done ? 'x' : ' '}] ${entryId} ${clean(title)}`.trimEnd()
  const anchor = text.indexOf('## 4.')
  const next = anchor === -1
    ? `${text.trimEnd()}\n\n${line}\n`
    : `${text.slice(0, anchor).trimEnd()}\n\n${line}\n\n${text.slice(anchor)}`
  writeFileSync(path, next, 'utf-8')
  return { ok: true, path, skipped: false }
}
