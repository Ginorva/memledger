import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseLedgerMarkdown, formatEntryBlock, buildDecisionIndex, INDEX_BEGIN, INDEX_END, ENTRY_BEGIN, ENTRY_END, } from './markdown-parser.js';
import { anchorPathsOf, anchorStatus, deadPathsOf } from './anchors.js';
import { Mem0Adapter } from './mem0-adapter.js';
import { validateEntry, isUnsettled } from './schema.js';
import { hasRequirement } from './requirements.js';
import { supersessionMap } from './supersede.js';
import { extraLedgerSources } from './ledger-sources.js';
export class LedgerManager {
    workspaceRoot;
    ledgerPath;
    extraLedgers;
    adapter;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.ledgerPath = join(workspaceRoot, 'docs', '变更台账.md');
        // 可选：一个工作区可以配置额外的台账（见 ledger-sources.js）。没有配置时
        // 这是空数组，行为与之前完全一致。
        this.extraLedgers = extraLedgerSources(workspaceRoot);
        this.adapter = new Mem0Adapter();
        this.reload();
    }
    getLedgerPath() {
        return this.ledgerPath;
    }
    /** 额外台账的来源标签（没有配置时为空数组）。 */
    getExtraLedgers() {
        return this.extraLedgers;
    }
    hasLedger() {
        return existsSync(this.ledgerPath);
    }
    /**
     * 主台账的条目 —— 写入、编号、锚点核验都只看它。
     * 额外台账属于别的仓：它们的编号规则不同（当天重排）、锚点指向别的仓的文件、
     * 引用的需求文档也在别的仓 —— 拿它们做本仓的校验只会制造假警报。
     */
    readPrimaryEntries() {
        if (!this.hasLedger())
            return [];
        const content = readFileSync(this.ledgerPath, 'utf-8');
        return parseLedgerMarkdown(content);
    }
    /**
     * 全部台账的条目（主 + 额外），每条带 source 标签标明来自哪本。
     * 检索用这个 —— 「查不到历史 → 重做已完成的事」的盲区就在这里。
     */
    readAllEntries() {
        const out = this.readPrimaryEntries();
        for (const src of this.extraLedgers) {
            let parsed = [];
            try {
                parsed = parseLedgerMarkdown(readFileSync(src.path, 'utf-8'));
            } catch {
                continue;
            }
            for (const e of parsed) {
                e.source = src.label;
                e.sourcePath = src.rel;
                out.push(e);
            }
        }
        return out;
    }
    reload() {
        const entries = this.readAllEntries();
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
        // 索引重建只针对主台账，但检索索引要装上全部（主 + 额外）。
        this.adapter.loadEntries(this.readAllEntries());
    }
    verify() {
        const entries = this.readPrimaryEntries();
        const result = {
            ok: true,
            fails: [],
            warns: [],
            oks: [],
            unknown: [],
            superseded: [],
        };
        // A superseded entry describes code that a later entry already replaced.
        // Its anchor may be gone on purpose, so checking it would manufacture
        // exactly the false alarm the ledger exists to prevent. The live tip of
        // each chain is still checked.
        const supersededBy = supersessionMap(entries);
        for (const e of entries) {
            // The requirement link is checked for every entry, landed or not: a
            // dangling link means the "directory" points at a file that is gone.
            if (e.requirement && !hasRequirement(this.workspaceRoot, e.requirement)) {
                result.warns.push(`[${e.id}] 引用的需求不存在: ${e.requirement}`);
            }
            if (supersededBy.has(e.id)) {
                result.superseded.push(`[${e.id}] 已被 ${supersededBy.get(e.id)} 取代，不核验`);
                continue;
            }
            if (e.status !== '已落地') {
                // Unfinished entries rot silently today: their anchor can vanish
                // while verify only looked at landed ones. Warn instead of fail —
                // an abandoned pending entry is not a regression, but it is no
                // longer "waiting for verification" either.
                // 已废弃 is exempt: the record was closed because the subject is
                // gone, so a dead anchor is the expected state, not a to-do.
                if (isUnsettled(e.status)) {
                    const pendingPaths = anchorPathsOf(e.anchor);
                    if (pendingPaths.length > 0 && anchorStatus(this.workspaceRoot, pendingPaths) === 'dead') {
                        result.warns.push(`[${e.id}] 状态为「${e.status}」，但锚点已不存在: ${pendingPaths[0]}（该待办可能已失效，考虑结案）`);
                    }
                }
                continue;
            }
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
