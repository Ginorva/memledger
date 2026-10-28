import { LedgerEntry, SearchOptions } from './types.js'
import { PENDING_STATUSES } from './schema.js'

export interface Mem0Message {
  role: 'user' | 'assistant'
  content: string
}

export interface Mem0MemoryItem {
  id: string
  memory: string
  metadata: {
    entryId: string
    title: string
    type: string
    status: string
    anchor: string
    keywords: string[]
    commit?: string
    isPending: boolean
  }
}

export class Mem0Adapter {
  private inMemoryIndex: Map<string, LedgerEntry> = new Map()

  /**
   * 将一条台账转换为供 Mem0 记忆引擎消化的标准自然语言语义
   */
  public toMem0Payload(entry: LedgerEntry): { content: string; metadata: Record<string, any> } {
    const isPending = PENDING_STATUSES.has(entry.status)
    const actionVerb = isPending ? `决议【${entry.status}】` : `已完成落地【${entry.type}】`

    const content = [
      `[台账记录 ${entry.id}] 模块/锚点: ${entry.anchor}。`,
      `事项: ${entry.title} (${actionVerb})。`,
      `背景与根因: ${entry.background}`,
      `处理方式: ${entry.change}`,
      `决策原因(Why): ${entry.why}`,
      entry.tradeoff ? `取舍与重启条件: ${entry.tradeoff}` : '',
      `关联提交: ${entry.commit || '无'}`,
    ]
      .filter(Boolean)
      .join(' ')

    return {
      content,
      metadata: {
        entryId: entry.id,
        title: entry.title,
        type: entry.type,
        status: entry.status,
        anchor: entry.anchor,
        keywords: entry.keywords,
        commit: entry.commit,
        isPending,
      },
    }
  }

  /**
   * 加载台账条目建立本地认知索引
   */
  public loadEntries(entries: LedgerEntry[]): void {
    this.inMemoryIndex.clear()
    for (const e of entries) {
      this.inMemoryIndex.set(e.id, e)
    }
  }

  /**
   * 智能检索：融合代码锚点、未决状态、关键词与语义匹配
   */
  public search(options: SearchOptions): LedgerEntry[] {
    const q = options.query.trim().toLowerCase()
    const all = Array.from(this.inMemoryIndex.values())

    const matched = all.filter((entry) => {
      // 状态过滤
      if (options.status) {
        if (options.status === 'pending') {
          if (!PENDING_STATUSES.has(entry.status)) return false
        } else if (entry.status !== options.status) {
          return false
        }
      }

      // 锚点特定过滤
      if (options.anchor) {
        const targetAnchor = options.anchor.toLowerCase()
        if (!entry.anchor.toLowerCase().includes(targetAnchor)) return false
      }

      if (!q) return true

      // 多字段综合命中计算
      const haystack = [
        entry.id,
        entry.title,
        entry.anchor,
        entry.background,
        entry.why,
        entry.change,
        entry.tradeoff,
        entry.commit,
        ...entry.keywords,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      // 关键词全覆盖或模糊覆盖
      const words = q.split(/\s+/)
      return words.some((w) => haystack.includes(w))
    })

    // 智能排序：锚点精确命中 > 未决条目 > 日期倒序
    matched.sort((a, b) => {
      if (options.anchor) {
        const aHit = a.anchor.toLowerCase().includes(options.anchor.toLowerCase())
        const bHit = b.anchor.toLowerCase().includes(options.anchor.toLowerCase())
        if (aHit !== bHit) return aHit ? -1 : 1
      }
      const aPending = PENDING_STATUSES.has(a.status)
      const bPending = PENDING_STATUSES.has(b.status)
      if (aPending !== bPending) return aPending ? -1 : 1

      return (b.date || '').localeCompare(a.date || '')
    })

    if (options.limit && options.limit > 0) {
      return matched.slice(0, options.limit)
    }
    return matched
  }
}
