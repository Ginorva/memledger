// suite.js — executable contract suites, one per program.
//
// The ledger records *why* a change happened. A suite records what must still be
// true afterwards. Both are indexed by the same `file::symbol` anchors, which is
// what makes the suite cheap: touching `lib/client.js::X` selects the handful of
// cases that cover X instead of the program's whole test tree.
//
// Three files, three jobs:
//
//   docs/验收/<program>.json        the contract — declarative, tiny, hash-frozen
//   docs/.memledger-runs.jsonl      append-only run history (the score trend)
//   docs/程序/<program>.md          the human-readable program card
//
// Deliberate constraints:
//
//  * No test framework. A case is a command plus assertions on exit code and
//    stdout. Anything richer becomes a second codebase that nobody re-reads,
//    and a suite nobody re-reads is a suite that silently rots.
//  * No execution from the GUI. Running is an agent action; an unauthenticated
//    localhost POST that spawns processes is not a feature, it is a hole.
//  * The command is checked against a shell-metacharacter denylist before it is
//    spawned. A workspace file must not be able to become a shell injection.
//  * `frozen.hash` covers run/expect/weight/covers. Editing a case by hand —
//    typically weakening an assertion to turn the bar green — is therefore
//    *visible*: `ledger_verify` reports the drift.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { anchorPathsOf, anchorStatus, normalizePath, samePath } from './anchors.js'

export const SUITES_RELATIVE = join('docs', '验收')
export const RUNS_RELATIVE = join('docs', '.memledger-runs.jsonl')
export const PROGRAMS_RELATIVE = join('docs', '程序')

const MAX_RUNS_KEPT = 500
const CASE_TIMEOUT_MS = 60_000
const CASE_TIMEOUT_CAP_MS = 300_000
const OUTPUT_CAP = 200_000
const RUN_MESSAGE_CAP = 1200

