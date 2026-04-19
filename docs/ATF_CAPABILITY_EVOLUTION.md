# ATF 能力演进图

## 这份文档解决什么问题

ATF 不应只围绕当前已经跑通的链路优化。

当前的 `CLI + 文件协议 + cron 扫描` 只是起点，不是终点。ATF 的真正目标是逐步成长为面向 agent-to-agent 协作时代的协议层、控制层和最终的协作市场基础设施。

因此，ATF 的开发应始终围绕“能力升级”展开，而不是只围绕“当前实现修补”展开。

## 核心原则

### 1. 当前实现只是 Phase 0

当前实现证明了 ATF 的起点成立，但不代表 ATF 的能力边界已经确定。

已跑通的只是：

- 任务创建
- 指派
- 状态回写
- 超时检测
- 催办
- DLQ
- 归档

这说明异步协作协议成立，但 ATF 远不止于此。

### 2. 未来能力优先于当前形态

ATF 的设计不应被当前的宿主限制永久绑定。

虽然当前运行在 OpenClaw 之上，且依赖 heartbeat / cron，但未来需要预留：

- 更快的唤醒
- 显式消息
- 自主触发
- 协作评价
- 激励分配
- 信誉系统
- 市场协议

### 3. 每一阶段都应服务于长期目标

当前阶段做的任何能力，都应该回答一个问题：

**它是否在为未来的多 Agent 协作市场和协作基础设施打地基？**

如果答案是否定的，就不应成为长期主线。

## ATF 的目标能力分层

ATF 未来的能力可以分成 6 层。

### Layer 1：任务协议层

这是 ATF 的起点，也是当前最接近完成的一层。

能力包括：

- 任务 schema
- 状态机
- 指派 / 签收
- DRI
- 依赖关系
- 子任务 / fan-out
- 交付确认

意义：

- 让 Agent 协作第一次具备结构化对象
- 把“对话型协作”变成“协议型协作”

当前状态：

- 已有基础能力
- 仍需补齐依赖关系、显式 accept、统一 schema 治理

### Layer 2：运行保障层

这一层负责保证任务不会静默失败。

能力包括：

- timeout
- 催办
- DLQ
- retry
- archived
- 投递记录
- 审计日志

意义：

- 让多 Agent 协作具备运维能力
- 让失败可见、可恢复、可追踪

当前状态：

- 已验证最小闭环
- 仍需做更清晰的记录、证据和策略管理

### Layer 3：协作通信层

这一层是 ATF 当前明显缺失的部分。

能力包括：

- Agent-to-Agent 消息
- 任务内讨论线程
- shared context
- 决策请求
- 阻塞说明
- 交付反馈

意义：

- 让多个 Agent 不只是串行执行，而是可以显式协作
- 把“任务状态同步”升级为“任务协作同步”

当前状态：

- 基本缺失
- 已开始落地最小 Message Envelope / Receipt
- 已支持 thread / focus / reply 的最小绑定
- 仍需继续建设更完整的任务线程、shared context 和协作消息模型

### Layer 4：自主协作层

这一层让 Agent 从被动执行者变成主动协作者。

能力包括：

- Focus Items
- Trigger Binding
- Self-Adaptive Triggering
- on_message / on_status_change 唤醒
- Reflections
- follow-up planning

意义：

- 让 Agent 可以主动跟踪任务
- 让任务推进不完全依赖外部人类调度
- 为多 Agent 组织协作打下自治基础

当前状态：

- 最小自主对象层已落地，不再只是弱雏形
- 已具备 Focus Items、Trigger Binding、Reflections 和 shared context 的最小协议对象
- 已具备 `on_message / on_status_change / on_blocked` 唤醒模型
- 已具备 focus 状态变化对 trigger 的最小收束行为
- 已具备 trigger firing / execution / consume 的最小运行时钩子
- `update` / `focus update` / `msg send` 已能自动产生日志和 trigger fires
- 已具备 agent 维度的 trigger inbox、全局 pending-trigger-fires 索引，以及 `scan / scan-all / execute-pending` 入口
- 已具备 firing 到 reflection 的最小绑定，以及 handoff 对 shared context / reflection summary 的显式传递
- 下一步缺的不是对象定义，而是把这些对象推进成主动运营和任务自推进动作

### Layer 5：评价与信誉层

这一层负责把“协作历史”转化为“可用判断依据”。

能力包括：

- 任务评价
- 交付 review
- 可靠性画像
- 协作表现统计
- 任务类型适配画像
- 信誉系统

意义：

- 让未来分工不只是靠人工印象
- 让任务分配逐步从规则走向信誉驱动

当前状态：

- `Phase C Lite / 内部调度信誉层` 已形成最小闭环
- 已具备 `review / credits / reputation / stats digest / review backlog / agent audit`
- 已能把任务、消息、回执、反思和 review 聚合成内部画像与巡检信号
- 当前仍未延伸到市场级身份、激励、结算和公开信誉网络

### Layer 6：激励与市场层

这是 ATF 最长期的外层能力。

能力包括：

- 预算
- 记账
- 激励分配
- 结算
- Agent 声誉与收益绑定
- 外部 Agent 接入协议
- 任务市场 / 协作市场

意义：

- 让 ATF 从内部协作工具成长为协作基础设施
- 让 Agent 劳动、交付和收益形成闭环

当前状态：

- 还处于愿景层
- 不应在前四层没稳定前抢跑

## 推荐的能力升级顺序

ATF 后续开发建议按以下顺序推进。

### Priority A

- 强化 Layer 1：统一 schema、accept、依赖关系
- 强化 Layer 2：超时、DLQ、归档、审计

目标：

- 把底层协议和运行保障做到稳定可靠

### Priority B

- 强化 Layer 3：消息、讨论线程、shared context

目标：

- 把已有最小协作面继续做稳，而不是回到只会接单

### Priority C

- 强化 Layer 4：Focus、Trigger Binding、Reflections 的动作闭环

目标：

- 让 Agent 从“有自治对象”走向“有主动动作”

### Priority D

- 建设 Phase D：主动运营动作层

目标：

- 把已有的 Focus / Trigger / Message / Reflection / review 信号推进成主动动作

### Priority E

- 建设 Layer 6：激励、结算、市场

目标：

- 把协作系统外延到经济系统

## 这对当前开发意味着什么

### 应优先做的事

- 任何能让任务协议更稳定的工作
- 任何能让 Agent 协作更显式的工作
- 任何能让自治行为更结构化的工作

### 应谨慎做的事

- 只服务于当前演示效果但不沉淀长期能力的改动
- 过早做支付或市场包装
- 过早把项目重构成重型独立平台

## 一句话结论

ATF 不该被定义为“已经做成了什么”，而应被定义为“正在向什么能力体系演进”。

当前跑通的链路很重要，但它的真正价值在于：

**它证明了 ATF 可以从异步任务协议出发，逐步长成多 Agent 协作的控制层、自治层、信誉层和最终的市场基础设施。**
