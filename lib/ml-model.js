// ml-model.js — Pure-JS lightweight logistic regression for MemLedger.
//
// Zero external dependencies. The model learns from two signals:
//   - POSITIVE: ledger_check surfaces an entry, and later ledger_add accepts
//     (or force-overrides) it → the check was relevant
//   - NEGATIVE: ledger_check surfaces an entry, but it was never acted upon
//     → the check was noise
//
// Online SGD with a low learning rate keeps weights stable (no catastrophic
// forgetting from a single bad sample). The rule-based scoreEntry remains
// as the floor — the ML score only *boosts*, never suppresses negative-memory
// entries (搁置/已回退/已废弃 are always surfaced regardless of score).
//
// Feature vector (8 dimensions):
//   [0] statusWeight    — from STATUS_WEIGHT enum (0.3–1.0)
//   [1] anchorPrecision — exact=1.0, suffix=0.8, prefix=0.7, miss=0.3
//   [2] timeDecay       — exponential decay (0–1)
//   [3] repairCount     — how many times this anchor was landed before (0–N, normalized)
//   [4] negativeCount   — how many 搁置/已回退 on this anchor (0–N, normalized)
//   [5] keywordOverlap  — fraction of query keywords that match entry keywords (0–1)
//   [6] hasContract     — whether a contract suite covers this anchor (0 or 1)
//   [7] bm25Affinity    — BM25 score from search if available, normalized (0–1)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FEATURE_COUNT = 8
const LEARNING_RATE = 0.01
const REGULARIZATION = 0.001  // L2 regularization to prevent overfitting
const MIN_SAMPLES_FOR_ML = 20 // don't use ML until we have enough data
const MODEL_FILE = '.memledger-ml.json'

/**
 * Sigmoid function: maps any real number to (0, 1).
 */
function sigmoid(x) {
  if (x > 500) return 1
  if (x < -500) return 0
  return 1 / (1 + Math.exp(-x))
}

/**
 * Lightweight logistic regression model.
 *
 * - `predict(features)` returns a probability [0, 1]
 * - `update(features, label)` does one step of online SGD
 * - `save(root)` / `load(root)` persist to docs/.memledger-ml.json
 */
export class RelevanceModel {
  /** @type {number[]} weights for each feature */
  weights
  /** @type {number} bias term */
  bias
  /** @type {number} total training samples seen */
  sampleCount
  /** @type {Array<{features: number[], label: number, ts: number}>} recent training log */
  trainingLog

  constructor() {
    // Initialize with informed priors based on the existing rule-based scoring:
    // The first three features (statusWeight, anchorPrecision, timeDecay)
    // should start positive since they're proven useful.
    this.weights = [
      1.5,   // statusWeight — known to be important
      1.2,   // anchorPrecision — known to be important
      0.8,   // timeDecay — known to be important
      0.5,   // repairCount — probably useful (repeated repairs = higher risk)
      0.7,   // negativeCount — probably useful (prior 搁置/回退 = important)
      0.3,   // keywordOverlap — might help
      0.4,   // hasContract — probably useful (guarded code is important)
      0.3,   // bm25Affinity — might help
    ]
    this.bias = -0.5
    this.sampleCount = 0
    this.trainingLog = []
  }

  /**
   * Forward pass: compute probability that this entry is relevant.
   * @param {number[]} features - 8-dimensional feature vector
   * @returns {number} probability [0, 1]
   */
  predict(features) {
    let z = this.bias
    for (let i = 0; i < FEATURE_COUNT && i < features.length; i++) {
      z += this.weights[i] * features[i]
    }
    return sigmoid(z)
  }

  /**
   * One step of online SGD (stochastic gradient descent).
   * @param {number[]} features - 8-dimensional feature vector
   * @param {number} label - 1 (relevant/adopted) or 0 (noise/ignored)
   */
  update(features, label) {
    const predicted = this.predict(features)
    const error = label - predicted  // gradient of cross-entropy loss

    // Update weights: w += lr * error * x - lr * lambda * w
    for (let i = 0; i < FEATURE_COUNT && i < features.length; i++) {
      this.weights[i] += LEARNING_RATE * error * features[i]
        - LEARNING_RATE * REGULARIZATION * this.weights[i]
    }
    this.bias += LEARNING_RATE * error

    this.sampleCount += 1

    // Keep a bounded training log for diagnostics
    this.trainingLog.push({
      features: features.slice(0, FEATURE_COUNT),
      label,
      predicted: +predicted.toFixed(4),
      ts: Date.now(),
    })
    if (this.trainingLog.length > 200) {
      this.trainingLog = this.trainingLog.slice(-100)
    }
  }

  /**
   * Whether the model has seen enough data to be used for scoring.
   * Before this threshold, the rule-based score is used exclusively.
   */
  get isReady() {
    return this.sampleCount >= MIN_SAMPLES_FOR_ML
  }