const CASE_STATUSES = ['active', 'flaky', 'retired']
const UNSAFE_CHARS = /[&|;<>`$(){}!%\r\n]/

function today() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function trunc(text, max) {
  const value = String(text ?? '')
  return value.length > max ? value.slice(0, max - 1) + '…' : value
}

function toList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item)).filter((item) => item.length > 0)
}

export function isValidProgramName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_@.\-]+$/.test(name)
}

/* ------------------------------------------------------------- programs -- */

/** A program is a directory with a package.json, plus the root itself when it has one. */
export function discoverPrograms(root) {
  const found = []
  const readDescription = (dir) => {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
      return typeof pkg.description === 'string' ? pkg.description : ''
    } catch {
      return ''
    }
  }
  if (existsSync(join(root, 'package.json'))) {
    found.push({ name: basename(root), dir: root, description: readDescription(root) })
  }
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (name.startsWith('.') || name === 'node_modules') continue
    const dir = join(root, name)
    if (!existsSync(join(dir, 'package.json'))) continue
    found.push({ name, dir, description: readDescription(dir) })
  }
  return found
}

/** Where a program's cases actually run. Unknown program names fall back to the root. */
export function programDir(root, program) {
  const direct = join(root, program)
  if (existsSync(direct) && existsSync(join(direct, 'package.json'))) return direct
  return root
}

/** Program names that exist on disk or have a suite registered. */
export function programNames(root) {
  const names = new Set(discoverPrograms(root).map((program) => program.name))
  for (const suite of listSuites(root)) names.add(suite.program)
  return [...names]
}

/**
 * Which program a ledger entry belongs to.
 *
 * `仓` is the stated field, but historical entries say "本仓" / "包装仓", so the
 * anchor's first path segment is the fallback that actually works.
 */
export function programOfEntry(root, entry, names = programNames(root)) {
  const set = names instanceof Set ? names : new Set(names)
  const stated = String(entry?.repo ?? '').trim()
  if (set.has(stated)) return stated
  for (const path of anchorPathsOf(entry?.anchor)) {
    const top = path.split('/')[0]
    if (set.has(top)) return top
  }
  return ''
}

/* ---------------------------------------------------------------- cases -- */

export function normalizeCase(raw) {
  const status = CASE_STATUSES.includes(raw?.status) ? raw.status : 'active'
  return {
    id: String(raw?.id ?? '').trim(),
    title: String(raw?.title ?? '').trim(),
    from: String(raw?.from ?? '').trim(),
    covers: Array.isArray(raw?.covers) ? raw.covers.map(normalizePath).filter(Boolean) : [],
    run: typeof raw?.run === 'string' ? raw.run.trim() : '',
    expect: {
      exit: Number.isInteger(raw?.expect?.exit) ? raw.expect.exit : 0,
      contains: toList(raw?.expect?.contains),
      notContains: toList(raw?.expect?.notContains),
      matches: typeof raw?.expect?.matches === 'string' ? raw.expect.matches : '',
    },
    weight: Number.isFinite(raw?.weight) && raw.weight > 0 ? Math.min(50, Math.round(raw.weight)) : 1,
    status,
    seenFail: raw?.seenFail === true,
    note: String(raw?.note ?? '').trim(),
    timeoutMs: Number.isFinite(raw?.timeoutMs) && raw.timeoutMs > 0 ? raw.timeoutMs : CASE_TIMEOUT_MS,
    added: String(raw?.added ?? ''),
  }
}

/** Reject a case before it is stored, so a broken contract never reaches a run. */
export function validateCase(raw) {
  const c = normalizeCase(raw)
  const errors = []
  if (c.id.length === 0) errors.push('缺少用例 id')
  if (c.title.length === 0) errors.push('缺少用例标题（一句话说明它守的是哪条契约）')
  const unsafe = unsafeReason(c.run)
  if (unsafe) errors.push(unsafe)
  if (c.expect.matches) {
    try {
      new RegExp(c.expect.matches)
    } catch {
      errors.push(`matches 不是合法正则：${c.expect.matches}`)
    }
  }
  return { valid: errors.length === 0, errors, case: c }
}

/**
 * The path half of a `covers` entry, made root-relative.
 * Covers are written relative to the program directory, which is what the person
 * editing the suite sees; ledger_check targets are root-relative.
 */
export function coverRootPath(program, cover) {
  const path = normalizePath(String(cover).split('::')[0])
  if (path.length === 0) return ''
  if (program.length === 0 || path.startsWith(program + '/')) return path
  return `${program}/${path}`
}

/**
 * Shell metacharacters are refused rather than escaped.
 *
 * `cmd.exe` quoting is not something a plugin should get clever about at 2am;
 * refusing keeps the blast radius at "this case cannot be registered".
 */
export function unsafeReason(command) {
  const text = String(command ?? '').trim()
  if (text.length === 0) return '用例缺少 run 命令'
  if (text.length > 400) return 'run 命令过长（>400 字符）'
  if (UNSAFE_CHARS.test(text)) return 'run 命令含 shell 元字符（& | ; < > ` $ ( ) { } ! % 换行），拒绝执行'
  return ''
}

/* --------------------------------------------------------------- suites -- */

export function suitesDir(root) {
  return join(root, SUITES_RELATIVE)
}

export function suitePath(root, program) {
  return join(suitesDir(root), `${program}.json`)
}

