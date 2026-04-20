# ATF Action Layer (Phase D)

当前 `Phase D / 主动运营动作层` 的目标，不是再补一层新的任务协议，而是把已有的：

- `review backlog`
- `message thread`
- `reflection.what_needs_decision`

这些信号，推进成真正可执行、可审计、可批量消费的动作对象。

## 1. 当前定义

Phase D 新增正式协议对象：

- `atf.action.v1`

它是位于 `Focus / Trigger / Message / Reflection / Review` 之上的轻量运营层，负责：

1. 扫描已有协议对象
2. 生成去重后的动作记录
3. 把动作执行成 `message` 或 `pending_task`
4. 保留动作级审计和 inbox 视图

当前支持的动作类型：

- `stale_review_follow_up`
- `pending_reply_follow_up`
- `decision_follow_up`
- `launch_writeback_follow_up`
- `launch_resolution_follow_up`

## 2. 当前规则

### 2.1 stale review follow-up

当任务已经 `completed / delivered` 且超过阈值仍没有外部 review 时，生成动作：

- 默认阈值：`stale_days=4`
- 默认 owner：任务 `reviewee / assignee / dri`
- 推荐执行：催 review 或直接补一条非 self review

### 2.2 pending reply follow-up

当 `request / decision_request / blocker` 消息长时间未被响应时，生成动作：

- 默认阈值：`message_hours=12`
- 默认 owner：原消息 `to_agent`
- 推荐执行：回复、回执或推进 thread 闭环

### 2.3 decision follow-up

当存在 `reflection.what_needs_decision` 且长时间没有决策回写时，生成动作：

- 默认阈值：`decision_hours=6`
- 默认 owner：`dri / assigned_to / reflection.author`
- 推荐执行：给出决策，或明确切入 `blocked / decide`

## 3. CLI 入口

扫描动作：

```bash
node atf-cli.js action scan
node atf-cli.js action scan pinchymeow
node atf-cli.js action scan kind=stale_review_follow_up stale_days=7
node atf-cli.js action scan f0x kind=launch_writeback_follow_up writeback_minutes=30
node atf-cli.js action scan f0x kind=launch_resolution_follow_up resolution_hours=12
```

查看动作队列：

```bash
node atf-cli.js action list
node atf-cli.js action list status=pending
node atf-cli.js action inbox pinchymeow
```

执行动作：

```bash
node atf-cli.js action execute-pending pinchymeow mode=message
node atf-cli.js action execute-pending f0x mode=pending_task
node atf-cli.js action execute T-001 ACT-xxx mode=noop
```

## 4. 执行模式

当前支持 3 种动作执行模式：

标准术语：`action pending_task -> <agentWorkspace>/pending-task.json`。这与 trigger 层默认落在 `<taskDir>/pending-task.json` 的 `pending_task` 是两条不同链路。

- `message`
  - 生成一条 `atf.message.v1`
  - `from_agent=adapter-action`
  - 写回任务 thread，可继续走回执闭环
- `pending_task`
  - 向目标 agent workspace 写入 `pending-task.json`
  - 适合直接变成 agent 的下一步操作
- `noop`
  - 只把动作记为 skipped
  - 适合 dry-run / 巡检演练

## 5. 全局索引

Phase D 新增两个 watcher / cron 友好的全局索引：

- `ATF_DATA_DIR/pending-actions.json`
- `ATF_DATA_DIR/action-inboxes/<agent>.json`

其中：

- `pending-actions.json`
  - 全局 pending action 汇总
- `action-inboxes/<agent>.json`
  - 单 agent 待执行动作 inbox

## 6. Action Watcher

仓库内新增：

- `workspace/bin/atf-action-watcher.cjs`

它的最小链路是：

1. `node atf-cli.js action scan`
2. 读取 `pending-actions.json / action-inboxes/<agent>.json`
3. `node atf-cli.js action execute-pending`

推荐用法：

```bash
node workspace/bin/atf-action-watcher.cjs --help
node workspace/bin/atf-action-watcher.cjs --agent pinchymeow --mode message
node workspace/bin/atf-action-watcher.cjs --agent pinchymeow --mode message --to huntmind --thread THR-release
node workspace/bin/atf-action-watcher.cjs --agent f0x --mode pending_task
```

