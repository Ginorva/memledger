import { readFileSync, existsSync } from 'node:fs'
import { LedgerEntry } from './types.js'
import { parseLedgerMarkdown } from './markdown-parser.js'

export function importExistingDocs(docPath: string): LedgerEntry[] {
  if (!existsSync(docPath)) {
    throw new Error(`指定的台账文档不存在: ${docPath}`)
  }

  const content = readFileSync(docPath, 'utf-8')
  // 如果已经是标准的变更台账格式，直接解析
  const entries = parseLedgerMarkdown(content)
  if (entries.length > 0) {
    return entries
  }

  // 兜底：如果不是标准 12 字段格式（如普通 CHANGELOG），尝试按 Markdown 标题分段提取
  const fallbackEntries: LedgerEntry[] = []
  const sections = content.split(/^##\s+/m).filter((s) => s.trim().length > 0)

  let count = 1
  const today = new Date().toISOString().slice(0, 10)
  const dayStr = today.replace(/-/g, '')

  for (const sec of sections) {
    const lines = sec.trim().split('\n')
    const title = lines[0].trim()
    const body = lines.slice(1).join('\n').trim()

    if (title.toLowerCase().includes('怎么用') || title.toLowerCase().includes('目录')) {
      continue
    }

    fallbackEntries.push({
      id: `CL-${dayStr}-${String(count++).padStart(2, '0')}`,
      title,
      date: today,
      type: '修复',
      status: '已落地',
      repo: '导入文档',
      background: '从已有历史文档导入',
      change: body || title,
      why: '历史文档记录',
      tradeoff: '无',
      anchor: '导入资产',
      commit: '无',
      verify: '人工核对',
      keywords: ['历史导入'],
    })
  }

  return fallbackEntries
}
