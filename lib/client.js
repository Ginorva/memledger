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
.ml-root{position:absolute;inset:0;display:flex;flex-direction:column;padding:20px 24px 140px;font-size:13px;color:var(--dsw-alias-label-primary,#e4e4e7);box-sizing:border-box;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;--ml-border:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 20%,transparent);--ml-surface:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 4%,transparent);--ml-surface-raised:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 7%,transparent);--ml-surface-hover:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 12%,transparent);--ml-surface-active:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 18%,transparent);--ml-accent:var(--dsw-alias-brand-primary,#6d8cff);--ml-green:#86efac;--ml-red:#fca5a5;--ml-yellow:#fde68a;--ml-orange:#fdba74;--ml-blue:#93c5fd;--ml-purple:#c4b5fd;--ml-dim:var(--dsw-alias-label-tertiary,#71717a);--ml-sub:var(--dsw-alias-label-secondary,#a1a1aa);--ml-radius:10px;--ml-radius-sm:7px}
.ml-root *{box-sizing:border-box}
.ml-root::-webkit-scrollbar{width:9px;height:9px}
.ml-root::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--ml-dim) 40%,transparent);border-radius:9px;border:2px solid transparent;background-clip:content-box}
.ml-root::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--ml-dim) 65%,transparent);background-clip:content-box}
.ml-root::-webkit-scrollbar-track{background:transparent}

/* ── header ── */
.ml-topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding-bottom:14px;flex-wrap:wrap}
.ml-topbar-left{display:flex;flex-direction:column;gap:3px;min-width:0}
.ml-h1{font-size:15px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;letter-spacing:-.01em}
.ml-h1-badge{font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;letter-spacing:.02em}
.ml-subtitle{font-size:11.5px;color:var(--ml-dim);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:720px}
.ml-topbar-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.ml-input{border-radius:8px;border:1px solid var(--ml-border);background:var(--ml-surface);color:var(--dsw-alias-label-primary,#e4e4e7);font:inherit;font-size:12px;padding:6px 11px;outline:none;width:200px;transition:border-color .15s,box-shadow .15s}
.ml-input:focus{border-color:color-mix(in srgb,var(--ml-accent) 55%,transparent);box-shadow:0 0 0 2.5px color-mix(in srgb,var(--ml-accent) 10%,transparent)}
.ml-pill{border-radius:20px;border:1px solid var(--ml-border);background:transparent;color:var(--ml-sub);font:inherit;font-size:11.5px;padding:5px 13px;cursor:pointer;transition:all .15s;white-space:nowrap;user-select:none}
.ml-pill:hover{background:var(--ml-surface-hover)}
.ml-pill[data-on="1"]{background:color-mix(in srgb,var(--ml-accent) 15%,transparent);color:var(--ml-accent);border-color:color-mix(in srgb,var(--ml-accent) 35%,transparent)}
.ml-icon-btn{width:30px;height:30px;border-radius:8px;border:1px solid var(--ml-border);background:transparent;color:var(--ml-sub);font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;padding:0;line-height:1}
.ml-icon-btn:hover{background:var(--ml-surface-hover);color:var(--dsw-alias-label-primary,#e4e4e7)}

/* ── tab bar ── */
.ml-tabbar{display:flex;gap:2px;margin-bottom:14px;background:var(--ml-surface);border:1px solid var(--ml-border);border-radius:var(--ml-radius);padding:3px;width:fit-content}
.ml-tabbar-item{font-size:12px;padding:6px 18px;border-radius:8px;cursor:pointer;border:none;background:transparent;color:var(--ml-dim);transition:all .18s;font:inherit;font-weight:500;user-select:none;position:relative}
.ml-tabbar-item:hover{color:var(--ml-sub);background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#71717a) 7%,transparent)}
.ml-tabbar-item[data-on="1"]{background:color-mix(in srgb,var(--ml-accent) 16%,transparent);color:var(--ml-accent);font-weight:600;box-shadow:0 1px 4px color-mix(in srgb,var(--ml-accent) 15%,transparent),inset 0 0 0 1px color-mix(in srgb,var(--ml-accent) 22%,transparent)}

/* ── body / panes ── */
.ml-body{display:flex;gap:14px;flex:1;min-height:200px}
.ml-panel{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--ml-surface);border:1px solid var(--ml-border);border-radius:var(--ml-radius);overflow:hidden}
.ml-panel-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--ml-border);flex-shrink:0}
.ml-panel-title{font-weight:600;font-size:12.5px;display:flex;align-items:center;gap:6px;margin:0;letter-spacing:.01em}
.ml-panel-badge{font-size:10.5px;color:var(--ml-dim);background:var(--ml-surface-raised);padding:2px 8px;border-radius:20px}
.ml-panel-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.ml-panel-body::-webkit-scrollbar{width:9px;height:9px}
.ml-panel-body::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--ml-dim) 40%,transparent);border-radius:9px;border:2px solid transparent;background-clip:content-box}
.ml-panel-body::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--ml-dim) 65%,transparent);background-clip:content-box}
.ml-panel-body::-webkit-scrollbar-track{background:transparent}

/* ── empty state ── */
.ml-empty{text-align:center;color:var(--ml-dim);padding:40px 16px;font-size:12px;line-height:1.7}
.ml-empty-icon{font-size:28px;margin-bottom:8px;opacity:.7}

