// client.js — DSH Web GUI client view for MemLedger & Repo Map.
//
// Registered under `conversation.view` so it sits alongside "Chat", "Trace",
// and "Versions" in the session tab bar.

window.__ModuleLoader__.load({
  id: 'dsh-memledger',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /* ================================================================ STYLES */

    const CSS = `
/* ── foundations ── */
.ml-root{display:flex;flex-direction:column;height:100%;min-height:0;padding:18px 24px 14px;font-size:13px;color:var(--dsw-alias-label-primary,#e4e4e7);box-sizing:border-box;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;--ml-border:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 22%,transparent);--ml-surface:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 5%,transparent);--ml-surface-raised:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 8%,transparent);--ml-surface-hover:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 14%,transparent);--ml-accent:var(--dsw-alias-brand-primary,#6d8cff);--ml-green:#86efac;--ml-red:#fca5a5;--ml-yellow:#fde68a;--ml-orange:#fdba74;--ml-blue:#93c5fd;--ml-dim:var(--dsw-alias-label-tertiary,#71717a);--ml-sub:var(--dsw-alias-label-secondary,#a1a1aa);--ml-radius:10px}

/* ── header ── */
.ml-topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding-bottom:14px;flex-wrap:wrap}
.ml-topbar-left{display:flex;flex-direction:column;gap:2px;min-width:0}
.ml-h1{font-size:15px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;letter-spacing:-.01em}
.ml-h1-badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;letter-spacing:.02em}
.ml-subtitle{font-size:11.5px;color:var(--ml-dim);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:680px}
.ml-topbar-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.ml-input{border-radius:8px;border:1px solid var(--ml-border);background:var(--ml-surface);color:var(--dsw-alias-label-primary,#e4e4e7);font:inherit;font-size:12px;padding:6px 11px;outline:none;width:190px;transition:border-color .15s,box-shadow .15s}
.ml-input:focus{border-color:color-mix(in srgb,var(--ml-accent) 60%,transparent);box-shadow:0 0 0 2px color-mix(in srgb,var(--ml-accent) 12%,transparent)}
.ml-pill{border-radius:20px;border:1px solid var(--ml-border);background:transparent;color:var(--ml-sub);font:inherit;font-size:11.5px;padding:5px 13px;cursor:pointer;transition:all .15s;white-space:nowrap;user-select:none}
.ml-pill:hover{background:var(--ml-surface-hover)}
.ml-pill[data-on="1"]{background:color-mix(in srgb,var(--ml-accent) 16%,transparent);color:var(--ml-accent);border-color:color-mix(in srgb,var(--ml-accent) 40%,transparent)}
.ml-icon-btn{width:30px;height:30px;border-radius:8px;border:1px solid var(--ml-border);background:transparent;color:var(--ml-sub);font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;padding:0;line-height:1}
.ml-icon-btn:hover{background:var(--ml-surface-hover);color:var(--dsw-alias-label-primary,#e4e4e7)}

/* ── tab bar ── */
.ml-tabbar{display:flex;gap:2px;margin-bottom:12px;background:var(--ml-surface);border:1px solid var(--ml-border);border-radius:10px;padding:3px;width:fit-content}
.ml-tabbar-item{font-size:12px;padding:6px 20px;border-radius:8px;cursor:pointer;border:none;background:transparent;color:var(--ml-dim);transition:all .18s;font:inherit;font-weight:500;user-select:none;position:relative}
.ml-tabbar-item:hover{color:var(--ml-sub);background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 8%,transparent)}
.ml-tabbar-item[data-on="1"]{background:color-mix(in srgb,var(--ml-accent) 18%,transparent);color:var(--ml-accent);font-weight:600;box-shadow:0 1px 4px color-mix(in srgb,var(--ml-accent) 18%,transparent),inset 0 0 0 1px color-mix(in srgb,var(--ml-accent) 25%,transparent)}

/* ── body / panes ── */
.ml-body{display:flex;gap:14px;flex:1;min-height:0}
.ml-panel{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--ml-surface);border:1px solid var(--ml-border);border-radius:var(--ml-radius);overflow:hidden}
.ml-panel-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--ml-border);flex-shrink:0}
.ml-panel-title{font-weight:600;font-size:12.5px;display:flex;align-items:center;gap:6px;margin:0;letter-spacing:.01em}
.ml-panel-badge{font-size:10.5px;color:var(--ml-dim);background:var(--ml-surface-raised);padding:2px 7px;border-radius:20px}
.ml-panel-body{flex:1;min-height:0;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.ml-panel-body::-webkit-scrollbar{width:5px}
.ml-panel-body::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--ml-dim) 35%,transparent);border-radius:9px}
.ml-panel-body::-webkit-scrollbar-track{background:transparent}

/* ── empty state ── */
.ml-empty{text-align:center;color:var(--ml-dim);padding:40px 16px;font-size:12px;line-height:1.7}
.ml-empty-icon{font-size:28px;margin-bottom:8px;opacity:.7}

/* ── file tree items ── */
.ml-file{border:1px solid var(--ml-border);border-radius:8px;padding:8px 10px;background:transparent;transition:background .12s}
.ml-file:hover{background:var(--ml-surface-hover)}
.ml-file-path{font-weight:600;font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary,#e4e4e7);display:flex;align-items:center;gap:5px}
.ml-file-path .ml-ficon{color:var(--ml-accent);font-size:13px}
.ml-file-lines{font-size:10.5px;color:var(--ml-dim);font-weight:400;margin-left:auto}
.ml-sig{font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;font-size:11px;color:var(--ml-sub);margin-left:12px;padding:2px 0 2px 8px;border-left:2px solid color-mix(in srgb,var(--ml-accent) 30%,transparent)}

/* ── ledger cards ── */
.ml-entry{border:1px solid var(--ml-border);border-radius:var(--ml-radius);padding:10px 12px;background:transparent;display:flex;flex-direction:column;gap:5px;transition:background .12s}
.ml-entry:hover{background:var(--ml-surface-hover)}
.ml-entry-top{display:flex;align-items:center;gap:8px}
.ml-entry-id{font-size:11px;font-weight:600;color:var(--ml-dim);font-family:ui-monospace,Consolas,monospace;flex-shrink:0}
.ml-entry-title{font-weight:600;font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ml-badge{font-size:10.5px;padding:2px 8px;border-radius:20px;font-weight:600;white-space:nowrap;letter-spacing:.02em;flex-shrink:0}
.ml-badge-ok{color:var(--ml-green);background:color-mix(in srgb,var(--ml-green) 12%,transparent)}
.ml-badge-warn{color:var(--ml-red);background:color-mix(in srgb,var(--ml-red) 12%,transparent)}
.ml-entry-anchor{font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;font-size:11px;color:var(--ml-accent);word-break:break-all;padding-left:1px}
.ml-entry-field{font-size:12px;line-height:1.6;color:var(--ml-sub)}
.ml-entry-field b{font-weight:600;color:var(--dsw-alias-label-primary,#e4e4e7);margin-right:5px}

/* ── dashboard: score ring ── */
.ml-ring-wrap{position:relative;width:68px;height:68px;flex-shrink:0;margin:0 auto}
.ml-ring-wrap svg{width:68px;height:68px;transform:rotate(-90deg);filter:drop-shadow(0 0 6px color-mix(in srgb,var(--ml-accent) 25%,transparent))}
.ml-ring-wrap circle{fill:none;stroke-width:5.5}
.ml-ring-bg{stroke:color-mix(in srgb,var(--ml-dim) 18%,transparent)}
.ml-ring-fg{stroke-linecap:round;transition:stroke-dashoffset .7s cubic-bezier(.4,0,.2,1)}
.ml-ring-num{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.ml-ring-val{font-size:19px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.ml-ring-lbl{font-size:9px;color:var(--ml-dim);letter-spacing:.04em;line-height:1}

/* ── dashboard: hero row ── */
.ml-hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;align-items:stretch}
.ml-hero-card{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;padding:14px 12px;border:1px solid var(--ml-border);border-radius:var(--ml-radius);background:var(--ml-surface);transition:background .12s}
.ml-hero-card:hover{background:var(--ml-surface-hover)}
.ml-hero-val{font-size:24px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums;margin-top:2px}
.ml-hero-lbl{font-size:11px;color:var(--ml-sub);text-align:center;line-height:1.4;white-space:nowrap}
.ml-hero-sub{font-size:10px;color:var(--ml-dim);text-align:center;line-height:1.45;margin-top:auto;padding-top:4px}
.ml-hero-comment{font-size:10px;color:var(--ml-dim);text-align:center;line-height:1.5;margin-top:6px}

/* ── dashboard: detail cards ── */
.ml-dcard{display:flex;flex-direction:column;border:1px solid var(--ml-border);border-radius:var(--ml-radius);overflow:hidden;background:transparent}
.ml-dcard-hdr{font-weight:600;font-size:12px;line-height:1.4;min-height:34px;padding:8px 12px;background:var(--ml-surface-raised);display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--ml-border);box-sizing:border-box}
.ml-dcard-hdr .ml-hdr-note{margin-left:auto;font-size:10.5px;font-weight:400;color:var(--ml-dim);white-space:nowrap}
.ml-dcard-body{padding:10px 12px;display:flex;flex-direction:column;gap:7px;min-width:0}
.ml-dcard-body--row{flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px}
.ml-dcard-foot{font-size:10.5px;color:var(--ml-dim);line-height:1.6;padding:0 12px 10px}
.ml-dnote{font-size:11.5px;color:var(--ml-dim);line-height:1.6}
.ml-pillrow{display:flex;flex-wrap:wrap;gap:6px}

/* ── dashboard: rows / meters ── */
.ml-vrow{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.6}
.ml-vrow-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.ml-vrow-cnt{font-weight:700;min-width:20px;text-align:right;font-variant-numeric:tabular-nums;flex-shrink:0}
.ml-vrow-lbl{color:var(--ml-sub);flex:0 0 auto;min-width:78px}
.ml-vrow-track{flex:1;height:4px;border-radius:4px;background:var(--ml-surface-raised);overflow:hidden;min-width:24px}
.ml-vrow-bar{display:block;height:100%;border-radius:4px;transition:width .5s cubic-bezier(.4,0,.2,1)}

/* ── dashboard: call pills ── */
.ml-cpill{display:inline-flex;align-items:baseline;gap:5px;padding:4px 10px;border-radius:20px;font-size:11.5px;line-height:1.5;background:var(--ml-surface-raised);font-variant-numeric:tabular-nums}
.ml-cpill-name{color:var(--ml-sub)}
.ml-cpill-num{font-weight:700;color:var(--dsw-alias-label-primary,#e4e4e7)}

/* ── dashboard: cache bar ── */
.ml-cachebar{height:6px;border-radius:6px;background:var(--ml-surface-raised);overflow:hidden}
.ml-cachebar-fill{display:block;height:100%;border-radius:6px;transition:width .5s cubic-bezier(.4,0,.2,1)}
.ml-cachehead{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;line-height:1.6}
.ml-cachehead b{font-variant-numeric:tabular-nums}

/* ── dashboard: cumulative row ── */
.ml-cum{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;line-height:1.7}
.ml-cum-item{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap}
.ml-cum-lbl{color:var(--ml-sub)}
.ml-cum-val{font-weight:700;font-variant-numeric:tabular-nums}

/* ── dashboard: history / events (aligned columns) ── */
.ml-erow{display:grid;grid-template-columns:64px 74px 1fr auto;align-items:baseline;column-gap:10px;font-size:11.5px;line-height:1.7}
.ml-erow--hist{grid-template-columns:88px 1fr auto}
.ml-etime{color:var(--ml-dim);font-variant-numeric:tabular-nums}
.ml-ename{color:var(--ml-accent);white-space:nowrap}
.ml-emeta{color:var(--ml-dim);min-width:0;overflow-wrap:anywhere}
.ml-escore{font-weight:700;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}

/* ── dashboard: ledger overview ── */
.ml-pathline{font-size:10.5px;color:var(--ml-dim);line-height:1.6;overflow-wrap:anywhere;font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace}

/* ── dashboard: notice ── */
.ml-notice{padding:10px 14px;border-radius:var(--ml-radius);font-size:12px;line-height:1.7;color:var(--ml-sub);border:1px solid color-mix(in srgb,var(--ml-blue) 32%,transparent);background:color-mix(in srgb,var(--ml-blue) 8%,transparent)}
.ml-notice b{color:var(--ml-blue);font-weight:600}
.ml-notice-line{margin-top:4px}

/* ── dashboard: footer ── */
.ml-footer{font-size:10.5px;color:var(--ml-dim);text-align:center;padding-top:12px;letter-spacing:.01em}

/* ── @keyframes ── */
@keyframes ml-fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.ml-anim{animation:ml-fadeIn .35s cubic-bezier(.4,0,.2,1) both}
.ml-anim-d1{animation-delay:.05s}.ml-anim-d2{animation-delay:.10s}.ml-anim-d3{animation-delay:.15s}.ml-anim-d4{animation-delay:.20s}
`.trim()

    function insertStyles() {
      if (typeof document === 'undefined') return () => {}
      const prev = document.querySelector('style[data-plugin="dsh-memledger"]')
      if (prev) { prev.textContent = CSS; return () => {} }
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-memledger'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    const PENDING_LIST = ['未做', '搁置', '待验证', '已回退', '已废弃', '进行中']

    /* ========================================================= SUB-COMPONENTS */

    /** 工具名英→中映射 */
    var TOOL_NAMES = {
      'ledger_map': '地图扫描',
      'ledger_check': '改前预检',
      'ledger_search': '台账搜索',
      'ledger_add': '决策入册',
      'ledger_requirement': '需求建档',
      'ledger_verify': '锚点体检',
      'ledger_bootstrap': '台账初始化',
    }

    /** 圆环评分组件 */
    function ScoreRing(props) {
      var score = props.score ?? 0
      var r = 29, c = 2 * Math.PI * r
      var offset = c * (1 - score / 100)
      var color = score >= 80 ? '#86efac' : score >= 50 ? '#fde68a' : score >= 20 ? '#fdba74' : '#fca5a5'
      var grade = score >= 80 ? '优秀' : score >= 50 ? '良好' : score >= 20 ? '及格' : '待提升'
      return h('div', { className: 'ml-ring-wrap', title: '效能评分：综合衡量工具使用率（40%）、决策沉淀率（30%）、风险拦截力（30%）' },
        h('svg', { viewBox: '0 0 72 72' },
          h('circle', { className: 'ml-ring-bg', cx: 36, cy: 36, r: r }),
          h('circle', { className: 'ml-ring-fg', cx: 36, cy: 36, r: r,
            style: { stroke: color, strokeDasharray: c, strokeDashoffset: offset } })
        ),
        h('div', { className: 'ml-ring-num' },
          h('span', { className: 'ml-ring-val', style: { color: color } }, score),
          h('span', { className: 'ml-ring-lbl' }, grade)
        )
      )
    }

    var VERDICT_META = {
      'rollback-risk':   { dot: '#fca5a5', label: '倒车风险拦截', tip: '检测到已修过的代码被回退，AI 可能在走回头路' },
      'repeated-repair': { dot: '#fde68a', label: '重复修复警告', tip: '同一处问题被反复修过，提醒 AI 不要重复劳动' },
      'already-done':    { dot: '#86efac', label: '已有实现提醒', tip: '台账中已记录过该功能/修复，无需重做' },
      'shelved':         { dot: '#fdba74', label: '搁置方案警示', tip: '方案曾被搁置，需确认重启条件才能继续' },
      'foreign-anchor':  { dot: '#a1a1aa', label: '外部仓库锚点', tip: '锚点指向当前仓库之外，仅作参考' },
      'unrecorded':      { dot: '#52525b', label: '新场景放行', tip: '台账无相关记录，属于全新改动，已放行' },
    }

    /** 预检判定分布行 + 悬停提示 */
    function VerdictRow(props) {
      var m = VERDICT_META[props.verdict] || { dot: '#71717a', label: props.verdict, tip: '' }
      var pct = props.total > 0 ? Math.max(3, Math.round(props.count / props.total * 100)) : 0
      return h('div', { className: 'ml-vrow', title: m.tip || '' },
        h('span', { className: 'ml-vrow-dot', style: { background: m.dot } }),
        h('span', { className: 'ml-vrow-cnt' }, props.count),
        h('span', { className: 'ml-vrow-lbl' }, m.label),
        h('span', { className: 'ml-vrow-track' },
          h('span', { className: 'ml-vrow-bar', style: { width: pct + '%', background: m.dot } })
        )
      )
    }

    function formatUptime(sec) {
      if (sec < 60) return sec + ' 秒'
      if (sec < 3600) return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒'
      return Math.floor(sec / 3600) + ' 小时 ' + Math.floor((sec % 3600) / 60) + ' 分'
    }

    /** 卡片内的一行灰字（空状态占位或说明） */
    function mutedLine(text, key) {
      return h('div', { key: key, className: 'ml-dnote' }, text)
    }

    /** 统计仪表盘 */
    function DashboardPanel(props) {
      var s = props.stats
      if (!s) {
        return h('div', { className: 'ml-empty' },
          h('div', { className: 'ml-empty-icon' }, '📊'),
          '正在读取统计数据…', h('br'),
          '若长时间无内容，检查该工作区是否存在 docs/变更台账.md'
        )
      }

      var entries = Array.isArray(props.entries) ? props.entries : []
      var entryStatus = {}
      for (var i = 0; i < entries.length; i += 1) {
        var st = entries[i].status || '未知'
        entryStatus[st] = (entryStatus[st] || 0) + 1
      }
      var entryStatusPairs = Object.entries(entryStatus).sort(function (a, b) { return b[1] - a[1] })
      var pendingCount = entries.filter(function (e) { return PENDING_LIST.includes(e.status) }).length
      var reqCount = new Set(entries.map(function (e) { return e.requirement }).filter(Boolean)).size
      var recentEvents = Array.isArray(s.recentEvents) ? s.recentEvents : []
      var verdicts = (s.check && s.check.verdicts) || {}
      var verdictTotal = Object.values(verdicts).reduce(function (a, b) { return a + b }, 0)
      var hasVerdicts = verdictTotal > 0
      var riskyBlocked = (s.check && s.check.riskyBlocked) || 0
      var addRec = (s.add && s.add.recorded) || 0
      var addDup = (s.add && s.add.duplicatesBlocked) || 0
      var cacheHit = (s.map && s.map.cacheHits) || 0
      var cacheMiss = (s.map && s.map.cacheMisses) || 0
      var cacheTotal = cacheHit + cacheMiss
      var cacheRate = cacheTotal > 0 ? Math.round(cacheHit / cacheTotal * 100) : null

      // 生成效能分的文字解读
      var score = s.effectivenessScore || 0
      var scoreComment = score >= 80 ? '工具使用充分，决策沉淀到位' :
                          score >= 50 ? '基本可用，建议多用「改前预检」和「决策入册」' :
                          score >= 20 ? '使用不够充分，防护效果有限' : '几乎未使用，建议启用台账工作流'

      return h('div', { className: 'ml-panel-body', style: { gap: '14px' } },

        // ── 刚重启、本次进程还没有调用时的说明 ──
        (s.totalCalls || 0) === 0 ? h('div', { className: 'ml-notice ml-anim' },
          h('b', null, '本次进程还没有台账调用'),
          '　上方四个数字统计的是「当前 DSH 进程」内的调用，重启后从 0 开始计数 —— 这是正常的。',
          s.cumulative && s.cumulative.totalCalls > 0
            ? h('div', { className: 'ml-notice-line' },
                '长期数据看下方「跨会话累计」与「历史会话记录」：累计 ' + s.cumulative.totalCalls +
                ' 次调用、' + (s.cumulative.addRecorded || 0) + ' 条决策沉淀、' + (s.cumulative.riskyBlocked || 0) + ' 次风险拦截。')
            : h('div', { className: 'ml-notice-line' }, '还没有任何历史会话数据；正常改一次代码并让 AI 调用台账工具后就会出现。')
        ) : null,

        // ── 顶部总览行 ──
        h('div', { className: 'ml-hero ml-anim' },
          // 效能评分
          h('div', { className: 'ml-hero-card' },
            h(ScoreRing, { score: score }),
            h('div', { className: 'ml-hero-comment' }, scoreComment)
          ),
          // 核心指标卡片
          h('div', { className: 'ml-hero-card', title: '本次 DSH 进程内，AI 调用了多少次台账相关工具' },
            h('div', { className: 'ml-hero-val', style: { color: 'var(--ml-blue)' } }, s.totalCalls || 0),
            h('div', { className: 'ml-hero-lbl' }, '🧰 工具调用'),
            h('div', { className: 'ml-hero-sub' }, '本次进程内累计')
          ),
          h('div', { className: 'ml-hero-card', title: '检测到倒车或重复修复等高危操作并拦截的次数' },
            h('div', { className: 'ml-hero-val', style: { color: riskyBlocked > 0 ? 'var(--ml-red)' : 'var(--ml-green)' } }, riskyBlocked),
            h('div', { className: 'ml-hero-lbl' }, '🛡️ 风险拦截'),
            h('div', { className: 'ml-hero-sub' }, riskyBlocked > 0 ? '已阻止危险操作' : '暂无风险')
          ),
          h('div', { className: 'ml-hero-card', title: '通过「决策入册」记录下来的重要决策数量' },
            h('div', { className: 'ml-hero-val', style: { color: 'var(--ml-green)' } }, addRec),
            h('div', { className: 'ml-hero-lbl' }, '📝 决策沉淀'),
            h('div', { className: 'ml-hero-sub' }, addRec > 0 ? '条经验已入册' : '尚无记录')
          ),
          h('div', { className: 'ml-hero-card', title: '尝试重复入册同一决策时被系统挡回的次数' },
            h('div', { className: 'ml-hero-val', style: { color: addDup > 0 ? 'var(--ml-yellow)' : 'var(--ml-dim)' } }, addDup),
            h('div', { className: 'ml-hero-lbl' }, '🚫 重复挡回'),
            h('div', { className: 'ml-hero-sub' }, addDup > 0 ? '防止重复入册' : '无重复')
          )
        ),

        // ── 两列详情 ──
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '12px', alignItems: 'start' } },

          // 左列：工具调用 + 缓存 + 锚点
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 } },

            // 工具调用明细
            h('div', { className: 'ml-dcard ml-anim ml-anim-d1' },
              h('div', { className: 'ml-dcard-hdr' }, '🧰 各工具调用次数'),
              h('div', { className: 'ml-dcard-body' },
                h('div', { className: 'ml-pillrow' },
                  Object.entries(s.calls || {}).map(function (p) {
                    var zhName = TOOL_NAMES[p[0]] || p[0]
                    var tip = ''
                    if (p[0] === 'ledger_map') tip = '扫描代码结构，生成项目骨架地图'
                    else if (p[0] === 'ledger_check') tip = '改代码前检查是否有历史决策冲突'
                    else if (p[0] === 'ledger_search') tip = '按关键词搜索台账中的历史决策'
                    else if (p[0] === 'ledger_add') tip = '将重要决策/经验记入台账'
                    else if (p[0] === 'ledger_requirement') tip = '把需求规范化为 docs/需求 下的需求文档，台账条目挂作子项'
                    else if (p[0] === 'ledger_verify') tip = '验证已记录的代码锚点是否还存在'
                    else if (p[0] === 'ledger_bootstrap') tip = '从 git 历史或文档创建台账'
                    return h('span', {
                      key: p[0],
                      className: 'ml-cpill',
                      title: tip,
                      style: p[1] === 0 ? { opacity: .45 } : null,
                    },
                      h('span', { className: 'ml-cpill-name' }, zhName),
                      h('span', { className: 'ml-cpill-num' }, p[1] + ' 次')
                    )
                  })
                )
              ),
              h('div', { className: 'ml-dcard-foot' }, '灰掉的表示本次进程还没调用过，鼠标悬停可看用途')
            ),

            // 地图缓存效率
            h('div', { className: 'ml-dcard ml-anim ml-anim-d2' },
              h('div', { className: 'ml-dcard-hdr' },
                h('span', null, '⚡ 地图缓存效率'),
                h('span', { className: 'ml-hdr-note' }, '仅统计本次进程')
              ),
              h('div', { className: 'ml-dcard-body' },
                cacheTotal > 0
                  ? h('div', { className: 'ml-cachehead' },
                      h('span', { style: { color: 'var(--ml-sub)' } },
                        '命中 ', h('b', null, cacheHit), ' 次　未命中 ', h('b', null, cacheMiss), ' 次'),
                      cacheRate !== null
                        ? h('span', { style: { fontWeight: 700, color: cacheRate >= 50 ? 'var(--ml-green)' : 'var(--ml-yellow)' } }, '命中率 ' + cacheRate + '%')
                        : null
                    )
                  : h('div', { className: 'ml-dnote' }, '本次进程还没有扫描过代码地图'),
                cacheTotal > 0
                  ? h('div', { className: 'ml-cachebar' },
                      h('div', { className: 'ml-cachebar-fill',
                        style: { width: (cacheRate || 0) + '%', background: cacheRate >= 50 ? 'var(--ml-green)' : 'var(--ml-yellow)' } })
                    )
                  : null
              ),
              h('div', { className: 'ml-dcard-foot' },
                cacheTotal === 0
                  ? '缓存命中率越高，说明项目结构越稳定，扫描开销越小'
                  : cacheHit === 0
                    ? '本次进程第一次扫描必然未命中（还没有可比对的旧快照）；代码结构没变时再扫一次才会命中'
                    : '缓存命中率越高，说明项目结构越稳定，扫描开销越小')
            ),

            // 锚点体检
            h('div', { className: 'ml-dcard ml-anim ml-anim-d3' },
              h('div', { className: 'ml-dcard-hdr' }, '🔍 锚点存活检查'),
              h('div', { className: 'ml-dcard-body' },
                s.verify && s.verify.runs > 0
                  ? h('div', { className: 'ml-cachehead' },
                      h('span', { style: { color: 'var(--ml-sub)' } }, '已执行 ', h('b', null, s.verify.runs), ' 次体检'),
                      s.verify.anchorsMissing > 0
                        ? h('span', { style: { color: 'var(--ml-red)', fontWeight: 600 } }, '发现 ' + s.verify.anchorsMissing + ' 个锚点丢失')
                        : h('span', { style: { color: 'var(--ml-green)', fontWeight: 600 } }, '全部存活')
                    )
                  : h('div', { className: 'ml-dnote' }, '本次进程还没有体检过')
              ),
              h('div', { className: 'ml-dcard-foot' }, '锚点是台账条目对应的代码位置，丢失意味着之前的修复可能被撤销')
            )
          ),

          // 右列：预检判定 + 跨会话 + 历史
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 } },

            // 预检判定分布
            h('div', { className: 'ml-dcard ml-anim ml-anim-d1' },
              h('div', { className: 'ml-dcard-hdr' }, '🛡️ 改前预检结果分布'),
              h('div', { className: 'ml-dcard-body' },
                hasVerdicts
                  ? Object.entries(verdicts).filter(function (p) { return p[1] > 0 }).map(function (p) {
                      return h(VerdictRow, { key: p[0], verdict: p[0], count: p[1], total: verdictTotal })
                    })
                  : h('div', { className: 'ml-dnote' }, '本次进程还没有跑过改前预检')
              ),
              h('div', { className: 'ml-dcard-foot' }, '改代码前系统会查台账历史，避免走弯路；悬停可看每类判定含义')
            ),

            // 跨会话累计
            h('div', { className: 'ml-dcard ml-anim ml-anim-d2' },
              h('div', { className: 'ml-dcard-hdr' }, '📈 跨会话累计统计'),
              h('div', { className: 'ml-dcard-body' },
                s.cumulative
                  ? h('div', { className: 'ml-cum' },
                      h('span', { className: 'ml-cum-item' }, h('span', { className: 'ml-cum-lbl' }, '会话'), h('span', { className: 'ml-cum-val' }, s.cumulative.sessionsCount || 0)),
                      h('span', { className: 'ml-cum-item' }, h('span', { className: 'ml-cum-lbl' }, '调用'), h('span', { className: 'ml-cum-val' }, s.cumulative.totalCalls || 0)),
                      h('span', { className: 'ml-cum-item' }, h('span', { className: 'ml-cum-lbl' }, '拦截'), h('span', { className: 'ml-cum-val', style: { color: s.cumulative.riskyBlocked > 0 ? 'var(--ml-red)' : 'var(--ml-green)' } }, s.cumulative.riskyBlocked || 0)),
                      h('span', { className: 'ml-cum-item' }, h('span', { className: 'ml-cum-lbl' }, '沉淀'), h('span', { className: 'ml-cum-val', style: { color: 'var(--ml-green)' } }, s.cumulative.addRecorded || 0)),
                      h('span', { className: 'ml-cum-item' }, h('span', { className: 'ml-cum-lbl' }, '挡回'), h('span', { className: 'ml-cum-val', style: { color: 'var(--ml-yellow)' } }, s.cumulative.duplicatesBlocked || 0))
                    )
                  : null
              ),
              h('div', { className: 'ml-dcard-foot' }, '存在工作区 docs/.memledger-stats.json，重启不清零')
            ),

            // 历史会话明细
            h('div', { className: 'ml-dcard ml-anim ml-anim-d3' },
              h('div', { className: 'ml-dcard-hdr' }, '🕘 历史会话记录'),
              h('div', { className: 'ml-dcard-body' },
                Array.isArray(s.sessionHistory) && s.sessionHistory.length > 0
                  ? s.sessionHistory.slice().reverse().slice(0, 6).map(function (h0, i) {
                      var when = h0.endedAt ? new Date(h0.endedAt) : null
                      var timeText = when
                        ? (when.getMonth() + 1) + '/' + when.getDate() + ' ' +
                          String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0')
                        : '未知时间'
                      var sc = h0.score ?? 0
                      var color = sc >= 80 ? 'var(--ml-green)' : sc >= 50 ? 'var(--ml-yellow)' : 'var(--ml-dim)'
                      return h('div', { className: 'ml-erow ml-erow--hist', key: i },
                        h('span', { className: 'ml-etime' }, timeText),
                        h('span', { className: 'ml-emeta' },
                          '调用 ', h('b', { style: { color: 'var(--dsw-alias-label-primary,#e4e4e7)' } }, h0.totalCalls || 0),
                          ' 次 · 沉淀 ', h('b', null, h0.addRecorded || 0), ' 条'),
                        h('span', { className: 'ml-escore', style: { color: color } }, sc + ' 分')
                      )
                    })
                  : h('div', { className: 'ml-dnote' }, '还没有已落盘的历史会话')
              ),
              h('div', { className: 'ml-dcard-foot' }, '上方四个数字只统计当前进程，重启后从 0 开始')
            )
          )
        ),

        // ── 台账概览 + 最近调用 ──
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '12px', alignItems: 'start' } },

          h('div', { className: 'ml-dcard ml-anim ml-anim-d1' },
            h('div', { className: 'ml-dcard-hdr' },
              h('span', null, '📚 台账概览'),
              h('span', { className: 'ml-hdr-note' }, entries.length + ' 条 · 未决 ' + pendingCount + ' 条' + (reqCount > 0 ? ' · 需求 ' + reqCount + ' 个' : ''))
            ),
            h('div', { className: 'ml-dcard-body' },
              entryStatusPairs.length > 0
                ? entryStatusPairs.map(function (p) {
                    var isPending = PENDING_LIST.includes(p[0])
                    var color = isPending ? (p[0] === '搁置' ? 'var(--ml-orange)' : p[0] === '已回退' || p[0] === '已废弃' ? 'var(--ml-red)' : 'var(--ml-yellow)') : 'var(--ml-green)'
                    var pct = entries.length > 0 ? Math.max(3, Math.round(p[1] / entries.length * 100)) : 0
                    return h('div', { className: 'ml-vrow', key: p[0] },
                      h('span', { className: 'ml-vrow-dot', style: { background: color } }),
                      h('span', { className: 'ml-vrow-cnt' }, p[1]),
                      h('span', { className: 'ml-vrow-lbl' }, p[0]),
                      h('span', { className: 'ml-vrow-track' },
                        h('span', { className: 'ml-vrow-bar', style: { width: pct + '%', background: color } })
                      )
                    )
                  })
                : h('div', { className: 'ml-dnote' }, '这个工作区还没有台账条目')
            ),
            h('div', { className: 'ml-dcard-foot' },
              h('div', { className: 'ml-pathline' },
                props.root ? (props.root + '\\docs\\变更台账.md') : '尚未解析到工作区位置'))
          ),

          h('div', { className: 'ml-dcard ml-anim ml-anim-d2' },
            h('div', { className: 'ml-dcard-hdr' }, '⏱ 最近调用'),
            h('div', { className: 'ml-dcard-body' },
              recentEvents.length > 0
                ? recentEvents.slice().reverse().slice(0, 6).map(function (ev, idx) {
                    var when = ev.ts ? new Date(ev.ts) : null
                    var t = when
                      ? String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0') + ':' + String(when.getSeconds()).padStart(2, '0')
                      : '--:--:--'
                    var extra = ''
                    if (ev.verdict) extra = (VERDICT_META[ev.verdict] || {}).label || ev.verdict
                    else if (ev.cached === true) extra = '缓存命中'
                    else if (ev.cached === false) extra = '重新扫描'
                    else if (ev.refused === true) extra = '挡回'
                    return h('div', { className: 'ml-erow', key: idx },
                      h('span', { className: 'ml-etime' }, t),
                      h('span', { className: 'ml-ename' }, TOOL_NAMES[ev.tool] || ev.tool || '未知'),
                      h('span', { className: 'ml-emeta' }, extra),
                      h('span', null)
                    )
                  })
                : h('div', { className: 'ml-dnote' }, '本次进程还没有调用记录')
            ),
            h('div', { className: 'ml-dcard-foot' }, '按时间倒序，最多显示最近 6 次')
          )
        ),

        // 底部运行时长
        h('div', { className: 'ml-footer' },
          '当前进程已运行 ' + formatUptime(s.uptimeSeconds || 0))
      )
    }

    /* ============================================================= MAIN VIEW */

    function MemLedgerMainView(props) {
      var sessionId = props?.sessionId
      var _es = React.useState({ loading: true, list: [], root: '', error: null })
      var entriesState = _es[0], setEntriesState = _es[1]
      var _ms = React.useState({ loading: true, files: [], fileCount: 0, symbolCount: 0, error: null })
      var mapState = _ms[0], setMapState = _ms[1]
      var _ss = React.useState({ loading: true, data: null, error: null })
      var statsState = _ss[0], setStatsState = _ss[1]
      var _q = React.useState(''); var query = _q[0], setQuery = _q[1]
      var _p = React.useState(false); var onlyPending = _p[0], setOnlyPending = _p[1]
      var _t = React.useState('dashboard'); var tab = _t[0], setTab = _t[1]

      var loadData = React.useCallback(function () {
        var params = new URLSearchParams()
        if (query) params.set('q', query)
        if (onlyPending) params.set('status', 'pending')
        if (typeof sessionId === 'string' && sessionId.length > 0) params.set('session', sessionId)

        fetch('/api/memledger/entries?' + params.toString(), { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then(function (d) { setEntriesState({ loading: false, list: d.entries || [], root: d.root || '', error: null }) })
          .catch(function (e) { setEntriesState({ loading: false, list: [], root: '', error: String(e?.message || e) }) })

        var mp = new URLSearchParams()
        if (typeof sessionId === 'string' && sessionId.length > 0) mp.set('session', sessionId)
        fetch('/api/memledger/map?' + mp.toString(), { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then(function (d) { setMapState({ loading: false, files: d.files || [], fileCount: d.fileCount || 0, symbolCount: d.symbolCount || 0, error: null }) })
          .catch(function (e) { setMapState({ loading: false, files: [], fileCount: 0, symbolCount: 0, error: String(e?.message || e) }) })

        var sp = new URLSearchParams()
        if (typeof sessionId === 'string' && sessionId.length > 0) sp.set('session', sessionId)
        fetch('/api/memledger/stats?' + sp.toString(), { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then(function (d) { setStatsState({ loading: false, data: d.ok ? d : null, error: null }) })
          .catch(function (e) { setStatsState({ loading: false, data: null, error: String(e?.message || e) }) })
      }, [sessionId, query, onlyPending])

      React.useEffect(function () { loadData() }, [loadData])

      // ── map pane body ──
      var mapBody
      if (mapState.loading) {
        mapBody = h('div', { className: 'ml-empty' }, h('div', { className: 'ml-empty-icon' }, '🔍'), '正在分析项目拓扑…')
      } else if (mapState.error) {
        mapBody = h('div', { className: 'ml-empty' }, h('div', { className: 'ml-empty-icon' }, '🔌'), '地图暂未连接')
      } else if (mapState.files.length === 0) {
        mapBody = h('div', { className: 'ml-empty' }, h('div', { className: 'ml-empty-icon' }, '📂'), '当前工作区暂无识别的代码模块')
      } else {
        mapBody = mapState.files.map(function (file) {
          var syms = (file.symbols || []).slice(0, 5).map(function (s, i) {
            return h('div', { className: 'ml-sig', key: i }, s.sig + (s.doc ? ' — ' + s.doc : ''))
          })
          if ((file.symbols || []).length > 5) {
            syms.push(h('div', { className: 'ml-sig', key: 'x', style: { opacity: .6 } }, '… 还有 ' + (file.symbols.length - 5) + ' 个符号'))
          }
          return h('div', { className: 'ml-file', key: file.path },
            h('div', { className: 'ml-file-path' },
              h('span', { className: 'ml-ficon' }, file.symbols && file.symbols.length > 0 ? '◆' : '◇'),
              file.path,
              h('span', { className: 'ml-file-lines' }, file.lineCount + ' 行')
            ),
            syms
          )
        })
      }

      // ── ledger pane body ──
      var ledgerBody
      if (entriesState.loading) {
        ledgerBody = h('div', { className: 'ml-empty' }, h('div', { className: 'ml-empty-icon' }, '📖'), '读取变更台账…')
      } else if (entriesState.error) {
        ledgerBody = h('div', { className: 'ml-empty' }, h('div', { className: 'ml-empty-icon' }, '🔌'), '台账暂未连接')
      } else if (entriesState.list.length === 0) {
        ledgerBody = h('div', { className: 'ml-empty' }, h('div', { className: 'ml-empty-icon' }, '📝'), '尚未记录条目。', h('br'), '改动后 AI 会自动入册。')
      } else {
        ledgerBody = entriesState.list.map(function (e) {
          var pending = PENDING_LIST.includes(e.status)
          return h('div', { className: 'ml-entry', key: e.id },
            h('div', { className: 'ml-entry-top' },
              h('span', { className: 'ml-entry-id' }, e.id),
              h('span', { className: 'ml-entry-title' }, e.title),
              h('span', { className: 'ml-badge ' + (pending ? 'ml-badge-warn' : 'ml-badge-ok') }, e.status)
            ),
            e.anchor ? h('div', { className: 'ml-entry-anchor' }, '📌 ' + e.anchor) : null,
            e.why ? h('div', { className: 'ml-entry-field' }, h('b', null, '为什么'), e.why) : null,
            e.tradeoff && e.tradeoff !== '无' ? h('div', { className: 'ml-entry-field' }, h('b', null, '取舍'), e.tradeoff) : null
          )
        })
      }

      // ── header derived ──
      var score = statsState.data?.effectivenessScore ?? null
      var badgeColor = score === null ? '' : score >= 80 ? 'var(--ml-green)' : score >= 50 ? 'var(--ml-yellow)' : score >= 20 ? 'var(--ml-orange)' : 'var(--ml-red)'

      return h('div', { className: 'ml-root' },

        // ── top bar ──
        h('div', { className: 'ml-topbar' },
          h('div', { className: 'ml-topbar-left' },
            h('p', { className: 'ml-h1' },
              '记忆台账',
              score !== null
                ? (statsState.data?.totalCalls
                    ? h('span', { className: 'ml-h1-badge',
                        style: { color: badgeColor, background: 'color-mix(in srgb,' + badgeColor + ' 14%,transparent)' } },
                        '效能 ' + score + ' 分')
                    : h('span', { className: 'ml-h1-badge',
                        style: { color: 'var(--ml-dim)', background: 'color-mix(in srgb, var(--ml-dim) 14%, transparent)' } },
                        '本次进程未调用'))
                : null
            ),
            h('p', { className: 'ml-subtitle' },
              (entriesState.root || '当前会话') + '　' + mapState.fileCount + ' 个模块　' + mapState.symbolCount + ' 个符号　' + entriesState.list.length + ' 条决策' +
              (statsState.data?.totalCalls ? '　' + statsState.data.totalCalls + ' 次调用' : '')
            )
          ),
          h('div', { className: 'ml-topbar-right' },
            h('input', { className: 'ml-input', placeholder: '搜索台账…', value: query,
              onChange: function (e) { setQuery(e.target.value) } }),
            h('button', { className: 'ml-pill', 'data-on': onlyPending ? '1' : '0',
              onClick: function () { setOnlyPending(function (v) { return !v }) } },
              onlyPending ? '未决 ✓' : '未决'),
            h('button', { className: 'ml-icon-btn', onClick: loadData, title: '刷新' }, '↻')
          )
        ),

        // ── tab bar ──
        h('div', { className: 'ml-tabbar' },
          h('button', { className: 'ml-tabbar-item', 'data-on': tab === 'dashboard' ? '1' : '0',
            onClick: function () { setTab('dashboard') } }, '📊 效能'),
          h('button', { className: 'ml-tabbar-item', 'data-on': tab === 'detail' ? '1' : '0',
            onClick: function () { setTab('detail') } }, '🗺 骨架与台账')
        ),

        // ── tab content ──
        tab === 'dashboard'
          ? h('div', { className: 'ml-body' },
              h('div', { className: 'ml-panel', style: { flex: 1 } },
                h('div', { className: 'ml-panel-hdr' },
                  h('p', { className: 'ml-panel-title' }, '📊 效能仪表盘'),
                  h('span', { className: 'ml-panel-badge' },
                    statsState.loading ? '加载中' : (statsState.error ? '不可用' : '● 实时'))
                ),
                h(DashboardPanel, { stats: statsState.data, entries: entriesState.list, root: entriesState.root })
              )
            )
          : h('div', { className: 'ml-body' },
              h('div', { className: 'ml-panel' },
                h('div', { className: 'ml-panel-hdr' },
                  h('p', { className: 'ml-panel-title' }, '🗺 代码骨架'),
                  h('span', { className: 'ml-panel-badge' }, mapState.fileCount + ' 个文件　' + mapState.symbolCount + ' 个符号')
                ),
                h('div', { className: 'ml-panel-body' }, mapBody)
              ),
              h('div', { className: 'ml-panel' },
                h('div', { className: 'ml-panel-hdr' },
                  h('p', { className: 'ml-panel-title' }, '📖 决策台账'),
                  h('span', { className: 'ml-panel-badge' }, entriesState.list.length + ' 条')
                ),
                h('div', { className: 'ml-panel-body' }, ledgerBody)
              )
            )
      )
    }

    /* ================================================================ MODULE */

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (!slots || typeof slots.inject !== 'function') return
        ctx.effect(insertStyles)
        slots.inject('conversation.view', function () {
          return slots.register(
            {
              name: 'conversation.view',
              id: 'dsh-memledger',
              order: 120,
              label: function () { return '台账与地图' },
              inject: function (sessionId) { return { sessionId: sessionId } },
            },
            MemLedgerMainView
          )
        })
      },
    }
  },
})
