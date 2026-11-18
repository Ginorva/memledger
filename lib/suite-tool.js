// suite-tool.js — the `ledger_suite` agent tool.
//
// One tool, several actions, because tool definitions are a fixed tax on every
// session: `list` / `run` / `add` / `update` / `retire` / `sync` share one
// schema and one place to explain the contract.
//
// The tool deliberately reports the score, not just pass/fail: a suite whose
// score silently drifts downward is the early warning the ledger cannot give.

import {
  casesCovering,
  discoverPrograms,
  emptySuite,
  formatRunMessage,
  isValidProgramName,
  latestRun,
  listSuites,
  loadSuite,
  programOfEntry,
  readRuns,
  recordRun,
  runCases,
  saveSuite,
  selectCases,
  suiteHealth,
  syncProgramCards,
  validateCase,
  writeProgramCard,
} from './suite.js'
import { statsRegistry } from './stats.js'

const MESSAGE_CAP = 1200
const ACTIONS = ['list', 'run', 'add', 'update', 'retire', 'sync']

function msg(text) {
  return text.length > MESSAGE_CAP ? text.slice(0, MESSAGE_CAP - 24) + '\n…(已截断，narrow the scope)' : text
}

function inferProgram(root, args) {
  if (typeof args?.program === 'string' && args.program.trim().length > 0) return args.program.trim()
  if (Array.isArray(args?.paths) && args.paths.length > 0) {
    const programs = [...new Set(casesCovering(root, args.paths).map((hit) => hit.program))]
    if (programs.length === 1) return programs[0]
  }
  const suites = listSuites(root)
  return suites.length === 1 ? suites[0].program : ''
}

