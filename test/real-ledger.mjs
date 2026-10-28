// Exercise the plugin's routes against a real, large ledger.
//
// The smoke test uses a tiny fixture; this one points the same handlers at an
// actual project ledger (209 KB, 69 entries) because a parser that only works
// on a hand-written sample is not evidence of anything.

import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const ROOT = 'D:/zyd_apps/技术钻研/dsh_new/mem-ledger'
const REAL = process.argv[2]

function fakeRes() {
  const collected = { status: 0, body: '' }
  return { collected, writeHead(s) { collected.status = s }, end(t) { collected.body = t } }
}

async function main() {
  if (!REAL) {
    console.log('usage: node test/real-ledger.mjs <repo-root>')
    process.exit(2)
  }
  const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  const routes = new Map()
  module.apply({
    webServer: { register: (r) => { routes.set(r.path, r.handler); return () => {} } },
    effect: (fn) => fn(),
  })

  let failures = 0
  const check = (label, ok, detail) => {
    if (ok) console.log('  PASS  ' + label)
    else { failures += 1; console.log('  FAIL  ' + label + (detail === undefined ? '' : ' -> ' + detail)) }
  }

  const statusRes = fakeRes()
  await routes.get('/api/memledger/status')({ url: '/api/memledger/status?root=' + encodeURIComponent(REAL) }, statusRes)
  const status = JSON.parse(statusRes.collected.body)
  console.log('status:')
  check('HTTP 200', statusRes.collected.status === 200, String(statusRes.collected.status))
  check('hasLedger', status.hasLedger === true)
  check('parsed a non-trivial number of entries', status.totalCount >= 40, 'totalCount=' + status.totalCount)
  check('pendingCount is sane', status.pendingCount >= 0 && status.pendingCount <= status.totalCount, 'pending=' + status.pendingCount)

  const allRes = fakeRes()
  await routes.get('/api/memledger/entries')({ url: '/api/memledger/entries?root=' + encodeURIComponent(REAL) }, allRes)
  const all = JSON.parse(allRes.collected.body)
  console.log('entries:')
  check('HTTP 200', allRes.collected.status === 200, String(allRes.collected.status))
  check('entry count matches status', all.entries.length === status.totalCount, all.entries.length + ' vs ' + status.totalCount)
  const withId = all.entries.filter((e) => e.id).length
  check('every entry has an id', withId === all.entries.length, withId + '/' + all.entries.length)
  const withAnchor = all.entries.filter((e) => e.anchor).length
  check('most entries carry an anchor', withAnchor >= all.entries.length * 0.8, withAnchor + '/' + all.entries.length)
  const withWhy = all.entries.filter((e) => e.why).length
  check('most entries carry a why', withWhy >= all.entries.length * 0.8, withWhy + '/' + all.entries.length)
  const datesOk = all.entries.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).length
  check('dates parse to YYYY-MM-DD', datesOk >= all.entries.length * 0.9, datesOk + '/' + all.entries.length)

  console.log('sample entry:')
  const sample = all.entries.find((e) => e.anchor && e.why)
  if (sample) {
    console.log('    id      ' + sample.id)
    console.log('    title   ' + sample.title)
    console.log('    status  ' + sample.status)
    console.log('    anchor  ' + sample.anchor)
    console.log('    why     ' + String(sample.why).slice(0, 60))
  } else {
    failures += 1
    console.log('  FAIL  no entry had both anchor and why')
  }

  console.log('search on real data:')
  const started = Date.now()
  const qRes = fakeRes()
  await routes.get('/api/memledger/entries')(
    { url: '/api/memledger/entries?q=' + encodeURIComponent('闸门') + '&root=' + encodeURIComponent(REAL) },
    qRes,
  )
  const elapsed = Date.now() - started
  const q = JSON.parse(qRes.collected.body)
  check('search returned something', q.entries.length > 0, String(q.entries.length))
  check('search returned fewer than all', q.entries.length < all.entries.length, q.entries.length + '/' + all.entries.length)
  check('search finished under 1000ms', elapsed < 1000, elapsed + 'ms')

  const pRes = fakeRes()
  await routes.get('/api/memledger/entries')(
    { url: '/api/memledger/entries?status=pending&root=' + encodeURIComponent(REAL) },
    pRes,
  )
  const pending = JSON.parse(pRes.collected.body)
  check('pending filter matches status count', pending.entries.length === status.pendingCount, pending.entries.length + ' vs ' + status.pendingCount)
  check('every pending entry has a why', pending.entries.every((e) => e.why && e.why.length > 0), JSON.stringify(pending.entries.filter((e) => !e.why).map((e) => e.id)))

  console.log('')
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((cause) => {
  console.log('HARNESS CRASHED: ' + (cause && cause.stack ? cause.stack : cause))
  process.exit(1)
})
