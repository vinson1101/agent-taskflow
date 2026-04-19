# AgentTaskFlow (ATF) - 任务分配与协作系统

> 基于 OpenClaw 的多 Agent 任务管理框架。统一任务仓库 + CLI + Watcher。

**状态：运行中（v2，2026-04-11 重构）**

## 指导文档

以下文档用于沉淀当前阶段的产品判断和未来方向：

- [docs/README.md](./docs/README.md) - 指导文档索引
- [docs/ATF_PRODUCT_GUIDE.md](./docs/ATF_PRODUCT_GUIDE.md) - 当前产品定义与边界
- [docs/ATF_BUSINESS_STRATEGY.md](./docs/ATF_BUSINESS_STRATEGY.md) - 商业价值与演进路径
- [docs/ATF_AUTONOMY_ROADMAP.md](./docs/ATF_AUTONOMY_ROADMAP.md) - 自主能力缺口与路线图
- [docs/ATF_CAPABILITY_EVOLUTION.md](./docs/ATF_CAPABILITY_EVOLUTION.md) - 从当前实现到长期能力体系的演进图
- [docs/ATF_EXTERNAL_REFERENCES.md](./docs/ATF_EXTERNAL_REFERENCES.md) - Clawith、BotCord 等外部参考及可吸收点
- [docs/ATF_RUNTIME_USAGE.md](./docs/ATF_RUNTIME_USAGE.md) - 当前 CLI 的实际调用说明
- [docs/ATF_REPUTATION_LAYER.md](./docs/ATF_REPUTATION_LAYER.md) - Phase C Lite / 内部调度信誉层设计
- [docs/ATF_WATCHER_INTEGRATION.md](./docs/ATF_WATCHER_INTEGRATION.md) - cron / watcher / heartbeat 集成说明

---

## 核心文件

| 文件 | 说明 |
|------|------|
| `atf-cli.js` | CLI 入口，所有命令 |
| `workspace/bin/atf-watcher.cjs` | 仓库内可见的 watcher v1：`scan-all -> execute-pending` 批量执行脚本 |
| `workspace/bin/learnings-promote.cjs` | learnings → MEMORY promote |
| `/root/.openclaw/atf-tasks/` | 统一任务仓库（50 个任务） |

---

## 架构

