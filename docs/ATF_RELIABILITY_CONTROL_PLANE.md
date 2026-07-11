# ATF v2 Reliability Control Plane

本文是 v2 事件快路径、跨 session obligation、runtime adapter、A2A 和指标的运行说明。

## 运行模型

`assign / message / action / trigger` 写入 durable truth 时同步生成 `atf.event.v1`。常驻的 event dispatcher 以 250ms debounce 合并同一 agent 的事件，生成一个 `atf.work-envelope.v1` 并调用 Runtime Adapter v1。低频 control-plane 运行 verifier、重试漏投递并升级耗尽义务；空闲对账不会调用 runtime。

```bash
npm run atf:event-dispatcher
node workspace/bin/atf-control-plane.cjs --quiet-idle
```

v2 control-plane 默认不再运行旧 workspace launcher，避免它和事件快路径重复启动 session。只在兼容旧部署时显式追加 `--launcher`。

核心数据位于 `ATF_DATA_DIR`：

- `events/`：durable event 与 dispatch 状态
- `obligations/`：`atf.obligation.v1`
- `work-envelopes/`：每次 session 的最小上下文
- `runtime-dispatches/`：Runtime Adapter v1 payload
- `verifier-runs/`：确定性验证审计
- `a2a-mappings/`：A2A task 与 ATF task 映射
- `metrics/`：运行指标快照

## Agent Runtime

Registry 记录 workspace 与 runtime，task schema 不包含 runtime-specific 字段：

```bash
node atf-cli.js agent register f0x workspace=/path/to/f0x runtime=openclaw
node atf-cli.js agent register hermes-worker workspace=/path/to/workspace runtime=hermes
```

OpenClaw 可继续使用现有 `sessions_spawn` backend，或配置 `ATF_OPENCLAW_ADAPTER_CMD`。Hermes 使用官方 API Server 的 `POST /v1/runs`：

```bash
export ATF_HERMES_API_URL=http://127.0.0.1:8642
export ATF_HERMES_API_KEY=...
node atf-cli.js event dispatch
```

仓库 smoke 会用本地 HTTP canary 验证 Hermes Runs API 契约；部署到真实 Hermes 后应再次运行 `npm run atf:reliability:smoke` 或创建一个 `runtime=hermes` 的 canary task。ATF 不读取或修改 Hermes 内部数据库。

## Obligation 与 Verifier

assign 默认要求 task status write-back，message 默认要求 ack/reply，action 与 trigger 默认要求 task write-back。验证命令：

```bash
node atf-cli.js obligation list T-001
node atf-cli.js verify T-001
node atf-cli.js reconcile
```

未到期义务保持 `pending`；超时后生成 retry event；超过 `max_attempts` 后进入 `status=escalation_required`、`recovery_state=attention`。

## A2A Boundary

ATF 接受 A2A `SendMessage`/Task JSON，映射 Task status、Message 和 Artifact；DRI、obligation 与 verifier 放在 ATF extension metadata 内：

```bash
node atf-cli.js a2a inbound inbound.json
node atf-cli.js a2a outbound T-001
node atf-cli.js a2a push push-notification.json
```

A2A 只承担外部互操作，ATF 不复制第二套通用通信协议。

## Session Context Provider

该能力只读且可关闭。启用时只返回带 provenance 的短片段，并过滤常见 token/password/secret：

```bash
export ATF_SESSION_CONTEXT_PATHS=/path/to/sessions:/another/index
node atf-cli.js context search "task keywords"
```

不设置该变量时 Work Envelope 不包含历史 session 片段，主链行为不变。

## 指标

```bash
node atf-cli.js metrics
```

输出 event-to-dispatch p50/p95、session wake 数、重复事件数、未回写率、自动恢复数、升级数和按 runtime 的 dispatch 结果。指标用于判断哪些能力应继续保留，哪些应退化为 adapter/policy。

## 验证

```bash
npm test
npm audit --omit=dev
```

默认测试覆盖 Phase C、watcher、control-plane、Phase D 和 v2 reliability smoke，并在 Node 22/24 CI 运行。
