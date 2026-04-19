# ATF 自主能力路线图

## 背景

ATF 当前已经具备异步任务派发和状态回写能力，但仍缺少真正的“自主协作层”。

当前模式更像：

- 人或主 Agent 创建任务
- 通过 CLI / 文件派发任务
- 子 Agent 在 heartbeat / cron 扫描中发现任务
- 子 Agent 执行后回写状态
- cron 驱动的 watch / scan 脚本负责超时检测、催办、DLQ 和归档

这条链路已经证明 ATF 可以作为异步任务总线工作，但它还不具备以下能力：

- Agent 自主追踪自己的工作焦点
- Agent 自主创建和回收触发器
- Agent 间围绕同一任务显式交流
- Agent 根据消息或事件被唤醒
- Agent 对自己的工作过程进行结构化反思

这些能力构成了 ATF 下一阶段必须补上的“自主层”。

## 参考模式

外部参考中，Clawith 提供了一个值得借鉴的模式：

- Focus Items：Agent 主动维护当前在追踪什么
- Focus-Trigger Binding：触发器必须绑定到一个工作焦点
- Self-Adaptive Triggering：Agent 根据任务演化自己调整触发器
- Agent Messaging：Agent 间显式消息传递
- Reflections：任务触发后的自我审查和反思

ATF 不需要复制 Clawith 的完整平台形态，但应该吸收其中的自主协作思想。

## 为什么 ATF 现在缺这一层

ATF 当前寄生于 OpenClaw，能力边界明显受限：

- heartbeat 周期长
- watch 依赖 cron 轮询，不是常驻事件驱动
- 没有实时事件总线
- 没有任务线程内消息模型
- 没有 Focus 级别的中间状态对象
- cron / watcher 更偏外部驱动，不是 Agent 自治驱动

因此，ATF 当前是“异步控制层”，还不是“自治协作层”。

## 设计目标

ATF 的自主能力应服务于现有异步协作内核，而不是把项目改造成重型独立平台。

目标应当是：

1. 增强 ATF 的 Agent 自治能力
2. 保持与 OpenClaw 的低耦合集成
3. 保持文件协议和状态机的可审计性
4. 不引入过早的复杂前后端系统

## 建议补齐的能力

### 1. Focus Items

为每个任务引入 `focus` 概念，作为 Agent 当前正在追踪的工作对象。

建议用途：

- 把一个任务拆成更小的当前关注项
- 记录当前假设、阻塞点、下一步动作
- 区分“任务整体状态”和“当前工作焦点”

建议最小结构：

- `focus_id`
- `task_id`
- `title`
- `status`
- `owner_agent`
- `next_action`
- `updated_at`

### 2. Trigger Binding

所有 ATF 内触发器都应该和任务或 focus 显式绑定。

包括：

- timeout
- cron review
- poll
- message wakeup
- follow-up reminders

这样才能避免：

- 无主触发器漂移
- 任务完成后遗留定时器
- 难以审计触发器为何存在

### 3. Agent Messaging

ATF 需要任务内的 Agent 间消息机制，而不是只靠状态字段和文件投递。

最小消息模型就足够：

- `task_id`
- `from_agent`
- `to_agent`
- `message_type`
- `body`
- `created_at`
- `reply_to`

典型用途：

- 补充说明
- 请求上下文
- 请求决策
- 交付反馈
- 多 Agent 协调

### 4. Wakeup 模型

ATF 不应只依赖长周期 heartbeat。

建议逐步支持：

- `cron`
- `interval`
- `on_message`
- `on_status_change`
- `on_blocked`

第一阶段不一定要实时，但要让“被消息唤醒”和“被状态变化唤醒”成为正式模型。

### 5. Reflections

ATF 需要把“复盘”从分散的记事提升为任务对象的一部分。

建议在任务或 focus 上挂载：

- `reflection`
- `what_changed`
- `what_failed`
- `what_should_repeat`
- `what_needs_decision`

这会直接帮助：

- lessons 沉淀
- 自反思 cron
- 评价与信誉体系