```
atf create "描述"  → ctx.json + pending-task.json
atf assign T-X f0x → ctx.assigned_to + pending-task.json
F0x scan          → 发现 pending-task.json → 查 ctx.status → 执行
F0x               → atf update T-X completed
Watcher(cron scan) → 检测 completed / timeout → 通知 / 催办 / DLQ
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
node atf-cli.js create <描述> [type=x] [difficulty=1-5] [priority=x] [tags=a,b] # 创建任务
node atf-cli.js list                    # 列出所有任务
node atf-cli.js nextnum                  # 下一个编号
node atf-cli.js status <taskId>         # 查看状态
node atf-cli.js stats summary            # 查看整体完成/反馈统计
node atf-cli.js stats agents             # 查看 agent 完成度/反馈统计
node atf-cli.js stats show <agent>       # 查看单个 agent 统计
node atf-cli.js profile <taskId>         # 查看任务画像
node atf-cli.js profile set <taskId> [type=x] [difficulty=1-5] [priority=x] [tag=x] [tags=a,b] # 更新任务画像
node atf-cli.js ctx <taskId>             # 查看 ctx.json
node atf-cli.js assign <taskId> <agent>  # 指派（写 pending-task.json）
node atf-cli.js assign recommend <taskId> [top=N] # 查看内部指派建议
node atf-cli.js update <taskId> <status> # 更新状态（pause/assigned/completed等）
node atf-cli.js fan-out <taskId> <a1,a2> # fan-out 分发
node atf-cli.js delivered <taskId>       # 标记已送达（Vinson 确认）
node atf-cli.js dri <taskId> [agent]     # 设置/查看 DRI
node atf-cli.js focus add <taskId> <owner> <title>            # 创建 Focus Item
node atf-cli.js focus list <taskId> [owner]                   # 列出 Focus Items
node atf-cli.js focus show <taskId> <focusId>                 # 查看 Focus Item
node atf-cli.js focus update <taskId> <focusId> <status> [nextAction] # 更新 Focus
node atf-cli.js trigger add <taskId> <owner> <type> <spec> [focus=FOC-...] [thread=...] [intent=x] [note=x] # 创建 Trigger
node atf-cli.js trigger follow-up <taskId> <owner> <spec> [focus=FOC-...] [thread=...] [note=x] # 创建 follow-up Trigger
node atf-cli.js trigger review <taskId> <owner> <spec> [focus=FOC-...] [thread=...] [note=x] # 创建 review Trigger
node atf-cli.js trigger list <taskId> [owner]                 # 列出 Triggers
node atf-cli.js trigger inbox <agent> [taskId]                # 查看 agent 待处理 Trigger fires
node atf-cli.js trigger rebuild-index                         # 重建全局 Trigger fire 索引
node atf-cli.js trigger due <taskId> [owner] [at=ISO]         # 查看已到期 Trigger
node atf-cli.js trigger scan <taskId> [owner] [at=ISO]        # 扫描并触发当前任务的已到期 Trigger
node atf-cli.js trigger scan-all [owner] [at=ISO]             # 扫描并触发所有任务的已到期 Trigger
node atf-cli.js trigger show <taskId> <triggerId>             # 查看 Trigger
node atf-cli.js trigger update <taskId> <triggerId> <status>  # 更新 Trigger
node atf-cli.js trigger fire <taskId> <triggerId> <sourceType> [ref=...] [note] # 手动记录 Trigger firing
node atf-cli.js trigger fires <taskId> [triggerId] [status]   # 查看 Trigger firing 记录
node atf-cli.js trigger execute <taskId> <fireId> [executor] [mode=pending_task|message|room|noop] [note=x] [to=agent] [thread=x] [room=x] # 执行单条 pending fire
node atf-cli.js trigger execute-pending [agent] [executor=x] [mode=x] [limit=N] [note=x] [to=agent] [thread=x] [room=x] # 批量执行 pending fires
node atf-cli.js trigger executions <taskId> [fireId]          # 查看 Trigger execution 记录
node atf-cli.js trigger consume <taskId> <fireId> <consumer> [result] # 标记 Trigger firing 已消费
node atf-cli.js trigger ignore <taskId> <fireId> <consumer> [reason] # 标记 Trigger firing 已忽略
node atf-cli.js reflect add <taskId> <author> <field> <内容> [focus=FOC-...] [trigger=TRG-...] [fire=TGF-...] # 添加 Reflection
node atf-cli.js reflect from-fire <taskId> <fireId> <author> <field> <内容> # 从 Trigger fire 创建 Reflection
node atf-cli.js reflect list <taskId> [field] [focus=FOC-...] [trigger=TRG-...] [fire=TGF-...] [author=x] # 查看 Reflections
node atf-cli.js reflect summary <taskId> [focus=FOC-...] [author=x] # 查看 Reflection 摘要
node atf-cli.js reflect show <taskId> <reflectionId>          # 查看 Reflection
node atf-cli.js review add <taskId> <reviewer> <reviewee> <outcome> <总结> [type=x] [overall=4] [quality=4] [timeliness=4] [communication=4] [ownership=4] [focus=FOC-...] [thread=x] [trigger=TRG-...] [fire=TGF-...] # 写入 Review
node atf-cli.js review list <taskId> [reviewee] [reviewer=x] [type=x] [outcome=x] [focus=FOC-...] # 查看任务 Reviews
node atf-cli.js review pending [agent]                        # 查看待评价任务
node atf-cli.js review show <taskId> <reviewId>               # 查看 Review
node atf-cli.js credits rebuild                               # 重建内部积分索引（完成度 + 反馈）
node atf-cli.js credits list                                  # 查看 agent 积分概览
node atf-cli.js credits show <agent>                          # 查看单个 agent 积分账本
node atf-cli.js reputation rebuild                            # 重建 reputation / scores 索引
node atf-cli.js reputation list                               # 查看 agent 信誉概览
node atf-cli.js reputation show <agent>                       # 查看单个 agent 画像
node atf-cli.js shared add <taskId> <author> <type> <内容> [focus=FOC-...] [thread=...] [tag=x] [tags=a,b] # 添加共享上下文
node atf-cli.js shared list <taskId> [type] [focus=FOC-...] [thread=...] [author=x] [tag=x] # 查看共享上下文
node atf-cli.js msg send <taskId> <from> <to> <type> <内容> [focus=FOC-...] [thread=...] [reply=MSG-...] # 发送任务内异步消息
node atf-cli.js msg inbox <agent> [taskId]                    # 查看 agent 收件箱
node atf-cli.js msg thread <taskId> [threadId|focus=FOC-...]  # 查看任务消息线程
node atf-cli.js msg threads <taskId> [focus=FOC-...] [agent=x] # 查看任务线程总览
node atf-cli.js msg ack <taskId> <messageId> <agent> [type] [note] # 写消息回执
node atf-cli.js msg receipts <taskId> <messageId>             # 查看消息回执
node atf-cli.js dlq list                  # 列出 DLQ
node atf-cli.js dlq retry <taskId>       # DLQ 重试
node atf-cli.js dlq skip <taskId>       # DLQ 跳过
node atf-cli.js dlq cancel <taskId>     # DLQ 取消
```

