// ledger-sources.js — 一个工作区可以配置**额外的台账文件**。
//
// 为什么需要它（2026-11-18）
// -------------------------
// 插件原本假定「一个工作区 = 一本台账」（`docs/变更台账.md`）。但有些工作区横跨多个
// git 仓，各仓各有一本自己的台账：包装仓 `agent/docs/变更台账.md`、引擎仓
// `core/docs/变更台账.md`。而内置检索只索引主台账 —— **另外两本共 300+ 条历史决策
// 检索不到**（盲区约 75%），agent 会因此重做已经做过的事。
//
// 设计原则：**默认行为零变化**
// ----------------------
// 没有配置文件时，行为与之前完全一致（一本台账）。只有工作区显式写下
// `.dsh/memledger.json` 才会启用多台账：
//
//   {
//     "ledgers": [
//       { "path": "agent/docs/变更台账.md", "label": "工程" },
//       { "path": "core/docs/变更台账.md",  "label": "引擎" }
//     ]
//   }
//
// 写入永远只写主台账（`docs/变更台账.md`）—— 额外台账属于别的仓，本插件不代管它们的
// 写入与索引重建。
import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute, sep } from 'node:path';

export const LEDGER_CONFIG_RELATIVE = join('.dsh', 'memledger.json');

/**
 * 读取工作区配置的额外台账来源。配置缺失或坏了都返回空数组 ——
 * 一个可选功能不该让插件整体失效。
 */
export function extraLedgerSources(root) {
  const cfgPath = join(root, LEDGER_CONFIG_RELATIVE);
  if (!existsSync(cfgPath)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  } catch {
    return [];
  }
  const list = Array.isArray(raw?.ledgers) ? raw.ledgers : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item.path !== 'string' || item.path.length === 0) continue;
    const abs = isAbsolute(item.path)
      ? item.path
      : join(root, item.path.replace(/[\\/]/g, sep));
    if (!existsSync(abs)) continue;      // 配了但文件不在 → 当作没配，不报错
    out.push({
      path: abs,
      rel: item.path,
      label: typeof item.label === 'string' && item.label.length > 0 ? item.label : item.path,
    });
  }
  return out;
}
