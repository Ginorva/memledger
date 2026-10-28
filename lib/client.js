// client.js — DSH Web GUI client view for MemLedger & Repo Map.
//
// Registered under `conversation.view` so it sits alongside "Chat", "Trace",
// and "Versions" in the session tab bar.
//
// Provides a split-pane interface:
//   - Left pane: Codebase Topology Map (file tree, exported symbols, signatures)
//   - Right pane: Decision Ledger (why, tradeoffs, shelved ideas, rollback guards)

window.__ModuleLoader__.load({
  id: 'dsh-memledger',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /* ---------------------------------------------------------------- styles -- */

    const CSS = [
      '.ml-container{display:flex;flex-direction:column;height:100%;min-height:0;padding:16px 20px;font-size:13px;color:var(--dsw-alias-label-primary,#e6e6e6);box-sizing:border-box}',
      '.ml-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 18%,transparent);flex-wrap:wrap}',
      '.ml-header-left{display:flex;flex-direction:column;gap:3px}',
      '.ml-title{font-size:15px;font-weight:600;margin:0;display:flex;align-items:center;gap:6px}',
      '.ml-meta{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b93a1);margin:0}',
      '.ml-header-actions{display:flex;align-items:center;gap:8px}',
      '.ml-search{border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 30%,transparent);background:var(--dsw-alias-bg-primary,rgba(30,30,34,.6));color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 10px;outline:none;min-width:180px}',
      '.ml-btn{border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 30%,transparent);background:transparent;color:var(--dsw-alias-label-secondary,#a6adc8);font:inherit;font-size:12px;padding:6px 12px;cursor:pointer;transition:all .15s ease}',
      '.ml-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 12%,transparent)}',
      '.ml-btn[data-active="1"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 20%,transparent);color:var(--dsw-alias-brand-primary,#4f6ef7);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 50%,transparent)}',
      '.ml-main{display:flex;gap:16px;flex:1;min-height:0;padding-top:14px}',
      '.ml-pane{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 4%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 14%,transparent);border-radius:12px;padding:12px 14px}',
      '.ml-pane-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 12%,transparent)}',
      '.ml-pane-title{font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;margin:0}',
      '.ml-scroll-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:4px}',
      '.ml-card{border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 18%,transparent);border-radius:10px;padding:10px 12px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 5%,transparent);display:flex;flex-direction:column;gap:6px}',
      '.ml-card-header{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.ml-card-title{font-weight:600;font-size:13px}',
      '.ml-tag{font-size:11px;padding:2px 7px;border-radius:6px;font-weight:500;white-space:nowrap}',
      '.ml-tag[data-type="landed"]{color:#a6e3a1;background:rgba(166,227,161,.14);border:1px solid rgba(166,227,161,.35)}',
      '.ml-tag[data-type="pending"]{color:#f38ba8;background:rgba(243,139,168,.14);border:1px solid rgba(243,139,168,.35)}',
      '.ml-anchor{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-brand-primary,#4f6ef7);word-break:break-all}',
      '.ml-desc{font-size:12px;line-height:18px}',
      '.ml-desc b{font-weight:600;color:var(--dsw-alias-label-secondary,#a6adc8);margin-right:4px}',
      '.ml-file-item{display:flex;flex-direction:column;gap:4px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 14%,transparent);border-radius:8px;padding:8px 10px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 3%,transparent)}',
      '.ml-file-name{font-weight:600;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.ml-symbol{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary,#8b93a1);margin-left:8px;padding-left:6px;border-left:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 40%,transparent)}',
      '.ml-empty{text-align:center;color:var(--dsw-alias-label-tertiary,#8b93a1);padding:30px 10px;font-size:12px;line-height:20px}',
    ].join('')

    function insertStyles() {
      if (typeof document === 'undefined') return () => {}
      const prev = document.querySelector('style[data-plugin="dsh-memledger"]')
      if (prev) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-memledger'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    const PENDING_LIST = ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中']

    /* ---------------------------------------------------------------- component -- */

    function MemLedgerMainView(props) {
      const sessionId = props?.sessionId
      const [entriesState, setEntriesState] = React.useState({ loading: true, list: [], root: '', error: null })
      const [mapState, setMapState] = React.useState({ loading: true, files: [], fileCount: 0, symbolCount: 0, error: null })
      const [query, setQuery] = React.useState('')
      const [onlyPending, setOnlyPending] = React.useState(false)

      const loadData = React.useCallback(() => {
        const params = new URLSearchParams()
        if (query) params.set('q', query)
        if (onlyPending) params.set('status', 'pending')
        if (typeof sessionId === 'string' && sessionId.length > 0) params.set('session', sessionId)

        // 1. Fetch entries
        fetch('/api/memledger/entries?' + params.toString(), { cache: 'no-store' })
          .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then((data) => {
            setEntriesState({ loading: false, list: data.entries || [], root: data.root || '', error: null })
          })
          .catch((cause) => {
            setEntriesState({ loading: false, list: [], root: '', error: String(cause?.message || cause) })
          })

        // 2. Fetch codebase map
        const mapParams = new URLSearchParams()
        if (typeof sessionId === 'string' && sessionId.length > 0) mapParams.set('session', sessionId)
        fetch('/api/memledger/map?' + mapParams.toString(), { cache: 'no-store' })
          .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then((data) => {
            setMapState({
              loading: false,
              files: data.files || [],
              fileCount: data.fileCount || 0,
              symbolCount: data.symbolCount || 0,
              error: null,
            })
          })
          .catch((cause) => {
            setMapState({ loading: false, files: [], fileCount: 0, symbolCount: 0, error: String(cause?.message || cause) })
          })
      }, [sessionId, query, onlyPending])

      React.useEffect(() => {
        loadData()
      }, [loadData])

      // Render Left Pane (Map)
      let mapBody
      if (mapState.loading) {
        mapBody = h('div', { className: 'ml-empty' }, '正在分析项目拓扑与骨架…')
      } else if (mapState.error) {
        mapBody = h('div', { className: 'ml-empty' }, '地图数据暂未连接（可直接在会话中呼叫 ledger_map）')
      } else if (mapState.files.length === 0) {
        mapBody = h('div', { className: 'ml-empty' }, '当前工作区暂无识别的代码模块')
      } else {
        const fileElements = mapState.files.map((file) => {
          const syms = (file.symbols || []).slice(0, 5).map((s, idx) =>
            h('div', { className: 'ml-symbol', key: idx }, s.sig + (s.doc ? ` — ${s.doc}` : ''))
          )
          if ((file.symbols || []).length > 5) {
            syms.push(h('div', { className: 'ml-symbol', key: 'more' }, `... 还有 ${file.symbols.length - 5} 个符号`))
          }
          return h('div', { className: 'ml-file-item', key: file.path },
            h('div', { className: 'ml-file-name' }, `📄 ${file.path} (${file.lineCount}行)`),
            syms
          )
        })
        mapBody = h('div', { className: 'ml-scroll-list' }, fileElements)
      }

      // Render Right Pane (Ledger)
      let ledgerBody
      if (entriesState.loading) {
        ledgerBody = h('div', { className: 'ml-empty' }, '读取变更台账中…')
      } else if (entriesState.error) {
        ledgerBody = h('div', { className: 'ml-empty' }, '台账服务暂未连接（可直接在会话中呼叫 ledger_check）')
      } else if (entriesState.list.length === 0) {
        ledgerBody = h('div', { className: 'ml-empty' },
          '当前工作区尚未记录台账条目。',
          h('br'),
          '改动后调用 ledger_add 入册，此处将自动同步更新。'
        )
      } else {
        const cards = entriesState.list.map((entry) => {
          const isPending = PENDING_LIST.includes(entry.status)
          return h('div', { className: 'ml-card', key: entry.id },
            h('div', { className: 'ml-card-header' },
              h('span', { className: 'ml-card-title' }, `${entry.id} · ${entry.title}`),
              h('span', { className: 'ml-tag', 'data-type': isPending ? 'pending' : 'landed' }, entry.status)
            ),
            entry.anchor ? h('div', { className: 'ml-anchor' }, `📍 ${entry.anchor}`) : null,
            entry.why ? h('div', { className: 'ml-desc' }, h('b', null, '为什么:'), entry.why) : null,
            entry.tradeoff && entry.tradeoff !== '无'
              ? h('div', { className: 'ml-desc' }, h('b', null, '取舍/重启条件:'), entry.tradeoff)
              : null
          )
        })
        ledgerBody = h('div', { className: 'ml-scroll-list' }, cards)
      }

      return h('div', { className: 'ml-container' },
        // Header
        h('div', { className: 'ml-header' },
          h('div', { className: 'ml-header-left' },
            h('p', { className: 'ml-title' }, '🗺️ 代码骨架 & 📖 决策台账'),
            h('p', { className: 'ml-meta' },
              `工作区: ${entriesState.root || '当前会话'} · 模块 ${mapState.fileCount} 个 (${mapState.symbolCount} 符号) · 决策 ${entriesState.list.length} 条`
            )
          ),
          h('div', { className: 'ml-header-actions' },
            h('input', {
              className: 'ml-search',
              placeholder: '搜索关键词、锚点或错误…',
              value: query,
              onChange: (e) => setQuery(e.target.value),
            }),
            h('button', {
              className: 'ml-btn',
              'data-active': onlyPending ? '1' : '0',
              onClick: () => setOnlyPending((v) => !v),
            }, onlyPending ? '仅看未决/搁置 ✓' : '仅看未决/搁置'),
            h('button', {
              className: 'ml-btn',
              onClick: loadData,
            }, '🔄 刷新')
          )
        ),
        // Split-pane Body
        h('div', { className: 'ml-main' },
          // Left Pane: Codebase Map
          h('div', { className: 'ml-pane' },
            h('div', { className: 'ml-pane-head' },
              h('p', { className: 'ml-pane-title' }, '🗺️ 空间拓扑 (代码骨架地图)'),
              h('span', { className: 'ml-meta' }, `${mapState.fileCount} 文件 / ${mapState.symbolCount} 符号`)
            ),
            mapBody
          ),
          // Right Pane: Decision Ledger
          h('div', { className: 'ml-pane' },
            h('div', { className: 'ml-pane-head' },
              h('p', { className: 'ml-pane-title' }, '📖 时间台账 (历史决策与负向记忆)'),
              h('span', { className: 'ml-meta' }, `${entriesState.list.length} 条决策`)
            ),
            ledgerBody
          )
        )
      )
    }

    /* ----------------------------------------------------------------- module -- */

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (!slots || typeof slots.inject !== 'function') {
          return
        }
        ctx.effect(insertStyles)
        slots.inject('conversation.view', function () {
          return slots.register(
            {
              name: 'conversation.view',
              id: 'dsh-memledger',
              order: 120,
              label: function () {
                return '台账与地图'
              },
              inject: function (sessionId) {
                return { sessionId: sessionId }
              },
            },
            MemLedgerMainView
          )
        })
      },
    }
  },
})