快速自测：

```bash
npm run atf:phasec:smoke
node workspace/bin/atf-phasec-smoke.cjs --cleanup
```

---

## Watcher 入口

```bash
npm run atf:watcher -- --help
npm run atf:watcher -- --agent f0x --executor watcher-v1
npm run atf:watcher:dry -- --agent f0x
```

`workspace/bin/atf-watcher.cjs` 当前做两件事：

1. 调用 `node atf-cli.js trigger scan-all`
2. 调用 `node atf-cli.js trigger execute-pending`

默认执行模式仍是 `pending_task`，也就是把 pending fire 落成任务目录下的 `pending-task.json`，同时写入 `trigger-executions/` 审计记录。

当前已经支持 4 种 adapter / mode：

- `pending_task`
- `message`
- `room`
- `noop`

执行器现在会显式生成 `handoff` payload，把任务、focus、shared-context、最近消息、reflection 摘要一起传给下游 adapter。`room` 模式要求 `room=<name>` 或 `thread=room:<name>`；缺参时会记成 `skipped`，fire 保持 `pending`，不会误消费。

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
- ✅ Watcher v1.5（通过 cron 扫描驱动：超时 DLQ + 幂等投递 + 文件降级）
- ✅ fan-out 分发
- ✅ 任务内异步消息（Message Envelope + Receipt 最小版）
- ✅ Focus Items 最小版
- ✅ Trigger Binding 最小版
- ✅ Trigger firing records / consumption 最小版
- ✅ Trigger inbox / ignore 最小版
- ✅ Trigger scan 最小版
- ✅ 全局 pending-trigger-fires / trigger-inboxes 索引
- ✅ cron / daily@HH:MM / weekly@mon@HH:MM 形式的最小 next_due_at 计算
- ✅ Reflection source binding 最小版
- ✅ 外部 watcher v1.6 已接入 Trigger fire 消费链并通过服务器侧 smoke
- ✅ shared context 最小版
- ✅ Trigger intent / thread_id / note 元数据
- ✅ trigger follow-up / review 快捷入口
- ✅ msg threads 任务线程总览
- ✅ shared context 的 focus/thread/tag 绑定与过滤
- ✅ reflect summary 任务级摘要
- ✅ 任务级 Review（task / delivery / collaboration）
- ✅ reputation / scores 索引（任务、消息、回执、反思、review 聚合）
- ✅ `status / assign` 直接显示 review / reputation 摘要
- ✅ `review pending` 半自动评价闭环入口
- ✅ Trigger Action Executor 最小版（`execute / execute-pending / executions`）
- ✅ 仓库内可见 watcher v1（`workspace/bin/atf-watcher.cjs`）
- ✅ Trigger Action Adapter 第一批（`pending_task / message / room / noop`）
- ✅ 显式 handoff schema（shared context / recent messages / reflection summary）
- ✅ execution failure model（`dispatched / skipped / failed`）
- ✅ learnings-promote.cjs（→ MEMORY）
- ✅ 岚遥机制（learnings/ 即时记录 + promote）

## 未完成 / 待优化

- [ ] **Trigger Action Adapter 扩展** — `pending_task / message / room` 已落地，但还没有直接触达 agent session / bot 的 adapter
- [ ] **learnings → lessons 合并** — 已存在 `memory/lessons/`，learnings 机制是重复的，应迁移到 lessons
- [ ] **简化 watcher** — 投递确认、delivery-history、pending-decisions 复杂度过高，简化回基本超时 DLQ 即可
- [ ] **block/decide/revise 命令移除** — 设计过重，用 `update <status>` 代替即可
- [ ] **shared-context/ 日常化沉淀** — 已有 `focus/thread/tag` 结构，但 intel/decision 的日常使用还不稳定
- [ ] **每日复盘 cron** — 岚遥建议的 23:00 复盘尚未建立
- [ ] **Zoe 每周巡检** — 岚遥建议的 10:00/14:00/22:00 巡检 cron 尚未建立

---

## 相关路径

- 任务仓库：`ATF_TASKS_DIR`，默认 `/root/.openclaw/atf-tasks/`
- 数据目录：`ATF_DATA_DIR`，默认 `/root/.openclaw/workspace/agent-taskflow/data/`
- 全局 Trigger 索引：`ATF_DATA_DIR/pending-trigger-fires.json`
- Agent Trigger inbox：`ATF_DATA_DIR/trigger-inboxes/*.json`
- reputation 索引：`ATF_DATA_DIR/scores.json`
- 工作区根目录：`ATF_WORKSPACE_DIR`，默认 `/root/.openclaw/workspace/`
- learnings promote：`ATF_LEARNINGS_PROMOTE_SCRIPT`

---

*最后更新：2026-04-19*
