window.__ModuleLoader__.load({
  id: 'dsh-memledger',
  factory: (require) => {
    const React = require('react')

    const h = React.createElement

    /* ---------------------------------------------------------------- styles -- */

    const CSS = [
      '.ml-ledger{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;padding:16px 20px;font-size:14px;color:var(--dsw-alias-label-primary,#e6e6e6)}',
      '.ml-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
      '.ml-title{font-size:15px;font-weight:600;margin:0}',
      '.ml-sub{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b93a1);margin:0}',
      '.ml-input{flex:1;min-width:200px;border-radius:9px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 34%,transparent);background:var(--dsw-alias-bg-primary,rgba(30,30,34,.6));color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:7px 11px;outline:none}',
      '.ml-btn{border-radius:9px;border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 34%,transparent);background:transparent;color:var(--dsw-alias-label-secondary,#5c6570);font:inherit;font-size:12px;padding:6px 12px;cursor:pointer}',
      '.ml-btn[data-on="1"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 18%,transparent);color:var(--dsw-alias-brand-primary,#4f6ef7);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f6ef7) 45%,transparent)}',
      '.ml-list{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding-bottom:8px}',
      '.ml-card{border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 20%,transparent);border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:7px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#888) 5%,transparent)}',
      '.ml-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.ml-card-id{font-weight:600;font-size:13px}',
      '.ml-tag{font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid transparent;white-space:nowrap}',
      '.ml-tag[data-pending="1"]{color:#f38ba8;border-color:rgba(243,139,168,.45);background:rgba(243,139,168,.12)}',
      '.ml-tag[data-pending="0"]{color:#a6e3a1;border-color:rgba(166,227,161,.4);background:rgba(166,227,161,.12)}',
      '.ml-anchor{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-brand-primary,#4f6ef7);word-break:break-all}',
      '.ml-field{font-size:13px;line-height:19px}',
      '.ml-field b{font-weight:600;margin-right:4px}',
      '.ml-empty{text-align:center;color:var(--dsw-alias-label-tertiary,#8b93a1);padding:40px 16px;font-size:13px;line-height:21px}',
    ].join('')

    function insertStyles() {
      if (typeof document === 'undefined') return function () {}
      const prev = document.querySelector('style[data-plugin="dsh-memledger"]')
      if (prev) return function () {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-memledger'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return function () { tag.remove() }
    }

    /* ------------------------------------------------------------------- view -- */

    const PENDING = ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中']

    function errorMessage(cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }

    function LedgerView() {
      const [state, setState] = React.useState({ phase: 'loading', entries: [], root: '', error: null })
      const [query, setQuery] = React.useState('')
      const [onlyPending, setOnlyPending] = React.useState(false)

      const load = React.useCallback(function (q, pending) {
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        if (pending) params.set('status', 'pending')
        fetch('/api/memledger/entries?' + params.toString(), { cache: 'no-store' })
          .then(function (response) {
            if (response.status === 404) {
              throw new Error('宿主端未注册 /api/memledger/entries 路由，请确认插件已完整启用。')
            }
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
          .then(function (data) {
            setState({ phase: 'ready', entries: data.entries || [], root: String(data.root || ''), error: null })
          })
          .catch(function (cause) {
            setState({ phase: 'error', entries: [], root: '', error: errorMessage(cause) })
          })
      }, [])

      React.useEffect(function () {
        load('', false)
      }, [load])

      React.useEffect(function () {
        const timer = setTimeout(function () { load(query.trim(), onlyPending) }, 220)
        return function () { clearTimeout(timer) }
      }, [query, onlyPending, load])

      const cards = state.entries.map(function (entry) {
        const isPending = PENDING.indexOf(entry.status) >= 0
        return h('div', { className: 'ml-card', key: entry.id },
          h('div', { className: 'ml-card-top' },
            h('span', { className: 'ml-card-id' }, String(entry.id || '') + ' · ' + String(entry.title || '')),
            h('span', { className: 'ml-tag', 'data-pending': isPending ? '1' : '0' }, String(entry.status || '')),
          ),
          entry.anchor ? h('div', { className: 'ml-anchor' }, '📍 ' + entry.anchor) : null,
          entry.why ? h('div', { className: 'ml-field' }, h('b', null, '为什么'), String(entry.why)) : null,
          entry.tradeoff && entry.tradeoff !== '无'
            ? h('div', { className: 'ml-field' }, h('b', null, '取舍/重启'), String(entry.tradeoff))
            : null,
        )
      })

      let body
      if (state.phase === 'loading') {
        body = h('div', { className: 'ml-empty' }, '读取台账中…')
      } else if (state.phase === 'error') {
        body = h('div', { className: 'ml-empty' }, '读取失败：' + state.error)
      } else if (cards.length === 0) {
        body = h('div', { className: 'ml-empty' },
          '这个工作区没有台账条目。',
          h('br'),
          h('span', { className: 'ml-anchor' }, '当前解析到的根目录：' + (state.root || '(未知)')),
          h('br'),
          '若根目录不对，设置环境变量 MEMLEDGER_ROOT 指向项目根，或让我在该项目里初始化台账。')
      } else {
        body = h('div', { className: 'ml-list' }, cards)
      }

      return h('div', { className: 'ml-ledger' },
        h('div', { className: 'ml-head' },
          h('div', null,
            h('p', { className: 'ml-title' }, '📖 MemLedger 记忆台账'),
            h('p', { className: 'ml-sub' },
              state.entries.length + ' 条 · ' + (state.root || '解析中…'),
            ),
          ),
        ),
        h('div', { className: 'ml-head' },
          h('input', {
            className: 'ml-input',
            placeholder: '输入关键词、错误特征、或代码锚点…',
            value: query,
            onChange: function (event) { setQuery(event.target.value) },
          }),
          h('button', {
            className: 'ml-btn',
            'data-on': onlyPending ? '1' : '0',
            onClick: function () { setOnlyPending(function (v) { return !v }) },
          }, onlyPending ? '仅看未决 ✓' : '仅看未决'),
        ),
        body,
      )
    }

    /* ----------------------------------------------------------------- module -- */

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) {
          throw new Error('[dsh-memledger] Missing DSH slots service. Check dsh.client.inject and restart DSH.')
        }
        ctx.effect(insertStyles)
        slots.inject('conversation.view', function () {
          return slots.register(
            {
              name: 'conversation.view',
              id: 'memledger',
              order: 120,
              label: function () { return '台账' },
            },
            LedgerView,
          )
        })
      },
    }
  },
})