/** Hash over exactly the parts that decide pass/fail — not titles or notes. */
export function hashCases(cases) {
  const basis = cases
    .map((c) => [c.id, c.run, c.weight, c.status, c.covers.join('|'), JSON.stringify(c.expect)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 16)
}

export function emptySuite(program) {
  return { program, version: 0, updated: '', frozen: { hash: '', at: '' }, cases: [], hash: '', drift: false }
}

export function loadSuite(root, program) {
  const path = suitePath(root, program)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    const cases = Array.isArray(parsed?.cases) ? parsed.cases.map(normalizeCase) : []
    const hash = hashCases(cases)
    const frozen = parsed?.frozen && typeof parsed.frozen === 'object' ? parsed.frozen : { hash: '', at: '' }
    return {
      program: typeof parsed?.program === 'string' && parsed.program.length > 0 ? parsed.program : program,
      version: Number.isFinite(parsed?.version) ? parsed.version : 0,
      updated: typeof parsed?.updated === 'string' ? parsed.updated : '',
      frozen,
      cases,
      hash,
      drift: typeof frozen.hash === 'string' && frozen.hash.length > 0 && frozen.hash !== hash,
    }
  } catch (cause) {
    return { ...emptySuite(program), broken: cause instanceof Error ? cause.message : String(cause) }
  }
}

export function saveSuite(root, suite) {
  const dir = suitesDir(root)
  mkdirSync(dir, { recursive: true })
  const cases = suite.cases.map(normalizeCase)
  const hash = hashCases(cases)
  const payload = {
    program: suite.program,
    version: Number(suite.version) || 0,
    updated: today(),
    frozen: { hash, at: new Date().toISOString() },
    cases,
  }
  writeFileSync(suitePath(root, suite.program), JSON.stringify(payload, null, 2) + '\n', 'utf-8')
  return { ...payload, hash, drift: false }
}

export function listSuites(root) {
  const dir = suitesDir(root)
  if (!existsSync(dir)) return []
  const suites = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const suite = loadSuite(root, name.slice(0, -'.json'.length))
    if (suite) suites.push(suite)
  }
  return suites.sort((a, b) => a.program.localeCompare(b.program))
}

/* ----------------------------------------------------------------- runs -- */

export function appendRun(root, record) {
  const path = join(root, RUNS_RELATIVE)
  mkdirSync(dirname(path), { recursive: true })
  let lines = []
  if (existsSync(path)) {
    lines = readFileSync(path, 'utf-8').split('\n').filter((line) => line.trim().length > 0)
  }
  lines.push(JSON.stringify(record))
  const bounded = lines.slice(-MAX_RUNS_KEPT)
  // Only rewrite the file when the cap actually bit; the common path is a
  // single-line append, which is what keeps the history cheap to maintain.
  if (bounded.length === lines.length) {
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
  } else {
    writeFileSync(path, bounded.join('\n') + '\n', 'utf-8')
  }
}

export function readRuns(root, options = {}) {
  const path = join(root, RUNS_RELATIVE)
  if (!existsSync(path)) return []
  const runs = []
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const text = line.trim()
    if (text.length === 0) continue
    try {
      const record = JSON.parse(text)
      if (typeof options.program !== 'string' || record.program === options.program) runs.push(record)
    } catch {
      // A torn line is not worth failing a whole history read over.
    }
  }
  return typeof options.limit === 'number' && options.limit > 0 ? runs.slice(-options.limit) : runs
}

export function latestRun(root, program, options = {}) {
  const runs = readRuns(root, { program, limit: options.limit })
  // A run over the cases selected by a diff is evidence about that change, not
  // a measure of the program: folding its score into the trend would let a
  // one-case run masquerade as "the program is at 100".
  const relevant = options.includePartial ? runs : runs.filter((run) => !run.partial)
  return relevant.length > 0 ? relevant[relevant.length - 1] : null
}

/* -------------------------------------------------------------- running -- */

function killTree(child) {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
      return
    }
    child.kill('SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // the process is already gone
    }
  }
}

/**
 * Run one case command. Never throws: a spawn failure is a failed case, because
 * a suite run that explodes is worse than a suite run that reports red.
 *
 * Output goes to files rather than through piped stdio. Two reasons: a chatty
 * case can never deadlock on a full pipe, and confined sandboxes refuse piped
 * stdio outright — a runner that only works unsandboxed is not a runner.
 *
 * The capture files live under the workspace (`docs/.memledger-capture/`)
 * because that is the one place every sandbox agrees is writable. They are
 * removed per case; the directory is hidden and holds nothing else.
 */
