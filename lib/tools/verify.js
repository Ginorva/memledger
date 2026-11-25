// dsh-memledger — ledger_verify tool.
//
// Anchor health check: validates that landed entries still have their code.

import { LedgerManager } from '../ledger-manager.js'
import { statsRegistry } from '../stats.js'
import { suiteHealth } from '../suite.js'
import { readRoot, readEntries } from '../workspace-resolver.js'

export function verifyTool() {
  return {
    name: 'ledger_verify',
    description:
      '锚点体检：已落地条目的代码是否还在。锚点缺失说明早前的修复可能被静默改没——这是防回退的检查。',
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录；省略则从 cwd 向上找。' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          checked: { type: 'number' },
          missing: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          unverifiable: { type: 'array', items: { type: 'string' } },
          superseded: { type: 'array', items: { type: 'string' } },
          suiteIssues: { type: 'array', items: { type: 'string' } },
          contractDebts: { type: 'array', items: { type: 'string' } },
          regressionDebts: { type: 'array', items: { type: 'string' } },
          message: { type: 'string' },
        },
        required: ['ok', 'message'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const root = readRoot(args, exec)
      const stats = statsRegistry.get(root)
      stats.recordCall('ledger_verify')
      const manager = new LedgerManager(root)
      const outcome = manager.verify()
      const unknown = outcome.unknown ?? []
      const warns = outcome.warns ?? []
      const superseded = outcome.superseded ?? []
      const health = suiteHealth(root, readEntries(root))
      stats.recordVerifyResult(outcome.fails.length)
      const parts = []
      if (outcome.ok) parts.push(`锚点体检通过：${outcome.oks.length} 处已落地锚点文件齐全。`)
      else parts.push(`发现 ${outcome.fails.length} 处锚点缺失：` + outcome.fails.join('；'))
      if (superseded.length > 0) parts.push(`${superseded.length} 条已被取代，不核验（由取代它的那条负责）。`)
      if (unknown.length > 0) parts.push(`${unknown.length} 处锚点指向其它仓库，本仓无法核验（不计为倒车）。`)
      if (warns.length > 0) {
        const shown = warns.slice(0, 4).join('；') + (warns.length > 4 ? `；…另 ${warns.length - 4} 条` : '')
        parts.push(`⚠️ ${warns.length} 处提醒：${shown}`)
      }
      if (health.suites > 0) {
        parts.push(`🧪 契约套件 ${health.suites} 个 / ${health.cases} 例。`)
        if (health.issues.length > 0) {
          const shown = health.issues.slice(0, 3).join('；') + (health.issues.length > 3 ? `；…另 ${health.issues.length - 3} 条` : '')
          parts.push(`⚠️ 套件问题 ${health.issues.length} 条：${shown}`)
        }
        if (health.debts.length > 0) {
          parts.push(`📋 契约欠账 ${health.debts.length} 条（已落地但无用例）：${health.debts.slice(0, 5).map((debt) => debt.id).join('、')}`)
        }
        if (health.regressionDebts && health.regressionDebts.length > 0) {
          parts.push(`🚨 免疫抗体缺失 ${health.regressionDebts.length} 条（已回退但无防倒车契约）：${health.regressionDebts.slice(0, 5).map((debt) => debt.id).join('、')}`)
        }
      }
      return {
        ok: outcome.ok,
        root,
        checked: outcome.oks.length + outcome.fails.length,
        missing: outcome.fails,
        warnings: warns,
        unverifiable: unknown,
        superseded,
        suiteIssues: health.issues,
        contractDebts: health.debts.map((debt) => debt.id),
        regressionDebts: (health.regressionDebts ?? []).map((debt) => debt.id),
        message: parts.join(' '),
      }
    },
  }
}