/* ── file tree items ── */
.ml-file{border:1px solid var(--ml-border);border-radius:var(--ml-radius-sm);padding:8px 10px;background:transparent;transition:background .12s;cursor:pointer}
.ml-file:hover{background:var(--ml-surface-hover)}
.ml-file[data-open="1"]{background:var(--ml-surface);border-color:color-mix(in srgb,var(--ml-accent) 25%,transparent)}
.ml-file-path{font-weight:600;font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary,#e4e4e7);display:flex;align-items:center;gap:5px}
.ml-file-path .ml-ficon{color:var(--ml-accent);font-size:13px;transition:transform .2s}
.ml-file[data-open="1"] .ml-ficon{transform:rotate(90deg)}
.ml-file-lines{font-size:10.5px;color:var(--ml-dim);font-weight:400;margin-left:auto}
.ml-file-syms{margin-top:4px;padding-top:4px;border-top:1px dashed var(--ml-border)}
.ml-sig{font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;font-size:11px;color:var(--ml-sub);margin-left:12px;padding:2px 0 2px 8px;border-left:2px solid color-mix(in srgb,var(--ml-accent) 30%,transparent)}

/* ── ledger cards ── */
.ml-entry{border:1px solid var(--ml-border);border-radius:var(--ml-radius);padding:10px 12px;background:transparent;display:flex;flex-direction:column;gap:5px;transition:all .15s;cursor:pointer}
.ml-entry:hover{background:var(--ml-surface-hover)}
.ml-entry[data-open="1"]{background:var(--ml-surface);border-color:color-mix(in srgb,var(--ml-accent) 20%,transparent)}
.ml-entry-top{display:flex;align-items:center;gap:8px}
.ml-entry-id{font-size:11px;font-weight:600;color:var(--ml-dim);font-family:ui-monospace,Consolas,monospace;flex-shrink:0}
.ml-entry-title{font-weight:600;font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ml-badge{font-size:10.5px;padding:2px 8px;border-radius:20px;font-weight:600;white-space:nowrap;letter-spacing:.02em;flex-shrink:0}
.ml-badge-ok{color:var(--ml-green);background:color-mix(in srgb,var(--ml-green) 12%,transparent)}
.ml-badge-warn{color:var(--ml-red);background:color-mix(in srgb,var(--ml-red) 12%,transparent)}
.ml-badge-wip{color:var(--ml-yellow);background:color-mix(in srgb,var(--ml-yellow) 12%,transparent)}
.ml-badge-info{color:var(--ml-blue);background:color-mix(in srgb,var(--ml-blue) 12%,transparent)}
.ml-entry-detail{padding-top:4px;border-top:1px dashed var(--ml-border);margin-top:2px;display:flex;flex-direction:column;gap:4px}
.ml-entry-anchor{font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;font-size:11px;color:var(--ml-accent);word-break:break-all;padding-left:1px}
.ml-entry-field{font-size:12px;line-height:1.6;color:var(--ml-sub)}
.ml-entry-field b{font-weight:600;color:var(--dsw-alias-label-primary,#e4e4e7);margin-right:5px}

/* ── dashboard: score ring ── */
.ml-ring-wrap{position:relative;width:80px;height:80px;flex-shrink:0}
.ml-ring-wrap svg{width:80px;height:80px;transform:rotate(-90deg);filter:drop-shadow(0 0 10px color-mix(in srgb,var(--ml-accent) 15%,transparent))}
.ml-ring-wrap circle{fill:none;stroke-width:4.5}
.ml-ring-bg{stroke:color-mix(in srgb,var(--ml-dim) 12%,transparent)}
.ml-ring-fg{stroke-linecap:round;transition:stroke-dashoffset .8s cubic-bezier(.4,0,.2,1)}
.ml-ring-num{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
.ml-ring-val{font-size:22px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.ml-ring-lbl{font-size:9px;color:var(--ml-dim);letter-spacing:.05em;line-height:1;text-transform:uppercase}

/* ── dashboard: KPI strip ── */
.ml-kpi-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px}
.ml-kpi{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:10px 8px;border:1px solid var(--ml-border);border-radius:var(--ml-radius-sm);background:var(--ml-surface);transition:all .15s}
.ml-kpi:hover{background:var(--ml-surface-hover);border-color:color-mix(in srgb,var(--ml-accent) 18%,transparent)}
.ml-kpi-val{font-size:20px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
.ml-kpi-label{font-size:10px;color:var(--ml-dim);text-align:center;line-height:1.3;letter-spacing:.02em}

/* ── dashboard: section card ── */
.ml-dcard{display:flex;flex-direction:column;border:1px solid var(--ml-border);border-radius:var(--ml-radius);background:transparent;overflow:hidden}
.ml-dcard-hdr{font-weight:600;font-size:12px;line-height:1.4;min-height:34px;padding:8px 14px;background:var(--ml-surface-raised);display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--ml-border)}
.ml-dcard-hdr .ml-hdr-note{margin-left:auto;font-size:10.5px;font-weight:400;color:var(--ml-dim);white-space:nowrap}
.ml-hint{cursor:help;color:var(--ml-dim);font-size:12px;font-weight:400;opacity:.45;transition:opacity .15s;margin-left:3px;user-select:none}
.ml-hint:hover{opacity:1}
.ml-dcard-body{padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.ml-dnote{font-size:11.5px;color:var(--ml-dim);line-height:1.6}

/* ── dashboard: metric rows ── */
.ml-vrow{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.6}
.ml-vrow-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.ml-vrow-cnt{font-weight:700;min-width:22px;text-align:right;font-variant-numeric:tabular-nums;flex-shrink:0}
.ml-vrow-lbl{color:var(--ml-sub);flex:0 0 auto;min-width:72px}
.ml-vrow-track{flex:1;height:4px;border-radius:4px;background:var(--ml-surface-raised);overflow:hidden;min-width:24px}
.ml-vrow-bar{display:block;height:100%;border-radius:4px;transition:width .5s cubic-bezier(.4,0,.2,1)}

/* ── dashboard: summary section ── */
.ml-summary-grid{display:grid;grid-template-columns:auto 1fr;gap:0;font-size:12px;line-height:1.7}
.ml-summary-icon{width:28px;text-align:center;flex-shrink:0;font-size:13px}
.ml-summary-row{display:flex;align-items:center;gap:4px;padding:5px 0;border-bottom:1px solid color-mix(in srgb,var(--ml-dim) 8%,transparent)}
.ml-summary-row:last-child{border-bottom:none}
.ml-summary-count{font-weight:800;font-variant-numeric:tabular-nums;min-width:18px}
.ml-summary-text{color:var(--ml-sub)}

/* ── dashboard: progress bar ── */
.ml-cachebar{height:6px;border-radius:6px;background:var(--ml-surface-raised);overflow:hidden}
.ml-cachebar-fill{display:block;height:100%;border-radius:6px;transition:width .5s cubic-bezier(.4,0,.2,1)}

/* ── dashboard: cumulative footer ── */
.ml-cum{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11px;line-height:1.6;padding:8px 14px;border-top:1px solid var(--ml-border);background:var(--ml-surface)}
.ml-cum-item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.ml-cum-lbl{color:var(--ml-dim)}
.ml-cum-val{font-weight:700;font-variant-numeric:tabular-nums;color:var(--ml-sub)}

/* ── weight bar (ML model) ── */
.ml-wbar{display:flex;align-items:center;gap:8px;font-size:11px;line-height:1.6}
.ml-wbar-track{height:5px;border-radius:4px;background:var(--ml-surface-raised);overflow:hidden;min-width:60px;max-width:120px;flex-shrink:0}
.ml-wbar-fill{display:block;height:100%;border-radius:4px;background:var(--ml-accent)}
.ml-wbar-name{color:var(--ml-sub);font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;font-size:10.5px;min-width:120px}
.ml-wbar-val{font-variant-numeric:tabular-nums;color:var(--ml-dim);font-size:10.5px;min-width:36px;text-align:right}

/* ── contract suites ── */
.ml-suite{display:flex;flex-direction:column;gap:12px}
.ml-prog{border:1px solid var(--ml-border);border-radius:var(--ml-radius);overflow:hidden;background:transparent}
.ml-prog-hdr{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--ml-surface-raised);border-bottom:1px solid var(--ml-border);flex-wrap:wrap}
.ml-prog-name{font-weight:700;font-size:13px;font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;white-space:nowrap}
.ml-prog-desc{font-size:10.5px;color:var(--ml-dim);min-width:0;flex:1;overflow-wrap:anywhere}
.ml-prog-score{font-size:18px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap;display:flex;align-items:baseline;gap:3px}
.ml-prog-score small{font-size:10.5px;font-weight:600;color:var(--ml-dim)}
.ml-prog-delta{font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.ml-prog-body{padding:10px 14px 12px;display:flex;flex-direction:column;gap:8px}
.ml-prog-meta{font-size:10.5px;color:var(--ml-dim);display:flex;flex-wrap:wrap;gap:4px 14px;line-height:1.6}
.ml-spark{display:flex;align-items:flex-end;gap:3px;height:22px;padding:2px 0}
.ml-spark-bar{width:5px;min-height:2px;border-radius:2px;background:color-mix(in srgb,var(--ml-accent) 55%,transparent);transition:height .3s ease}
.ml-spark-bar--bad{background:color-mix(in srgb,var(--ml-red) 65%,transparent)}
.ml-cases{padding-right:5px;overflow-y:auto}
.ml-cases::-webkit-scrollbar{width:9px}
.ml-cases::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--ml-dim) 38%,transparent);border-radius:9px;border:2px solid transparent;background-clip:content-box}
.ml-cases::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--ml-dim) 62%,transparent);background-clip:content-box}
.ml-cases::-webkit-scrollbar-track{background:transparent}
.ml-case-head{display:grid;grid-template-columns:46px minmax(0,1fr) 46px 52px;gap:8px;font-size:10px;color:var(--ml-dim);letter-spacing:.06em;padding:3px 0 5px;border-bottom:1px solid var(--ml-border);position:sticky;top:0;background:var(--ml-surface);z-index:1;text-transform:uppercase}
.ml-case-head span:nth-child(3){text-align:center}
.ml-case-head span:nth-child(4){text-align:right}
.ml-case{display:grid;grid-template-columns:46px minmax(0,1fr) 46px 52px;gap:8px;align-items:baseline;font-size:11.5px;padding:4px 0;border-bottom:1px dashed color-mix(in srgb,var(--ml-dim) 12%,transparent);transition:background .1s}
.ml-case:last-child{border-bottom:none}
.ml-case:hover{background:var(--ml-surface-hover)}
.ml-case-id{font-family:ui-monospace,'Cascadia Code',Menlo,Consolas,monospace;color:var(--ml-dim);font-size:10.5px}
.ml-case-title{min-width:0;overflow-wrap:anywhere;line-height:1.5}
.ml-case-w{justify-self:center;min-width:22px;text-align:center;border-radius:9px;padding:1px 6px;font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ml-sub);background:var(--ml-surface-raised)}
.ml-case-w--hi{color:var(--ml-orange);background:color-mix(in srgb,var(--ml-orange) 14%,transparent)}
.ml-case-w--antibody{color:#c4b5fd;background:color-mix(in srgb,#8b5cf6 20%,transparent);border:1px solid color-mix(in srgb,#a78bfa 35%,transparent);font-weight:700}
.ml-reg-debt{font-size:11.5px;line-height:1.5;color:#fca5a5;padding:8px 12px;border:1px solid color-mix(in srgb,#ef4444 35%,transparent);border-radius:var(--ml-radius-sm);background:color-mix(in srgb,#ef4444 8%,transparent);display:flex;align-items:center;gap:8px}
.ml-badge-superseded{color:var(--ml-dim);background:color-mix(in srgb,var(--ml-dim) 14%,transparent);border:1px dashed color-mix(in srgb,var(--ml-dim) 35%,transparent)}
.ml-entry[data-superseded="1"]{opacity:.65}
.ml-entry[data-superseded="1"]:hover{opacity:1}
.ml-case-st{text-align:right;font-size:10.5px;font-weight:600;white-space:nowrap}
.ml-debt{font-size:11px;line-height:1.6;color:var(--ml-orange);padding:6px 10px;border:1px dashed color-mix(in srgb,var(--ml-orange) 30%,transparent);border-radius:var(--ml-radius-sm);background:color-mix(in srgb,var(--ml-orange) 5%,transparent)}
.ml-debt b{font-weight:700}
.ml-legend{font-size:10.5px;color:var(--ml-dim);line-height:1.65;padding:8px 12px;border:1px solid var(--ml-border);border-radius:var(--ml-radius-sm);background:var(--ml-surface)}
.ml-legend b{color:var(--ml-sub);font-weight:600}

/* ── @keyframes ── */
@keyframes ml-fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.ml-anim{animation:ml-fadeIn .3s cubic-bezier(.4,0,.2,1) both}
.ml-anim-d1{animation-delay:.05s}.ml-anim-d2{animation-delay:.1s}.ml-anim-d3{animation-delay:.15s}

/* ── utility ── */
.ml-sep{width:100%;height:1px;background:var(--ml-border);margin:4px 0;flex-shrink:0}

/* ── copy toast ── */
.ml-copy-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:color-mix(in srgb,#000 85%,transparent);color:#fff;padding:6px 16px;border-radius:20px;font-size:12px;animation:ml-fadeIn .2s ease;z-index:9999;pointer-events:none;backdrop-filter:blur(8px)}
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

    /** 格式化 tokens 数字 */
    function fmtTokens(n) {
      if (n >= 1000) {
        var k = n / 1000
        return (k === Math.floor(k) ? String(k) : k.toFixed(1)) + 'k'
      }
      return String(n)
    }

    function formatUptime(sec) {
      if (sec < 60) return sec + ' 秒'
      if (sec < 3600) return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒'
      return Math.floor(sec / 3600) + ' 小时 ' + Math.floor((sec % 3600) / 60) + ' 分'
    }

    /** 状态 badge 的样式类 */
    function badgeClass(status) {
      if (status === '已落地') return 'ml-badge ml-badge-ok'
      if (status === '进行中' || status === '待验证') return 'ml-badge ml-badge-wip'
      if (PENDING_LIST.includes(status)) return 'ml-badge ml-badge-warn'
      return 'ml-badge ml-badge-info'
    }

    /** 圆环评分组件 */
    function ScoreRing(props) {
      var score = props.score ?? 0
      var r = 34, c = 2 * Math.PI * r
      var offset = c * (1 - score / 100)
      var color = score >= 80 ? '#86efac' : score >= 50 ? '#fde68a' : score >= 20 ? '#fdba74' : '#fca5a5'
      var grade = score >= 80 ? 'GOOD' : score >= 50 ? 'FAIR' : score >= 20 ? 'LOW' : 'IDLE'
      return h('div', { className: 'ml-ring-wrap', title: '综合效能评分（0-100）\n= 工具使用率 × 40% + 决策沉淀率 × 30% + 风险拦截率 × 30%\n\n≥80 GOOD：台账工作流运转充分\n≥50 FAIR：基本运转，更多使用后效果更好\n≥20 LOW：刚开始积累\n＜20 IDLE：本次会话尚未使用' },
        h('svg', { viewBox: '0 0 80 80' },
          h('circle', { className: 'ml-ring-bg', cx: 40, cy: 40, r: r }),
          h('circle', { className: 'ml-ring-fg', cx: 40, cy: 40, r: r,
            style: { stroke: color, strokeDasharray: c, strokeDashoffset: offset } })
        ),
        h('div', { className: 'ml-ring-num' },
          h('span', { className: 'ml-ring-val', style: { color: color } }, score),
          h('span', { className: 'ml-ring-lbl' }, grade)
        )
      )
    }

    var VERDICT_META = {
      'rollback-risk':   { dot: '#fca5a5', label: '回退风险', tip: '已修复的代码出现被改回原样的迹象，可能导致同一 bug 重新出现' },
      'repeated-repair': { dot: '#fde68a', label: '重复修复', tip: '同一位置已被修复过多次，本次改动可能是在重复之前做过的事' },
      'already-done':    { dot: '#86efac', label: '已有实现', tip: '台账中已记录过相同功能或修复，无需重做' },
      'shelved':         { dot: '#fdba74', label: '搁置方案', tip: '相关方案曾被搁置，需确认搁置原因已消除才可继续' },
      'foreign-anchor':  { dot: '#a1a1aa', label: '外部锚点', tip: '锚点指向当前仓库之外的代码，仅供参考' },
      'unrecorded':      { dot: '#52525b', label: '新路径', tip: '台账中无相关记录，属于全新改动，直接放行' },
    }

    /** 预检判定分布行 */
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

    /* =========================================== DASHBOARD (效能) */

    /** 🤖 决策模型卡片 */
    function MLModelCard(props) {
      var ml = props.ml
      if (!ml) return null
      var ready = ml.ready
      var sampleCount = ml.sampleCount || 0
      if (sampleCount === 0 && !ready) return null
      var weights = ml.weights || {}
      var WEIGHT_LABELS = {
        'statusWeight': '状态权重',
        'anchorPrecision': '锚点精度',
        'timeDecay': '时间衰减',
        'repairCount': '修复频次',
        'negativeCount': '否决历史',
        'keywordOverlap': '关键词匹配',
        'hasContract': '契约覆盖',
        'bm25Affinity': '检索相关度',
      }
      var maxWeight = 0
      var weightEntries = Object.entries(weights)
      for (var i = 0; i < weightEntries.length; i++) {
        var absVal = Math.abs(weightEntries[i][1])
        if (absVal > maxWeight) maxWeight = absVal
      }
      if (maxWeight === 0) maxWeight = 1
      var progressPct = Math.min(100, Math.round(sampleCount / 20 * 100))
      return h('div', { className: 'ml-dcard ml-anim ml-anim-d2' },
        h('div', { className: 'ml-dcard-hdr' },
          h('span', null, '排序模型'),
          h('span', {
            className: 'ml-hint',
            title: '观察「预检后 AI 是否采纳了建议」来学习排序偏好，\n让下次预检时更重要的历史决策排在前面。\n需 20 个反馈样本启用，偏好保存在工作区、重启不丢。'
          }, 'ⓘ'),
          h('span', { className: 'ml-hdr-note' },
            ready
              ? h('span', { style: { color: 'var(--ml-green)' } }, '● 已就绪 · ' + sampleCount + ' 样本')
              : sampleCount + '/20 样本'
          )
        ),
        h('div', { className: 'ml-dcard-body' },
          ready
            ? [
                weightEntries.map(function (pair) {
                  var pct = Math.round(Math.abs(pair[1]) / maxWeight * 100)
                  var label = WEIGHT_LABELS[pair[0]] || pair[0]
                  return h('div', { key: pair[0], className: 'ml-wbar' },
                    h('span', { className: 'ml-wbar-track' },
                      h('span', { className: 'ml-wbar-fill', style: { width: pct + '%' } })
                    ),
                    h('span', { className: 'ml-wbar-name' }, label),
                    h('span', { className: 'ml-wbar-val' }, pair[1].toFixed(2))
                  )
                })
              ]
            : [
                h('div', { key: 'progress', style: { marginBottom: '4px' } },
                  h('div', { style: { fontSize: '11.5px', color: 'var(--ml-sub)', marginBottom: '5px' } },
                    '采集样本 ' + sampleCount + ' / 20'
                  ),
                  h('div', { className: 'ml-cachebar' },
                    h('span', { className: 'ml-cachebar-fill', style: { width: progressPct + '%', background: 'var(--ml-accent)' } })
                  )
                ),
                h('div', { key: 'explain', className: 'ml-dnote' },
                  'AI 每次先预检、再入册时产生一个反馈样本。积满 20 个样本后，模型将自动启用，优化预检结果的排序。'
                )
              ]
        )
      )
    }

    /** 效能仪表盘 — 直接在 ml-root 滚动流中平铺，不嵌套 panel/panel-body 滚动区 */
    function DashboardPanel(props) {
      var s = props.stats
      if (!s) {
        return h('div', { className: 'ml-empty' },
          h('div', { className: 'ml-empty-icon' }, '📊'),
          '正在加载统计数据…'
        )
      }

      var entries = Array.isArray(props.entries) ? props.entries : []
      var v = s.value || {}
      var addRec = (s.add && s.add.recorded) || 0
      var score = s.effectivenessScore || 0
      var totalCalls = s.totalCalls || 0
      var pendingCount = entries.filter(function (e) { return PENDING_LIST.includes(e.status) }).length
      var checkCount = (s.calls && s.calls.ledger_check) || 0
      var riskyBlocked = (s.check && s.check.riskyBlocked) || 0

      // ── 防护事件 ──
      var impacts = []
      if ((v.rollbacksPrevented || 0) > 0)
        impacts.push({ icon: '🛡', count: v.rollbacksPrevented, label: '回退风险拦截', desc: '已修复的代码出现被改回原样的迹象，已阻止', color: 'var(--ml-red)' })
      if ((v.duplicateWorkSaved || 0) > 0)
        impacts.push({ icon: '♻️', count: v.duplicateWorkSaved, label: '重复工作规避', desc: '要做的事台账里已有记录，跳过了重复劳动', color: 'var(--ml-green)' })
      if ((v.shelvedRespected || 0) > 0)
        impacts.push({ icon: '⚠', count: v.shelvedRespected, label: '搁置方案拦截', desc: '方案之前被搁置过，已阻止在条件不满足时重启', color: 'var(--ml-orange)' })

      return h('div', { className: 'ml-dash-flow', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },

        // ── 顶部：评分 + KPI ──
        h('div', { className: 'ml-dcard ml-anim', style: { overflow: 'visible' } },
          h('div', { className: 'ml-dcard-body', style: { padding: '16px' } },

            // 面板概述
            h('div', { style: { fontSize: '11.5px', color: 'var(--ml-sub)', lineHeight: '1.6', marginBottom: '12px' } },
              '记忆台账在 AI 修改代码前自动查阅历史决策（预检），修改后记录本次决策（沉淀），',
              '发现风险时阻止 AI 重复犯错（拦截）。以下数据反映本次会话的运转情况。'
            ),

            h('div', { style: { display: 'flex', gap: '20px', alignItems: 'center' } },

              // 评分环
              h(ScoreRing, { score: score }),

              // KPI 指标
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { className: 'ml-kpi-strip' },
                  h('div', { className: 'ml-kpi', title: '本次会话中台账工具被调用的总次数，包括预检、入册、搜索、地图等所有操作' },
                    h('span', { className: 'ml-kpi-val', style: { color: 'var(--dsw-alias-label-primary,#e4e4e7)' } }, totalCalls),
                    h('span', { className: 'ml-kpi-label' }, '工具调用')
                  ),
                  h('div', { className: 'ml-kpi', title: 'AI 修改代码前查阅台账历史的次数（ledger_check）——预检越多，回退风险越低' },
                    h('span', { className: 'ml-kpi-val', style: { color: checkCount > 0 ? 'var(--ml-blue)' : 'var(--ml-dim)' } }, checkCount),
                    h('span', { className: 'ml-kpi-label' }, '预检次数')
                  ),
                  h('div', { className: 'ml-kpi', title: '预检时发现已有决策记录并阻止 AI 走回头路的次数——比如已修复的 bug 差点被改回去' },
                    h('span', { className: 'ml-kpi-val', style: { color: riskyBlocked > 0 ? 'var(--ml-red)' : 'var(--ml-dim)' } }, riskyBlocked),
                    h('span', { className: 'ml-kpi-label' }, '风险拦截')
                  ),
                  h('div', { className: 'ml-kpi', title: 'AI 完成改动后写入台账的决策记录数——沉淀的记录将在后续预检中被检索到' },
                    h('span', { className: 'ml-kpi-val', style: { color: addRec > 0 ? 'var(--ml-green)' : 'var(--ml-dim)' } }, addRec),
                    h('span', { className: 'ml-kpi-label' }, '决策沉淀')
                  )
                )
              )
            )
          ),

          // 累计数据 footer
          s.cumulative && s.cumulative.sessionsCount > 1
            ? h('div', { className: 'ml-cum', title: '跨所有历史会话的累计统计' },
                h('span', { className: 'ml-cum-item' },
                  h('span', { className: 'ml-cum-lbl' }, '历史累计'),
                  h('span', { className: 'ml-cum-val' }, s.cumulative.sessionsCount + ' 个会话')
                ),
                h('span', { className: 'ml-cum-item' },
                  h('span', { className: 'ml-cum-lbl' }, '总调用'),
                  h('span', { className: 'ml-cum-val' }, s.cumulative.totalCalls || 0)
                ),
                h('span', { className: 'ml-cum-item' },
                  h('span', { className: 'ml-cum-lbl' }, '已沉淀决策'),
                  h('span', { className: 'ml-cum-val' }, (s.cumulative.addRecorded || 0) + ' 条')
                ),
                h('span', { className: 'ml-cum-item' },
                  h('span', { className: 'ml-cum-lbl' }, '累计拦截'),
                  h('span', { className: 'ml-cum-val' }, (s.cumulative.riskyBlocked || 0) + ' 次')
                )
              )
            : null
        ),

        // ── 防护效果 ──
        (impacts.length > 0 || pendingCount > 0)
          ? h('div', { className: 'ml-dcard ml-anim ml-anim-d1' },
              h('div', { className: 'ml-dcard-hdr' },
                h('span', null, '防护记录'),
                h('span', {
                  className: 'ml-hint',
                  title: '预检时发现历史决策与当前改动冲突，自动阻止 AI 走回头路或做重复工作的记录'
                }, 'ⓘ'),
                h('span', { className: 'ml-hdr-note' }, formatUptime(s.uptimeSeconds || 0))
              ),
              h('div', { className: 'ml-dcard-body' },
                impacts.length > 0
                  ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                      impacts.map(function (item, i) {
                        return h('div', { key: i, className: 'ml-summary-row', title: item.desc },
                          h('span', { className: 'ml-summary-icon' }, item.icon),
                          h('span', { className: 'ml-summary-count', style: { color: item.color } }, item.count),
                          h('span', { className: 'ml-summary-text' },
                            h('span', null, item.label),
                            h('span', { style: { color: 'var(--ml-dim)', fontSize: '11px', marginLeft: '6px' } }, '— ' + item.desc)
                          )
                        )
                      })
                    )
                  : null,

                pendingCount > 0
                  ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--ml-orange)', paddingTop: impacts.length > 0 ? '6px' : '0', borderTop: impacts.length > 0 ? '1px solid var(--ml-border)' : 'none' } },
                      h('span', null, '📋'),
                      h('span', { style: { fontWeight: 700 } }, pendingCount),
                      h('span', null, '条决策尚未落地（搁置、待验证或进行中），详见「骨架与台账」页')
                    )
                  : null
              )
            )
          : entries.length === 0 && totalCalls === 0
            ? h('div', { className: 'ml-dcard ml-anim ml-anim-d1' },
                h('div', { className: 'ml-dcard-hdr' }, h('span', null, '运行状态')),
                h('div', { className: 'ml-dcard-body' },
                  h('div', { className: 'ml-dnote' },
                    '等待首次调用。当 AI 开始修改代码时，台账工具会自动查阅历史决策（预检）、',
                    '记录新决策（入册），并在发现风险时阻止重复犯错。'
                  )
                )
              )
            : null,

        // ── 预检分布 ──
        s.check && s.check.pathsScanned > 0
          ? h('div', { className: 'ml-dcard ml-anim ml-anim-d1' },
              h('div', { className: 'ml-dcard-hdr' },
                h('span', null, '预检分布'),
                h('span', {
                  className: 'ml-hint',
                  title: 'AI 每次修改代码前会调用 ledger_check 预检相关路径，\n' +
                    '将结果按类型分类统计。颜色越暖表示风险越高。'
                }, 'ⓘ'),
                h('span', { className: 'ml-hdr-note' },
                  s.check.pathsScanned + ' 路径 · ' + s.check.entriesMatched + ' 条命中'
                )
              ),
              h('div', { className: 'ml-dcard-body' },
                h('div', { className: 'ml-dnote', style: { marginBottom: '4px' } },
                  'AI 在修改每个文件前查阅台账历史，以下是各类预检结果的分布：'
                ),
                Object.entries(s.check.verdicts || {})
                  .filter(function (pair) { return pair[1] > 0 })
                  .sort(function (a, b) { return b[1] - a[1] })
                  .map(function (pair) {
                    return h(VerdictRow, {
                      key: pair[0],
                      verdict: pair[0],
                      count: pair[1],
                      total: s.check.pathsScanned
                    })
                  })
              )
            )
          : null,

        // ── 决策模型 ──
        h(MLModelCard, { ml: s.ml || null })
      )
    }

    /* =========================================== CONTRACTS (契约跑分) */

    /** 程序契约卡 */
    function SuitePanel(props) {
      var data = props.data
      if (!data) {
        return h('div', { className: 'ml-empty' },
          h('div', { className: 'ml-empty-icon' }, '🧪'), '契约跑分暂未连接')
      }
      var programs = data.programs || []
      if (programs.length === 0) {
        return h('div', { className: 'ml-empty' },
          h('div', { className: 'ml-empty-icon' }, '🧪'),
          '还没有契约套件。', h('br'),
          '改完一处，让 AI 补一条可执行用例：', h('br'),
          h('b', null, 'ledger_suite action=add'), ' → ', h('b', null, 'ledger_suite action=run'))
      }

      return h('div', { className: 'ml-suite' },
        h('div', { className: 'ml-legend' },
          h('b', null, '权重说明'), '：每条用例在程序总分里占的比重，由添加用例时指定（默认 1，分数 = 通过用例的权重和 ÷ 全部用例权重和 × 100）。',
          h('span', { style: { marginLeft: '8px' } },
            h('b', { style: { color: '#c4b5fd' } }, '🛡️ 防踩坑用例权重 5'),
            '（专门锁住历史回退，防止同一个坑再次踩入）。'
          )
        ),
        programs.map(function (program) {
          var cases = program.cases || []
          var active = cases.filter(function (c) { return c.status !== 'retired' })
          var last = program.last
          var history = program.history || []
          var prev = history.length > 1 ? history[history.length - 2] : null
          var delta = (last && prev && typeof last.score === 'number' && typeof prev.score === 'number')
            ? last.score - prev.score : null
          var scoreColor = last && typeof last.score === 'number'
            ? (last.score >= 90 ? 'var(--ml-green)' : last.score >= 70 ? 'var(--ml-yellow)' : 'var(--ml-red)')
            : 'var(--ml-dim)'

          var bars = history.map(function (run, index) {
            var value = typeof run.score === 'number' ? run.score : 0
            var height = Math.max(2, Math.round((value / 100) * 22))
            return h('span', {
              key: index,
              className: 'ml-spark-bar' + (value < 70 ? ' ml-spark-bar--bad' : ''),
              style: { height: height + 'px' },
              title: (run.ts ? String(run.ts).slice(5, 16).replace('T', ' ') : '') + ' · ' + (run.score ?? '—') + ' 分 · ' + run.passed + '/' + run.total,
            })
          })

          var retired = cases.filter(function (c) { return c.status === 'retired' })
          var shown = active.concat(retired)
          var rows = shown.map(function (c) {
            var status = c.status === 'retired'
              ? h('span', { className: 'ml-case-st', style: { color: 'var(--ml-dim)' }, title: '已停用' }, '⏹ 停用')
              : !c.last
                ? h('span', { className: 'ml-case-st', style: { color: 'var(--ml-dim)' }, title: '还没跑过' }, '⚪ 未跑')
                : c.last.ok
                  ? h('span', { className: 'ml-case-st', style: { color: 'var(--ml-green)' }, title: c.last.ms ? (c.last.ms + ' ms') : '' }, '✓ 通过')
                  : h('span', { className: 'ml-case-st', style: { color: 'var(--ml-red)' }, title: c.last.reason || '失败' }, '✗ 失败')
            var weight = Number.isFinite(c.weight) ? c.weight : 1
            var isAntibody = weight >= 5
            return h('div', { className: 'ml-case', key: c.id },
              h('span', { className: 'ml-case-id' }, c.id),
              h('span', {
                className: 'ml-case-title',
                title: (c.title || '') + (isAntibody ? '\n【性质】防踩坑用例' : '') + (c.covers && c.covers.length ? '\n覆盖：' + c.covers.join('、') : '') + (c.from ? '\n来源：' + c.from : '')
              },
                c.title || '（未命名用例）',
                isAntibody ? h('span', { style: { marginLeft: '6px', fontSize: '10px', color: '#c4b5fd', fontWeight: 'bold' } }, '🛡️防踩坑') : null
              ),
              h('span', {
                className: isAntibody ? 'ml-case-w ml-case-w--antibody' : weight >= 3 ? 'ml-case-w ml-case-w--hi' : 'ml-case-w',
                title: isAntibody
                  ? '🛡️ 防踩坑用例（权重 ' + weight + '）：专门用来防范历史回退，锁定破坏场景，防止重复踩坑！'
                  : '权重 ' + weight + '：这条用例在程序总分里占的比重，添加用例时指定。',
              }, String(weight)),
              status
            )
          })

          var caseHead = h('div', { className: 'ml-case-head' },
            h('span', null, '编号'),
            h('span', null, '用例'),
            h('span', null, '权重'),
            h('span', null, '最近')
          )

          return h('div', { className: 'ml-prog', key: program.program },
            h('div', { className: 'ml-prog-hdr' },
              h('span', { className: 'ml-prog-name' }, program.program),
              h('span', { className: 'ml-prog-desc', title: program.description || '' }, program.description || ''),
              program.drift ? h('span', { className: 'ml-badge ml-badge-warn', title: '套件哈希与登记时不一致——断言被人改过' }, '漂移') : null,
              last
                ? h('span', { className: 'ml-prog-score', style: { color: scoreColor } }, String(last.score ?? '—'), h('small', null, '分'))
                : h('span', { className: 'ml-prog-score', style: { color: 'var(--ml-dim)', fontSize: '12px' } }, '未跑分'),
              delta !== null && delta !== 0
                ? h('span', { className: 'ml-prog-delta', style: { color: delta > 0 ? 'var(--ml-green)' : 'var(--ml-red)' } },
                    (delta > 0 ? '▲' : '▼') + Math.abs(delta))
                : null
            ),
            h('div', { className: 'ml-prog-body' },
              program.regressionDebts && program.regressionDebts.length > 0
                ? h('div', { className: 'ml-reg-debt' },
                    h('span', null, '🚨'),
                    h('span', null,
                      '缺防踩坑保护：检测到 ' + program.regressionDebts.length + ' 处改动曾发生回退（' +
                      program.regressionDebts.map(function (d) { return d.id }).join('、') +
                      '），尚未建立防倒车契约！请尽快补充权重 5 的用例锁住。'
                    )
                  )
                : null,
              h('div', { className: 'ml-prog-meta' },
                h('span', null, '契约 ' + active.length + ' 例'),
                retired.length > 0 ? h('span', null, '停用 ' + retired.length + ' 例（不计分）') : null,
                last ? h('span', null, last.passed + '/' + last.total + ' 通过') : null,
                last ? h('span', null, String(last.ts).slice(5, 16).replace('T', ' ')) : null,
                program.version ? h('span', null, 'v' + program.version) : null
              ),
              history.length > 1 ? h('div', { className: 'ml-spark' }, bars) : null,
              rows.length > 0
                ? h('div', { className: 'ml-cases' }, [caseHead].concat(rows))
                : h('div', { className: 'ml-prog-meta' }, '（没有用例）')
            )
          )
        })
      )
    }

    /* =========================================== FILE ITEM (骨架) */

    function FileItem(props) {
      var file = props.file
      var isOpen = props.isOpen
      var toggle = props.toggle
      var syms = (file.symbols || [])
      var hasSym = syms.length > 0

      var symNodes = null
      if (isOpen && hasSym) {
        var items = syms.slice(0, 8).map(function (s, i) {
          return h('div', { className: 'ml-sig', key: i }, s.sig + (s.doc ? ' — ' + s.doc : ''))
        })
        if (syms.length > 8) {
          items.push(h('div', { className: 'ml-sig', key: 'x', style: { opacity: .6 } }, '… 还有 ' + (syms.length - 8) + ' 个符号'))
        }
        symNodes = h('div', { className: 'ml-file-syms' }, items)
      }

      return h('div', {
        className: 'ml-file',
        'data-open': isOpen ? '1' : '0',
        onClick: hasSym ? toggle : undefined,
        style: hasSym ? undefined : { cursor: 'default' },
      },
        h('div', { className: 'ml-file-path' },
          h('span', { className: 'ml-ficon' }, hasSym ? '▸' : '◇'),
          file.path,
          h('span', { className: 'ml-file-lines' }, file.lineCount + ' 行' + (hasSym ? ' · ' + syms.length + ' 符号' : ''))
        ),
        symNodes
      )
    }

    /* =========================================== ENTRY ITEM (台账) */

    function EntryItem(props) {
      var e = props.entry
      var isOpen = props.isOpen
      var toggle = props.toggle
      var pending = PENDING_LIST.includes(e.status)
      var superseded = e.supersededBy

      var detail = null
      if (isOpen) {
        detail = h('div', { className: 'ml-entry-detail' },
          superseded ? h('div', { className: 'ml-entry-field', style: { color: 'var(--ml-dim)' } }, h('b', null, '替代说明'), '本方案已被更晚的决策 ' + superseded + ' 替代结案，建议以新方案为准。') : null,
          e.anchor ? h('div', { className: 'ml-entry-anchor' }, '📌 ' + e.anchor) : null,
          e.why ? h('div', { className: 'ml-entry-field' }, h('b', null, '为什么'), e.why) : null,
          e.change ? h('div', { className: 'ml-entry-field' }, h('b', null, '改了什么'), e.change) : null,
          e.tradeoff && e.tradeoff !== '无' ? h('div', { className: 'ml-entry-field' }, h('b', null, '取舍'), e.tradeoff) : null,
          e.verify ? h('div', { className: 'ml-entry-field' }, h('b', null, '验证'), e.verify) : null,
          e.requirement ? h('div', { className: 'ml-entry-field' }, h('b', null, '需求'), e.requirement) : null,
          e.type ? h('div', { className: 'ml-entry-field' }, h('b', null, '类型'), e.type) : null
        )
      }

      return h('div', {
        className: 'ml-entry',
        'data-open': isOpen ? '1' : '0',
        'data-superseded': superseded ? '1' : '0',
        onClick: toggle,
      },
        h('div', { className: 'ml-entry-top' },
          h('span', { className: 'ml-entry-id' }, e.id),
          h('span', { className: 'ml-entry-title', title: e.title }, e.title),
          superseded ? h('span', { className: 'ml-badge ml-badge-superseded', title: '该方案已被更晚的条目替代，以新结论为准' }, '🌱 已被 ' + superseded + ' 替代') : null,
          h('span', { className: badgeClass(e.status) }, e.status)
        ),
        detail
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
      var _su = React.useState({ loading: true, data: null, error: null })
      var suitesState = _su[0], setSuitesState = _su[1]
      var _q = React.useState(''); var query = _q[0], setQuery = _q[1]
      var _p = React.useState(false); var onlyPending = _p[0], setOnlyPending = _p[1]
      var _t = React.useState('dashboard'); var tab = _t[0], setTab = _t[1]
      // Track expanded items for file tree and ledger entries
      var _openFiles = React.useState({}); var openFiles = _openFiles[0], setOpenFiles = _openFiles[1]
      var _openEntries = React.useState({}); var openEntries = _openEntries[0], setOpenEntries = _openEntries[1]
      // Track live entries filter (metabolic consensus view)
      var _ol = React.useState(true); var onlyLive = _ol[0], setOnlyLive = _ol[1]

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

        var up = new URLSearchParams()
        if (typeof sessionId === 'string' && sessionId.length > 0) up.set('session', sessionId)
        fetch('/api/memledger/suites?' + up.toString(), { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then(function (d) { setSuitesState({ loading: false, data: d.ok ? d : null, error: null }) })
          .catch(function (e) { setSuitesState({ loading: false, data: null, error: String(e?.message || e) }) })
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
        mapBody = mapState.files.map(function (file, idx) {
          return h(FileItem, {
            key: file.path,
            file: file,
            isOpen: !!openFiles[file.path],
            toggle: function () {
              setOpenFiles(function (prev) {
                var next = {}
                for (var k in prev) next[k] = prev[k]
                next[file.path] = !prev[file.path]
                return next
              })
            },
          })
        })
      }

      // ── ledger pane body ──
      var ledgerBody
      var displayEntries = entriesState.list
      if (onlyLive) {
        displayEntries = displayEntries.filter(function (e) { return !e.supersededBy })
      }
      var hiddenSupersededCount = entriesState.list.length - displayEntries.length

      if (entriesState.loading) {
        ledgerBody = h('div', { className: 'ml-empty' }, h('div', { className: 'ml-empty-icon' }, '📖'), '读取变更台账…')
      } else if (entriesState.error) {
        ledgerBody = h('div', { className: 'ml-empty' }, h('div', { className: 'ml-empty-icon' }, '🔌'), '台账暂未连接')
      } else if (displayEntries.length === 0) {
        ledgerBody = h('div', { className: 'ml-empty' },
          h('div', { className: 'ml-empty-icon' }, '📝'),
          hiddenSupersededCount > 0
            ? ['当前搜索下有 ' + hiddenSupersededCount + ' 条记录已被新方案替代。', h('br'), '点击右上角「全部历史」即可展开查看。']
            : ['尚未记录条目。', h('br'), '改动后 AI 会自动入册。']
        )
      } else {
        var entryNodes = displayEntries.map(function (e) {
          return h(EntryItem, {
            key: e.id,
            entry: e,
            isOpen: !!openEntries[e.id],
            toggle: function () {
              setOpenEntries(function (prev) {
                var next = {}
                for (var k in prev) next[k] = prev[k]
                next[e.id] = !prev[e.id]
                return next
              })
            },
          })
        })
        if (onlyLive && hiddenSupersededCount > 0) {
          entryNodes.push(
            h('div', {
              key: '__superseded_hint__',
              style: { padding: '8px 12px', fontSize: '11px', color: 'var(--ml-dim)', textAlign: 'center' }
            }, '🌱 已自动隐藏 ' + hiddenSupersededCount + ' 条被新方案替代的历史旧记录（点右上角「全部历史」可展开）')
          )
        }
        ledgerBody = entryNodes
      }

      // ── header derived ──
      var score = statsState.data?.effectivenessScore ?? null
      var badgeColor = score === null ? '' : score >= 80 ? 'var(--ml-green)' : score >= 50 ? 'var(--ml-yellow)' : score >= 20 ? 'var(--ml-orange)' : 'var(--ml-red)'

      return h('div', { style: { position: 'relative', width: '100%', height: '100%', minHeight: 0 } },
        h('div', { className: 'ml-root' },

        // ── top bar ──
        h('div', { className: 'ml-topbar' },
          h('div', { className: 'ml-topbar-left' },
            h('p', { className: 'ml-h1' },
              '记忆台账',
              score !== null
                ? (statsState.data?.totalCalls
                    ? h('span', { className: 'ml-h1-badge',
                        style: { color: badgeColor, background: 'color-mix(in srgb,' + badgeColor + ' 14%,transparent)' } },
                        score + ' 分')
                    : h('span', { className: 'ml-h1-badge',
                        style: { color: 'var(--ml-dim)', background: 'color-mix(in srgb, var(--ml-dim) 14%, transparent)' } },
                        '待激活'))
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
            h('button', { className: 'ml-pill', 'data-on': onlyLive ? '1' : '0',
              onClick: function () { setOnlyLive(function (v) { return !v }) },
              title: onlyLive ? '当前：已隐藏被新方案替代的旧记录。点击可展开全部历史。' : '当前：显示全部历史。点击可只看有效方案。' },
              onlyLive ? '有效方案 ✓' : '全部历史'),
            h('button', { className: 'ml-pill', 'data-on': onlyPending ? '1' : '0',
              onClick: function () { setOnlyPending(function (v) { return !v }) } },
              onlyPending ? '未决 ✓' : '未决'),
            h('button', { className: 'ml-icon-btn', onClick: loadData, title: '刷新' }, '↻')
          )
        ),

        // ── tab bar ──
        h('div', { className: 'ml-tabbar' },
          h('button', { className: 'ml-tabbar-item', 'data-on': tab === 'dashboard' ? '1' : '0',
            onClick: function () { setTab('dashboard') } }, '效能总览'),
          h('button', { className: 'ml-tabbar-item', 'data-on': tab === 'detail' ? '1' : '0',
            onClick: function () { setTab('detail') } }, '🗺 骨架与台账'),
          h('button', { className: 'ml-tabbar-item', 'data-on': tab === 'suites' ? '1' : '0',
            onClick: function () { setTab('suites') } }, '🧪 契约跑分')
        ),

        // ── tab content ──
        // 效能 tab 直接在 ml-root 滚动流中平铺，不嵌套 ml-body>ml-panel（会产生
        // 双重滚动 + overflow:hidden 裁剪，导致底部内容被对话输入框遮挡）
        tab === 'dashboard'
          ? h(DashboardPanel, { stats: statsState.data, entries: entriesState.list, root: entriesState.root })
          : tab === 'suites'
            ? h('div', { className: 'ml-body' },
                h('div', { className: 'ml-panel' },
                  h('div', { className: 'ml-panel-hdr' },
                    h('p', { className: 'ml-panel-title' }, '🧪 契约跑分'),
                    h('span', { className: 'ml-panel-badge' },
                      suitesState.loading
                        ? '加载中'
                        : suitesState.error
                          ? '不可用'
                          : ((suitesState.data?.programs || []).length + ' 个程序 · ' + (suitesState.data?.totalCases || 0) + ' 例'))
                  ),
                  h('div', { className: 'ml-panel-body' }, h(SuitePanel, { data: suitesState.data }))
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
