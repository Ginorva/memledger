import { checkFactClaim, hasProbe } from './fact-claims.js';

export const REQUIRED_FIELDS = [
    '日期',
    '类型',
    '状态',
    '仓',
    '背景',
    '改动',
    '为什么',
    '取舍',
    '锚点',
    'commit',
    '验收',
    '关键词',
];
export const VALID_STATUSES = new Set([
    '已落地',
    '进行中',
    '待验证',
    '搁置',
    '未做',
    '已回退',
    '已废弃',
]);
export const VALID_TYPES = new Set([
    '修复',
    '新功能',
    '重构',
    '口径',
    '部署',
    '决策',
    '埋点',
    '演练',
    '文档',
    // 环境事实：会过期（这台机有没有凭据 / 某服务现在能不能连 / 某张表停在哪天）。
    // 与「决策」分开，是因为它的**读法**不同：决策长期有效，事实是快照 ——
    // 混在一起就会让「日期最新的错事实」自动赢（2026-11-19 事故）。
    '事实',
]);
export const NEEDS_WHY_STATUSES = new Set([
    '搁置',
    '未做',
    '已回退',
    '已废弃',
    '待验证',
]);
export const STATUS_PRIORITY = {
    未做: 0,
    搁置: 1,
    待验证: 2,
    已回退: 3,
    已废弃: 4,
    进行中: 5,
    已落地: 6,
};

/**
 * Status relevance weight for scoring.
 * Higher = more important to surface in ledger_check results.
 * 搁置/已回退 are the anti-rollback core — always surface them.
 */
export const STATUS_WEIGHT = {
    '搁置':   1.0,
    '已回退': 1.0,
    '已废弃': 0.9,
    '进行中': 0.8,
    '待验证': 0.7,
    '未做':   0.6,
    '已落地': 0.3,
};

/**
 * Statuses whose weight is immune to time decay.
 * These represent negative memory — "why we didn't do it" — and must never
 * silently fade out of check results.
 */
export const DECAY_IMMUNE_STATUSES = new Set(['搁置', '已回退', '已废弃']);
export const PENDING_STATUSES = new Set([
    '未做',
    '搁置',
    '待验证',
    '已回退',
    '已废弃',
    '进行中',
]);
/**
 * Terminal "the record itself is void" statuses.
 *
 * 已废弃 means the thing being tracked no longer exists (the plugin was
 * removed, the plan was dropped outright). Such an entry stays in the ledger as
 * negative memory, but it is no longer work in progress: it must not sit in the
 * 未决清单, and a vanished anchor is the *reason* it was abandoned rather than a
 * warning worth re-reading forever.
 *
 * Deliberately narrow: 已回退 is a decision about a change, not a void record,
 * so it stays unsettled and keeps being surfaced.
 */
export const ABANDONED_STATUSES = new Set(['已废弃']);
/** Unfinished *and still worth tracking* — pending minus abandoned. */
export function isUnsettled(status) {
    return PENDING_STATUSES.has(status) && !ABANDONED_STATUSES.has(status);
}
export function validateEntry(entry) {
    const errors = [];
    if (!entry.id)
        errors.push('缺少 entry_id');
    if (!entry.title)
        errors.push('缺少 title');
    if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date))
        errors.push('日期格式错误 (需 YYYY-MM-DD)');
    if (!entry.type || !VALID_TYPES.has(entry.type))
        errors.push(`非法类型: ${entry.type}`);
    if (!entry.status || !VALID_STATUSES.has(entry.status))
        errors.push(`非法状态: ${entry.status}`);
    if (entry.status && NEEDS_WHY_STATUSES.has(entry.status) && (!entry.why || entry.why.trim().length < 5)) {
        errors.push(`状态为「${entry.status}」的条目必须详细说明「为什么」与重启条件`);
    }
    if (!entry.anchor)
        errors.push('必须声明代码锚点 (anchor)');
    // Keywords are a search index, not a genre label. "修复" answers no future
    // question, and a ledger whose 300 entries all say "修复" cannot be searched
    // at all — which is exactly how a growing ledger turns into a useless one.
    const keywords = Array.isArray(entry.keywords)
        ? entry.keywords.map((value) => String(value).trim()).filter(Boolean)
        : [];
    const distinct = [...new Set(keywords)];
    if (distinct.length === 0) {
        errors.push('关键词至少 2 个：领域词/报错特征/符号名，不要只写类型');
    }
    else if (distinct.length < 2) {
        errors.push(`关键词只有「${distinct[0]}」，至少给 2 个（领域词、报错特征、符号名）`);
    }
    else if (distinct.every((keyword) => VALID_TYPES.has(keyword))) {
        errors.push('关键词不能只是类型枚举（修复/重构…），它回答不了以后的检索');
    }
    // ── 环境事实的可信度判据（2026-11-19）────────────────────────────────
    // 一条「否定式能力事实」（某台机没有凭据 / 某服务不能自己连 / 需人工处理）
    // 会让后来的人**照着它不做事**，所以它必须自带一条能重跑的复核命令。
    // 只卡**未决**条目（它们还会被当待办读）与 type=事实；已落地的是历史陈述，不拦。
    const fact = checkFactClaim(entry);
    const openEntry = isUnsettled(entry.status);
    if (entry.type === '事实') {
        const probe = String(entry.probe ?? '').trim();
        if (!probe && !hasProbe(entry.verify ?? '')) {
            errors.push('类型「事实」= 会过期的环境快照，必须在「验收」里给一条能重跑的复核命令');
        }
    }
    else if (!fact.ok && openEntry) {
        errors.push(fact.reason);
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
