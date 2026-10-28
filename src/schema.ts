import { LedgerEntry, LedgerStatus, LedgerType } from './types.js'

export const REQUIRED_FIELDS = [
  '日期',
  '类型',
  '状态',
  '仓',
  '背景',
  '改动',
  '为什么',
  '取舍',
  '锚点',
  'commit',
  '验收',
  '关键词',
] as const

export const VALID_STATUSES: Set<LedgerStatus> = new Set([
  '已落地',
  '进行中',
  '待验证',
  '搁置',
  '未做',
  '已回退',
  '已废弃',
])

export const VALID_TYPES: Set<LedgerType> = new Set([
  '修复',
  '新功能',
  '重构',
  '口径',
  '部署',
  '决策',
  '埋点',
  '演练',
  '文档',
])

// 必须写清“为什么”的状态（这是防倒车和防止重复讨论的唯一凭据）
export const NEEDS_WHY_STATUSES: Set<LedgerStatus> = new Set([
  '搁置',
  '未做',
  '已回退',
  '已废弃',
  '待验证',
])

// 检索优先级：未决决策排在最前面，因为主问题往往是“为什么没做、什么被改没”
export const STATUS_PRIORITY: Record<LedgerStatus, number> = {
  未做: 0,
  搁置: 1,
  待验证: 2,
  已回退: 3,
  已废弃: 4,
  进行中: 5,
  已落地: 6,
}

export const PENDING_STATUSES: Set<LedgerStatus> = new Set([
  '未做',
  '搁置',
  '待验证',
  '已回退',
  '已废弃',
  '进行中',
])

export function validateEntry(entry: Partial<LedgerEntry>): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!entry.id) errors.push('缺少 entry_id')
  if (!entry.title) errors.push('缺少 title')
  if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) errors.push('日期格式错误 (需 YYYY-MM-DD)')
  if (!entry.type || !VALID_TYPES.has(entry.type)) errors.push(`非法类型: ${entry.type}`)
  if (!entry.status || !VALID_STATUSES.has(entry.status)) errors.push(`非法状态: ${entry.status}`)
  if (entry.status && NEEDS_WHY_STATUSES.has(entry.status) && (!entry.why || entry.why.trim().length < 5)) {
    errors.push(`状态为「${entry.status}」的条目必须详细说明「为什么」与重启条件`)
  }
  if (!entry.anchor) errors.push('必须声明代码锚点 (anchor)')

  return {
    valid: errors.length === 0,
    errors,
  }
}
