# MemLedger (`dsh-memledger`)

**[中文](README.md)** | **[English](README.en.md)**

> **A spatial map for code, a temporal ledger for decisions.**  
> An engineering-governance and intelligent-memory plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai): pre-change dedup and rollback warnings, post-change decision logging, eliminating the costliest pain points of AI programming — **drifting off-target, blind full-project scans, duplicate work, and silently reverting already-fixed code**.

---

## 🎯 Why MemLedger?

In long-running projects, the most expensive cost of AI coding is not "can't write code" but:

1. **Spatial disorientation**: The agent aimlessly scans the entire project (`glob`/`grep` storms), attention diluted by irrelevant code, finding the wrong entry point, building the wrong thing;
2. **Temporal amnesia**: AI lacks cross-session negative memory. A solution proven to cause deadlocks and abandoned three months ago? A fresh session cheerfully rewrites it, reverting stable fixes back into the same old pit.

MemLedger follows the **"spatial map + temporal ledger"** dual-loop principle:

* **Spatial Map (Repo Map)**: Distills an entire project's code into a high-density skeleton of under 2000 tokens — the agent grasps the full architecture without reading source files;
* **Temporal Ledger (Change Ledger)**: Indexed by physical code anchors (`file::symbol`), mandatorily records *why* a change was made and *why* a proposal was rejected, with real-time rollback and duplicate-fix interception.

---

## 🖼️ GUI: Session-Level Dashboard

The plugin registers a native view in the DSH client (Desktop & Web) session tab bar, alongside **Chat**, **Trace**, and **Versions**:

```
┌──────┬──────┬──────┬──────────────────────────┐
│ Chat │ Trace│ Ver. │ Ledger & Map (MemLedger)  │
└──────┴──────┴──────┴──────────────────────────┘
```

Click **[Ledger & Map]** to open a three-tab cockpit:

* **📊 Effectiveness**: Real-time dashboard of tool calls, decision density, risk interceptions;
* **🗺 Skeleton & Ledger**: Left pane shows file topology (files / line counts / export signatures), right pane shows decision cards (search, filter unsettled);
* **🧪 Contract Scores**: Program cards — latest score, trend, case pass rate, landed-but-uncovered debt;
* **High resilience**: Optional routes + frontend sandbox isolation, graceful fallback on network errors — **zero risk of blank screens**.

---

## 🤖 Eight Core Agent Tools

| Tool | When | What it does |
|---|---|---|
| **`ledger_map`** | Before exploring / editing code | Get or refresh the codebase skeleton map — export symbols & API signatures without blind scanning |
| **`ledger_check`** | Right before modifying code | Has this file/symbol been changed before? Why? Is the fix still alive? Shows contract score when covered |
| **`ledger_requirement`** | When a request is made | Normalize user requests into `docs/requirements/RQ-YYYYMMDD-NN.md` with verbatim quotes, scope, acceptance criteria |
| **`ledger_add`** | After landing a feature / abandoning a plan | Persist decision rationale (13 fields), especially record abandoned approaches as negative memory |
| **`ledger_suite`** | After code changes / before closing | Contract suite: register executable test cases, score, run by anchor; score history, assertion drift detection |
| **`ledger_search`** | When questions arise | Search by keyword, error signature, or code anchor — unsettled/rejected entries surface first |
| **`ledger_verify`** | Before delivery | Check whether landed anchors still exist; report orphaned requirements, suite drift, dead case anchors, zero-case debt |
| **`ledger_bootstrap`** | First-time project onboarding | Auto-generate an initial ledger from Git commit history or existing docs |

### Smart Verdict Matrix (`ledger_check`)

| Verdict | Severity | Meaning | Recommended Action |
|---|---|---|---|
| `rollback-risk` | 🔴 Critical | Historical fix code has been lost in the current file | ⚠️ Stop immediately — high risk of stepping into the same historical pit |
| `repeated-repair` | 🟡 Warning | Same function/symbol has been repaired multiple times | ⚠️ Read prior rationale before patching |
| `shelved` | ⚠️ Caution | This approach was tried before and **shelved/rejected** | ⚠️ Check restart conditions before proceeding |
| `already-done` | 🟢 Safe | Feature is landed and anchor is alive | No need to reinvent the wheel |
| `unrecorded` | ⚪ New | No historical records | Confirm it's a new scenario, proceed, then `ledger_add` |

---

## 📐 13-Field Ledger Entry Schema

`docs/changelog.md` uses a strict append-only Markdown structure:

| Field | Description | Example |
|---|---|---|
| **Date** | When the change happened | `2026-10-28` |
| **Type** | fix / feature / refactor / spec / deploy / decision / telemetry / drill / docs | `refactor` |
| **Status** | landed / in-progress / pending-verify / shelved / todo / reverted / abandoned | `landed` |
| **Repo** | Repository name | `dsh-memledger` |
| **Requirement** | Optional. Requirement ID → `docs/requirements/RQ-….md` | `RQ-20261113-01` |
| **Background** | What is the current situation, why did this problem arise | `Old dashboard hard-depends on webServer, causing headless builds to crash` |
| **Change** | What technical change was actually made | `Removed hard dependency, switched to optional route injection + client-side sandbox` |
| **Why** | Core decision rationale (**required for non-landed statuses**) | `Tool purity first; UI is a non-blocking optional presentation` |
| **Tradeoff** | Cost paid, or **restart conditions** for shelved entries | `Cost: maintaining dual-layer fault tolerance; gained: zero blank-screen surface` |
| **Anchor** | Physical code location (`file::symbol`) | `lib/index.js::apply` |
| **Commit** | Git commit hash | `4541e1e` |
| **Verify** | Verification command or test case | `Contract C-001/C-003 · 7/7 passed · 100 score` |
| **Keywords** | Search tags | `dashboard, fault-tolerance, graceful-degradation` |

---

## 🛡️ Contract Layer

The ledger answers *"why was this changed"*; the contract suite answers *"is the change still correct"*:

- **Anchor-targeted selection**: Cases declare `covers: ["lib/x.js::fn"]`; modified anchors trigger only their covering cases.
- **Weighted scores**: `Σ(weight × pass) / Σweight`. Rollback-prevention cases get weight 5, acceptance criteria weight 3.
- **Anti-self-certification**: No test framework dependency; `update` requires a `reason` and a spec-type ledger entry; `seenFail` encourages red-then-green.

---

## 🚀 Installation

### From npm (recommended)

```bash
npm install dsh-memledger
```

### In DSH

Search `memledger` in the Plugin Manager for one-click installation.

### From source

```bash
git clone https://gitee.com/ginorva/mem-ledger.git
cd mem-ledger
npm test   # 13 smoke test suites
```

---

## 🏛️ Acknowledgments & References

1. **[Aider](https://github.com/paul-gauthier/aider)**: Pioneered the **Repo Map** concept — extracting export symbols via AST into a compact topology.
2. **[Mem0](https://github.com/mem0ai/mem0)** & **ADR**: **Negative Memory** — treating failed and abandoned rationale as first-class citizens.
3. **[DeepSeek Harness](https://github.com/deepseek-ai)**: Built on DSH's Cordis dependency injection lifecycle, Agent Tools contracts, and Client UI Slots extension mechanism.

---

## 📄 License

MIT License © 2026 ginorva / MemLedger Contributors
