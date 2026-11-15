# ATF 主计划

> 更新时间：2026-11-15。当前优先级和验收标准以本文为准；历史里程碑保留为现有仓库基线。

## 1. 升级目标

**让 ATF 从依附于宿主运行的控制面，升级为可独立部署的跨 Agent 任务交付服务。** OpenClaw 不再是 ATF 运行的必需条件，而是保留的执行适配器。独立指进程、存储和任务生命周期独立；第一阶段允许与现有宿主同机，不需要新服务器。

- ATF 拥有持久事件信箱、任务 ID、责任人、待办义务、交付版本、验收记录和恢复状态。事件信箱只负责接住并去重；队列清空不等于任务结案。
- 执行器和验收器通过各自受支持的接口接单、提交产物或回执；不直接写任务库，不共享会话全文或凭据。工作台只读状态，不能替代任务状态来源。
- 接入方式可以是 CLI、MCP、HTTP 或 A2A；各通道差异留在适配层。ATF 不是 Agent 运行时，也不重做讨论、席位或通用协议。

## 2. 从现有基线开始，不先迁移生产

现有 v2 已有持久事件、Work Envelope、跨会话 obligation/verifier、OpenClaw/Hermes 适配和 A2A 对象映射，但代码和 smoke 边界不能代表真实跨宿主部署。例如当前 Hermes 请求仍引用 ATF 侧的本地 envelope 路径，跨机器未必可读；当前部分产物校验只判断有无输出，不核具体版本。先保持已有 OpenClaw 链路、数据和调度不变。

最小新增边界：

| 边界 | 需要明确 |
| --- | --- |
| 事件和派发 | 外部来源与事件 ID 去重；先持久记录派发意图及稳定请求 ID，再调用适配器。响应不确定时先对账，不盲目再次发单。 |
| 任务与产物 | 保持同一 task ID；产物绑定验收义务、版本和内容校验值，引用必须经授权且验收方可读，不能是只有发送端认识的本地路径。 |
| 审查与关单 | 验收回执绑定任务、义务、指定验收者和确切产物版本/哈希。业务质量由清单、规则或指定验收者核对；ATF 核对回执身份、权限和版本后决定是否结案。 |
| 状态和恢复 | 分开记录事件处理、运行结果、验收结果；保留退回原因、下一责任人和未解义务。重启后由持久状态恢复，不依赖旧对话。 |

## 3. 下一阶段与验收门槛

### U0：独立启动与隔离基线（合成基线已验证）

在隔离配置下，用 ATF 自己的进程和数据目录启动；测试环境不运行 OpenClaw，不读其任务目录、workspace 信号或会话。用合成事件证明接收、持久化、重启恢复和审计读回。现有 OpenClaw 适配器和生产配置保持不变。2026-11-15 14:30（北京时间）在未安装、未运行 OpenClaw 的隔离环境，使用 U1 源码树 `eca4aa20d2466a7ceea9cc9505764d5ca2d5afa8` 验证合成事件经独立 CLI 进程去重、派发并回写原任务及义务。可用 `npm run atf:u0:standalone:smoke` 复现；这不代表生产迁移或真实来源接通。

### U1：ATF → DSH → ATF 最小交付闭环（隔离实测通过）

复用 DSH Dispatch 的受支持接口，将最小验收包送到指定会话，取得结构化结果并回写 ATF。DSH 的回复是验收输入，不等于 ATF 已结案。2026-11-15（北京时间）已在 Mac 隔离目录用合成样件与真实 DSH 专用会话验证原任务接单、旧版回执拒收和精确关单。变更与回归见 [PR #1](https://github.com/vinson1101/agent-taskflow/pull/1) 及 [CI 检查](https://github.com/vinson1101/agent-taskflow/pull/1/checks)；CI 是合成回归，不代替 Mac 实测。这些结果不代表生产已部署。

| 场景 | 通过标准 |
| --- | --- |
| OpenClaw 不运行 | ATF 派出同一任务，DSH 读取指定版本、返回回执；ATF 按清单验收，读回原任务记录。 |
| 重复事件与派发结果不明 | 重送同一事件不重复发单。模拟派发后响应丢失，ATF 依据稳定请求 ID 查回；结果仍不明时保留待对账，不盲发。 |
| 中断和换会话 | 派发后重启 ATF 或更换 DSH 会话，原任务 ID、当前产物、未解义务和下一责任不丢。 |
| 版本与授权 | 提交 v2 后，迟到的 v1 回执或非指定验收者的回执不能替 v2 关单；正确验收者对 v2 的有效通过回执才可结案；退回则仍是原单。 |

测试回执保留版本、任务/请求 ID、关键状态转换与去重/恢复依据，不保存凭据或大段会话。Stub 和 HTTP 契约测试只是准备，不得替代真实 DSH 端到端验收。

### U2：按需接第二条外部来源，再评估部署

U1 通过后再评估：将已授权的公开研究交付接入事件信箱，确定 Grok 的触发和产物回传是两条不同边界。仅在本阶段尝试手工导入一份获准使用的完整公开 Grok 产物，按[本机手工导入合同](./docs/ATF_PUBLIC_RESEARCH_IMPORT.md)核对完整产物、精确审批、原任务回写和手工派发，不把合成测试当作真实 Grok 来源已接通。若没有稳定、获准、可读回的产物出口，继续人工导入，不把触发成功当成结果交付。再按需求验证 Hermes 真机和 A2A 互操作。任何生产迁移、网络暴露、长期凭据或新增权限另行评审；不属于隔离试点。

## 4. 已有 v2 历史基线

以下为 2026-07-11 仓库记录，不是本次升级验收，也不代表生产部署结果。M0–M6 的原始设计、历史实施顺序和完成标准见[历史主计划](https://github.com/vinson1101/agent-taskflow/blob/17b133be4bf36b0ea77f5ad040bd7b1747a619ed/PLAN.md)。

| Milestone | 仓库实现 | 验证状态 |
| --- | --- | --- |
| M0 | registry workspace、原子 JSON、单实例锁、零生产依赖、默认全量 smoke、Node 22/24 CI、learnings promote | 完成 |
| M1 | unified durable event、250ms per-agent debounce、dedupe、event dispatcher、低频 reconciler、Runtime Adapter v1 | 完成；本地 p95 smoke < 5s |
| M2 | `atf.obligation.v1`、`atf.work-envelope.v1`、required write-back、verifier、retry 与 escalation | 完成 |
| M3 | OpenClaw adapter、Hermes 官方 `POST /v1/runs` adapter、stub/HTTP contract canary | 仓库完成；真实 Hermes endpoint canary 待部署环境 |
| M4 | A2A inbound Task/Message、outbound status/artifact、push notification、ATF extension metadata | 完成 |
| M5 | 可关闭的只读 session context、provenance、长度限制、secret redaction | 完成；真实续接提升率待生产实验 |
| M6 | dispatch p50/p95、wake/duplicate、write-back/recovery/escalation、runtime 分组指标 | 完成；长期基线待生产采样 |

原 v2 仓库完成标准由 `npm test` 和 `npm audit --omit=dev` 验证。真实 Hermes canary 与生产效果指标属于部署验证，不用本地 stub 冒充。
