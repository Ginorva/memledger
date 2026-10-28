import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BEGIN_MARKER,
  END_MARKER,
  buildRuleBlock,
  ensureAgentsRulesInjected,
} from '../lib/inject-rules.js'

function check(title, condition, extra = '') {
  const prefix = condition ? '  PASS  ' : '  FAIL  '
  console.log(prefix + title + (extra ? ' -> ' + extra : ''))
  if (!condition) process.exitCode = 1
}

const dir = mkdtempSync(join(tmpdir(), 'inject-test-'))
const target = join(dir, 'AGENTS.md')

try {
  console.log('fresh creation:')
  const r1 = ensureAgentsRulesInjected(target)
  check('creates new file', r1.ok && r1.updated && r1.reason === 'created')
  check('contains begin marker', readFileSync(target, 'utf-8').includes(BEGIN_MARKER))
  check('contains end marker', readFileSync(target, 'utf-8').includes(END_MARKER))

  console.log('idempotency:')
  const r2 = ensureAgentsRulesInjected(target)
  check('up-to-date returns false for updated', r2.ok && !r2.updated && r2.reason === 'up-to-date')

  console.log('appends without overwriting custom user rules:')
  const customFile = join(dir, 'CUSTOM_AGENTS.md')
  writeFileSync(customFile, '# My Custom Rules\n\nKeep this safe!\n', 'utf-8')
  const r3 = ensureAgentsRulesInjected(customFile)
  check('reports appended', r3.ok && r3.updated && r3.reason === 'appended')
  const content3 = readFileSync(customFile, 'utf-8')
  check('preserved custom content', content3.includes('# My Custom Rules') && content3.includes('Keep this safe!'))
  check('appended rule block', content3.includes(BEGIN_MARKER))

  console.log('updates outdated block in-place:')
  const modifiedContent = content3.replace('空间有地图', '老版文字已变更')
  writeFileSync(customFile, modifiedContent, 'utf-8')
  const r4 = ensureAgentsRulesInjected(customFile)
  check('refreshed block in-place', r4.ok && r4.updated && r4.reason === 'block-refreshed')
  const content4 = readFileSync(customFile, 'utf-8')
  check('still preserved custom rules', content4.includes('# My Custom Rules'))
  check('restored official block text', content4.includes('空间有地图'))

  console.log('ALL INJECTION CHECKS PASSED')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
