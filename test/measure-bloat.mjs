// Measure how much the real ledger has piled up.
//
// Bloat is not a cosmetic problem: it is the mechanism that makes retrieval
// fail, and failed retrieval is what sends a project back to redo work it
// already did. So the numbers that matter are not "how many bytes" but
// "how concentrated and how duplicated".

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { anchorPathsOf, symbolOf } from '../lib/anchors.js'
import { parseLedgerMarkdown } from '../lib/markdown-parser.js'

const repo = process.argv[2] ?? 'D:/zyd_apps/GitHub/Omw_quant_agent'
const ledgerPath = join(repo, 'docs', '变更台账.md')
const text = readFileSync(ledgerPath, 'utf-8')
const entries = parseLedgerMarkdown(text)

const kb = (bytes) => (bytes / 1024).toFixed(1) + ' KB'
console.log('ledger: ' + ledgerPath)
console.log('size:   ' + kb(Buffer.byteLength(text)))
console.log('lines:  ' + text.split('\n').length)
console.log('entries:' + entries.length)
console.log('per entry: ' + (Buffer.byteLength(text) / entries.length / 1024).toFixed(2) + ' KB')

const byStatus = new Map()
for (const entry of entries) byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1)
console.log('\nby status:')
for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
  console.log('  ' + String(status).padEnd(6) + count)
}

// Concentration: a few files usually hold most of the decisions.
const byFile = new Map()
for (const entry of entries) {
  for (const path of anchorPathsOf(entry.anchor)) {
    byFile.set(path, (byFile.get(path) ?? 0) + 1)
  }
}
const hottest = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
console.log('\nhottest files:')
for (const [path, count] of hottest) console.log('  ' + String(count).padStart(3) + '  ' + path)

// Duplication: the same symbol recorded more than once means the ledger grew by
// repeating itself, which is exactly the pile-up that hides the signal.
const bySymbol = new Map()
for (const entry of entries) {
  for (const path of anchorPathsOf(entry.anchor)) {
    const symbol = symbolOf(entry.anchor)
    const key = path + '::' + symbol
    if (!bySymbol.has(key)) bySymbol.set(key, [])
    bySymbol.get(key).push(entry)
  }
}
const duplicates = [...bySymbol.entries()].filter(([, list]) => list.length > 1).sort((a, b) => b[1].length - a[1].length)
console.log('\nsymbols recorded more than once: ' + duplicates.length)
for (const [key, list] of duplicates.slice(0, 8)) {
  console.log('  ' + String(list.length).padStart(2) + 'x  ' + key)
  console.log('      ' + list.map((e) => e.id + '[' + e.status + ']').join(' '))
}

// What a working set would have to be if only unresolved or recently touched
// entries were loaded. This is the number the archive design is aiming at.
const settled = entries.filter((entry) => entry.status === '已落地')
const unresolved = entries.filter((entry) => entry.status !== '已落地')
console.log('\nworking-set split:')
console.log('  unresolved (must load):  ' + unresolved.length)
console.log('  settled (archivable):    ' + settled.length)

// Rough context cost, at ~1 token per CJK character for Chinese-heavy text.
const approxTokens = Math.round(Buffer.byteLength(text) / 3)
console.log('\napproximate context cost of loading the whole file: ' + (approxTokens / 1000).toFixed(0) + 'k tokens')
