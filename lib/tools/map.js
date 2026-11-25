// dsh-memledger — ledger_map tool.
//
// Generates/refreshes the codebase skeleton map (docs/项目结构.md).

import { createHash } from 'node:crypto'
import { normalizePath, samePath } from '../anchors.js'
import { updateProjectMapFile } from '../scanner-map.js'
import { statsRegistry } from '../stats.js'
import { CFG, outlineOfMarkdown } from '../scoring.js'
import { readRoot } from '../workspace-resolver.js'

export function mapTool() {
  // v3: Content-hash cache using MD5 for reliable change detection
  // v4: Per-root hash map so multi-workspace scenarios hit cache correctly
  const mapHashByRoot = new Map()

  return {
    name: 'ledger_map',
    description:
      '生成/刷新代码骨架地图（docs/项目结构.md）。默认只回文件清单，用 scope 取某个文件或目录的符号签名。改代码前用它定位，不要全盘扫。',
    parameters: {
      type: 'object',
      properties: {
        root: {
          type: 'string',
          description: '仓库根目录；省略则从 cwd 向上找。',
        },
        refresh: {
          type: 'boolean',
          description: '是否写入 docs/项目结构.md（默认 true）。',
        },
        scope: {
          type: 'string',
          description: '只看某个文件/目录的骨架；省略给全量。',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          root: { type: 'string' },
          mapPath: { type: 'string' },
          fileCount: { type: 'number' },
          symbolCount: { type: 'number' },
          cached: { type: 'boolean' },
          budgeted: { type: 'boolean' },
          summary: { type: 'string' },
          result: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['ok', 'message'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const root = readRoot(args, exec)
      const stats = statsRegistry.get(root)
      stats.recordCall('ledger_map')
      const scope = typeof args?.scope === 'string' && args.scope.length > 0 ? normalizePath(args.scope) : null
      const result = updateProjectMapFile(root, {})

      if (!result.ok) {
        stats.recordMapResult(false)
        return {
          ok: false,
          root,
          fileCount: result.fileCount,
          symbolCount: result.symbolCount,
          message: `❌ 生成代码骨架地图失败: ${result.error}`,
        }
      }

      const mapPath = result.path
      const fullMarkdown = result.markdown

      // v4: Per-root content hash for reliable change detection across workspaces
      const contentHash = createHash('md5').update(fullMarkdown).digest('hex')
      if (!scope && contentHash === mapHashByRoot.get(root)) {
        stats.recordMapResult(true)
        return {
          ok: true,
          root,
          mapPath,
          fileCount: result.fileCount,
          symbolCount: result.symbolCount,
          cached: true,
          summary: `${result.fileCount} 模块, ${result.symbolCount} 符号`,
          result: stats.toCompactSummary(),
          message: `🗺️ 项目结构未变化（${result.fileCount} 模块, ${result.symbolCount} 符号）。无需重复查看。`,
        }
      }
      mapHashByRoot.set(root, contentHash)
      stats.recordMapResult(false)

      // v2: If scope is specified, filter to only relevant files
      let outputMarkdown = fullMarkdown
      if (scope) {
        const lines = fullMarkdown.split('\n')
        const filtered = []
        let inRelevantSection = false
        let headerCount = 0
        for (const line of lines) {
          // Keep the document header
          if (headerCount < 8) { filtered.push(line); headerCount++; continue }

          if (line.startsWith('### `')) {
            const pathMatch = line.match(/^### `([^`]+)`/)
            if (pathMatch) {
              const filePath = normalizePath(pathMatch[1])
              inRelevantSection = samePath(filePath, scope) ||
                filePath.startsWith(scope + '/') || scope.startsWith(filePath + '/')
            } else {
              inRelevantSection = false
            }
          }
          if (line.startsWith('- **`') && line.includes('`**:')) {
            const pathMatch = line.match(/`([^`]+)`/)
            if (pathMatch) {
              const filePath = normalizePath(pathMatch[1])
              inRelevantSection = samePath(filePath, scope)
            }
          }

          if (inRelevantSection) filtered.push(line)
        }
        outputMarkdown = filtered.length > headerCount
          ? filtered.join('\n')
          : `（scope="${scope}" 未匹配到骨架条目，可能不是代码文件）`
      }

      const summary = `${result.fileCount} 模块, ${result.symbolCount} 符号`
      const headline = scope
        ? `🗺️ **[局部骨架]** scope=\`${scope}\` | ${summary}`
        : `🗺️ **[项目骨架地图]** ${summary} | \`${mapPath}\``

      // Budget: the full map is on disk either way; the message is the part
      // that eats context. Over budget, send the file-level outline instead and
      // point at `scope=` for signatures.
      let message = headline + '\n\n' + outputMarkdown
      let budgeted = false
      if (!scope && outputMarkdown.length > CFG.mapMaxChars) {
        budgeted = true
        message =
          `${headline}\n\n${outlineOfMarkdown(outputMarkdown, CFG.mapMaxChars - 500)}` +
          `\n\n> 📦 完整骨架 ${outputMarkdown.length} 字符已折叠为文件清单（${result.fileCount} 个文件 / ${result.symbolCount} 个符号）。` +
          `用 \`scope=<目录或文件>\` 取局部符号，或直接读 \`${mapPath}\`。`
      }

      return {
        ok: true,
        root,
        mapPath,
        fileCount: result.fileCount,
        symbolCount: result.symbolCount,
        cached: false,
        budgeted,
        summary,
        result: stats.toCompactSummary(),
        message,
      }
    },
  }
}