export function runCommand(command, cwd, options = {}) {
  const timeoutMs = typeof options === 'number' ? options : options.timeoutMs ?? CASE_TIMEOUT_MS
  const captureRoot = typeof options === 'object' && typeof options.captureRoot === 'string' ? options.captureRoot : ''
  return new Promise((resolve) => {
    const started = Date.now()
    const unsafe = unsafeReason(command)
    if (unsafe) {
      resolve({ exitCode: null, stdout: '', stderr: '', ms: 0, timedOut: false, error: unsafe })
      return
    }
    const isWin = process.platform === 'win32'
    const shell = isWin ? process.env.ComSpec || 'cmd.exe' : '/bin/sh'
    const shellArgs = isWin ? ['/d', '/s', '/c', command] : ['-c', command]
    const limitMs = Math.min(Math.max(1000, timeoutMs), CASE_TIMEOUT_CAP_MS)

    let tmpDir = ''
    let outFd = null
    let errFd = null
    let outPath = ''
    let errPath = ''
    let child = null

    const cleanup = () => {
      if (outFd !== null) {
        try {
          closeSync(outFd)
        } catch {
          // already closed
        }
        outFd = null
      }
      if (errFd !== null) {
        try {
          closeSync(errFd)
        } catch {
          // already closed
        }
        errFd = null
      }
      if (tmpDir.length > 0) {
        try {
          rmSync(tmpDir, { recursive: true, force: true })
        } catch {
          // temp files are best-effort
        }
        tmpDir = ''
      }
    }

    try {
      // Workspace first (the only reliably writable place under a sandbox),
      // system temp second (the normal case outside one).
      const bases = [captureRoot, tmpdir()].filter((base) => base.length > 0)
      let lastError = null
      for (const base of bases) {
        try {
          mkdirSync(base, { recursive: true })
          tmpDir = mkdtempSync(join(base, 'ml-'))
          break
        } catch (cause) {
          lastError = cause
        }
      }
      if (tmpDir.length === 0) {
        throw lastError ?? new Error('无法创建输出捕获目录')
      }
      outPath = join(tmpDir, 'stdout.log')
      errPath = join(tmpDir, 'stderr.log')
      outFd = openSync(outPath, 'w')
      errFd = openSync(errPath, 'w')
      child = spawn(shell, shellArgs, {
        cwd: existsSync(cwd) ? cwd : process.cwd(),
        env: { ...process.env, NO_COLOR: '1', MEMLEDGER_SUITE: '1' },
        windowsHide: true,
        windowsVerbatimArguments: isWin,
        stdio: ['ignore', outFd, errFd],
      })
    } catch (cause) {
      cleanup()
      resolve({ exitCode: null, stdout: '', stderr: '', ms: Date.now() - started, timedOut: false, error: cause instanceof Error ? cause.message : String(cause) })
      return
    }

    let settled = false
    let timedOut = false
    let timer = null
    const readCapped = (path) => {
      try {
        if (!existsSync(path)) return ''
        const text = readFileSync(path, 'utf-8')
        return text.length > OUTPUT_CAP ? text.slice(0, OUTPUT_CAP) : text
      } catch {
        return ''
      }
    }
    const finish = (exitCode, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdout = readCapped(outPath)
      const stderr = readCapped(errPath)
      cleanup()
      resolve({
        exitCode,
        stdout,
        stderr,
        ms: Date.now() - started,
        timedOut,
        error: error ?? (timedOut ? `超时 ${Math.round(limitMs / 1000)}s，已终止` : undefined),
      })
    }
    timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, limitMs)
    child.on('error', (cause) => finish(null, cause instanceof Error ? cause.message : String(cause)))
    child.on('close', (code) => finish(code ?? null, null))
  })
}

