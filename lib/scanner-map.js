// scanner-map.js — lightweight AST & signature skeleton generator for Repo Map.
//
// Generates a compact, high-density codebase structural overview (< 2000 tokens)
// without requiring heavy external dependencies. It extracts exported functions,
// classes, type definitions, and signatures across JS/TS, Python, Go, and common files.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

export const MAP_RELATIVE = join('docs', '项目结构.md')

const IGNORED_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.nyc_output',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  'env',
  '.idea',
  '.vscode',
  '.turbo',
  '.next',
  '.nuxt',
  'temp',
  'tmp',
  '.cache',
  '.dsh',
])

const IGNORED_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.lock',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
])

const RECOGNIZE_EXTS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.tsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.sh',
  '.bash',
  '.ps1',
])

/**
 * Extract signatures and comments from a source file based on language.
 */
function extractSignatures(filePath, content) {
  const ext = extname(filePath).toLowerCase()
  const lines = content.split(/\r?\n/)
  const symbols = []

  // 1. JavaScript / TypeScript
  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.tsx'].includes(ext)) {
    const exportRegex = /^export\s+(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/
    const defaultExportRegex = /^export\s+default\s+(?:async\s+)?(?:function\*?|class)?\s*([A-Za-z0-9_$]+)?/

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (!line || line.startsWith('//') || line.startsWith('/*')) continue

      const expMatch = line.match(exportRegex)
      if (expMatch) {
        // Grab signature line (strip trailing block opener '{')
        const sig = line.replace(/\s*\{\s*$/, '').slice(0, 120)
        symbols.push({ line: i + 1, name: expMatch[1], sig })
        continue
      }

      const defMatch = line.match(defaultExportRegex)
      if (defMatch) {
        const sig = line.replace(/\s*\{\s*$/, '').slice(0, 120)
        symbols.push({ line: i + 1, name: defMatch[1] || 'default', sig })
      }
    }
    return symbols
  }

  // 2. Python
  if (ext === '.py') {
    const pyRegex = /^(?:async\s+)?(?:def|class)\s+([A-Za-z0-9_]+)\s*(\([^)]*\))?/
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const trimmed = line.trim()
      // Only extract top-level or single-indent methods
      const indent = line.search(/\S/)
      if (indent > 4) continue

      const match = trimmed.match(pyRegex)
      if (match) {
        const sig = trimmed.replace(/:\s*$/, '').slice(0, 120)
        // Check next line for docstring
        let doc = ''
        if (i + 1 < lines.length) {
          const nextTrimmed = lines[i + 1].trim()
          if (nextTrimmed.startsWith('"""') || nextTrimmed.startsWith("'''")) {
            doc = nextTrimmed.replace(/^["']{3}|["']{3}$/g, '').trim()
          }
        }
        symbols.push({ line: i + 1, name: match[1], sig, doc: doc || undefined })
      }
    }
    return symbols
  }

  // 3. Go
  if (ext === '.go') {
    const goRegex = /^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(/
    const typeRegex = /^type\s+([A-Za-z0-9_]+)\s+(struct|interface)/
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim()
      const fnMatch = line.match(goRegex)
      if (fnMatch) {
        const sig = line.replace(/\s*\{\s*$/, '').slice(0, 120)
        symbols.push({ line: i + 1, name: fnMatch[1], sig })
        continue
      }
      const tMatch = line.match(typeRegex)
      if (tMatch) {
        symbols.push({ line: i + 1, name: tMatch[1], sig: line.replace(/\s*\{\s*$/, '') })
      }
    }
    return symbols
  }

  // 4. Rust
  if (ext === '.rs') {
    const rsRegex = /^pub\s+(?:async\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z0-9_]+)/
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim()
      const match = line.match(rsRegex)
      if (match) {
        symbols.push({ line: i + 1, name: match[1], sig: line.replace(/\s*\{\s*$/, '').slice(0, 120) })
      }
    }
    return symbols
  }

  // 5. Java
  if (ext === '.java') {
    const javaClassRegex = /^(?:public|protected)\s+(?:abstract\s+)?(?:final\s+)?(?:class|interface|enum|record)\s+([A-Za-z0-9_]+)/
    const javaMethodRegex = /^(?:public|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:abstract\s+)?(?:<[^>]+>\s+)?(\S+)\s+([A-Za-z0-9_]+)\s*\(/
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue

      const clsMatch = line.match(javaClassRegex)
      if (clsMatch) {
        symbols.push({ line: i + 1, name: clsMatch[1], sig: line.replace(/\s*\{\s*$/, '').slice(0, 120) })
        continue
      }
      const mtdMatch = line.match(javaMethodRegex)
      if (mtdMatch) {
        // Grab the full signature until the closing paren or opening brace
        let fullSig = line
        if (!fullSig.includes(')') && i + 1 < lines.length) {
          fullSig += ' ' + lines[i + 1].trim()
        }
        symbols.push({
          line: i + 1,
          name: mtdMatch[2],
          sig: fullSig.replace(/\s*\{\s*$/, '').slice(0, 120),
        })
      }
    }
    return symbols
  }

  // 6. C / C++ / Headers
  if (['.c', '.cpp', '.cc', '.h', '.hpp'].includes(ext)) {
    // Match top-level function definitions and class/struct declarations
    const cFuncRegex = /^(?:(?:static|extern|inline|virtual|explicit|constexpr|const)\s+)*(?:unsigned\s+)?([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*(?:\s*[*&])?)\s+([A-Za-z_]\w*)\s*\(/
    const cClassRegex = /^(?:template\s*<[^>]*>\s*)?(?:class|struct|enum(?:\s+class)?|namespace)\s+([A-Za-z_]\w*)/
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('#')) continue

      // Only extract top-level (indent ≤ 0)
      const indent = lines[i].search(/\S/)
      if (indent > 2) continue

      const clsMatch = line.match(cClassRegex)
      if (clsMatch) {
        symbols.push({ line: i + 1, name: clsMatch[1], sig: line.replace(/\s*[{;]\s*$/, '').slice(0, 120) })
        continue
      }
      const fnMatch = line.match(cFuncRegex)
      if (fnMatch && fnMatch[2] !== 'if' && fnMatch[2] !== 'for' && fnMatch[2] !== 'while' && fnMatch[2] !== 'switch' && fnMatch[2] !== 'return') {
        let fullSig = line
        if (!fullSig.includes(')') && i + 1 < lines.length) {
          fullSig += ' ' + lines[i + 1].trim()
        }
        symbols.push({
          line: i + 1,
          name: fnMatch[2],
          sig: fullSig.replace(/\s*\{\s*$/, '').slice(0, 120),
        })
      }
    }
    return symbols
  }

  return symbols
}

/**
 * Scan workspace recursively and gather files and skeletons.
 */
export function scanCodebaseMap(root, options = {}) {
  const maxDepth = options.maxDepth ?? 5
  const maxFiles = options.maxFiles ?? 200
  const scannedFiles = []
  let totalSymbols = 0

  function walk(currentDir, currentDepth) {
    if (currentDepth > maxDepth || scannedFiles.length >= maxFiles) return

    let entries
    try {
      entries = readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    // Sort: directories first, then files alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      const relPath = relative(root, fullPath).replace(/\\/g, '/')

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(fullPath, currentDepth + 1)
        }
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(entry.name)) continue
        const ext = extname(entry.name).toLowerCase()
        if (!RECOGNIZE_EXTS.has(ext) && !['Dockerfile', 'Makefile'].includes(entry.name)) continue

        let size = 0
        try {
          size = statSync(fullPath).size
        } catch {
          // ignore stat failure
        }

        // Skip massive files (> 500KB)
        if (size > 500 * 1024) continue

        let content = ''
        try {
          content = readFileSync(fullPath, 'utf-8')
        } catch {
          continue
        }

        const symbols = extractSignatures(fullPath, content)
        totalSymbols += symbols.length

        scannedFiles.push({
          path: relPath,
          size,
          lineCount: content.split('\n').length,
          symbols,
        })
      }
    }
  }

  walk(root, 0)

  return {
    root,
    fileCount: scannedFiles.length,
    symbolCount: totalSymbols,
    files: scannedFiles,
  }
}

/**
 * Render codebase map to Markdown.
 */
export function renderCodebaseMapMarkdown(mapData) {
  const { root, fileCount, symbolCount, files } = mapData
  const now = new Date().toISOString().slice(0, 10)

  const header = [
    `# 项目结构与代码骨架地图`,
    ``,
    `> 更新日期: ${now} | 模块文件: ${fileCount} 个 | 核心符号/函数: ${symbolCount} 个`,
    `> **AI 指南**: 编码前阅读本拓扑图定位核心文件与导出签名，严禁漫无目的全盘扫描代码库。`,
    ``,
    `---`,
    ``,
    `## 📂 核心目录与符号骨架`,
    ``,
  ]

  const lines = [...header]

  for (const f of files) {
    if (f.symbols.length > 0) {
      lines.push(`### \`${f.path}\` (${f.lineCount} 行)`)
      for (const s of f.symbols.slice(0, 15)) {
        const docSuffix = s.doc ? ` — *${s.doc}*` : ''
        lines.push(`- \`${s.sig}\`${docSuffix}`)
      }
      if (f.symbols.length > 15) {
        lines.push(`- *... 还有 ${f.symbols.length - 15} 个符号*`)
      }
      lines.push(``)
    } else if (['package.json', 'pyproject.toml', 'README.md', 'Dockerfile'].includes(basename(f.path))) {
      lines.push(`- **\`${f.path}\`**: 关键入口/配置 (${f.lineCount} 行)`)
    }
  }

  return lines.join('\n')
}

/**
 * Generate or refresh docs/项目结构.md in the target root.
 */
export function updateProjectMapFile(root, options = {}) {
  const mapData = scanCodebaseMap(root, options)
  const markdown = renderCodebaseMapMarkdown(mapData)
  const destPath = join(root, MAP_RELATIVE)

  try {
    const parent = dirname(destPath)
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true })
    }
    writeFileSync(destPath, markdown, 'utf-8')
    return {
      ok: true,
      path: destPath,
      fileCount: mapData.fileCount,
      symbolCount: mapData.symbolCount,
      markdown,
    }
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
      fileCount: mapData.fileCount,
      symbolCount: mapData.symbolCount,
    }
  }
}
