// 一次性测量脚本：逐个工具的 prompt 成本（desc / schema），
// 用来在工具定义预算（棘轮 5800）内找该从哪里省字。
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function fakeCtx() {
  const registered = new Map()
  return {
    registered,
    webServer: { register: () => () => {} },
    effect(fn) { return fn() },
    get(name, strict) {
      if (name === 'tools') return { register: (spec) => { registered.set(spec.name, spec); return () => registered.delete(spec.name) } }
      if (name === 'sessions') return undefined
      if (name === 'sessionQuery') return undefined
      if (strict === false) return undefined
      throw new Error('missing service: ' + name)
    },
    logger: { info() {}, warn() {}, error() {} },
    config: {},
  }
}

const module = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
const ctx = fakeCtx()
module.apply(ctx)
let total = 0
for (const [name, spec] of ctx.registered) {
  const size = name.length + JSON.stringify({ d: spec.description, p: spec.parameters }).length
  total += size
  console.log(`${name.padEnd(20)} total=${String(size).padStart(5)}  desc=${String(spec.description.length).padStart(4)}  schema=${String(JSON.stringify(spec.parameters).length).padStart(5)}`)
}
console.log('TOTAL', total, '/ 5800')
