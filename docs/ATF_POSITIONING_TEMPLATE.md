# ATF 对外定位模板

这份文档统一 ATF 新目标下的对外表述。当前能力和目标能力必须分开描述。

## 1. 推荐一句话

**ATF 是面向 OpenClaw、Hermes 等 session 型 Agent 的、兼容 A2A 的可靠性控制面。**

英文可使用：

**A2A-compatible Reliability Control Plane for Session-based Agents**

## 2. 推荐三句话

1. ATF 在 Agent session 外持久保存任务责任、待处理义务和恢复状态。
2. 它采用事件快路径唤醒 Agent，以低频 reconciler 修复漏投递、超时和缺失回写。
3. 它通过 runtime adapter 兼容 OpenClaw、Hermes 等宿主，并复用 A2A 做外部互操作。

## 3. 当前状态说明

当前仓库已经验证 OpenClaw 文件协议、事件快路径、runtime-neutral adapter、durable obligation、Work Envelope、verifier、Hermes Runs API 契约和 A2A compatibility。真实 Hermes 部署 canary 与生产指标基线仍依赖目标环境，不能表述为已经完成生产验证。

## 4. 可以说的点

- session 外持久任务责任
- Agent Team Ops / reliability control plane
- OpenClaw 当前基线
- Hermes 明确兼容目标
- 事件优先、轮询对账
- runtime-neutral adapter
- A2A-compatible boundary
- retry、DLQ、audit、write-back verifier

## 5. 不要说的点

- 新一代通用 Agent 通信协议
- 已完成真实 Hermes 生产验证
- 多产品共享同一个原生 session
- 实时多 Agent 聊天平台
- 已成熟的跨组织可信协作网络
- 支付或开放市场优先产品
- 已有强一致 write-back 保证

## 6. 常见问答

### ATF 是否与 A2A 竞争？

不竞争。A2A 负责外部互操作；ATF 负责宿主 runtime 唤醒、任务责任、恢复和 verifier。

### 为什么不只使用 AgentRQ 一类平台？

AgentRQ 证明持久任务、实时通知和多 runtime gateway 的方向成立。ATF 当前聚焦更窄的本地可靠性控制面，不复制完整 UI、多租户和 SaaS 产品面。

### 共享 session 是否能解决任务遗忘？

只能补充上下文。任务责任、required write-back 和恢复状态仍必须保存在 session 外。

### ATF 现在支持什么？

当前稳定基线包括 OpenClaw 异步链路和 v2 可靠性控制面；Hermes adapter 已通过官方 Runs API 契约 canary，真实部署验证取决于目标 Hermes endpoint。

## 7. 推荐介绍段

ATF 是面向 session 型 Agent 的可靠性控制面。它把任务责任和待处理义务保存在 session 外，在新任务或消息出现时通过 runtime adapter 唤醒 OpenClaw、Hermes 等 Agent，并验证执行结果是否正式回写。ATF 复用 A2A 进行外部互操作，不试图重新定义通用 Agent 通信协议。
