// fact-claims.js — 环境事实的「可信度」判据。
//
// 为什么需要这个模块（2026-11-19 的真实事故）
// ----------------------------------------------
// 台账是 append-only 的**决策**记录，却会混进**会过期的环境事实**：
// 「外网机没有 SSH 凭据，需 ISay 手动部署」被写进台账，依据只是
// 「我用 admin@47.107.96.13 直连被拒」这一个**没试对方式**的探针；
// 而 11-17 的同三本台账里明明记着「ssh smart-daily → 外网机部署成功」。
//
// append-only + 「日期最新 = 正确」⇒ **错的结论靠「新」取胜**，
// 后来的会话读到它就继续不部署（实测至少十次）。
//
// 这个模块给出三件事：
//   1. 这条结论是不是在断言「某台机/某服务 现在做不到 X」（能力否定）；
//   2. 这条结论有没有一条**能重跑**的复核命令（在「验收」里）；
//   3. 它跟更早的**肯定式**记录是不是冲突（更新 ≠ 正确）。
//
// 判据刻意窄：只抓「会让人不做事」的那一类，避免把正常的代码缺陷描述
// （「回灌通道没有收敛」）也拖进来。

/** 主体词：这条事实是关于「谁 / 哪台机 / 哪个服务 / 哪份凭据」的。 */
const SUBJECT_RE = /(外网机|内网机|公网机|服务端|选股页|quant-api|smart-daily|omw-inner|凭据|密钥|SSH|ssh|服务名|systemd|端口|安全组)/g

/**
 * 同义主体归一：同一台机器在不同条目里常换名字
 * （「外网机」/「公网机」/「服务端」/「选股页」都是那台 47.107.96.13）。
 * 不归一就会漏掉最典型的冲突：**新条目用了一个别名，就跟旧条目「不相关」了**，
 * 于是「更新的否定结论靠新取胜」这种事故又从缝里漏过去。
 */
const SUBJECT_ALIASES = new Map([
  ['外网机', '外网机'], ['公网机', '外网机'], ['服务端', '外网机'], ['选股页', '外网机'],
  ['内网机', '内网机'],
  ['凭据', '凭据'], ['密钥', '凭据'], ['SSH', '凭据'], ['ssh', '凭据'],
  ['quant-api', 'quant-api'],
  ['smart-daily', 'smart-daily'], ['omw-inner', 'omw-inner'],
])

function canonicalSubject(word) {
  return SUBJECT_ALIASES.get(word) ?? word
}

/** 能力否定：断言「做不到 / 不能自己来 / 要人工」。 */
const CAP_NEG_RE = /(?:没有|无|没)(?:凭据|密钥|权限|SSH|ssh|入口|通道)\b|(?:没有|无|没).{0,8}数据|未上行|读不到|取不到|拉不到|拿不到|不能(?:自己|自动|直接)?(?:连|访问|登录|部署|重启|推送|上传|读写)|无法(?:连|访问|登录|部署|自动|上传)|连不上|登不上|登录不上|访问不了|只能(?:等|由|请)?\s*ISay|(?:需|须|要)(?:要)?\s*ISay\s*(?:手动|来|执行|拉取|pull|部署|重启)|(?:只能|只能由)\s*(?:人工|手动)|(?:只能|只能由)你/

/** 会劝退人做事的后遗症词。 */
const BLOCKING_RE = /(ISay|手动|人工|只能|不能|无法|连不上|没有凭据|无凭据)/

/** 能重跑的命令的形态。 */
const PROBE_RE = /(?:python3?\s+\S+\.py|ssh\s+\S+|curl\s+|systemctl\s+|git\s+\S+|psql\s+|SELECT\s|scp\s+|pytest\s+|node\s+)/

/** 连接手段：说明「怎么连」，但还得配主体词才指得到同一对象。 */
const CONNECT_RE = /(ssh\s+\S+|curl\s+|systemctl\s+)/

/** 肯定式：证明「其实可以」的记录。 */
const POSITIVE_RE = /(可用|成功|已部署|已连|跑通|已完成|已就位|active|通过|修好|已推)/

/** 这条文本的主体词集合（去重 + 同义归一）。 */
export function subjectsOf(text) {
  const out = new Set()
  for (const match of String(text ?? '').matchAll(SUBJECT_RE)) {
    out.add(canonicalSubject(match[0]))
  }
  return out
}

/** 同义主体也用来做「指向同一对象」的判断：命令里写哪个别名都算。 */
function subjectVariants(word) {
  const canonical = canonicalSubject(word)
  const variants = new Set([canonical])
  for (const [raw, canon] of SUBJECT_ALIASES) {
    if (canon === canonical) variants.add(raw)
  }
  return variants
}

