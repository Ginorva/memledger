import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { LedgerEntry, SearchOptions, VerifyResult } from './types.js'
import {
  parseLedgerMarkdown,
  formatEntryBlock,
  buildDecisionIndex,
  INDEX_BEGIN,
  INDEX_END,
  ENTRY_BEGIN,
  ENTRY_END,
} from './markdown-parser.js'
import { Mem0Adapter } from './mem0-adapter.js'
import { validateEntry } from './schema.js'

export class LedgerManager {
  private workspaceRoot: string
  private ledgerPath: string
  private adapter: Mem0Adapter

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot
    this.ledgerPath = join(workspaceRoot, 'docs', '变更台账.md')
    this.adapter = new Mem0Adapter()
    this.reload()
  }

  public getLedgerPath(): string {
    return this.ledgerPath
  }

  public hasLedger(): boolean {
    return existsSync(this.ledgerPath)
  }

  /**
   * 重新加载台账并刷新内存认知索引
   */
  public reload(): LedgerEntry[] {
    if (!this.hasLedger()) {
      return []
    }
    const content = readFileSync(this.ledgerPath, 'utf-8')
    const entries = parseLedgerMarkdown(content)
    this.adapter.loadEntries(entries)
    return entries
  }

  /**
   * 检索台账
   */
  public search(options: SearchOptions): LedgerEntry[] {
    this.reload()
    return this.adapter.search(options)
  }

  /**
   * 追加新条目（只追加不修改历史）
   */
  public add(entry: LedgerEntry): { success: boolean; error?: string } {
    const val = validateEntry(entry)
    if (!val.valid) {
      return { success: false, error: val.errors.join('; ') }
    }

    if (!this.hasLedger()) {
      this.initWorkspace()
    }

    const currentContent = readFileSync(this.ledgerPath, 'utf-8')
    const block = formatEntryBlock(entry)

    let updatedContent = ''
    if (currentContent.includes(ENTRY_END)) {
      updatedContent = currentContent.replace(ENTRY_END, `${block}\n${ENTRY_END}`)
    } else {
      updatedContent = `${currentContent.trim()}\n\n${block}`
    }

    writeFileSync(this.ledgerPath, updatedContent, 'utf-8')
    this.reindex()
    return { success: true }
  }

  /**
   * 重新生成决策索引段
   */
  public reindex(): void {
    if (!this.hasLedger()) return

    const content = readFileSync(this.ledgerPath, 'utf-8')
    const entries = parseLedgerMarkdown(content)
    const newIndex = buildDecisionIndex(entries)

    if (content.includes(INDEX_BEGIN) && content.includes(INDEX_END)) {
      const before = content.slice(0, content.indexOf(INDEX_BEGIN) + INDEX_BEGIN.length)
      const after = content.slice(content.indexOf(INDEX_END))
      const replaced = `${before}\n\n${newIndex}\n\n${after}`
      writeFileSync(this.ledgerPath, replaced, 'utf-8')
    }
    this.adapter.loadEntries(entries)
  }

  /**
   * 体检：检查“已落地”的代码锚点是否在当前代码中消失（防倒车）
   */
  public verify(): VerifyResult {
    const entries = this.reload()
    const result: VerifyResult = {
      ok: true,
      fails: [],
      warns: [],
      oks: [],
    }

    for (const e of entries) {
      if (e.status !== '已落地') continue
      if (!e.anchor || e.anchor === '无' || e.anchor === '工程根目录') continue

      const [relPath] = e.anchor.split('::')
      const fullPath = join(this.workspaceRoot, relPath)

      if (!existsSync(fullPath)) {
        result.fails.push(`[${e.id}] 锚点文件已不存在: ${relPath}（疑似被迭代改没）`)
        result.ok = false
      } else {
        result.oks.push(`[${e.id}] 锚点文件存活: ${relPath}`)
      }
    }

    return result
  }

  /**
   * 初始化一个标准的工作区台账
   */
  public initWorkspace(initialEntries: LedgerEntry[] = []): void {
    const docsDir = join(this.workspaceRoot, 'docs')
    if (!existsSync(docsDir)) {
      mkdirSync(docsDir, { recursive: true })
    }

    const indexSection = buildDecisionIndex(initialEntries)
    const entryBlocks = initialEntries.map(formatEntryBlock).join('\n')

    const template = [
      '# 项目变更台账（append-only）',
      '',
      '> 由 MemLedger 自动维护。这份文档是「为什么」的答案库。',
      '> 本文件只追加不删改 —— 历史条目即使被推翻，也改成新状态并说明原因，不许删。',
      '',
      '---',
      '',
      '## 1. 决策索引（自动生成）',
      '',
      INDEX_BEGIN,
      '',
      indexSection,
      '',
      INDEX_END,
      '',
      '---',
      '',
      '## 2. 变更条目（只追加）',
      '',
      ENTRY_BEGIN,
      '',
      entryBlocks,
      '',
      ENTRY_END,
      '',
    ].join('\n')

    writeFileSync(this.ledgerPath, template, 'utf-8')
    this.reload()
  }
}
