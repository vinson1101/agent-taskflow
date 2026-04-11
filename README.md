# AgentTaskFlow (ATF) - 任务分配与协作系统

> 基于 OpenClaw 的多 Agent 任务管理框架。统一任务仓库 + CLI + Watcher。

**状态：运行中（v2，2026-04-11 重构）**

---

## 核心文件

| 文件 | 说明 |
|------|------|
| `atf-cli.js` | CLI 入口，所有命令 |
| `workspace/bin/atf-watcher.cjs` | 状态监控 + 超时 DLQ + 通知 |
| `workspace/bin/learnings-promote.cjs` | learnings → MEMORY promote |
| `/root/.openclaw/atf-tasks/` | 统一任务仓库（50 个任务） |

---

## 架构

```
atf create "描述"  → ctx.json + pending-task.json
atf assign T-X f0x → ctx.assigned_to + pending-task.json
F0x scan          → 发现 pending-task.json → 查 ctx.status → 执行
F0x               → atf update T-X completed
Watcher           → 检测 completed → 通知 PinchyMeow → Vinson 确认 delivered
```

**状态机：**
```
created → assigned → confirmed → executing → completed → delivered
    ↓         ↓          ↓
  超时DLQ   超时DLQ    超时DLQ
    ↓         ↓
  retry ×3   archived
```

---

## CLI 命令

```bash
node atf-cli.js create <描述>           # 创建任务
node atf-cli.js list                    # 列出所有任务
node atf-cli.js nextnum                  # 下一个编号
node atf-cli.js status <taskId>         # 查看状态
node atf-cli.js ctx <taskId>             # 查看 ctx.json
node atf-cli.js assign <taskId> <agent>  # 指派（写 pending-task.json）
node atf-cli.js update <taskId> <status> # 更新状态（pause/assigned/completed等）
node atf-cli.js fan-out <taskId> <a1,a2> # fan-out 分发
node atf-cli.js delivered <taskId>       # 标记已送达（Vinson 确认）
node atf-cli.js dri <taskId> [agent]     # 设置/查看 DRI
node atf-cli.js dlq list                  # 列出 DLQ
node atf-cli.js dlq retry <taskId>       # DLQ 重试
node atf-cli.js dlq skip <taskId>       # DLQ 跳过
node atf-cli.js dlq cancel <taskId>     # DLQ 取消
```

---

## CLI 命令（未完成 / 实验性）

> ⚠️ 以下命令今天加的，但设计过重，**暂不使用**，用 `update <status>` 代替

```bash
# 这些命令存在但暂不推荐使用（设计过于复杂）
node atf-cli.js block <taskId> <问题>    # 写 pending-decisions.json，Watcher 通知
node atf-cli.js decide <taskId> <回答>  # 回答决策，继续执行
node atf-cli.js revise <taskId> <反馈>  # 打回重做
```

**正确做法：** `atf update T-X paused` / `atf update T-X blocked` / `atf update T-X cancelled`

---

## 关键设计原则

1. **文件 ≠ 状态** — `pending-task.json` 是通知信号，`ctx.status` 才是控制流
2. **pause/cancelled/blocked** 等状态靠 `update` 命令，不需要新命令
3. **小团队简化** — 不需要 watcher 投递确认、delivery-history 去重、pending-decisions 队列

---

## 已实现

- ✅ 统一任务仓库（`/root/.openclaw/atf-tasks/`）
- ✅ ctx.json 标准结构（含 protocol/delivery_status/retry_count）
- ✅ CLI v2（create/list/assign/update/dlq/delivered/dri）
- ✅ pending-task.json 通知机制
- ✅ Watcher v1.5（超时 DLQ + 幂等投递 + 文件降级）
- ✅ fan-out 分发
- ✅ learnings-promote.cjs（→ MEMORY）
- ✅ 岚遥机制（learnings/ 即时记录 + promote）

## 未完成 / 待优化

- [ ] **learnings → lessons 合并** — 已存在 `memory/lessons/`，learnings 机制是重复的，应迁移到 lessons
- [ ] **简化 watcher** — 投递确认、delivery-history、pending-decisions 复杂度过高，简化回基本超时 DLQ 即可
- [ ] **block/decide/revise 命令移除** — 设计过重，用 `update <status>` 代替即可
- [ ] **shared-context/ 结构化** — intel/ 情报积累、decision/ 决策记录尚未日常化
- [ ] **每日复盘 cron** — 岚遥建议的 23:00 复盘尚未建立
- [ ] **Zoe 每周巡检** — 岚遥建议的 10:00/14:00/22:00 巡检 cron 尚未建立

---

## 相关路径

- 任务仓库：`/root/.openclaw/atf-tasks/`
- CLI：`/root/.openclaw/workspace/agent-taskflow/atf-cli.js`
- Watcher：`/root/.openclaw/workspace/bin/atf-watcher.cjs`
- learnings promote：`/root/.openclaw/workspace/bin/learnings-promote.cjs`
- Lessons：`/root/.openclaw/workspace/memory/lessons/`

---

*最后更新：2026-04-12*
