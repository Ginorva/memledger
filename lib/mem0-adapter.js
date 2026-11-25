import { PENDING_STATUSES } from './schema.js';

/**
 * Tokenize a string into searchable terms.
 * Splits on whitespace and CJK boundaries, lowercases, dedupes.
 */
function tokenize(text) {
    if (!text) return [];
    const raw = String(text).toLowerCase();
    // Split on whitespace, punctuation, and between CJK/non-CJK boundaries
    const tokens = raw.split(/[\s,;；，、:：.。!！?？()\[\]{}<>|/\\`'"@#$%^&*+=~\-_]+/)
        .filter(t => t.length > 0);
    // Also split CJK runs into bigrams for substring matching
    const cjkBigrams = [];
    for (const token of tokens) {
        // For tokens with CJK characters, generate character-level and bigram tokens
        const cjkChars = token.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
        if (cjkChars && cjkChars.length >= 2) {
            for (let i = 0; i < cjkChars.length - 1; i++) {
                cjkBigrams.push(cjkChars[i] + cjkChars[i + 1]);
            }
        }
    }
    return [...new Set([...tokens, ...cjkBigrams])];
}

/**
 * 索引里用的唯一键。
 *
 * 以前只有 entry.id —— 一个工作区一本台账时够用。但一个工作区可以配多本台账
 * （包装仓/引擎仓各一本），而**不同台账的 CL 编号会撞车**（编号规则不同：主台账全局
 * 连续、另两本当天重排）。若继续用 id 做键，后读的会把先读的**整个覆盖掉** ——
 * 那条决策就从检索里消失了，正是"检索不到历史 → 重做已完成的事"的成因。
 *
 * 所以索引键改成 `id::来源`，而 `entry.id` 仍是对外显示的编号。
 */
function keyOf(entry) {
    return entry.source ? `${entry.id}::${entry.source}` : entry.id;
}

export class Mem0Adapter {
    inMemoryIndex = new Map();

    // Inverted index: token → Set<entryId>
    _tokenIndex = new Map();
    // Status index: status → Set<entryId>
    _statusIndex = new Map();
    // Anchor index: normalized anchor fragment → Set<entryId>
    _anchorIndex = new Map();

    // BM25 statistics
    /** Total number of indexed documents. */
    _docCount = 0;
    /** Per-document token count: key → number of tokens. */
    _docLength = new Map();
    /** Average document length across all entries. */
    _avgDocLength = 0;
    /** Document frequency: token → number of documents containing it. */
    _docFreq = new Map();

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
        this._tokenIndex.clear();
        this._statusIndex.clear();
        this._anchorIndex.clear();
        this._docLength.clear();
        this._docFreq.clear();
        this._docCount = 0;

        for (const e of entries) {
            this.inMemoryIndex.set(keyOf(e), e);
            this._indexEntry(e);
        }

        // Compute average document length for BM25
        this._docCount = this.inMemoryIndex.size;
        if (this._docCount > 0) {
            let totalLength = 0;
            for (const len of this._docLength.values()) totalLength += len;
            this._avgDocLength = totalLength / this._docCount;
        } else {
            this._avgDocLength = 1;
        }
    }

    /**
     * Build inverted indexes for a single entry.
     */
    _indexEntry(entry) {
        const key = keyOf(entry);
        // 1. Token index — all searchable text fields
        const allText = [
            entry.id,
            entry.title,
            entry.anchor,
            entry.background,
            entry.why,
            entry.change,
            entry.tradeoff,
            entry.commit,
            ...(entry.keywords || []),
        ].filter(Boolean).join(' ');

        const tokens = tokenize(allText);
        this._docLength.set(key, tokens.length);

        // Track which tokens appear in this document (for doc freq)
        const seenTokens = new Set();
        for (const token of tokens) {
            if (!this._tokenIndex.has(token)) {
                this._tokenIndex.set(token, new Set());
            }
            this._tokenIndex.get(token).add(key);
            seenTokens.add(token);
        }
        // Update document frequency
        for (const token of seenTokens) {
            this._docFreq.set(token, (this._docFreq.get(token) || 0) + 1);
        }

        // 2. Status index
        if (!this._statusIndex.has(entry.status)) {
            this._statusIndex.set(entry.status, new Set());
        }
        this._statusIndex.get(entry.status).add(key);

        // 3. Anchor index — store lowered anchor fragments for substring search
        if (entry.anchor) {
            const anchorLower = entry.anchor.toLowerCase();
            // Index the whole anchor and path components
            const fragments = anchorLower.split(/[/\\:;；,，\s]+/).filter(f => f.length > 0);
            for (const frag of [anchorLower, ...fragments]) {
                if (!this._anchorIndex.has(frag)) {
                    this._anchorIndex.set(frag, new Set());
                }
                this._anchorIndex.get(frag).add(key);
            }
        }
    }

    /**
     * BM25 score for a single query token against a document.
     *
     * BM25(q, d) = IDF(q) × (tf × (k1 + 1)) / (tf + k1 × (1 - b + b × |d|/avgdl))
     *
     * where:
     *   tf = term frequency of q in d (approximated as 1 since we use set-based indexing)
     *   IDF(q) = ln((N - df + 0.5) / (df + 0.5) + 1)
     *   k1 = 1.2  (term frequency saturation)
     *   b  = 0.75 (length normalization)
     */
    _bm25Score(token, docKey) {
        const k1 = 1.2;
        const b = 0.75;
        const N = this._docCount;
        const df = this._docFreq.get(token) || 0;
        const dl = this._docLength.get(docKey) || 1;
        const avgdl = this._avgDocLength || 1;

        // IDF — log( (N - df + 0.5) / (df + 0.5) + 1 )
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

        // tf = 1 (binary: token is in the document or not)
        const tf = 1;
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl));

        return idf * tfNorm;
    }

    search(options) {
        const q = options.query.trim().toLowerCase();

        // Fast path: use indexes to narrow candidates instead of scanning all
        let candidateIds = null;

        // Status filter via index
        if (options.status) {
            if (options.status === 'pending') {
                candidateIds = new Set();
                for (const status of PENDING_STATUSES) {
                    const ids = this._statusIndex.get(status);
                    if (ids) for (const id of ids) candidateIds.add(id);
                }
            } else {
                const ids = this._statusIndex.get(options.status);
                candidateIds = ids ? new Set(ids) : new Set();
            }
        }

        // Anchor filter via index — intersect with candidates
        if (options.anchor) {
            const targetAnchor = options.anchor.toLowerCase();
            const anchorHits = new Set();
            // Check all anchor index entries for substring match
            for (const [frag, ids] of this._anchorIndex) {
                if (frag.includes(targetAnchor) || targetAnchor.includes(frag)) {
                    for (const id of ids) anchorHits.add(id);
                }
            }
            if (candidateIds === null) {
                candidateIds = anchorHits;
            } else {
                // Intersect
                for (const id of candidateIds) {
                    if (!anchorHits.has(id)) candidateIds.delete(id);
                }
            }
        }

        // Keyword query via token index — BM25 scored retrieval
        /** @type {Map<string, number>|null} docKey → BM25 score */
        let bm25Scores = null;
        if (q) {
            const queryTokens = tokenize(q);
            if (queryTokens.length > 0) {
                bm25Scores = new Map();
                const keywordHits = new Set();
                for (const token of queryTokens) {
                    // Exact token match from index
                    const exact = this._tokenIndex.get(token);
                    if (exact) {
                        for (const id of exact) {
                            keywordHits.add(id);
                            bm25Scores.set(id, (bm25Scores.get(id) || 0) + this._bm25Score(token, id));
                        }
                    }
                    // Substring fallback: only for short queries (≤3 chars) where exact
                    // match is too restrictive. Longer tokens rely on exact + CJK bigram
                    // matching, avoiding O(T) full traversal of the token index.
                    if (token.length >= 2 && token.length <= 3) {
                        for (const [indexed, ids] of this._tokenIndex) {
                            if (indexed.includes(token) || token.includes(indexed)) {
                                for (const id of ids) {
                                    keywordHits.add(id);
                                    // Substring matches get a discounted BM25 score (0.5×)
                                    if (!bm25Scores.has(id)) {
                                        bm25Scores.set(id, this._bm25Score(indexed, id) * 0.5);
                                    }
                                }
                            }
                        }
                    } else if (token.length >= 4) {
                        // For longer tokens, only check tokens that share a common prefix
                        // (first 3 chars) to avoid full traversal.
                        const prefix = token.slice(0, 3);
                        for (const [indexed, ids] of this._tokenIndex) {
                            if (indexed.startsWith(prefix) && (indexed.includes(token) || token.includes(indexed))) {
                                for (const id of ids) {
                                    keywordHits.add(id);
                                    if (!bm25Scores.has(id)) {
                                        bm25Scores.set(id, this._bm25Score(indexed, id) * 0.7);
                                    }
                                }
                            }
                        }
                    }
                }
                if (candidateIds === null) {
                    candidateIds = keywordHits;
                } else {
                    for (const id of candidateIds) {
                        if (!keywordHits.has(id)) candidateIds.delete(id);
                    }
                }
            }
        }

        // If no filters at all, return everything
        const candidates = candidateIds !== null
            ? [...candidateIds].map(id => this.inMemoryIndex.get(id)).filter(Boolean)
            : Array.from(this.inMemoryIndex.values());

        // Sort: BM25 score first (if keyword query), then anchor match, then pending first, then date desc
        candidates.sort((a, b) => {
            // BM25 score takes priority when a keyword query is present
            if (bm25Scores) {
                const aScore = bm25Scores.get(keyOf(a)) || 0;
                const bScore = bm25Scores.get(keyOf(b)) || 0;
                if (Math.abs(aScore - bScore) > 0.01) return bScore - aScore;
            }
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
            return candidates.slice(0, options.limit);
        }
        return candidates;
    }
}
