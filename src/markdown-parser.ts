import { LedgerEntry, LedgerStatus, LedgerType } from './types.js'
import { STATUS_PRIORITY, PENDING_STATUSES } from './schema.js'

export const ENTRY_BEGIN = '<!-- 条目:BEGIN -->'
export const ENTRY_END = '<!-- 条目:END -->'
export const INDEX_BEGIN = '<!-- 决策索引:BEGIN -->'
export const INDEX_END = '<!-- 决策索引:END -->'

const HEADING_RE = /^###\s+(CL-\d{8}-\d+)\s+·\s+(.+?)\s*$/
const FIELD_RE = /^-\s+\*\*(.+?)\*\*：(.*?)\s*$/

export function parseLedgerMarkdown(content: string): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  const lines = content.split('\n')

  let curId: string | null = null
  let curTitle: string | null = null
  let curFields: Record<string, string> = {}
  let curLine = 0

  function commitCurrent() {
    if (curId && curTitle) {
      const rawKeywords = curFields['关键词'] || ''
      const keywords = rawKeywords
        .split(/[,，;；]/)
        .map((k) => k.trim())
        .filter(Boolean)

      entries.push({
        id: curId,
        title: curTitle,
        date: curFields['日期'] || '',
        type: (curFields['类型'] || '修复') as LedgerType,
        status: (curFields['状态'] || '已落地') as LedgerStatus,
        repo: curFields['仓'] || '包装仓',
        background: curFields['背景'] || '',
        change: curFields['改动'] || '',
        why: curFields['为什么'] || '',
        tradeoff: curFields['取舍'] || '',
        anchor: curFields['锚点'] || '',
        commit: curFields['commit'] || '',
        verify: curFields['验收'] || '',
        keywords,
        lineNo: curLine,
      })
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const hm = HEADING_RE.exec(line)
    if (hm) {
      commitCurrent()
      curId = hm[1]
      curTitle = hm[2]
      curFields = {}
      curLine = idx + 1
      continue
    }

    const fm = FIELD_RE.exec(line)
    if (fm && curId) {
      curFields[fm[1].trim()] = fm[2].trim()
    }
  }

  commitCurrent()
  return entries
}

export function formatEntryBlock(entry: LedgerEntry): string {
  const kw = entry.keywords.join(', ')
  return [
    `### ${entry.id} · ${entry.title}`,
    '',
    `- **日期**：${entry.date}`,
    `- **类型**：${entry.type}`,
    `- **状态**：${entry.status}`,
    `- **仓**：${entry.repo}`,
    `- **背景**：${entry.background}`,
    `- **改动**：${entry.change}`,
    `- **为什么**：${entry.why}`,
    `- **取舍**：${entry.tradeoff || '无'}`,
    `- **锚点**：${entry.anchor}`,
    `- **commit**：${entry.commit || '无'}`,
    `- **验收**：${entry.verify || '无'}`,
    `- **关键词**：${kw}`,
    '',
  ].join('\n')
}

export function buildDecisionIndex(entries: LedgerEntry[]): string {
  // 排序：未决优先，同优先级按日期倒序
  const sorted = [...entries].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 99
    const pb = STATUS_PRIORITY[b.status] ?? 99
    if (pa !== pb) return pa - pb
    return (b.date || '').localeCompare(a.date || '')
  })

  // A 速查表
  const linesA = [
    '### 1.1 速查表（全部条目，未决在前，点击直跳）',
    '',
    '| ID | 日期 | 状态 | 类型 | 标题 | 锚点 |',
    '|---|---|---|---|---|---|',
  ]
  for (const e of sorted) {
    const slug = `${e.id.toLowerCase()}-${e.title.toLowerCase().replace(/[\s\/:*?"<>|]+/g, '-')}`
    linesA.push(`| [${e.id}](#${slug}) | ${e.date} | \`${e.status}\` | ${e.type} | ${e.title} | \`${e.anchor}\` |`)
  }

  // B 未决清单
  const pending = sorted.filter((e) => PENDING_STATUSES.has(e.status))
  const linesB = [
    '',
    '### 1.2 未决清单（未做 / 搁置 / 待验证 / 已回退 · 必看为什么）',
    '',
    '| ID | 状态 | 标题 | 为什么没做 / 回退原因 | 重启条件 |',
    '|---|---|---|---|---|',
  ]
  for (const e of pending) {
    const why = e.why ? e.why.replace(/[\r\n|]/g, ' ') : '—'
    const tradeoff = e.tradeoff ? e.tradeoff.replace(/[\r\n|]/g, ' ') : '—'
    linesB.push(`| ${e.id} | \`${e.status}\` | ${e.title} | ${why} | ${tradeoff} |`)
  }

  return [...linesA, ...linesB].join('\n')
}