/**
 * 这条条目是不是在断言「某台机/某服务 现在做不到 X」。
 * @param {object} entry 条目（title/background/change/why）
 * @returns {{claim:boolean, blocking:boolean, subjects:string[]}}
 */
export function capabilityClaim(entry) {
  const claim = [
    entry?.title,
    entry?.background,
    entry?.change,
  ].filter(Boolean).join('\n')
  const whole = [
    entry?.title,
    entry?.background,
    entry?.change,
    entry?.why,
    entry?.tradeoff,
  ].filter(Boolean).join('\n')
  return {
    claim: CAP_NEG_RE.test(claim),
    blocking: BLOCKING_RE.test(whole),
    subjects: [...subjectsOf(`${entry?.title ?? ''} ${entry?.anchor ?? ''}`)],
  }
}

/** 这段文本里有没有一条能重跑的命令。 */
export function hasProbe(text) {
  return PROBE_RE.test(String(text ?? ''))
}

/** 复核命令是否指向这条事实的同一主体（否则复跑它证明不了这条结论）。 */
export function probeMatchesSubject(entry, probeText) {
  const subjects = subjectsOf(`${entry?.title ?? ''} ${entry?.anchor ?? ''}`)
  if (subjects.size === 0) return true
  const text = String(probeText ?? '')
  const lower = text.toLowerCase()
  for (const s of subjects) {
    for (const variant of subjectVariants(s)) {
      if (text.includes(variant) || lower.includes(variant.toLowerCase())) return true
    }
  }
  // 命令里带了连接手段但没写主体词：只要它在 anchor 提到的路径上，也算指向同一对象
  if (CONNECT_RE.test(text)) {
    const anchor = String(entry?.anchor ?? '')
    const path = anchor.split('::')[0]
    if (path && text.includes(path)) return true
  }
  return false
}

/**
 * 更早的**肯定式**记录里，有没有同主体但结论相反的？
 * @returns {object|null} 冲突的旧条目
 */
export function findConflictingEarlier(entries, candidate) {
  const subjects = subjectsOf(`${candidate?.title ?? ''} ${candidate?.anchor ?? ''}`)
  const candidateText = [
    candidate?.title, candidate?.background, candidate?.change, candidate?.why,
  ].filter(Boolean).join('\n')
  if (!CAP_NEG_RE.test(candidateText)) return null
  const candidatePath = String(candidate?.anchor ?? '').split('::')[0]
  const earlier = (entries ?? [])
    .filter((e) => e && e.id !== candidate?.id)
    .filter((e) => String(e.date ?? '') <= String(candidate?.date ?? ''))
  for (const old of earlier) {
    const oldText = [old.title, old.background, old.change, old.why].filter(Boolean).join('\n')
    if (!POSITIVE_RE.test(oldText)) continue
    if (CAP_NEG_RE.test(old.title ?? '')) continue
    // 同一个锚点 = 强信号（两条讲的是同一处代码/同一件事）；
    // 否则看主体是否重叠（归一后「外网机」与「服务端」能对上）。
    const oldPath = String(old.anchor ?? '').split('::')[0]
    const sameAnchor = candidatePath && oldPath && candidatePath === oldPath
    const overlap = [...subjects].filter((s) => subjectsOf(`${old.title ?? ''} ${old.anchor ?? ''}`).has(s))
    if (sameAnchor || overlap.length > 0) return old
  }
  return null
}

/**
 * 校验一条待写入的条目：能力否定必须自带复核命令。
 * @returns {{ok:boolean, reason?:string, subjects?:string[], needsProbe?:boolean}}
 */
export function checkFactClaim(entry) {
  const { claim, blocking, subjects } = capabilityClaim(entry)
  const probeText = [entry?.probe, entry?.verify].filter(Boolean).join('\n')
  if (!claim || !blocking) return { ok: true }
  const probe = entry?.probe && String(entry.probe).trim().length > 0
    ? String(entry.probe)
    : (hasProbe(probeText) ? probeText : '')
  if (!probe) {
    return {
      ok: false,
      needsProbe: true,
      subjects,
      reason:
        '这是一条「否定式能力事实」（断言某台机/某个服务现在做不到 X），它会让后来的人「不做事」，' +
        '所以必须自带一条能重跑的复核命令：在「验收」里写一条能重跑、且指向同一对象的命令' +
        '（如 `ssh smart-daily "systemctl is-active quant-api"`）。' +
        '同时请在「为什么」里写清「我试的是什么」—— 没试对方式的探针不能当成系统事实。',
    }
  }
  if (!probeMatchesSubject(entry, probe)) {
    return {
      ok: false,
      needsProbe: true,
      subjects,
      reason:
        `复核命令没有指向这条事实的主体（${subjects.join('/')}），复跑它证明不了这条结论。` +
        '请让命令里出现同一个主体（机器别名 / 服务名 / 路径）。',
    }
  }
  return { ok: true, subjects }
}
