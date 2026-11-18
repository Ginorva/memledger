// Smoke test for the entry schema: keyword retrieval rules and terminal states.
//
// Two contracts live here, both of which were landed as fixes to this very
// ledger and both of which are easy to undo by "simplifying" the validator:
//
//   CL-20261117-24  keywords are a search index (≥2, never type-only)
//   CL-20261117-18  已废弃 is a terminal state, not open work
//
// A validator that accepts everything is not a validator; the assertions below
// are the ones that actually fired on real entries.

import { validateEntry, isUnsettled, ABANDONED_STATUSES } from '../lib/schema.js'

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label)
  } else {
    failures += 1
    console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail))
  }
}

function entry(over = {}) {
  return {
    id: 'CL-20260101-01',
    title: '测试条目',
    date: '2026-01-01',
    type: '修复',
    status: '已落地',
    anchor: 'lib/x.js::fn',
    why: '因为所以，科学道理，至少五个字。',
    keywords: ['领域词', '符号名'],
    ...over,
  }
}

console.log('keywords are a search index:')
check('a well-formed entry validates', validateEntry(entry()).valid, JSON.stringify(validateEntry(entry()).errors))
check('no keywords is refused', !validateEntry(entry({ keywords: [] })).valid)
check('one keyword is refused', !validateEntry(entry({ keywords: ['领域词'] })).valid, JSON.stringify(validateEntry(entry({ keywords: ['领域词'] })).errors))
check('type-only keywords are refused', !validateEntry(entry({ keywords: ['修复', '重构'] })).valid)
check('one type + one real word passes', validateEntry(entry({ keywords: ['修复', '幂等'] })).valid, JSON.stringify(validateEntry(entry({ keywords: ['修复', '幂等'] })).errors))
check('duplicates collapse to one and are refused', !validateEntry(entry({ keywords: ['幂等', '幂等'] })).valid)

console.log('required fields:')
check('missing anchor is refused', !validateEntry(entry({ anchor: '' })).valid)
check('bad date is refused', !validateEntry(entry({ date: '2026/01/01' })).valid)
check('unknown status is refused', !validateEntry(entry({ status: '做完' })).valid)
check('unknown type is refused', !validateEntry(entry({ type: '修补' })).valid)

console.log('non-landed statuses must explain themselves:')
check('搁置 with a stub why is refused', !validateEntry(entry({ status: '搁置', why: '算了' })).valid)
check('搁置 with a real why passes', validateEntry(entry({ status: '搁置', why: '限流期间补数会污染缓存，等正式接口上线。' })).valid)
check('已回退 with a stub why is refused', !validateEntry(entry({ status: '已回退', why: '不好' })).valid)

console.log('已废弃 is terminal, not open work:')
check('已废弃 is not unsettled', isUnsettled('已废弃') === false)
check('已回退 is still unsettled', isUnsettled('已回退') === true)
check('待验证 is unsettled', isUnsettled('待验证') === true)
check('已落地 is settled', isUnsettled('已落地') === false)
check('进行中 is unsettled', isUnsettled('进行中') === true)
check('ABANDONED_STATUSES only holds 已废弃', ABANDONED_STATUSES.size === 1 && ABANDONED_STATUSES.has('已废弃'), JSON.stringify([...ABANDONED_STATUSES]))

console.log(failures === 0 ? '\nschema-smoke: all checks passed' : `\nschema-smoke: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