export function evaluateCase(c, outcome) {
  const want = Number.isInteger(c.expect?.exit) ? c.expect.exit : 0
  const reasons = []
  let ok = true
  if (outcome.error) {
    ok = false
    reasons.push(outcome.error)
  } else if (outcome.exitCode !== want) {
    ok = false
    reasons.push(`退出码 ${outcome.exitCode === null ? '缺失' : outcome.exitCode}（期望 ${want}）`)
  }
  for (const needle of c.expect?.contains ?? []) {
    if (!outcome.stdout.includes(needle)) {
      ok = false
      reasons.push(`stdout 缺少「${trunc(needle, 24)}」`)
    }
  }
  for (const needle of c.expect?.notContains ?? []) {
    if (outcome.stdout.includes(needle)) {
      ok = false
      reasons.push(`stdout 出现禁区「${trunc(needle, 24)}」`)
    }
  }
  if (c.expect?.matches) {
    try {
      if (!new RegExp(c.expect.matches).test(outcome.stdout)) {
        ok = false
        reasons.push(`stdout 不匹配 /${trunc(c.expect.matches, 32)}/`)
      }
    } catch {
      ok = false
      reasons.push('matches 正则无效')
    }
  }
  return {
    id: c.id,
    title: c.title,
    weight: c.weight,
    status: c.status,
    seenFail: c.seenFail === true,
    ok,
    reason: ok ? '' : reasons.join('；') || '断言未通过',
    exitCode: outcome.exitCode ?? null,
    timedOut: Boolean(outcome.timedOut),
    ms: outcome.ms,
  }
}

/** Run the selected cases sequentially. Sequential keeps the output readable and the failures attributable. */
export async function runCases(root, program, cases, options = {}) {
  const dir = programDir(root, program)
  const captureRoot = join(root, 'docs', '.memledger-capture')
  const started = Date.now()
  const results = []
  for (const c of cases) {
    if (c.status === 'retired') continue
    const outcome = await runCommand(c.run, dir, { timeoutMs: c.timeoutMs, captureRoot })
    results.push(evaluateCase(c, outcome))
  }
  const scored = results.filter((result) => result.status !== 'flaky')
  const weightTotal = scored.reduce((sum, result) => sum + (result.weight || 1), 0)
  const weightPassed = scored.filter((result) => result.ok).reduce((sum, result) => sum + (result.weight || 1), 0)
  const summary = {
    program,
    dir,
    at: new Date().toISOString(),
    ms: Date.now() - started,
    passed: scored.filter((result) => result.ok).length,
    failed: scored.filter((result) => !result.ok).length,
    total: scored.length,
    flaky: results.filter((result) => result.status === 'flaky').length,
    weightTotal,
    weightPassed,
    score: weightTotal === 0 ? null : Math.round((weightPassed / weightTotal) * 100),
    cases: results,
    partial: options.partial === true,
    trigger: typeof options.trigger === 'string' ? options.trigger : '',
  }
  return summary
}

export function recordRun(root, summary) {
  const previous = latestRun(root, summary.program)
  const record = {
    ts: summary.at,
    program: summary.program,
    score: summary.score,
    passed: summary.passed,
    total: summary.total,
    failed: summary.failed,
    flaky: summary.flaky,
    ms: summary.ms,
    partial: summary.partial === true,
    trigger: summary.trigger,
    cases: summary.cases.map((result) => ({ id: result.id, ok: result.ok, ms: result.ms, reason: result.reason })),
    prevScore: previous && Number.isFinite(previous.score) ? previous.score : null,
  }
  appendRun(root, record)
  return record
}

/** Pick the cases a change can plausibly break. No paths = the whole suite. */
export function selectCases(suite, paths) {
  const active = suite.cases.filter((c) => c.status !== 'retired')
  if (!Array.isArray(paths) || paths.length === 0) return active
  const targets = paths.map(normalizePath).filter(Boolean)
  return active.filter((c) =>
    c.covers.some((cover) => {
      const rootPath = coverRootPath(suite.program, cover)
      return targets.some((target) => samePath(rootPath, target))
    }),
  )
}

