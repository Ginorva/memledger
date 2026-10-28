export type LedgerStatus =
  | '已落地'
  | '进行中'
  | '待验证'
  | '搁置'
  | '未做'
  | '已回退'
  | '已废弃'

export type LedgerType =
  | '修复'
  | '新功能'
  | '重构'
  | '口径'
  | '部署'
  | '决策'
  | '埋点'
  | '演练'
  | '文档'

export interface LedgerEntry {
  id: string              // 如 CL-20261028-01
  title: string           // 简明标题
  date: string            // 发生日期 YYYY-MM-DD
  type: LedgerType        // 变更类型
  status: LedgerStatus    // 变更状态
  repo: string            // 涉及仓库（如 包装仓、引擎仓、两仓）
  background: string      // 现状与问题背景
  change: string          // 具体修改内容
  why: string             // 为什么这么做 / 为什么不改
  tradeoff?: string       // 取舍代价 / 放弃的备选方案
  anchor: string          // 代码物理锚点（文件::符号 或 文件路径）
  commit?: string         // git commit hash
  verify?: string         // 验收验证命令或测试文件
  keywords: string[]      // 检索关键词
  lineNo?: number         // 在 markdown 中的行号
}

export interface SearchOptions {
  query: string
  status?: LedgerStatus | 'pending'  // pending 代表所有未决状态 (未做/搁置/待验证/已回退)
  anchor?: string
  brief?: boolean
  limit?: number
}

export interface VerifyResult {
  ok: boolean
  fails: string[]
  warns: string[]
  oks: string[]
}
