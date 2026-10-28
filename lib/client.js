;(function () {
  if (typeof window === 'undefined') return

  console.log('[MemLedger] 前端看板插槽正在注入...')

  let ledgerData = {
    hasLedger: false,
    totalCount: 0,
    pendingCount: 0,
    entries: [],
  }

  async function fetchStatus() {
    try {
      const res = await fetch('/api/memledger/status')
      if (res.ok) {
        const json = await res.json()
        ledgerData = { ...ledgerData, ...json }
        renderCapsule()
      }
    } catch (e) {
      // offline
    }
  }

  function renderCapsule() {
    let capsule = document.getElementById('dsh-memledger-capsule')
    if (!capsule) {
      const composerToolbar =
        document.querySelector('[data-dsh-composer-toolbar]') ||
        document.querySelector('.composer-toolbar') ||
        document.body

      capsule = document.createElement('div')
      capsule.id = 'dsh-memledger-capsule'
      capsule.style.display = 'inline-flex'
      capsule.style.alignItems = 'center'
      capsule.style.gap = '6px'
      capsule.style.padding = '2px 8px'
      capsule.style.borderRadius = '12px'
      capsule.style.fontSize = '12px'
      capsule.style.cursor = 'pointer'
      capsule.style.background = 'rgba(137, 180, 250, 0.15)'
      capsule.style.color = '#89b4fa'
      capsule.style.border = '1px solid rgba(137, 180, 250, 0.3)'
      capsule.style.transition = 'all 0.2s'

      capsule.onmouseover = () => {
        capsule.style.background = 'rgba(137, 180, 250, 0.25)'
      }
      capsule.onmouseout = () => {
        capsule.style.background = 'rgba(137, 180, 250, 0.15)'
      }
      capsule.onclick = openModal

      composerToolbar.appendChild(capsule)
    }

    const pendingText = ledgerData.pendingCount > 0 ? ` · ⚠️ 未决 ${ledgerData.pendingCount}` : ''
    capsule.innerHTML = `📖 记忆台账: ${ledgerData.totalCount}条${pendingText}`
  }

  async function openModal() {
    let modal = document.getElementById('dsh-memledger-modal')
    if (modal) {
      modal.remove()
    }

    modal = document.createElement('div')
    modal.id = 'dsh-memledger-modal'
    modal.style.position = 'fixed'
    modal.style.inset = '0'
    modal.style.zIndex = '99999'
    modal.style.background = 'rgba(0, 0, 0, 0.65)'
    modal.style.backdropFilter = 'blur(4px)'
    modal.style.display = 'flex'
    modal.style.justifyContent = 'center'
    modal.style.alignItems = 'center'

    const container = document.createElement('div')
    container.style.width = '800px'
    container.style.maxHeight = '85vh'
    container.style.background = '#1e1e2e'
    container.style.color = '#cdd6f4'
    container.style.borderRadius = '12px'
    container.style.boxShadow = '0 16px 40px rgba(0,0,0,0.5)'
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.overflow = 'hidden'
    container.style.border = '1px solid #313244'

    const header = document.createElement('div')
    header.style.padding = '16px 20px'
    header.style.borderBottom = '1px solid #313244'
    header.style.display = 'flex'
    header.style.justifyContent = 'space-between'
    header.style.alignItems = 'center'
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:20px;">📖</span>
        <span style="font-size:16px;font-weight:600;">MemLedger 记忆台账看板</span>
      </div>
      <button id="memledger-close" style="background:transparent;border:none;color:#a6adc8;font-size:18px;cursor:pointer;">✕</button>
    `

    const searchBar = document.createElement('div')
    searchBar.style.padding = '12px 20px'
    searchBar.style.background = '#181825'
    searchBar.style.display = 'flex'
    searchBar.style.gap = '10px'
    searchBar.innerHTML = `
      <input id="memledger-input" type="text" placeholder="输入关键词、错误特征、代码锚点..." style="flex:1;background:#313244;border:none;border-radius:6px;padding:8px 12px;color:#cdd6f4;outline:none;" />
      <button id="memledger-pending-filter" style="background:#45475a;border:none;border-radius:6px;padding:8px 12px;color:#f38ba8;cursor:pointer;">仅看未决</button>
    `

    const body = document.createElement('div')
    body.id = 'memledger-list'
    body.style.flex = '1'
    body.style.overflowY = 'auto'
    body.style.padding = '16px 20px'
    body.style.display = 'flex'
    body.style.flexDirection = 'column'
    body.style.gap = '12px'

    container.appendChild(header)
    container.appendChild(searchBar)
    container.appendChild(body)
    modal.appendChild(container)
    document.body.appendChild(modal)

    document.getElementById('memledger-close').onclick = () => modal.remove()
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove()
    }

    const input = document.getElementById('memledger-input')
    let onlyPending = false

    const renderList = async () => {
      const q = input.value.trim()
      const status = onlyPending ? 'pending' : ''
      try {
        const res = await fetch(`/api/memledger/entries?q=${encodeURIComponent(q)}&status=${status}`)
        const data = await res.json()
        const entries = data.entries || []

        if (entries.length === 0) {
          body.innerHTML = '<div style="text-align:center;color:#6c7086;padding:40px;">暂无相关台账记录</div>'
          return
        }

        body.innerHTML = entries
          .map((e) => {
            const isPending = ['未做', '搁置', '待验证', '已回退'].includes(e.status)
            const badgeColor = isPending ? '#f38ba8' : '#a6e3a1'
            return `
            <div style="background:#24273a;border:1px solid #363a4f;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-weight:600;color:#cdd6f4;">${e.id} · ${e.title}</div>
                <span style="font-size:11px;background:${badgeColor}22;color:${badgeColor};padding:2px 8px;border-radius:4px;border:1px solid ${badgeColor}44;">${e.status}</span>
              </div>
              <div style="font-size:12px;color:#89b4fa;font-family:monospace;">📍 ${e.anchor}</div>
              <div style="font-size:13px;color:#a6adc8;margin-top:2px;"><strong>为什么:</strong> ${e.why}</div>
              ${e.tradeoff && e.tradeoff !== '无' ? `<div style="font-size:12px;color:#f9e2af;"><strong>重启/取舍:</strong> ${e.tradeoff}</div>` : ''}
            </div>
          `
          })
          .join('')
      } catch (err) {
        body.innerHTML = '<div style="color:#f38ba8;">加载失败</div>'
      }
    }

    input.oninput = renderList
    const pendingBtn = document.getElementById('memledger-pending-filter')
    pendingBtn.onclick = () => {
      onlyPending = !onlyPending
      pendingBtn.style.background = onlyPending ? '#f38ba8' : '#45475a'
      pendingBtn.style.color = onlyPending ? '#1e1e2e' : '#f38ba8'
      renderList()
    }

    renderList()
  }

  fetchStatus()
  setInterval(fetchStatus, 30000)
})()
