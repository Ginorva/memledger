import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseLedgerMarkdown, formatEntryBlock, buildDecisionIndex, INDEX_BEGIN, INDEX_END, ENTRY_BEGIN, ENTRY_END, } from './markdown-parser.js';
import { anchorPathsOf, anchorStatus, deadPathsOf } from './anchors.js';
import { Mem0Adapter } from './mem0-adapter.js';
import { validateEntry } from './schema.js';
export class LedgerManager {
    workspaceRoot;
    ledgerPath;
    adapter;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.ledgerPath = join(workspaceRoot, 'docs', '变更台账.md');
        this.adapter = new Mem0Adapter();
        this.reload();
    }
    getLedgerPath() {
        return this.ledgerPath;
    }
    hasLedger() {
        return existsSync(this.ledgerPath);
    }
    reload() {
        if (!this.hasLedger()) {
            return [];
        }
        const content = readFileSync(this.ledgerPath, 'utf-8');
        const entries = parseLedgerMarkdown(content);
        this.adapter.loadEntries(entries);
        return entries;
    }
    search(options) {
        this.reload();
        return this.adapter.search(options);
    }
    add(entry) {
        const val = validateEntry(entry);
        if (!val.valid) {
            return { success: false, error: val.errors.join('; ') };
        }
        if (!this.hasLedger()) {
            this.initWorkspace();
        }
        const currentContent = readFileSync(this.ledgerPath, 'utf-8');
        const block = formatEntryBlock(entry);
        let updatedContent = '';
        if (currentContent.includes(ENTRY_END)) {
            updatedContent = currentContent.replace(ENTRY_END, `${block}\n${ENTRY_END}`);
        }
        else {
            updatedContent = `${currentContent.trim()}\n\n${block}`;
        }
        writeFileSync(this.ledgerPath, updatedContent, 'utf-8');
        this.reindex();
        return { success: true };
    }
    reindex() {
        if (!this.hasLedger())
            return;
        const content = readFileSync(this.ledgerPath, 'utf-8');
        const entries = parseLedgerMarkdown(content);
        const newIndex = buildDecisionIndex(entries);
        if (content.includes(INDEX_BEGIN) && content.includes(INDEX_END)) {
            const before = content.slice(0, content.indexOf(INDEX_BEGIN) + INDEX_BEGIN.length);
            const after = content.slice(content.indexOf(INDEX_END));
            const replaced = `${before}\n\n${newIndex}\n\n${after}`;
            writeFileSync(this.ledgerPath, replaced, 'utf-8');
        }
        this.adapter.loadEntries(entries);
    }
    verify() {
        const entries = this.reload();
        const result = {
            ok: true,
            fails: [],
            warns: [],
            oks: [],
            unknown: [],
        };
        for (const e of entries) {
            if (e.status !== '已落地')
                continue;
            if (!e.anchor || e.anchor === '无' || e.anchor === '工程根目录')
                continue;
            const paths = anchorPathsOf(e.anchor);
            if (paths.length === 0)
                continue;
            const status = anchorStatus(this.workspaceRoot, paths);
            if (status === 'alive') {
                result.oks.push(`[${e.id}] 锚点文件存活: ${paths[0]}`);
            }
            else if (status === 'dead') {
                // Name only the paths that actually left this repository: an entry
                // may also anchor a file in a sibling repo, and blaming that one
                // would be a false alarm.
                const gone = deadPathsOf(this.workspaceRoot, paths);
                result.fails.push(`[${e.id}] 锚点文件已不存在: ${gone.join('、')}（疑似被迭代改没）`);
                result.ok = false;
            }
            else {
                // No path and no top directory here means the anchor points into a
                // sibling repository (wrapper vs engine). Saying "missing" would
                // fire on every run, so it is reported as unverifiable instead.
                result.unknown.push(`[${e.id}] 锚点不在本仓，无法核验: ${paths[0]}`);
            }
        }
        return result;
    }
    initWorkspace(initialEntries = []) {
        const docsDir = join(this.workspaceRoot, 'docs');
        if (!existsSync(docsDir)) {
            mkdirSync(docsDir, { recursive: true });
        }
        const indexSection = buildDecisionIndex(initialEntries);
        const entryBlocks = initialEntries.map(formatEntryBlock).join('\n');
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
        ].join('\n');
        writeFileSync(this.ledgerPath, template, 'utf-8');
        this.reload();
    }
}