/** Cases across every program that cover the given root-relative paths. */
export function casesCovering(root, paths) {
  const targets = (Array.isArray(paths) ? paths : []).map(normalizePath).filter(Boolean)
  if (targets.length === 0) return []
  const hits = []
  for (const suite of listSuites(root)) {
    for (const c of suite.cases) {
      if (c.status === 'retired') continue
      if (c.covers.some((cover) => targets.some((target) => samePath(coverRootPath(suite.program, cover), target)))) {
        hits.push({ program: suite.program, case: c })
      }
    }
  }
  return hits
}

/* ----------------------------------------------------------- reporting -- */

export function formatRunMessage(summary, previous) {
  const lines = []
  const delta =
    previous && Number.isFinite(previous.score) && Number.isFinite(summary.score)
      ? summary.score - previous.score
      : null
  const deltaText = delta === null ? '' : delta === 0 ? ' · 持平' : ` · 较上次 ${delta > 0 ? '+' : ''}${delta}`
  lines.push(
    `🧪 ${summary.program}${summary.partial ? '（选测）' : ''} · ${summary.passed}/${summary.total} 通过 · 契约分 ${summary.score ?? '—'}${deltaText}`,
  )
  const failed = summary.cases.filter((result) => !result.ok)
  for (const result of failed.slice(0, 5)) {
    lines.push(`  ✗ ${result.id} ${trunc(result.title, 28)} — ${result.reason}`)
  }
  if (failed.length > 5) lines.push(`  …另 ${failed.length - 5} 例失败`)
  if (summary.flaky > 0) lines.push(`  （${summary.flaky} 例 flaky 已隔离，不计分）`)
  const neverFailed = summary.cases.filter((result) => result.ok && !result.seenFail)
  if (failed.length === 0 && summary.total > 0 && neverFailed.length === summary.total) {
    lines.push('  ⚠️ 全部一次通过——确认这些断言失败过（先红后绿），否则它们守不住任何东西。')
  }
  let message = lines.join('\n')
  if (message.length > RUN_MESSAGE_CAP) message = message.slice(0, RUN_MESSAGE_CAP - 20) + '\n…(已截断)'
  return message
}

