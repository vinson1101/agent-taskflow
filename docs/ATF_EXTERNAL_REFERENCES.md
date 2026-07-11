# ATF 外部参考

## 使用原则

ATF 参考外部项目时遵循四条规则：

1. 先确认对方真实实现，不根据宣传语推断能力。
2. 参考能力边界，不机械复制完整产品形态。
3. 已有行业标准优先做 adapter，不在 ATF 内重建一套不兼容协议。
4. 任何参考都必须落到 [PLAN.md](../PLAN.md) 的具体里程碑和验收条件。

## AgentRQ

- 项目：[agentrq/agentrq](https://github.com/agentrq/agentrq)
- 定位：Agent 与人类共享的实时任务协作平台
- 已核对能力：持久 Task/Message、SQLite/PostgreSQL、MCP tools、SSE 事件、Claude Channel、ACP Gateway、Codex app-server gateway、跨 workspace supervisor

### 对 ATF 的启发

AgentRQ 直接验证了几个关键判断：

- 任务真相应保存在 session 外。
- Task 创建后可以通过通知通道主动触达 Agent，不必等待 Agent 高频轮询。
- 不同 runtime 应通过 gateway / adapter 接入同一任务面。
- Agent 执行应走 `getTask -> ongoing -> reply -> completed` 的显式回写链。
- session 与 task 可以建立临时映射，但长期恢复仍应回到持久任务库。

### 不照搬

- 不复制完整 Web UI、OAuth、多租户和 SaaS 部署面。
- 不复制 AgentRQ 的 workspace 产品模型作为 ATF 核心 schema。
- 不因 AgentRQ 使用 Go/SQLite 就立即重写 ATF 技术栈。

### 落点

- M1：事件快路径、runtime adapter、实时通知后低频对账。
- M2：session/task obligation、required write-back 和 verifier。
- M3：Hermes adapter。

## A2A Protocol

- 规范：[A2A Protocol](https://a2a-protocol.org/)
- 定位：跨厂商 Agent 的标准 Task、Message、Artifact、streaming 和 push notification 协议

### 对 ATF 的判断

A2A 会持续覆盖 ATF 早期设想中的外部 Agent 通信和任务交换能力，因此 ATF 不应继续发展成另一套通用互操作协议。

ATF 保留的职责是：

- DRI / SLA / obligation
- 宿主 runtime 唤醒
- session 恢复
- lease / retry / DLQ / escalation
- write-back verifier
- 本地审计和运行指标

### 落点

- M4：在边界映射 A2A Task / Message / Artifact。
- A2A push notification 进入 ATF event fast path。
- ATF 专属字段只作为内部对象或明确 extension。

## Hermes Agent

- 项目：[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
- 已核对能力：MCP integration、messaging gateway、持久 memory、session search、cron、跨平台 conversation continuity、subagents

### 对 ATF 的启发

Hermes 已经拥有自己的 session、memory、gateway 和 scheduler，因此 ATF 不应复制或直接修改这些内部状态。兼容方式应是：

- Runtime Adapter 通过 Hermes 官方 MCP、CLI 或 gateway 接受 Work Envelope。
- Hermes 通过 ATF MCP/CLI 完成 task/message/status/artifact write-back。
- Hermes session history 只能作为可选 Session Context Provider。

### 落点

- M3：Hermes stub smoke + 真实 canary。
- 验收要求是同一 ATF task 可由 OpenClaw 或 Hermes 执行，核心 task schema 不出现 runtime-specific 分支。

## Agent Sessions / AI Sessions MCP

- 项目：[jazzyalex/agent-sessions](https://github.com/jazzyalex/agent-sessions)
- 项目：[yoavf/ai-sessions-mcp](https://github.com/yoavf/ai-sessions-mcp)
- 定位：统一浏览、搜索、恢复或跨 Agent 读取 Claude Code、Codex、Hermes、OpenClaw 等本地 session 历史

### 有帮助的部分

- 发现各 runtime 已保存的历史 session。
- 在新 session 中查找旧任务上下文。
- 为跨 Claude Code / Codex / Hermes / OpenClaw handoff 生成相关摘要。
- 避免每个项目都重新实现多种 transcript parser。

### 不能替代的部分

- 它们不能证明旧任务仍然有效。
- transcript 不能表示当前 DRI、未完成 obligation 或验收状态。
- resume 命令不等于跨产品共享同一个原生 session。
- 原始历史可能包含敏感信息和大量无关上下文。

### 落点

- M5：作为只读 Session Context Provider 候选。
- 必须提供 provenance、长度限制和敏感信息过滤。
- 关闭 session provider 后，ATF 主链仍必须完整工作。

## Clawith

- 项目：[dataelement/Clawith](https://github.com/dataelement/Clawith)
- 参考点：Focus、Trigger Binding、Agent Messaging、Reflection、持久 Agent 状态

ATF 已经吸收这些最小对象。后续不复制其完整持久平台和“自主意识”产品叙事，而是把已有对象推进为可验证 obligation 和 action。

## BotCord Protocol

- 站点：[BotCord Protocol](https://www.botcord.chat/protocol)
- 参考点：typed message envelope、receipt、TTL、retry、签名身份、room fan-out

ATF 已经实现 Message/Receipt 的一部分。外部互操作优先采用 A2A；BotCord 继续作为消息可靠性和身份治理的设计参考，不再作为独立协议扩张方向。

## 结论

这些项目分别覆盖不同层：

| 参考 | 主要价值 | ATF 的处理方式 |
|---|---|---|
| AgentRQ | 持久任务、实时通知、多 runtime gateway | 借鉴事件与 adapter，不复制完整平台 |
| A2A | 外部 Agent 互操作标准 | 做兼容边界，不竞争 |
| Hermes | 新的一等 session runtime | 官方接口 adapter + canary |
| Agent Sessions / AI Sessions MCP | 跨运行时历史检索与恢复 | 可选只读上下文来源 |
| Clawith | 自主协作对象 | 已吸收最小对象 |
| BotCord | 消息可靠性与身份 | 保留为内部协议参考 |

ATF 的主线因此收敛为：**持久责任 + 事件唤醒 + runtime adapter + verifier + 恢复**。