## 分阶段落地建议

### Phase A：最小自主层

优先做：

- Focus Items
- task/focus 绑定的 trigger schema
- 任务消息文件模型
- `on_message` 和 `on_blocked` 触发器

这一步的目标不是实时，而是让自治行为有结构。

当前进展：

- 最小 Focus Items 已开始落地
- 最小任务消息模型已开始落地
- 最小 Trigger Binding schema 已开始落地
- 最小 Reflection schema 已开始落地
- 消息已可最小绑定到 task / focus / thread / reply
- Focus 结束时已可自动归档关联 active triggers
- 已出现 `trigger-fires/`、`due/fire/consume` 和最小自动 firing 记录
- 已出现 agent 维度的 trigger inbox / ignore
- 已出现 due trigger 的 `scan / scan-all`
- 已出现 watcher 可直接消费的全局 pending trigger 索引
- Reflection 已可绑定 `trigger_id` / `fire_id`
- Trigger 目前仍未形成真正的执行引擎

### Phase B：协作自治层

优先做：

- Agent 自主设置 follow-up / review trigger
- 任务内讨论线程
- 任务级 reflection
- 更细粒度的 shared-context

这一步的目标是让 Agent 不只“接任务”，还会主动跟进任务。

当前进展（2026-04-19，按当前定义范围已完成）：

- 已支持 `trigger follow-up` / `trigger review` 快捷入口
- Trigger 已支持 `intent`、`thread_id`、`note`
- 已支持 `msg threads` 查看任务线程总览
- 已支持 `shared` 的 `focus/thread/tag` 绑定与过滤
- 已支持 `reflect summary` 生成任务级摘要
- 已支持 `Trigger Action Executor`
- 已支持 `pending_task / message / room / noop` adapter
- 已支持显式 handoff schema，把 shared-context / recent messages / reflection summary 传给下游
- 已支持 `skipped / failed` 执行结果，adapter 配置错误不会误消费 fire

### Phase C：评价和信誉层

在具备 Focus、消息、反思之后，再做：

- 任务评价
- 交付 review
- 信誉画像
- 协作表现统计

这一步是未来激励和市场机制的前置条件。

但在当前 `claw army` 内部场景下，应该先收敛成 `Phase C Lite / 内部调度信誉层`，而不是直接按市场规模设计。

当前进展（2026-04-19，最小切口已开始）：

- 已支持任务目录下的 `reviews/` 评价对象
- 已支持 `review add / list / show`
- 已支持 `delivery / collaboration / task` 三类 review
- 已支持 `credits rebuild / list / show`
- 已支持 `reputation rebuild / list / show`
- 已支持 `stats summary / agents / tasks / types / show`
- 已支持把任务、消息、回执、反思和 review 聚合成 `scores.json` reputation 索引
- 已支持把“完成度 + review 反馈”派生为 `credits.json` 内部积分账本
- 已支持任务级 `task_profile`，可记录 `type / difficulty / priority / tags`
- 已支持 `review pending` 通过 `type / status / limit` 过滤待评价积压
- 已支持 `assign recommend` 读取任务画像并给内部调度提供排序建议

当前收敛原则：

- 优先服务内部任务分配和日常调度
- 先做 review 闭环、内部画像、指派参考
- 身份、激励、结算、公开信誉网络后移到商用化阶段

## 明确不建议当前就做的事

- 不建议立即重构成 Clawith 那样的独立持久平台
- 不建议立即引入复杂 Web UI、数据库、多租户模型
- 不建议把“自主意识”做成抽象叙事而没有对应协议对象

ATF 现阶段更需要的是：

**可实现的自治协议对象，而不是宏大的自治叙事。**

## 结论

ATF 当前缺的不是更多任务命令，而是一个位于任务协议之上的自主协作层。

下一阶段应当围绕以下三件事展开：

1. Focus
2. Trigger Binding
3. Agent Messaging

如果这三件事补上，ATF 就会从“异步任务总线”升级为“具备初步自治能力的多 Agent 协作内核”。
