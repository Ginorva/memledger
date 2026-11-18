// Smoke test for the injected rule block (CL-20261117-21).
//
// The block is prepended to *every* session, so its cost is paid on every turn.
// That decision was "delete the tool table and keep only the workflow" — this
// test is what stops the table from growing back.
//
// It deliberately avoids temp files (unlike inject-rules-smoke, which tests the
// file merge/idempotency path): this contract must be checkable even where a
// sandbox refuses temp directories.

import { buildRuleBlock, BEGIN_MARKER, END_MARKER } from '../lib/inject-rules.js'

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

const block = buildRuleBlock()

console.log('markers:')
check('starts with the begin marker', block.startsWith(BEGIN_MARKER), block.slice(0, 40))
check('ends with the end marker', block.trimEnd().endsWith(END_MARKER), block.slice(-40))

console.log('budget:')
check('stays under 1900 chars', block.length <= 1900, String(block.length))

console.log('workflow steps:')
const steps = ['0. **建需求**', '1. **定位**', '2. **查重**', '3. **入册**', '4. **刷新地图**', '5. **收口需求**', '6. **留契约**']
for (const step of steps) {
  check(`has ${step}`, block.includes(step))
}
check('sends landed work to ledger_suite', block.includes('ledger_suite'))
check('sends duplicate checks to ledger_check', block.includes('ledger_check'))

console.log('no repeated tool table:')
// The tool table was 8 rows of "| `ledger_x` | when | what |" — pure duplication,
// because every tool already carries its own description.
check('has no markdown table at all', !/^\s*\|/m.test(block), (block.match(/^\s*\|.*$/m) || [''])[0])
check('does not repeat a tool row', !block.includes('| **`ledger_'), block.slice(0, 80))

console.log(failures === 0 ? '\nrules-smoke: all checks passed' : `\nrules-smoke: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