  /**
   * Persist model weights and training state.
   */
  save(root) {
    const dir = join(root, 'docs')
    const path = join(dir, MODEL_FILE)
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify({
        version: 1,
        weights: this.weights,
        bias: this.bias,
        sampleCount: this.sampleCount,
        featureNames: [
          'statusWeight', 'anchorPrecision', 'timeDecay', 'repairCount',
          'negativeCount', 'keywordOverlap', 'hasContract', 'bm25Affinity',
        ],
        trainingLog: this.trainingLog.slice(-50),
        savedAt: new Date().toISOString(),
      }, null, 2), 'utf-8')
    } catch {
      // persistence is best-effort
    }
  }

  /**
   * Load model weights from disk. Returns false if no saved model exists.
   */
  load(root) {
    const path = join(root, 'docs', MODEL_FILE)
    if (!existsSync(path)) return false
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'))
      if (raw.version !== 1) return false
      if (Array.isArray(raw.weights) && raw.weights.length === FEATURE_COUNT) {
        this.weights = raw.weights.map(Number)
      }
      if (typeof raw.bias === 'number') this.bias = raw.bias
      if (typeof raw.sampleCount === 'number') this.sampleCount = raw.sampleCount
      if (Array.isArray(raw.trainingLog)) this.trainingLog = raw.trainingLog.slice(-100)
      return true
    } catch {
      return false
    }
  }

  /**
   * Human-readable summary of the model state.
   */
  summary() {
    const names = [
      'statusWeight', 'anchorPrecision', 'timeDecay', 'repairCount',
      'negativeCount', 'keywordOverlap', 'hasContract', 'bm25Affinity',
    ]
    const pairs = names.map((name, i) => `${name}=${this.weights[i].toFixed(3)}`)
    return {
      ready: this.isReady,
      sampleCount: this.sampleCount,
      weights: Object.fromEntries(names.map((n, i) => [n, +this.weights[i].toFixed(4)])),
      bias: +this.bias.toFixed(4),
      formula: `σ(${pairs.join(' + ')} + bias=${this.bias.toFixed(3)})`,
    }
  }
}

/**
 * Extract the 8-dimensional feature vector for a (entry, targetPath) pair.
 *
 * @param {object} entry - ledger entry
 * @param {string} targetPath - the path being checked
 * @param {object} context - additional context
 * @param {number} context.statusWeight - from STATUS_WEIGHT
 * @param {number} context.anchorPrecision - computed anchor match precision
 * @param {number} context.timeDecay - computed time decay
 * @param {number} [context.repairCount=0] - times this anchor was landed
 * @param {number} [context.negativeCount=0] - times this anchor was 搁置/回退
 * @param {number} [context.keywordOverlap=0] - keyword match ratio (0–1)
 * @param {number} [context.hasContract=0] - whether covered by a contract (0/1)
 * @param {number} [context.bm25Affinity=0] - normalized BM25 score (0–1)
 * @returns {number[]} 8-dimensional feature vector
 */
export function extractFeatures(entry, targetPath, context) {
  return [
    context.statusWeight ?? 0.3,
    context.anchorPrecision ?? 0.3,
    context.timeDecay ?? 1.0,
    Math.min((context.repairCount ?? 0) / 5, 1.0),    // normalize to 0–1
    Math.min((context.negativeCount ?? 0) / 3, 1.0),   // normalize to 0–1
    context.keywordOverlap ?? 0,
    context.hasContract ?? 0,
    context.bm25Affinity ?? 0,
  ]
}

/**
 * Per-workspace model registry (mirrors StatsRegistry pattern).
 * Each workspace gets its own model so different projects learn independently.
 */
export class ModelRegistry {
  _byRoot = new Map()
  /** @type {Map<string, string>} normalized key → original root */
  _originalRoot = new Map()
  _default = new RelevanceModel()

  _key(root) {
    if (typeof root !== 'string' || root.length === 0) return ''
    return root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  }

  get(root) {
    const key = this._key(root)
    if (!key) return this._default
    let model = this._byRoot.get(key)
    if (!model) {
      model = new RelevanceModel()
      model.load(root)
      this._byRoot.set(key, model)
    }
    // Always keep the original (non-lowercased) root so save works on Windows
    if (typeof root === 'string' && root.length > 0) {
      this._originalRoot.set(key, root)
    }
    return model
  }

  saveAll() {
    for (const [key, model] of this._byRoot) {
      if (model.sampleCount > 0) {
        const root = this._originalRoot.get(key) || key
        try { model.save(root) } catch { /* best-effort */ }
      }
    }
  }
}

export const modelRegistry = new ModelRegistry()
export { FEATURE_COUNT, MIN_SAMPLES_FOR_ML }