export function renderProgramCard({ program, description, suite, runs, entries, debts }) {
  const active = suite.cases.filter((c) => c.status === 'active')
  const flaky = suite.cases.filter((c) => c.status === 'flaky')
  const retired = suite.cases.filter((c) => c.status === 'retired')
  const last = runs.length > 0 ? runs[runs.length - 1] : null
  const trend = runs.slice(-8).map((run) => (run.score === null || run.score === undefined ? '—' : String(run.score))).join(' → ')
  const lastById = new Map()
  for (const result of last?.cases ?? []) lastById.set(result.id, result)

  const lines = [
    `# 程序卡 · ${program}`,
    '',
    '> 由 MemLedger 自动生成（`ledger_suite sync` 或每次跑分后刷新）。手改会在下次刷新时被覆盖。',
    `> 生成时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    '## 1. 概览',
    '',
    `- 目录：\`${program}\``,
  ]
  if (description) lines.push(`- 职责：${description}`)
  lines.push(
    `- 契约：${active.length} 例 active${flaky.length > 0 ? ` / ${flaky.length} 例 flaky` : ''}${retired.length > 0 ? ` / ${retired.length} 例 retired` : ''}`,
  )
  lines.push(
    last
      ? `- 最近跑分：**${last.score ?? '—'} 分** · ${last.passed}/${last.total} 通过 · ${String(last.ts).slice(0, 16).replace('T', ' ')}`
      : '- 最近跑分：未跑过',
  )
  if (runs.length > 1) lines.push(`- 趋势（最近 ${runs.length} 次）：${trend}`)
  lines.push('', '## 2. 契约用例', '')

  if (suite.cases.length === 0) {
    lines.push('（还没有登记任何用例。改完一处就补一条：`ledger_suite action=add`。）')
  } else {
    lines.push('| ID | 用例 | 覆盖 | 来源 | 权重 | 最近 |')
    lines.push('|---|---|---|---|---|---|')
    for (const c of suite.cases) {
      const result = lastById.get(c.id)
      const state = c.status === 'retired' ? '⏹ 已停用' : c.status === 'flaky' ? '🌗 flaky' : result ? (result.ok ? '🟢 通过' : '🔴 失败') : '⚪ 未跑'
      lines.push(
        `| ${c.id}${c.seenFail ? '' : ' ⚠'} | ${escapeCell(c.title)} | ${escapeCell(c.covers.join('、') || '—')} | ${escapeCell(c.from || '—')} | ${c.weight} | ${state} |`,
      )
    }
    const weak = suite.cases.filter((c) => c.status === 'active' && !c.seenFail)
    if (weak.length > 0) {
      lines.push('', `> ⚠ 标记的 ${weak.length} 例从未观察到失败。一条没红过的用例，通常守不住任何东西。`)
    }
  }

  lines.push('', '## 3. 台账条目（最近 8 条）', '')
  if (entries.length === 0) {
    lines.push('（该程序还没有台账条目。）')
  } else {
    lines.push('| ID | 日期 | 状态 | 标题 |')
    lines.push('|---|---|---|---|')
    for (const entry of entries.slice(-8).reverse()) {
      lines.push(`| ${entry.id} | ${entry.date} | \`${entry.status}\` | ${escapeCell(entry.title)} |`)
    }
  }

  lines.push('', '## 4. 契约欠账', '')
  if (debts.length === 0) {
    lines.push('（已落地条目都有用例覆盖。）')
  } else {
    lines.push(`- 已落地但没有任何用例覆盖（${debts.length} 条）：`)
    for (const debt of debts.slice(0, 10)) {
      lines.push(`  - ${debt.id} · ${escapeCell(debt.title)} · \`${debt.anchor}\``)
    }
    if (debts.length > 10) lines.push(`  - …另 ${debts.length - 10} 条`)
  }
  lines.push('')
  return lines.join('\n')
}

function escapeCell(text) {
  return String(text ?? '').replace(/[\r\n|]/g, ' ').trim() || '—'
}

/** Test files are their own contract — see the skip in suiteHealth. */
export function isTestPath(path) {
  return /(^|\/)test\//i.test(path) || /(^|\/)tests\//i.test(path) || /\.(test|spec)\.[a-z0-9]+$/i.test(path)
}

/**
 * Suite health for `ledger_verify`.
 *
 * Three rot modes, in the order they matter: assertions edited behind the
 * tool's back, cases pointing at code that no longer exists, and landed
 * decisions that never got a case at all.
 */
