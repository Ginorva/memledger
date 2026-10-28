import { PENDING_STATUSES } from './schema.js';
export class Mem0Adapter {
    inMemoryIndex = new Map();
    toMem0Payload(entry) {
        const isPending = PENDING_STATUSES.has(entry.status);
        const actionVerb = isPending ? `决议【${entry.status}】` : `已完成落地【${entry.type}】`;
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
            .join(' ');
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
        };
    }
    loadEntries(entries) {
        this.inMemoryIndex.clear();
        for (const e of entries) {
            this.inMemoryIndex.set(e.id, e);
        }
    }
    search(options) {
        const q = options.query.trim().toLowerCase();
        const all = Array.from(this.inMemoryIndex.values());
        const matched = all.filter((entry) => {
            if (options.status) {
                if (options.status === 'pending') {
                    if (!PENDING_STATUSES.has(entry.status))
                        return false;
                }
                else if (entry.status !== options.status) {
                    return false;
                }
            }
            if (options.anchor) {
                const targetAnchor = options.anchor.toLowerCase();
                if (!entry.anchor.toLowerCase().includes(targetAnchor))
                    return false;
            }
            if (!q)
                return true;
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
                .toLowerCase();
            const words = q.split(/\s+/);
            return words.some((w) => haystack.includes(w));
        });
        matched.sort((a, b) => {
            if (options.anchor) {
                const aHit = a.anchor.toLowerCase().includes(options.anchor.toLowerCase());
                const bHit = b.anchor.toLowerCase().includes(options.anchor.toLowerCase());
                if (aHit !== bHit)
                    return aHit ? -1 : 1;
            }
            const aPending = PENDING_STATUSES.has(a.status);
            const bPending = PENDING_STATUSES.has(b.status);
            if (aPending !== bPending)
                return aPending ? -1 : 1;
            return (b.date || '').localeCompare(a.date || '');
        });
        if (options.limit && options.limit > 0) {
            return matched.slice(0, options.limit);
        }
        return matched;
    }
}