function nextCaseId(suite) {
  let max = 0
  for (const c of suite.cases) {
    const match = /^C-(\d+)$/i.exec(c.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `C-${String(max + 1).padStart(3, '0')}`
}

function card(root, program, entries) {
  const suite = loadSuite(root, program)
  if (!suite) return ''
  const found = discoverPrograms(root).find((item) => item.name === program)
  const health = suiteHealth(root, entries)
  return writeProgramCard(root, program, {
    description: found?.description ?? '',
    suite,
    runs: readRuns(root, { program, limit: 8 }),
    entries: (entries ?? []).filter((entry) => programOfEntry(root, entry) === program),
    debts: health.debts.filter((debt) => debt.program === program),
  })
}

/**
 * @param {{ readRoot: Function, readEntries: Function }} deps
 */
export function createSuiteTool(deps) {
  const { readRoot, readEntries } = deps

  return {
    name: 'ledger_suite',
    description:
      '程序契约套件：登记/跑分/停用可执行验收用例。用例=命令+退出码与 stdout 断言，按锚点选测；已落地条目应至少一条用例。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录；省略则从 cwd 向上找。' },
        action: { type: 'string', enum: ACTIONS, description: 'list|run|add|update|retire|sync' },
        program: { type: 'string', description: '程序名（含 package.json 的子目录，或工作区根）；省略时按 paths 或唯一套件推断。' },
        caseId: { type: 'string', description: '用例 id，如 C-003；add 省略则自动编号。' },
        title: { type: 'string', description: '这条用例守的是哪条契约（来自验收口径或回退原因）。' },
        from: { type: 'string', description: '来源：CL-… 或 RQ-…#验收口径N。' },
        covers: { type: 'array', items: { type: 'string' }, description: '覆盖锚点（相对程序目录），如 lib/x.js::fn；用于按改动选测。' },
        run: { type: 'string', description: '命令，如 "node test/x.mjs"；禁止 shell 元字符。' },
        expect: {
          type: 'object',
          description: '断言：exit（默认 0）、contains/notContains（stdout 必须/不得包含）。',
          properties: {
            exit: { type: 'number' },
            contains: { type: 'array', items: { type: 'string' } },
            notContains: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        weight: { type: 'number', description: '默认 1；倒车用例 5，验收口径 3。' },
        seenFail: { type: 'boolean', description: '是否已见它失败过一次（先红后绿）；没红过的用例守不住东西。' },
        paths: { type: 'array', items: { type: 'string' }, description: 'run 时按改动路径选测。' },
        reason: { type: 'string', description: 'update/retire 必填：为什么改判或停用这条契约。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          program: { type: 'string' },
          action: { type: 'string' },
          score: { type: 'number' },
          passed: { type: 'number' },
          failed: { type: 'number' },
          total: { type: 'number' },
          message: { type: 'string' },
        },
        required: ['ok', 'message'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const root = readRoot(args, exec)
      const action = String(args?.action ?? '')
      const stats = statsRegistry.get(root)
      stats.recordCall('ledger_suite')
      if (!ACTIONS.includes(action)) return { ok: false, root, message: `未知 action：${action}（可用：${ACTIONS.join(' / ')}）` }

      /* ------------------------------------------------------------- list */
      if (action === 'list') {
        const suites = listSuites(root)
        const programs = discoverPrograms(root)
        const lines = []
        if (suites.length === 0) {
          lines.push('还没有任何契约套件（docs/验收/ 为空）。')
          lines.push('下一步：挑一个程序登记第一条用例——它必须能守一条你不想被改回的决策。')
        } else {
          lines.push(`契约套件 ${suites.length} 个：`)
          for (const suite of suites) {
            const active = suite.cases.filter((c) => c.status === 'active').length
            const retired = suite.cases.filter((c) => c.status === 'retired').length
            const last = latestRun(root, suite.program)
            lines.push(
              `  ${suite.broken ? '🔴' : '🧪'} ${suite.program} · ${active} 例${retired > 0 ? `（停用 ${retired}）` : ''} · ` +
                (last ? `最近 ${last.passed}/${last.total} · ${last.score} 分` : '未跑过') +
                (suite.drift ? ' · ⚠️ 哈希漂移' : ''),
            )
          }
        }
        const adopted = new Set(suites.map((suite) => suite.program))
        const missing = programs.filter((program) => !adopted.has(program.name)).map((program) => program.name)
        if (missing.length > 0) lines.push(`\n未接入契约：${missing.join('、')}（用 add 登记第一条）`)
        const health = suiteHealth(root, readEntries(root))
        if (health.debts.length > 0) lines.push(`契约欠账：${health.debts.length} 条已落地决策没有任何用例覆盖。`)
        return { ok: true, root, action, message: msg(lines.join('\n')) }
      }

      /* -------------------------------------------------------------- run */
      if (action === 'run') {
        const program = inferProgram(root, args)
        if (program.length === 0) {
          return { ok: false, root, action, message: '无法确定程序：请传 program=，或传能唯一命中某个套件的 paths=。' }
        }
        const suite = loadSuite(root, program)
        if (!suite) return { ok: false, root, program, action, message: `${program} 还没有契约套件（docs/验收/${program}.json 不存在）。先用 action=add 登记用例。` }
        if (suite.broken) return { ok: false, root, program, action, message: `套件无法解析：${suite.broken}` }
        const cases = selectCases(suite, args?.paths)
        if (cases.length === 0) {
          return {
            ok: false,
            root,
            program,
            action,
            message: Array.isArray(args?.paths) && args.paths.length > 0
              ? `没有用例覆盖这些路径：${args.paths.join('、')}。要么这次改动确实没有契约（确认后用 action=add 补一条），要么 covers 写漏了。`
              : `${program} 的套件里没有可用用例（可能都 retired 了）。`,
          }
        }
        const previous = latestRun(root, program)
        const activeCount = suite.cases.filter((c) => c.status !== 'retired').length
        const summary = await runCases(root, program, cases, {
          trigger: 'ledger_suite run',
          partial: cases.length < activeCount,
        })
        recordRun(root, summary)
        const entries = readEntries(root)
        const cardPath = card(root, program, entries)
        const message =
          formatRunMessage(summary, previous) +
          `\n（已记入 docs/.memledger-runs.jsonl${cardPath ? `，程序卡已刷新：docs/程序/${program}.md` : ''}）`
        return {
          ok: true,
          root,
          program,
          action,
          score: summary.score ?? undefined,
          passed: summary.passed,
          failed: summary.failed,
          total: summary.total,
          message: msg(message),
        }
      }

      /* -------------------------------------------------------------- add */
      if (action === 'add') {
        const program = inferProgram(root, args)
        if (!isValidProgramName(program)) {
          return { ok: false, root, action, message: 'add 需要合法的 program（字母/数字/._-，不含路径分隔符）。' }
        }
        const candidate = {
          id: typeof args?.caseId === 'string' && args.caseId.trim().length > 0 ? args.caseId.trim() : '',
          title: args?.title,
          from: args?.from,
          covers: args?.covers,
          run: args?.run,
          expect: args?.expect,
          weight: args?.weight,
          seenFail: args?.seenFail,
          status: 'active',
        }
        const suite = loadSuite(root, program) ?? emptySuite(program)
        candidate.id = candidate.id || nextCaseId(suite)
        const check = validateCase(candidate)
        if (!check.valid) return { ok: false, root, program, action, message: '用例未通过校验：' + check.errors.join('；') }
        if (suite.cases.some((c) => c.id === check.case.id)) {
          return { ok: false, root, program, action, message: `${program} 已有用例 ${check.case.id}。改断言走 action=update（需 reason），别覆盖。` }
        }
        suite.cases = [...suite.cases, { ...check.case, added: new Date().toISOString().slice(0, 10) }]
        suite.version = (Number(suite.version) || 0) + 1
        saveSuite(root, suite)
        const cardPath = card(root, program, readEntries(root))
        const warnings = []
        if (!check.case.seenFail) warnings.push('⚠️ 这条用例还没观察到失败过。先确认它能红（故意改坏一行再跑），否则它可能守不住任何东西。')
        if (check.case.covers.length === 0) warnings.push('没写 covers：它不会被按改动选中，只能全量跑。')
        return {
          ok: true,
          root,
          program,
          action,
          message: msg(
            `已登记 ${program}/${check.case.id}：${check.case.title}（权重 ${check.case.weight}）` +
              (warnings.length > 0 ? '\n' + warnings.join('\n') : '') +
              `\n下一步：ledger_suite action=run program=${program}${cardPath ? `（程序卡：docs/程序/${program}.md）` : ''}`,
          ),
        }
      }

      /* ----------------------------------------------------------- update */
      if (action === 'update') {
        const program = inferProgram(root, args)
        const suite = program ? loadSuite(root, program) : null
        if (!suite) return { ok: false, root, program, action, message: `找不到 ${program || '该程序'} 的契约套件。` }
        const id = typeof args?.caseId === 'string' ? args.caseId.trim() : ''
        const index = suite.cases.findIndex((c) => c.id === id)
        if (index < 0) return { ok: false, root, program, action, message: `${program} 没有用例 ${id}。` }
        const reason = typeof args?.reason === 'string' ? args.reason.trim() : ''
        if (reason.length < 5) return { ok: false, root, program, action, message: 'update 必须传 reason（为什么这条契约要改，≥5 字）。改断言不留理由就是自证通过。' }
        const before = suite.cases[index]
        const merged = {
          ...before,
          title: typeof args?.title === 'string' && args.title.length > 0 ? args.title : before.title,
          from: typeof args?.from === 'string' && args.from.length > 0 ? args.from : before.from,
          covers: Array.isArray(args?.covers) ? args.covers : before.covers,
          run: typeof args?.run === 'string' && args.run.length > 0 ? args.run : before.run,
          weight: Number.isFinite(args?.weight) ? args.weight : before.weight,
          status: typeof args?.status === 'string' && ['active', 'flaky', 'retired'].includes(args.status) ? args.status : before.status,
          seenFail: typeof args?.seenFail === 'boolean' ? args.seenFail : before.seenFail,
          expect: args?.expect && typeof args.expect === 'object' ? { ...before.expect, ...stripUndefined(args.expect) } : before.expect,
        }
        const check = validateCase(merged)
        if (!check.valid) return { ok: false, root, program, action, message: '改后的用例不合法：' + check.errors.join('；') }
        suite.cases[index] = check.case
        suite.version = (Number(suite.version) || 0) + 1
        saveSuite(root, suite)
        card(root, program, readEntries(root))
        return {
          ok: true,
          root,
          program,
          action,
          message: msg(
            `已改判 ${program}/${id}（v${suite.version}）：${reason}\n` +
              '⚠️ 契约变了，历史分数与之后不可比。请在台账补一条「类型=口径」的条目说明为什么改——否则下次 ledger_verify 会问！',
          ),
        }
      }

      /* ----------------------------------------------------------- retire */
      if (action === 'retire') {
        const program = inferProgram(root, args)
        const suite = program ? loadSuite(root, program) : null
        if (!suite) return { ok: false, root, program, action, message: `找不到 ${program || '该程序'} 的契约套件。` }
        const id = typeof args?.caseId === 'string' ? args.caseId.trim() : ''
        const index = suite.cases.findIndex((c) => c.id === id)
        if (index < 0) return { ok: false, root, program, action, message: `${program} 没有用例 ${id}。` }
        const reason = typeof args?.reason === 'string' ? args.reason.trim() : ''
        if (reason.length < 5) return { ok: false, root, program, action, message: 'retire 必须传 reason（为什么不守了）。' }
        suite.cases[index] = { ...suite.cases[index], status: 'retired', note: reason }
        suite.version = (Number(suite.version) || 0) + 1
        saveSuite(root, suite)
        card(root, program, readEntries(root))
        const active = suite.cases.filter((c) => c.status === 'active').length
        return {
          ok: true,
          root,
          program,
          action,
          message: `已停用 ${program}/${id}：${reason}\n契约范围缩小到 ${active} 例——分数会因此不可比，别用新分数宣布进步。`,
        }
      }

      /* ------------------------------------------------------------- sync */
      const written = syncProgramCards(root, readEntries(root))
      const health = suiteHealth(root, readEntries(root))
      return {
        ok: true,
        root,
        action,
        message: msg(
          (written.length > 0 ? `已刷新 ${written.length} 张程序卡：${written.map((path) => path.split(/[\\/]/).slice(-2).join('/')).join('、')}` : '没有套件可刷新。') +
            (health.debts.length > 0 ? `\n契约欠账 ${health.debts.length} 条（已落地但无用例）：${health.debts.slice(0, 5).map((d) => d.id).join('、')}` : '') +
            (health.issues.length > 0 ? `\n⚠️ 套件问题 ${health.issues.length} 条，详见 ledger_verify。` : ''),
        ),
      }
    },
  }
}

function stripUndefined(object) {
  const out = {}
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined && value !== null) out[key] = value
  }
  return out
}
