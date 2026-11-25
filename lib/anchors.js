// Anchor parsing, shared by the tools and by LedgerManager.verify.
//
// Real ledgers do not store one clean `path::symbol` per entry. A single anchor
// routinely holds several paths separated by `；` or `;`, wraps each in
// backticks, prefixes them with CJK prose (`引擎 ...`, `包装仓 ...`), and
// sometimes carries prose instead of a path at all (`（无代码改动）...`).
//
// The three-state status is the important part. A two-repo project records
// anchors like `ai_core/factors/` in the wrapper repository, while `ai_core/`
// lives in the engine repository. Calling those "missing" would report a
// reverted fix on every single run, and a check that cries wolf is worse than
// no check at all. So `dead` is reserved for the case where the anchor's top
// directory does exist under this root and the file still does not.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Compare paths the way Windows and POSIX both write them. */
export function normalizePath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .trim()
}

/** Every file or directory path an anchor mentions, normalized and deduped. */
export function anchorPathsOf(anchor) {
  const raw = String(anchor ?? '')
  if (raw.length === 0) return []
  if (raw.includes('无代码改动')) return []

  const tokens = raw
    .replace(/\\/g, '/')
    .replace(/`/g, ' ')
    .split(/[；;，,、\n\r\t ]+/)

  const paths = []
  for (const token of tokens) {
    const withoutSymbol = token
      .split('::')[0]
      .replace(/[（）()。.:：]+$/g, '')
      .replace(/^[（(]+/, '')
    if (withoutSymbol.length === 0) continue
    const looksLikePath = /^[A-Za-z0-9_@.\-~]+(\/[A-Za-z0-9_@.\-~*]+)+\/?$/.test(withoutSymbol)
    const looksLikeFile = /^[A-Za-z0-9_@.\-~]+\.(py|ts|tsx|js|jsx|mjs|cjs|md|json|ya?ml|sh|ps1|bat|sql|go|rs|java|kt|c|h|cc|cpp|hpp|toml|ini|cfg|txt|env)$/i.test(withoutSymbol)
    if (!looksLikePath && !looksLikeFile) continue
    const normalized = normalizePath(withoutSymbol)
    if (normalized.length > 0 && !paths.includes(normalized)) paths.push(normalized)
  }
  return paths
}

/**
 * Whether an anchored path refers to the same file or subtree the caller named.
 *
 * Anchors mix absolute paths, repo-relative paths and directory-level anchors,
 * so a bare filename must match a nested file and a directory anchor must match
 * anything inside it — in both directions.
 */
export function samePath(anchorPath, target) {
  if (anchorPath.length === 0 || target.length === 0) return false
  if (anchorPath === target) return true
  if (anchorPath.endsWith('/' + target)) return true
  if (target.endsWith('/' + anchorPath)) return true
  if (anchorPath.startsWith(target + '/')) return true
  if (target.startsWith(anchorPath + '/')) return true
  return false
}

/**
 * The symbol half of an anchor written as `path/to/file.py::symbol`.
 *
 * Entries that anchor a whole file with no symbol return an empty string, and
 * two such entries on the same path do count as a repeat: without a symbol there
 * is nothing else to tell two repairs of the same code apart.
 */
export function symbolOf(anchor) {
  const raw = String(anchor ?? '')
  const at = raw.indexOf('::')
  if (at === -1) return ''
  return raw
    .slice(at + 2)
    .replace(/`/g, ' ')
    .split(/[；;，,、\n\r\t ]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ')
    .trim()
}

/**
 * The paths that are genuinely gone from this repository.
 *
 * An entry can name several paths, some here and some in a sibling repository.
 * Reporting the first one would blame a file that was never in this repo, so the
 * dead set is what the message must name.
 */
export function deadPathsOf(root, paths) {
  return paths.filter((path) => {
    const top = path.split('/')[0]
    if (top.length === 0 || path.includes('..')) return false
    return existsSync(join(root, top)) && !existsSync(join(root, path))
  })
}

/**
 * Classify an anchor against a repository root.
 *
 *   alive   — at least one named path exists here
 *   dead    — a named path's top directory exists here yet the path does not:
 *             the file was deleted or renamed, so the fix it recorded may be gone
 *   unknown — no named path and no top directory exists here: the anchor points
 *             into a different repository, so this root cannot judge it
 *   none    — the anchor names no usable path (prose-only anchors)
 */
export function anchorStatus(root, paths) {
  if (paths.length === 0) return 'none'
  if (paths.some((path) => existsSync(join(root, path)))) return 'alive'
  if (deadPathsOf(root, paths).length > 0) return 'dead'
  return 'unknown'
}

/**
 * Check whether a named symbol actually exists in a source file.
 *
 * Uses lightweight regex-based extraction (same patterns as scanner-map.js)
 * rather than a full AST parse — fast enough for per-entry checks while still
 * catching the most common case: "file exists but the function was deleted."
 *
 * Returns:
 *   'found'      — file exists and contains the named symbol definition
 *   'missing'    — file exists but the symbol was not found (likely renamed/deleted)
 *   'unchecked'  — file type not supported or symbol name is empty
 *   'no-file'    — the file itself does not exist
 */
export function symbolStatus(root, filePath, symbolName) {
  if (!symbolName || symbolName.trim().length === 0) return 'unchecked'
  const abs = join(root, filePath)
  if (!existsSync(abs)) return 'no-file'

  let content
  try {
    content = readFileSync(abs, 'utf-8')
  } catch {
    return 'unchecked'
  }

  // Limit file size to avoid blocking on huge files
  if (content.length > 500_000) return 'unchecked'

  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const name = symbolName.trim().split(/\s+/)[0] // take first word if multi-word

  // Build a set of patterns that would indicate the symbol is defined in this file
  const patterns = []

  // JavaScript / TypeScript
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'tsx'].includes(ext)) {
    patterns.push(
      new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|var|type|interface|enum)\\s+${escapeRegex(name)}\\b`),
      new RegExp(`\\b${escapeRegex(name)}\\s*[=:]\\s*(?:function|class|\\()`),
      new RegExp(`export\\s+default\\s+(?:async\\s+)?(?:function|class)\\s+${escapeRegex(name)}\\b`),
    )
  }
  // Python
  else if (ext === 'py') {
    patterns.push(
      new RegExp(`^\\s*(?:async\\s+)?(?:def|class)\\s+${escapeRegex(name)}\\b`, 'm'),
      new RegExp(`^${escapeRegex(name)}\\s*=`, 'm'),
    )
  }
  // Go
  else if (ext === 'go') {
    patterns.push(
      new RegExp(`\\bfunc\\s+(?:\\([^)]+\\)\\s+)?${escapeRegex(name)}\\s*\\(`),
      new RegExp(`\\btype\\s+${escapeRegex(name)}\\s+`),
    )
  }
  // Rust
  else if (ext === 'rs') {
    patterns.push(
      new RegExp(`\\b(?:pub\\s+)?(?:async\\s+)?(?:fn|struct|enum|trait)\\s+${escapeRegex(name)}\\b`),
    )
  }
  // Java / Kotlin
  else if (['java', 'kt'].includes(ext)) {
    patterns.push(
      new RegExp(`\\b(?:public|protected|private)?\\s*(?:static\\s+)?(?:final\\s+)?(?:class|interface|enum|record|fun)\\s+${escapeRegex(name)}\\b`),
    )
  }
  // C / C++
  else if (['c', 'h', 'cc', 'cpp', 'hpp'].includes(ext)) {
    patterns.push(
      new RegExp(`\\b${escapeRegex(name)}\\s*\\(`),
      new RegExp(`\\b(?:class|struct|enum)\\s+${escapeRegex(name)}\\b`),
    )
  }
  else {
    return 'unchecked'
  }

  for (const pattern of patterns) {
    if (pattern.test(content)) return 'found'
  }
  return 'missing'
}

/** Escape special regex characters in a symbol name. */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
