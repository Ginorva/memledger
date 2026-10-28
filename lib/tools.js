import { LedgerManager } from './ledger-manager.js';
import { scanGitHistory, convertGitCommitsToLedger } from './scanner-git.js';
import { importExistingDocs } from './scanner-docs.js';
export function createLedgerTools(workspaceRoot) {
    const manager = new LedgerManager(workspaceRoot);
    return {
        ledger_search: async (args) => {
            const results = manager.search({
                query: args.query || '',
                status: args.status,
                anchor: args.anchor,
                limit: args.limit || 10,
            });
            if (results.length === 0) {
                return {
                    found: false,
                    message: '未检索到匹配的台账记录（说明可能是新场景，注意做完必须入册）。',
                    entries: [],
                };
            }
            return {
                found: true,
                count: results.length,
                entries: results.map((e) => ({
                    id: e.id,
                    title: e.title,
                    status: e.status,
                    why: e.why,
                    whyNot: e.tradeoff,
                    anchor: e.anchor,
                    date: e.date,
                })),
            };
        },
        ledger_add: async (args) => {
            const today = new Date().toISOString().slice(0, 10);
            const dayStr = today.replace(/-/g, '');
            const id = `CL-${dayStr}-${Math.floor(Math.random() * 90 + 10)}`;
            const entry = {
                id,
                title: args.title,
                date: today,
                type: args.type,
                status: args.status,
                repo: args.repo || '本仓',
                background: args.background || args.title,
                change: args.change || args.title,
                why: args.why,
                tradeoff: args.tradeoff || '无',
                anchor: args.anchor,
                commit: args.commit || 'HEAD',
                verify: args.verify || '自动验证',
                keywords: args.keywords || [args.type],
            };
            const res = manager.add(entry);
            return {
                success: res.success,
                error: res.error,
                entryId: id,
                message: res.success ? `✅ 成功入册台账条目 ${id}` : `❌ 入册失败: ${res.error}`,
            };
        },
        ledger_verify: async () => {
            const res = manager.verify();
            return {
                ok: res.ok,
                failedCount: res.fails.length,
                fails: res.fails,
                summary: res.ok ? '✅ 全部已落地锚点文件存活，未发现倒车。' : `⚠️ 发现 ${res.fails.length} 处锚点异常！`,
            };
        },
        ledger_bootstrap: async (args) => {
            let entries = [];
            if (args.source === 'doc' && args.docPath) {
                entries = importExistingDocs(args.docPath);
            }
            else {
                const commits = scanGitHistory(workspaceRoot, args.maxCommits || 30);
                entries = convertGitCommitsToLedger(commits);
            }
            manager.initWorkspace(entries);
            return {
                success: true,
                count: entries.length,
                ledgerPath: manager.getLedgerPath(),
                message: `✅ 已成功从 ${args.source || 'git'} 初始化台账，共生成 ${entries.length} 条基线记录！`,
            };
        },
    };
}
