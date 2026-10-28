import { Context } from '@deepseek-ai/cordis'
import { LedgerManager } from './ledger-manager.js'
import { createLedgerTools } from './tools.js'

export const name = 'dsh-memledger'

export function apply(ctx: Context) {
  // 当前工作区根目录
  const getCwd = () => {
    try {
      return (ctx as any).baseDir || process.cwd()
    } catch {
      return process.cwd()
    }
  }

  // 注册 HTTP API 路由供前端看板或扩展调用
  const router = (ctx as any).router
  if (router) {
    router.get('/api/memledger/status', async (c: any) => {
      const manager = new LedgerManager(getCwd())
      const entries = manager.reload()
      const pendingCount = entries.filter((e) =>
        ['未做', '搁置', '待验证', '已回退'].includes(e.status),
      ).length

      return c.json({
        hasLedger: manager.hasLedger(),
        ledgerPath: manager.getLedgerPath(),
        totalCount: entries.length,
        pendingCount,
      })
    })

    router.get('/api/memledger/entries', async (c: any) => {
      const manager = new LedgerManager(getCwd())
      const q = c.req.query('q') || ''
      const status = c.req.query('status') || undefined
      const entries = manager.search({ query: q, status })
      return c.json({ entries })
    })

    router.post('/api/memledger/add', async (c: any) => {
      const body = await c.req.json()
      const manager = new LedgerManager(getCwd())
      const res = manager.add(body)
      return c.json(res)
    })
  }

  // 注册 Agent 工具
  ctx.on('ready', () => {
    ctx.logger('memledger').info('MemLedger 记忆台账插件已就绪')
  })
}

export * from './types.js'
export * from './schema.js'
export * from './ledger-manager.js'
export * from './tools.js'
