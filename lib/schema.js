// schema.js — pure data definitions: enums, constants, weights.
//
// validateEntry was moved to validator.js to break the schema.js → fact-claims.js
// dependency. schema.js is now a leaf module with no business-logic imports.
// The validateEntry re-export preserves backward compatibility.

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

// Re-export validateEntry from validator.js for backward compatibility.
// All callers that import { validateEntry } from './schema.js' keep working.
export { validateEntry } from './validator.js';
