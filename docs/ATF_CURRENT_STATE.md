# ATF 当前状态

## 当前一句话状态

ATF 已经打通了基于文件协议和 cron 扫描的异步多 Agent 任务闭环，但还不是实时协作系统，也还没有完整的自主协作层、评价层和激励层。

## 已实现并已验证

### 任务编排主链路

- CLI 创建任务
- 任务指派
- Agent 通过文件信号发现任务
- Agent 回写任务状态

### 运行保障链路

- 通过 cron 驱动的 watch / scan 脚本进行扫描
- 确认超时检测
- 自动催办
- 超时进入 DLQ
- 投递失败归档

### Watcher / Executor 链路

- 仓库内已经有可直接运行的 `workspace/bin/atf-watcher.cjs`
- watcher 默认执行 `trigger scan-all -> trigger execute-pending`
- 已可读取 `ATF_DATA_DIR/pending-trigger-fires.json`
- 已可读取 `ATF_DATA_DIR/trigger-inboxes/*.json`
- 默认执行模式会把 pending fire 落成 `pending-task.json`
- 已支持 `pending_task / message / room / noop` 4 种 adapter mode
- 已支持显式 `handoff` payload，把任务/上下文/反思传给 adapter
- 同时会写入 `trigger-executions/` 审计记录
- 本地隔离 smoke 已通过，不会破坏既有 `pending-task / timeout / DLQ / delivery` 主链

### 最小协作通信层

- 任务目录内的 `messages/` 和 `receipts/`
- 本地 Message Envelope
- 消息级 Receipt
- 面向同一 gateway 内 Agent 的异步定向消息
- 支持 `send / inbox / thread / threads / ack / receipts` 最小 CLI
- 消息可绑定 `thread_id`、`focus_id` 和 `reply_to_message_id`
- 已可列出任务内现有讨论线程概览（参与者 / 最新消息 / blocker / decision / pending）

### 最小自治对象层

- `focus-items/` 目录
- Focus Item 的创建、列出、查看、更新
- `triggers/` 目录
- Trigger Binding 的创建、列出、查看、更新
- Trigger 已支持 `intent`、`thread_id` 和 `note` 元数据
- 已支持 `trigger follow-up` / `trigger review` 快捷入口
- `trigger-fires/` 目录
- Trigger firing 的创建、列出、消费、忽略
- `trigger-executions/` 目录
- 已支持 `trigger execute` / `trigger execute-pending` / `trigger executions`
- 已支持 `pending_task / message / room / noop`
- pending fire 已可执行成 `pending-task.json`、agent message 或 room thread message
- 已支持显式 handoff schema（shared-context / recent messages / reflection summary）
- 已支持 execution 的 `dispatched / skipped / failed` 结果
- Agent 维度的 Trigger inbox
- `ATF_DATA_DIR/pending-trigger-fires.json`
- `ATF_DATA_DIR/trigger-inboxes/*.json`
- `trigger scan / scan-all` 已可把到期的 interval / cron triggers 扫描成 fire
- `reflections/` 目录
- Reflection 的创建、列出、查看
- Reflection 可绑定 `trigger_id` / `fire_id`
- `shared-context.json`
- 任务级共享上下文追加与查看
- shared-context 已支持 `focus/thread/tag` 级别绑定与过滤
- Focus 完成或丢弃时，关联的 active triggers 会自动归档
- `update` / `focus update` / `msg send` 已会自动产生日志和 trigger firing 记录
- `reflect from-fire` 已可把 firing 结果直接沉淀成 Reflection
- `reflect summary` 已可生成任务级 / Focus 级 reflection 摘要

### 多 Agent 异步场景

- 同一套链路可以跟踪多个 Agent
- 不同 Agent 的任务状态可以并行推进
- 至少在 `pinchymeow` / `f0x` 场景下，异步运行保障链路已经有实际运行证据
- `workspace/bin/atf-watcher.cjs` 的 `scan-all -> execute-pending` 链路已有本地隔离 smoke 证据

## 当前系统性质

ATF 当前更接近：

- 异步任务协议层
- 运行保障层
- OpenClaw 上的多 Agent 编排内核

ATF 当前还不是：

- 实时协作平台
- 多 Agent 即时讨论系统
- 完整评价系统
- 完整激励和结算系统
- 独立持久运行的 Agent 平台

## 当前约束

- 依赖 OpenClaw heartbeat 和 cron 扫描
- 不是实时事件驱动
- 扫描间隔较长，不适合即时任务
- 已有最小任务线程对象、线程总览和 room adapter，但还没有完整广播 / 订阅模型
- 已有最小 Agent-to-Agent 消息模型，但还没有跨节点通信层
- Trigger 执行器目前已支持 `pending_task / message / room / noop`，但还没有直达 session / bot 的 adapter
- 评价、信誉、激励尚未闭环

注：
当前已经有最小消息协议、最小自治对象、最小 trigger firing 记录、最小全局 pending 索引、最小 due-trigger scan、最小 firing→reflection 绑定，以及仓库内可见的 watcher v1 执行链，但仍然不是实时会话系统，也还没有完整的多方讨论模型、签名身份、完整的 Trigger action adapter 集，或跨节点通信层。

## 当前最重要的事实

ATF 的价值已经不只是“记录任务”，而是：

- 能派发
- 能跟踪
- 能超时检测
- 能催办
- 能进 DLQ
- 能归档

这说明 ATF 已经具备最小的异步运行保障能力。

## 下一阶段重点

当前最值得补齐的不是支付，而是自主协作层：

1. Focus Items
2. Trigger Binding
3. Agent Messaging
4. Reflections

在这之后，再做评价、信誉和激励才是合理顺序。

## Phase B 当前进展

`Phase B / 协作自治层` 已按当前定义范围完成：

- Agent 可直接创建 `follow-up / review` 语义 Trigger
- Trigger 可显式绑定 `thread_id`
- 任务内讨论线程已可总览，而不只是单线程查看
- shared-context 已支持 `focus/thread/tag` 级结构化沉淀
- reflection 已可直接产出任务级摘要
- pending fire 已可直接执行并沉淀 execution record
- 仓库内可见 watcher v1 已可直接跑 `scan-all -> execute-pending`
- `pending_task / message / room / noop` adapter 已落地
- handoff schema 已显式传递 shared context / thread context / reflection summary
- execution 失败模型已落地，不会因 adapter 配置错误误消费 fire
