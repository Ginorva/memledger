// Smoke test for 环境事实的可信度判据（2026-11-19）。
//
// 背景：一次真实事故 —— 「外网机没有 SSH 凭据，需 ISay 手动部署」被写进台账，
// 依据只是「我用 admin@47.107.96.13 直连被拒」这一个**没试对方式**的探针；
// 而 11-17 的同三本台账里明明记着「ssh smart-daily → 外网机部署成功」。
// append-only + 「日期最新 = 正确」⇒ 错的事实靠「新」取胜，后来的人照着它不做事。
//
// 这里守三条契约：
//   1. 否定式能力事实（会让人「不做事」）必须自带一条能重跑的复核命令；
//   2. 复核命令必须指向这条事实的**同一主体**（否则复跑它证明不了结论）；
//   3. 与更早的肯定式记录冲突时，要能把旧条目显式结案（supersedes → 取代）。

import { validateEntry } from '../lib/schema.js'
import { checkFactClaim, capabilityClaim, findConflictingEarlier, subjectsOf } from '../lib/fact-claims.js'
import { formatEntryBlock, parseLedgerMarkdown } from '../lib/markdown-parser.js'
import { supersessionMap } from '../lib/supersede.js'

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

const negative = entry({
  status: '进行中',
  title: '外网机选股页部署：需 ISay 手动 pull + 重启 quant-api',
  background: '外网机没有 SSH 凭据。',
  why: '工作区里没有外网机的凭据，只能由 ISay 手动执行。',
})

console.log('否定式能力事实要自带复核命令:')
const verdict = checkFactClaim(negative)
check('能力否定被识别出来', verdict.ok === false && verdict.needsProbe === true, JSON.stringify(verdict))
check('未决条目没有 probe → schema 拒绝', validateEntry(negative).valid === false,
  JSON.stringify(validateEntry(negative).errors))
check('已落地历史陈述不拦（不制造假红）',
  validateEntry(entry({ ...negative, status: '已落地' })).valid === true,
  JSON.stringify(validateEntry(entry({ ...negative, status: '已落地' })).errors))
check('给了 probe（指向同一主体）→ 放行',
  validateEntry(entry({ ...negative, probe: 'ssh smart-daily "systemctl is-active quant-api"' })).valid === true,
  JSON.stringify(validateEntry(entry({ ...negative, probe: 'ssh smart-daily "systemctl is-active quant-api"' })).errors))
check('probe 指不到同一主体 → 仍拒绝',
  validateEntry(entry({ ...negative, probe: 'python scripts/verify_all.py' })).valid === false)
check('验收里写了能重跑的命令也算',
  validateEntry(entry({ ...negative, verify: 'ssh smart-daily "systemctl is-active quant-api"' })).valid === true,
  JSON.stringify(validateEntry(entry({ ...negative, verify: 'ssh smart-daily "systemctl is-active quant-api"' })).errors))
check('普通代码缺陷型否定不拦（不是能力否定）',
  checkFactClaim(entry({
    status: '进行中',
    title: '回灌通道没有收敛：服务端能改内网真身',
    background: '这条通道没有堵住。',
    why: '需 ISay 拍板是否关闭。',
  })).ok === true)

console.log('类型「事实」= 会过期的快照:')
check('事实类型缺 probe → 拒绝', validateEntry(entry({ type: '事实', title: '外网机当前停在哪天' })).valid === false)
check('事实类型带 probe → 放行',
  validateEntry(entry({ type: '事实', title: '外网机当前停在哪天', probe: 'ssh smart-daily "git -C /usr/workdir/omw_quant log --oneline -1"' })).valid === true)

console.log('与更早的肯定式记录冲突要能被发现:')
const older = {
  id: 'CL-20251117-77',
  title: '服务端 quant-api 部署（7c9554d → 78a4bc6）',
  date: '2025-11-17',
  background: 'ssh smart-daily → 外网机 pull + 重启 quant-api 部署成功。',
  why: '服务端那台机跑 quant-api，是页面真身。',
  anchor: 'api/routes_qs.py::x',
  status: '已落地',
}
const newer = {
  id: 'CL-20260101-02',
  title: '外网机没有 SSH 凭据，需 ISay 手动部署',
  date: '2026-01-01',
  background: '外网机没有 SSH 凭据。',
  change: '外网机没有 SSH 凭据，只能由 ISay 手动执行。',
  why: '工作区里没有外网机的凭据。',
  anchor: 'api/routes_qs.py::x',
  status: '进行中',
}
const conflict = findConflictingEarlier([older], newer)
check('找到冲突的旧条目', conflict && conflict.id === 'CL-20251117-77', JSON.stringify(conflict && conflict.id))
check('没有旧记录时不报冲突', findConflictingEarlier([], newer) === null)
check('主体词能被抽出来', subjectsOf('外网机 quant-api 凭据').has('外网机'))

console.log('复核命令能被写进条目并读回来:')
const block = formatEntryBlock(entry({ probe: 'ssh smart-daily "systemctl is-active quant-api"' }))
check('条目里有「复核命令」行', block.includes('- **复核命令**：'), block)
const parsed = parseLedgerMarkdown(`# 台账\n\n${block}`)
check('解析回来带 probe', parsed.length === 1 && parsed[0].probe === 'ssh smart-daily "systemctl is-active quant-api"',
  JSON.stringify(parsed[0] && parsed[0].probe))

console.log('取代关系能显式结案旧条目:')
const oldBlock = formatEntryBlock(entry({ id: 'CL-20251117-77', title: '旧结论' }))
const newBlock = formatEntryBlock(entry({ id: 'CL-20260101-03', title: '新结论（结案 CL-20251117-77）' }))
const map = supersessionMap(parseLedgerMarkdown(oldBlock + newBlock))
check('正文里的「结案 CL-…」被识别为取代', map.get('CL-20251117-77') === 'CL-20260101-03', JSON.stringify([...map]))
const map2 = supersessionMap(parseLedgerMarkdown(oldBlock + formatEntryBlock(entry({ id: 'CL-20260101-04', title: '新结论', supersedes: 'CL-20251117-77' }))))
check('「取代」字段同样有效', map2.get('CL-20251117-77') === 'CL-20260101-04', JSON.stringify([...map2]))

console.log(failures === 0 ? '\nfact-claims-smoke: all checks passed' : `\nfact-claims-smoke: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
