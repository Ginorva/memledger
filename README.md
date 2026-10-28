# MemLedger (`dsh-memledger`)

**基于 Mem0 记忆网络的 DeepSeek Harness 智能变更台账与决策守卫。**

> 解决长线项目中 AI 最致命的“反复横跳、改回历史、健忘重修”问题：改动自动归档、决策因果沉淀、杜绝代码倒车。

---

## 🌟 核心特性

1. **Mem0 驱动的动态认知记忆**：
   - 区别于传统死板的纯文本或 SQL 关系表，采用 Mem0 的自适应实体、决策与因果抽取；
   - 自动合并与冲突消解：新决策推翻旧决策时，自动更新记忆图谱，解决台账堆积膨胀。
2. **代码锚点（Code Anchor）物理拦截**：
   - 记忆挂钩具体的代码文件与符号（如 `core/exec_caliber.py::gate_filter`）；
   - 在 AI 意图修改历史敏感代码前，自动唤醒前置记忆并告警拦截。
3. **人类与 Agent 双轨视图（Dual-View）**：
   - **人类视图**：自动同步导出 `docs/变更台账.md`，兼容标准的 12 项固定字段，Git 审阅一目了然；
   - **Agent 视图**：内置原生工具 `ledger_search`、`ledger_add`、`ledger_verify`，毫秒级意图检索。
4. **两轨冷启动（新老项目无缝适配）**：
   - **轨 A（已有台账）**：一键清洗导入历史文档；
   - **轨 B（零文档老项目）**：全自动扫描 Git 提交历史（`git log --grep="fix"`）逆向生成初始台账。
5. **DSH 原生看板**：
   - 在会话视图切换器里多出一个 **「台账」** 页签（`conversation.view` 插槽），带关键词检索与「仅看未决」过滤；
   - 未决事项（未做/搁置/待验证/已回退）红标，已落地绿标，代码锚点高亮可直接定位。

---

## 📐 12 项台账标准字段

| 字段 | 说明 | 示例 |
|---|---|---|
| **日期** | 改动实际发生日期 | `2026-10-28` |
| **类型** | 修复 / 新功能 / 重构 / 口径 / 部署 / 决策 / 埋点 / 演练 / 文档 | `修复` |
| **状态** | 已落地 / 进行中 / 待验证 / 搁置 / 未做 / 已回退 / 已废弃 | `搁置` |
| **仓** | 涉及仓库 | `包装仓` / `引擎仓` |
| **背景** | 为什么出现这个问题，现状是什么 | `闸门事后裁决，T+1 才写，选股池被消费` |
| **改动** | 具体改了什么 | `拟把闸门前移到选股写入前` |
| **为什么** | 为什么这么改 / 为什么不改（核心决策依据） | `现状是下游过滤，先看一周数据再定` |
| **取舍** | 代价 / 放弃了什么备选方案 | `前移会改引擎写入路径，风险高` |
| **锚点** | 代码物理位置（`文件::符号`） | `core/exec_caliber.py::gate_no_trade_pick_filter` |
| **commit**| Git 提交 Hash | `db553a9` |
| **验收** | 验证命令 / 测试用例 | `python scripts/verify_gate_pick_consistency.py` |
| **关键词**| 检索标签 | `闸门,选股,一致性,no_trade` |

---

## 🔌 集成契约（改代码前先看这节）

这个插件由**两半**组成，两半都必须按下面的形状写，任何一半形状不对都会让宿主加载失败。

### 宿主半 `lib/index.js`

```js
export const name = 'dsh-memledger'
export const inject = ['webServer']          // 服务名，不是包名
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), 'label')
}
```

对外提供两个**只读**路由：

| 路由 | 说明 |
|---|---|
| `GET /api/memledger/status` | 条目总数、未决数、台账路径、是否存在 |
| `GET /api/memledger/entries?q=&status=&root=` | 解析后的台账条目；`status=pending` 只看未决 |

`root` 参数是**权威**的：显式指定就只用它，不会串到别的工作区。不传时依次回退到 `MEMLEDGER_ROOT` 环境变量、宿主 cwd、向上 6 层目录。

### 客户端半 `lib/client.js`

```js
window.__ModuleLoader__.load({
  id: 'dsh-memledger',
  factory: (require) => {
    const React = require('react')
    return {
      inject: ['slots'],                     // 服务名，不是包名
      apply(ctx) {
        const slots = ctx.get('slots')       // 不是 ctx.slots
        slots.inject('conversation.view', () =>
          slots.register({ name: 'conversation.view', id: 'memledger', order: 120, label: () => '台账' }, View))
      },
    }
  },
})
```

> ⚠️ 两个最常见的坑：`inject` 写的是**服务名**（`slots` / `webServer`），不是 `@deepseek-ai/...` 包名；取服务必须用 `ctx.get('slots')`，写成 `ctx.slots` 会拿到 `undefined` 然后**静默不渲染**——不报错，但界面上什么都不会出现。

### `cordis.patch.yml`

```yaml
- insert:
    - id: dsh-memledger
      name: dsh-memledger
```

> ⚠️ `id` 必须等于 `lib/index.js` 导出的 `name`，`name` 才是包名（`dsh-context`、`dsh-unlag` 都是这个写法；`dshmarket` 的 `id: dsh-market` 与导出名一致、`name: dshmarket` 才是包名）。对不齐就会出现"启用后变成空指向条目"的故障。
>
> ⚠️ 这段必须有。它负责把 `dsh-memledger` 真正插进加载器树；缺了它，插件管理器"启用"时写入的 `- id: dsh-memledger` 就会变成**空指向条目**，**DSH 下次启动直接崩溃**。
>
> ⚠️ 不要在 profile 自己的 `cordis.patch.yml` 里手写这个条目——它由 bundle 提供。两边都写会变成重复挂载。

---

## 🛠️ 安装与使用

发布到 npm 后，在 DSH 插件市场搜索 `dsh-memledger` 安装，或：

```bash
dsh plugin --profile <profile> add dsh-memledger
```

**验证（不碰 profile，纯本地）**：

```bash
npm test
```

会跑两组冒烟测试：宿主端的模块形状 + 两个路由的真实请求响应，客户端端的 `__ModuleLoader__` 契约 + 插槽注册。全部 44 项断言必须绿。

---

## ⚠️ 当前边界

- 看板是**只读**的：能检索、能过滤，暂不提供从界面写入条目的路由。
- 条目的写入目前走 Agent 工具（`ledger_add`）或直接编辑 `docs/变更台账.md`。
- `memory/` 与 Mem0 图谱侧仍是本地启发式实现，未接外部向量库。