当前 watcher 额外支持几条适合生产环境测试的护栏：

- `--min-confidence <0-1>`
  - 只执行置信度达到阈值的动作
- `--max-risk <low|medium|high|urgent>`
  - 只执行风险等级不高于阈值的动作
- 默认 `registeredOnly=true`
  - owner agent 没在环境变量或 `agents.json` 里注册时，不会执行
- 默认不执行 `requires_confirmation=true` 的动作
- `--dry-run --json`
  - 直接输出这轮会执行哪些动作、哪些会被过滤、过滤原因是什么
- `--to <agent>` / `--thread <id>`
  - 在 `message` 模式下显式覆盖目标 agent 或 thread id

推荐的生产测试顺序：

```bash
node atf-cli.js agent audit
node workspace/bin/atf-action-watcher.cjs --dry-run --json --min-confidence 0.9
node workspace/bin/atf-action-watcher.cjs --agent pinchymeow --mode message --min-confidence 0.9 --limit 5
node workspace/bin/atf-action-watcher.cjs --agent f0x --mode pending_task --min-confidence 0.9 --limit 5
```

每次 watcher 运行还会把 summary 落到：

- `data/action-watcher-runs/<runId>.json`
- `data/action-watcher-runs/latest.json`

对应的只读查询入口：

```bash
node atf-cli.js action runs limit=10
node atf-cli.js action runs pinchymeow status=completed limit=5
node atf-cli.js action run-show latest
node atf-cli.js action watcher-status
node atf-cli.js action watcher-status pinchymeow warn_after_minutes=20
```

`watcher-status` 会把三类信息压成一个小摘要：

- 最近一次 watcher run 是否存在、是否失败、距离现在多久
- 最近 N 次 run 的 completed / failed 数
- 当前 pending action backlog 总量，以及按 agent / kind 的分布

如果 dry-run 里出现：

- `below_confidence`
- `risk_exceeds_max`
- `unregistered_owner`
- `requires_confirmation`

说明 watcher 正在用护栏过滤动作，而不是盲目 dispatch。

此外，Phase D 现在不再把同一信号“催一次就永久静默”：

- 每条 action 会记录 `attempt / reissue_of / cooldown_hours`
- 如果同一条 `message / reflection / review backlog` 信号仍未闭环，且上一条动作已过冷却窗口
- 下一次 `action scan` 会重新生成 follow-up，形成 `attempt=2/3/...`

## 7. 当前边界

当前 Phase D 仍是最小可用版本，不等于完整运营平台：

- 还没有 reviewer 身份治理
- 还没有预算、结算、激励绑定
- 还没有复杂的多级审批流
- 还没有常驻实时 runtime

当前版本优先解决的是：

**把已有的 backlog / blocker / decision 信号推进成真正的主动动作闭环。**

## 8. Harness 控制补强

为了避免 Phase D 变成“见到 pending 就盲发提醒”，当前 `atf.action.v1` 已补上一层轻量 harness 控制字段：

- `confidence`
  - 表示当前规则判断这条动作值得执行的置信度
- `policy`
  - 当前包含 `risk_level / reversible / requires_confirmation / verification_mode / recovery_plan`
- `evidence`
  - 把扫描时看到的信号来源和摘要显式附在动作上，而不是只留一条 `summary`
- `verification`
  - 记录最近一次执行的 `preflight / postflight`

当前执行链路变成：

1. `action scan` 产生候选动作，同时写入 `confidence / policy / evidence`
2. `action execute / execute-pending` 先跑 `preflight`
3. 只有源信号仍成立时，才继续执行 `message / pending_task / noop`
4. 执行后再跑 `postflight`，确认消息或 `pending-task.json` 真的落下

一个典型例子是：

- 扫描时发现某条 `request` 长时间未回复，于是生成 `pending_reply_follow_up`
- 但在 watcher 真正执行前，线程里已经有人回了
- 此时 `preflight` 会把动作安全标记为 `skipped`
- watcher 不会再误发 follow-up

这轮补强的目标不是把 ATF 做成一套厚重平台，而是先把最值钱的效果控制补上：

- 有证据
- 有置信度
- 有执行前确认
- 有执行后确认
