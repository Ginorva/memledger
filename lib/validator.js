// validator.js — entry validation, separated from schema.js to break the
// schema.js → fact-claims.js dependency. schema.js is pure data definitions
// (enums, constants, weights); validation that needs business logic lives here.

import { VALID_TYPES, VALID_STATUSES, NEEDS_WHY_STATUSES, isUnsettled } from './schema.js';
import { checkFactClaim, hasProbe } from './fact-claims.js';

/**
 * Full entry validation including fact-claim checks.
 *
 * This was originally in schema.js but created a circular dependency:
 * schema.js → fact-claims.js → schema.js (for PENDING_STATUSES).
 * Moving it here lets schema.js stay as a pure enumeration/constant module.
 */
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