export function suiteHealth(root, entries) {
  const suites = listSuites(root)
  const issues = []
  const debts = []
  const regressionDebts = []
  const names = new Set([...discoverPrograms(root).map((p) => p.name), ...suites.map((s) => s.program)])

  for (const suite of suites) {
    if (suite.broken) {
      issues.push(`套件 ${suite.program} 无法解析：${suite.broken}`)
      continue
    }
    if (suite.drift) {
      issues.push(`套件 ${suite.program} 的哈希与登记时不一致——断言被绕过工具改过，` +
        `需补一条「类型=口径」的台账条目说明为什么改，或跑 ledger_suite 重新登记`)
    }
    for (const c of suite.cases) {
      if (c.status === 'retired') continue
      for (const cover of c.covers) {
        const rootPath = coverRootPath(suite.program, cover)
        if (anchorStatus(root, [rootPath]) === 'dead') {
          issues.push(`用例 ${suite.program}/${c.id} 的覆盖锚点已不存在：${rootPath}（用例已失效，考虑 retire）`)
        }
      }
    }
    const covered = new Set()
    for (const c of suite.cases) {
      if (c.status === 'retired') continue
      for (const cover of c.covers) covered.add(normalizePath(cover.split('::')[0]))
    }
    for (const entry of entries ?? []) {
      if (entry.status !== '已落地') continue
      if (programOfEntry(root, entry, names) !== suite.program) continue
      const paths = anchorPathsOf(entry.anchor).map((path) => (path.startsWith(suite.program + '/') ? path.slice(suite.program.length + 1) : path))
      if (paths.length === 0) continue
      // A decision anchored at a test *is* its own contract. Demanding a case
      // that covers the test would be circular — and an unclearable debt is the
      // fastest way to teach everyone to ignore the debt list.
      if (paths.every(isTestPath)) continue
      const hasCase = [...covered].some((cover) => paths.some((path) => samePath(cover, path)))
      if (!hasCase) debts.push({ id: entry.id, title: entry.title, anchor: entry.anchor, program: suite.program })
    }

    // Antibody check (RSI): a rolled back entry MUST have an active regression
    // contract (weight >= 5) to prevent recurring regressions.
    const antibodyCases = suite.cases.filter((c) => c.status !== 'retired' && (c.weight ?? 1) >= 5)
    for (const entry of entries ?? []) {
      if (entry.status !== '已回退') continue
      if (programOfEntry(root, entry, names) !== suite.program) continue
      const paths = anchorPathsOf(entry.anchor).map((path) => (path.startsWith(suite.program + '/') ? path.slice(suite.program.length + 1) : path))
      if (paths.length === 0 || paths.every(isTestPath)) continue
      const hasAntibody = antibodyCases.some((c) =>
        c.from === entry.id ||
        c.covers.some((cover) => paths.some((path) => samePath(normalizePath(cover.split('::')[0]), path)))
      )
      if (!hasAntibody) {
        regressionDebts.push({ id: entry.id, title: entry.title, anchor: entry.anchor, program: suite.program })
      }
    }
  }

  // Debts for programs that have entries but no suite at all are only counted:
  // nagging about a program nobody has adopted yet is how a check gets ignored.
  const adopted = new Set(suites.map((suite) => suite.program))
  const unadopted = new Map()
  for (const entry of entries ?? []) {
    if (entry.status !== '已落地') continue
    const program = programOfEntry(root, entry, names)
    if (program.length === 0 || adopted.has(program) || !names.has(program)) continue
    unadopted.set(program, (unadopted.get(program) ?? 0) + 1)
  }

  return {
    issues,
    debts,
    regressionDebts,
    suites: suites.length,
    cases: suites.reduce((sum, suite) => sum + suite.cases.filter((c) => c.status !== 'retired').length, 0),
    unadopted: [...unadopted.entries()].map(([program, count]) => ({ program, count })),
  }
}

export function writeProgramCard(root, program, { description, suite, runs, entries, debts }) {
  const dir = join(root, PROGRAMS_RELATIVE)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${program}.md`)
  writeFileSync(path, renderProgramCard({ program, description, suite, runs, entries, debts }), 'utf-8')
  return path
}

/** Rebuild every program card. Cheap: one small markdown per program. */
export function syncProgramCards(root, entries) {
  const suites = listSuites(root)
  const programs = discoverPrograms(root)
  const names = new Set([...programs.map((program) => program.name), ...suites.map((suite) => suite.program)])
  const health = suiteHealth(root, entries)
  const written = []
  for (const suite of suites) {
    const found = programs.find((program) => program.name === suite.program)
    const programEntries = (entries ?? []).filter((entry) => programOfEntry(root, entry, names) === suite.program)
    const debts = health.debts.filter((debt) => debt.program === suite.program)
    written.push(
      writeProgramCard(root, suite.program, {
        description: found?.description ?? '',
        suite,
        runs: readRuns(root, { program: suite.program, limit: 8 }),
        entries: programEntries,
        debts,
      }),
    )
  }
  return written
}
