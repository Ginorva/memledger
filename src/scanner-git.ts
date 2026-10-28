import { execSync } from 'node:child_process'
import { LedgerEntry, LedgerType, LedgerStatus } from './types.js'

export interface GitCommitRecord {
  hash: string
  date: string
  subject: string
  body: string
  files: string[]
}

export function scanGitHistory(repoDir: string, maxCommits: number = 50): GitCommitRecord[] {
  try {
    // 提取带修复/回退/重要特性的提交
    const cmd = `git -C "${repoDir}" log -n ${maxCommits} --grep="fix\\|bug\\|revert\\|hotfix\\|口径\\|闸门" --format="COMMIT_START%n%H%n%as%n%s%n%b%nFILES_START" --name-only`
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })

    const blocks = output.split('COMMIT_START\n').filter((b) => b.trim().length > 0)
    const records: GitCommitRecord[] = []

    for (const block of blocks) {
      const [metaPart, filesPart] = block.split('FILES_START\n')
      const lines = metaPart.trim().split('\n')
      if (lines.length < 3) continue

      const hash = lines[0].trim().slice(0, 8)
      const date = lines[1].trim()
      const subject = lines[2].trim()
      const body = lines.slice(3).join('\n').trim()

      const files = (filesPart || '')
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && !f.startsWith('docs/'))

      records.push({
        hash,
        date,
        subject,
        body,
        files,
      })
    }

    return records
  } catch (err) {
    return []
  }
}

/**
 * 将 Git 提交记录转换为第一版冷启动台账条目
 */
export function convertGitCommitsToLedger(
  commits: GitCommitRecord[],
  repoName: string = '本仓',
): LedgerEntry[] {
  return commits.map((c, idx) => {
    const dayStr = c.date.replace(/-/g, '')
    const id = `CL-${dayStr}-${String(idx + 1).padStart(2, '0')}`

    const isRevert = /revert|回退/i.test(c.subject)
    const status: LedgerStatus = isRevert ? '已回退' : '已落地'
    const type: LedgerType = isRevert ? '重构' : '修复'

    const anchor = c.files.length > 0 ? c.files[0] : '工程根目录'

    return {
      id,
      title: c.subject,
      date: c.date,
      type,
      status,
      repo: repoName,
      background: `从 Git 历史自动逆向导入。提交信息: ${c.subject}`,
      change: c.body || c.subject,
      why: isRevert ? '历史回退提交，需查明回退动因' : '历史安全/逻辑修复',
      tradeoff: '自动逆向生成，待人工或会话增补',
      anchor,
      commit: c.hash,
      verify: 'git diff',
      keywords: [type, ...c.files.slice(0, 2)],
    }
  })
}
