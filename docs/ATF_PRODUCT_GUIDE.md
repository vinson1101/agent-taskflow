# ATF 产品定义

## 一句话定义

ATF 是面向 OpenClaw、Hermes 等 session 型 Agent 的、兼容 A2A 的事件优先可靠性控制面。

它不是独立 Agent 平台，也不是新的通用 Agent 通信标准。ATF 在 session 外持久保存任务责任，负责事件投递、运行时唤醒、回写验证和失败恢复。

## 为什么调整定位

当前 OpenClaw 主链已经证明文件协议、任务状态、follow-up、launch 和审计回写可以工作，但也暴露了三个结构性问题：

1. 高频轮询浪费资源，低频轮询增加任务等待时间。
2. Agent 依赖 session；session 退出后，未持久化的意图和通信义务不可靠。
3. A2A 和上层协作平台正在覆盖 Task、Message、Artifact 与跨 Agent 互操作，ATF 不应继续把自建外部通信协议作为核心价值。

因此，ATF 的核心从“让 Agent 通过轮询发现任务”调整为“让持久控制面主动驱动一次性 session，并验证结果回写”。

## 产品边界

### ATF 负责

- Task、DRI 和 obligation 的持久状态
- 事件生成、去重、debounce 和 dispatch
- OpenClaw / Hermes runtime adapter
- Work Envelope 和跨 session 任务恢复
- required write-back 与 verifier
- timeout、retry、lease、DLQ 和 escalation
- 审计、review 和运行质量指标
- A2A 边界映射

### 宿主 Runtime 负责

- 创建、恢复或接收 session
- 模型推理和工具执行
- 返回 runtime session reference
- 通过 ATF 工具或协议完成正式回写

### A2A 负责

- 外部 Agent 能力发现
- 标准 Task / Message / Artifact 交换
- 跨系统状态更新、streaming 和 push notification

ATF 专属的 DRI、obligation、verifier、DLQ 和 escalation 可以作为内部能力或明确 extension，但不应复制一套不兼容的 A2A 外部协议。

## 核心运行模型

### 事件快路径

当 Task、Message、Trigger 或 Action 产生可执行义务时，ATF 立即生成 durable event，通过对应 runtime adapter 唤醒 Agent。

同一 Agent 的短时间事件应合并和去重；如果 runtime 支持向活跃 session 投递，应优先复用，否则创建新 session。

### 低频 Reconciler

轮询仍然保留，但只承担：

- 漏投递修复
- 超时和失效 lease 检查
- 未回写 obligation 检查
- 可重建索引修复

空闲 reconciler 不能唤醒 LLM。

### Session 外持久状态

Session 不拥有任务真相。每次执行由 Work Envelope 提供：

- 唤醒原因
- 当前任务和 DRI
- 未读消息与待处理 obligation
- 必要的上下文摘要和引用
- required write-backs
- verifier 检查项

原始 transcript 可以作为可选上下文来源，但不能代替正式 Task、Artifact 或 write-back。

## 首批兼容范围

### OpenClaw

现有文件协议、launcher、`sessions_spawn` bridge 和 control-plane 是当前基线。后续将其包装为 Runtime Adapter v1，并保持既有 smoke 不回归。

### Hermes Agent

Hermes 是明确的一等兼容目标。集成必须使用 Hermes 官方 MCP、CLI 或 gateway 能力，不直接修改 Hermes 内部数据库。Hermes 应能接收 Work Envelope，并通过 ATF MCP/CLI 回写任务状态、消息、ack 和 artifact reference。

### 其他 Coding Agents

Claude Code、Codex、Gemini CLI 等可以通过 MCP、ACP、app-server gateway 或 A2A adapter 接入。ATF 不要求它们共享同一个原生 session；只要求能读取相关 Work Envelope 并完成可验证回写。

## 共享 Session 的定位

现有 session 浏览、搜索、恢复和跨 Agent 历史读取项目对上下文恢复有帮助，但它们解决的是“找回过去说过什么”，不是“现在谁必须做什么”。

ATF 只把这些能力作为可选的 Session Context Provider：

- 只读
- 按任务检索
- 输出小摘要和 provenance
- 可关闭，不影响主链

## 非目标

- 自建 A2A 替代协议
- 完整实时聊天产品
- 全量复制各运行时 transcript
- 统一所有产品的原生 session ID
- 重型多租户协作 SaaS
- 支付、结算和开放 Agent 市场
- 在没有真实压力前引入 broker 或分布式架构

## 当前实现状态

当前已经具备：

- 文件化 Task / Message / Trigger / Action / Launch 对象
- OpenClaw 侧 launcher 与 bridge
- lease、retry、DLQ、write-back audit
- watcher 和 control-plane smoke
- 事件快路径
- runtime-neutral adapter contract
- durable obligation 和 Work Envelope
- session 结束后的 verifier
- Hermes Runs API contract canary
- A2A compatibility smoke

真实 Hermes 部署 canary、跨运行时长期续接成功率实验和生产指标基线依赖目标环境，不能由仓库内 stub 代替。具体完成边界见根目录 [PLAN.md](../PLAN.md)。

## 长期判断

ATF 的长期价值不取决于拥有多少自定义对象，而取决于它是否能稳定降低：

- 任务发现延迟
- 无效轮询成本
- session 退出后的遗忘率
- 缺失回写率
- 人工催办和异常恢复时间

当宿主 runtime 或标准平台已经可靠覆盖某项能力时，ATF 应删除重复实现或退化为 adapter / policy。
