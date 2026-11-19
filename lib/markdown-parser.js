import { STATUS_PRIORITY, isUnsettled } from './schema.js';
import { supersessionMap } from './supersede.js';
export const ENTRY_BEGIN = '<!-- 条目:BEGIN -->';
export const ENTRY_END = '<!-- 条目:END -->';
export const INDEX_BEGIN = '<!-- 决策索引:BEGIN -->';
export const INDEX_END = '<!-- 决策索引:END -->';
const HEADING_RE = /^###\s+(CL-\d{8}-\d+)\s+·\s+(.+?)\s*$/;
const FIELD_RE = /^-\s+\*\*(.+?)\*\*：(.*?)\s*$/;
export function parseLedgerMarkdown(content) {
    const entries = [];
    const lines = content.split('\n');
    let curId = null;
    let curTitle = null;
    let curFields = {};
    let curLine = 0;
    function commitCurrent() {
        if (curId && curTitle) {
            const rawKeywords = curFields['关键词'] || '';
            const keywords = rawKeywords
                .split(/[,，;；]/)
                .map((k) => k.trim())
                .filter(Boolean);
            entries.push({
                id: curId,
                title: curTitle,
                date: curFields['日期'] || '',
                type: (curFields['类型'] || '修复'),
                status: (curFields['状态'] || '已落地'),
                repo: curFields['仓'] || '包装仓',
                requirement: curFields['需求'] || '',
                supersedes: curFields['取代'] || '',
                background: curFields['背景'] || '',
                change: curFields['改动'] || '',
                why: curFields['为什么'] || '',
                tradeoff: curFields['取舍'] || '',
                anchor: curFields['锚点'] || '',
                commit: curFields['commit'] || '',
                verify: curFields['验收'] || '',
                probe: curFields['复核命令'] || '',
                keywords,
                lineNo: curLine,
            });
        }
    }
    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const hm = HEADING_RE.exec(line);
        if (hm) {
            commitCurrent();
            curId = hm[1];
            curTitle = hm[2];
            curFields = {};
            curLine = idx + 1;
            continue;
        }
        const fm = FIELD_RE.exec(line);
        if (fm && curId) {
            curFields[fm[1].trim()] = fm[2].trim();
        }
    }
    commitCurrent();
    return entries;
}
export function formatEntryBlock(entry) {
    const kw = entry.keywords.join(', ');
    const requirementLine = entry.requirement
        ? [`- **需求**：${entry.requirement}`]
        : [];
    const supersedesLine = entry.supersedes
        ? [`- **取代**：${entry.supersedes}`]
        : [];
    // 复核命令：环境事实（会过期）条目的「怎么自己复核」——
    // 没有它，一条否定式事实就会让人「不做事」却无法自证（2026-11-19 事故）。
    const probeLine = entry.probe
        ? [`- **复核命令**：${entry.probe}`]
        : [];
    return [
        `### ${entry.id} · ${entry.title}`,
        '',
        `- **日期**：${entry.date}`,
        `- **类型**：${entry.type}`,
        `- **状态**：${entry.status}`,
        `- **仓**：${entry.repo}`,
        ...requirementLine,
        ...supersedesLine,
        `- **背景**：${entry.background}`,
        `- **改动**：${entry.change}`,
        `- **为什么**：${entry.why}`,
        `- **取舍**：${entry.tradeoff || '无'}`,
        `- **锚点**：${entry.anchor}`,
        `- **commit**：${entry.commit || '无'}`,
        `- **验收**：${entry.verify || '无'}`,
        ...probeLine,
        `- **关键词**：${kw}`,
        '',
    ].join('\n');
}
export function buildDecisionIndex(entries) {
    const sorted = [...entries].sort((a, b) => {
        const pa = STATUS_PRIORITY[a.status] ?? 99;
        const pb = STATUS_PRIORITY[b.status] ?? 99;
        if (pa !== pb)
            return pa - pb;
        return (b.date || '').localeCompare(a.date || '');
    });
    const linesA = [
        '### 1.1 速查表（活跃条目，未决在前，点击直跳）',
        '',
        '| ID | 日期 | 状态 | 类型 | 标题 | 锚点 |',
        '|---|---|---|---|---|---|',
    ];
    // One question deserves one row: when a symbol was tuned several times, the
    // older landed entries are collapsed instead of re-listed. Nothing is lost —
    // section 2 keeps every entry and ledger_search still finds them.
    const supersededBy = supersessionMap(entries);
    const active = sorted.filter((e) => !supersededBy.has(e.id));
    for (const e of active) {
        const slug = `${e.id.toLowerCase()}-${e.title.toLowerCase().replace(/[\s\/:*?"<>|]+/g, '-')}`;
        linesA.push(`| [${e.id}](#${slug}) | ${e.date} | \`${e.status}\` | ${e.type} | ${e.title} | \`${e.anchor}\` |`);
    }
    const folded = sorted.filter((e) => supersededBy.has(e.id));
    if (folded.length > 0) {
        linesA.push('', `> 已被取代（折叠 ${folded.length} 条）：${folded.map((e) => `${e.id}→${supersededBy.get(e.id)}`).join('、')}。历史仍在第 2 节，\`ledger_search\` 可取。`);
    }
    // 1.2 lists what is still open. An abandoned record (已废弃) is terminal
    // negative memory, not an open item, so it stays out of this list — that is
    // what lets a zombie entry actually be closed.
    const pending = sorted.filter((e) => isUnsettled(e.status));
    const linesB = [
        '',
        '### 1.2 未决清单（未做 / 搁置 / 待验证 / 已回退 · 必看为什么）',
        '',
        '| ID | 状态 | 标题 | 为什么没做 / 回退原因 | 重启条件 |',
        '|---|---|---|---|---|',
    ];
    for (const e of pending) {
        const why = e.why ? e.why.replace(/[\r\n|]/g, ' ') : '—';
        const tradeoff = e.tradeoff ? e.tradeoff.replace(/[\r\n|]/g, ' ') : '—';
        linesB.push(`| ${e.id} | \`${e.status}\` | ${e.title} | ${why} | ${tradeoff} |`);
    }
    // An empty table renders as a broken section; say "nothing open" explicitly.
    if (pending.length === 0) {
        linesB.push('| — | — | 无未决条目 | 全部条目已结案或落地 | — |');
    }
    // 1.3 需求分组 — the "table of contents" layer.
    // Only emitted once at least one entry names a requirement, so an existing
    // ledger renders byte-identically after upgrading the plugin.
    const grouped = new Map();
    for (const e of entries) {
        if (!e.requirement)
            continue;
        if (!grouped.has(e.requirement))
            grouped.set(e.requirement, []);
        grouped.get(e.requirement).push(e);
    }
    const linesC = [];
    if (grouped.size > 0) {
        const ids = [...grouped.keys()].sort((a, b) => b.localeCompare(a));
        linesC.push('', '### 1.3 按需求分组（需求 = 一条完整诉求，子项 = 落地它的台账条目）', '');
        linesC.push('| 需求 | 条目 | 未决 | 子项 |');
        linesC.push('|---|---|---|---|');
        let linked = 0;
        for (const id of ids) {
            const list = grouped.get(id);
            linked += list.length;
            const open = list.filter((e) => isUnsettled(e.status)).length;
            const items = list.map((e) => e.id).join('、');
            linesC.push(`| [${id}](./需求/${id}.md) | ${list.length} | ${open > 0 ? open : '—'} | ${items} |`);
        }
        const rest = entries.length - linked;
        if (rest > 0)
            linesC.push('', `> 另有 ${rest} 条未挂需求（历史条目；补一行 \`- **需求**：RQ-…\` 即可归入目录）。`);
    }
    return [...linesA, ...linesB, ...linesC].join('\n');
}
