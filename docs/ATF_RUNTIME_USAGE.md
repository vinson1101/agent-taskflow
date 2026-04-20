# ATF 调用说明

这份文档只说明一件事：

如何实际调用当前版本的 ATF CLI，尤其是任务、消息、Trigger、Reflection 这几层。

## 1. 环境变量

ATF 现在支持通过环境变量改写路径，不再强依赖 `/root/.openclaw/...`。

常用变量：

- `ATF_TASKS_DIR`
  任务仓库目录，默认 `/root/.openclaw/atf-tasks`
- `ATF_WORKSPACE_DIR`
  OpenClaw workspace 根目录，默认 `/root/.openclaw/workspace`
- `ATF_DATA_DIR`
  ATF 数据目录，默认 `$ATF_WORKSPACE_DIR/agent-taskflow/data`
- `ATF_PENDING_DECISIONS_MD`
  `block` 写入的 markdown 决策文件
- `ATF_PENDING_DECISIONS_JSON`
  `block/decide` 写入的 JSON 决策文件
- `ATF_LEARNINGS_PROMOTE_SCRIPT`
  `learnings promote` 调用的脚本路径
- `ATF_DEFAULT_AGENT_WORKSPACE`
  默认 agent workspace
- `ATF_WORKSPACE_<AGENT>`
  任意 agent 的 workspace；设置后会自动进入注册集，例如 `ATF_WORKSPACE_HUNTMIND`

Agent 注册前提：

- 当前默认不再内置 `f0x` / `pinchymeow`
- 如果你要直接照抄下面这些带 agent 名字的示例，先确保 agent 已经来自环境变量、`data/agents.json` 或 `agent register`

例如：

```bash
node atf-cli.js agent list
node atf-cli.js agent register f0x workspace=/root/.openclaw/workspace
node atf-cli.js agent register pinchymeow workspace=/root/.openclaw/workspace-pinchymeow
```

本地测试示例：

```powershell
$env:ATF_TASKS_DIR = "D:\\tmp\\atf\\tasks"
$env:ATF_WORKSPACE_DIR = "D:\\tmp\\atf\\workspace"
$env:ATF_DATA_DIR = "D:\\tmp\\atf\\data"
node atf-cli.js list
```

## 2. 基础任务流

创建任务：

```bash
node atf-cli.js create "实现 trigger runtime"
node atf-cli.js create "给 F0x 的长轮询任务" --confirm-timeout=45m --final-timeout=4h
```

查看任务：

```bash
node atf-cli.js list
node atf-cli.js status T-001
node atf-cli.js ctx T-001
```

指派与更新：

```bash
node atf-cli.js assign T-001 f0x
node atf-cli.js assign T-001 f0x --confirm-timeout=45m --final-timeout=4h
node atf-cli.js update T-001 executing
node atf-cli.js update T-001 completed
```

DLQ 处理：

```bash
node atf-cli.js dlq list
node atf-cli.js dlq show T-001
node atf-cli.js dlq retry T-001
node atf-cli.js dlq skip T-001
node atf-cli.js dlq cancel T-001
```

## 3. 任务内消息

发送消息：

```bash
node atf-cli.js msg send T-001 pinchymeow f0x request 请确认触发器策略
```

带 `focus/thread/reply` 的消息：

```bash
node atf-cli.js msg send T-001 pinchymeow f0x info 补充上下文 focus=FOC-xxx
node atf-cli.js msg send T-001 f0x pinchymeow blocker 需要决策 thread=focus:FOC-xxx
node atf-cli.js msg send T-001 pinchymeow f0x decision_reply 同意 reply=MSG-xxx
```

收件箱与线程：

```bash
node atf-cli.js msg inbox f0x
node atf-cli.js msg inbox f0x T-001
node atf-cli.js msg thread T-001
node atf-cli.js msg thread T-001 focus=FOC-xxx
node atf-cli.js msg threads T-001
node atf-cli.js msg threads T-001 focus=FOC-xxx
node atf-cli.js msg threads T-001 agent=f0x
```

回执：

```bash
node atf-cli.js msg ack T-001 MSG-xxx f0x seen
node atf-cli.js msg ack T-001 MSG-xxx f0x acked 已收到
node atf-cli.js msg receipts T-001 MSG-xxx
```

## 4. Focus

创建和更新：

```bash
node atf-cli.js focus add T-001 pinchymeow 先把 trigger runtime 打通
node atf-cli.js focus list T-001
node atf-cli.js focus show T-001 FOC-xxx
node atf-cli.js focus update T-001 FOC-xxx in_progress
node atf-cli.js focus update T-001 FOC-xxx done 完成最小扫描链路
```

说明：

- `focus done` 或 `focus dropped` 会自动归档关联的 active triggers

## 5. Trigger

### 5.1 创建 Trigger

`interval` 示例：

```bash
node atf-cli.js trigger add T-001 f0x interval 5m
node atf-cli.js trigger add T-001 f0x interval every:30m focus=FOC-xxx
node atf-cli.js trigger add T-001 f0x interval 30m thread=room:design intent=follow_up note=check-in
```

`cron` 示例：

```bash
node atf-cli.js trigger add T-001 pinchymeow cron daily@23:30
node atf-cli.js trigger add T-001 pinchymeow cron weekly@mon@23:30
node atf-cli.js trigger add T-001 pinchymeow cron hourly@15
node atf-cli.js trigger add T-001 pinchymeow cron "cron:*/10 * * * *"
node atf-cli.js trigger add T-001 pinchymeow cron daily@23:00 thread=room:design intent=review note=nightly-review
```

事件型 Trigger：

```bash
node atf-cli.js trigger add T-001 f0x on_message watch focus=FOC-xxx
node atf-cli.js trigger add T-001 pinchymeow on_status_change watch
node atf-cli.js trigger add T-001 pinchymeow on_blocked watch
```

`follow-up / review` 快捷入口：

```bash
node atf-cli.js trigger follow-up T-001 f0x 30m focus=FOC-xxx note=follow-up-check
node atf-cli.js trigger review T-001 pinchymeow daily@23:00 thread=room:design note=nightly-review
```

### 5.2 查看 Trigger

```bash
node atf-cli.js trigger list T-001
node atf-cli.js trigger list T-001 f0x
node atf-cli.js trigger show T-001 TRG-xxx
node atf-cli.js trigger due T-001
node atf-cli.js trigger due T-001 pinchymeow at=2026-04-19T23:31:00+08:00
```

### 5.3 扫描和触发

扫描单任务：

```bash
node atf-cli.js trigger scan T-001
node atf-cli.js trigger scan T-001 pinchymeow
node atf-cli.js trigger scan T-001 at=2026-04-19T23:31:00+08:00
```

扫描全部任务：

```bash
node atf-cli.js trigger scan-all
node atf-cli.js trigger scan-all f0x
node atf-cli.js trigger scan-all at=2026-04-19T23:31:00+08:00
```

手动记一次 firing：

```bash
node atf-cli.js trigger fire T-001 TRG-xxx manual ref=test 手动触发
```

### 5.4 消费 firing

查看 firing：

```bash
node atf-cli.js trigger fires T-001
node atf-cli.js trigger fires T-001 TRG-xxx
node atf-cli.js trigger fires T-001 pending
```

Agent 收件箱：

```bash
node atf-cli.js trigger inbox f0x
node atf-cli.js trigger inbox f0x T-001
```

执行 pending fire：

```bash
node atf-cli.js trigger execute T-001 TGF-xxx
node atf-cli.js trigger execute T-001 TGF-xxx executor=watcher-v1 mode=pending_task
node atf-cli.js trigger execute T-001 TGF-xxx executor=adapter-message mode=message
node atf-cli.js trigger execute T-001 TGF-xxx executor=adapter-room mode=room room=design
node atf-cli.js trigger execute-pending
node atf-cli.js trigger execute-pending f0x
node atf-cli.js trigger execute-pending f0x executor=watcher-v1 limit=10
node atf-cli.js trigger execute-pending f0x executor=adapter-message mode=message
node atf-cli.js trigger execute-pending pinchymeow executor=adapter-room mode=room room=design
node atf-cli.js trigger executions T-001
node atf-cli.js trigger executions T-001 TGF-xxx
```

Adapter 说明：

- `pending_task`
  默认模式，生成 `pending-task.json`
- `message`
  生成任务内 `handoff` 消息，默认投给 `owner_agent`
- `room`
  生成 `room:<name>` 线程消息，适合 review / 多人可见场景
- `noop`
  只写 execution record，不做实际投递

额外参数：

- `to=agent`
  覆盖 `message` 模式的目标 agent
- `thread=x`
  覆盖目标线程
- `room=x`
  显式指定 room，等价于 `thread=room:x`

显式 handoff：

- `pending_task`、`message`、`room` 三种模式都会生成 `handoff`
- handoff 内包含任务描述、focus、trigger/fire 元数据、shared-context、最近线程消息、reflection 摘要
- specialist / adapter 不再假设共享上下文，而是拿显式 handoff

失败模型：

- `dispatched`
  已成功投递并结算 fire
- `skipped`
  参数不足或策略拒绝执行，fire 保持 `pending`
- `failed`
  adapter 执行失败，fire 保持 `pending`

示例：

```bash
node atf-cli.js trigger execute-pending f0x executor=adapter-message mode=message
node atf-cli.js trigger execute-pending pinchymeow executor=adapter-room mode=room room=design
node atf-cli.js trigger execute-pending f0x executor=adapter-skip mode=room
```

最后一个例子会得到 `skipped`，因为它没有提供 `room=<name>`，同时 fire 不会被误消费。

消费或忽略：

```bash
node atf-cli.js trigger consume T-001 TGF-xxx f0x 已执行
node atf-cli.js trigger ignore T-001 TGF-xxx pinchymeow 暂不处理
```

重建全局索引：

```bash
node atf-cli.js trigger rebuild-index
```

## 6. Reflection

直接添加：

```bash
node atf-cli.js reflect add T-001 pinchymeow what_changed 已接通 trigger runtime
node atf-cli.js reflect add T-001 pinchymeow what_failed cron 表达式不完整 trigger=TRG-xxx
node atf-cli.js reflect add T-001 pinchymeow what_needs_decision 需要决定扫描频率 fire=TGF-xxx
```

从 firing 创建：

```bash
node atf-cli.js reflect from-fire T-001 TGF-xxx pinchymeow what_changed 这次触发有效
```

查看：

```bash
node atf-cli.js reflect list T-001
node atf-cli.js reflect list T-001 what_failed
node atf-cli.js reflect list T-001 focus=FOC-xxx
node atf-cli.js reflect list T-001 trigger=TRG-xxx
node atf-cli.js reflect list T-001 fire=TGF-xxx
node atf-cli.js reflect list T-001 author=pinchymeow
node atf-cli.js reflect summary T-001
node atf-cli.js reflect summary T-001 focus=FOC-xxx
node atf-cli.js reflect show T-001 RFL-xxx
```

## 6.1 shared-context 结构化绑定

追加 shared context：

```bash
node atf-cli.js shared add T-001 pinchymeow context 补充设计背景 focus=FOC-xxx
node atf-cli.js shared add T-001 pinchymeow decision 同意 nightly review thread=room:design tag=decision
node atf-cli.js shared add T-001 f0x intel 观察到消息触发频率偏高 tags=trigger,review
```

按维度过滤：

```bash
node atf-cli.js shared list T-001
node atf-cli.js shared list T-001 decision
node atf-cli.js shared list T-001 focus=FOC-xxx
node atf-cli.js shared list T-001 thread=room:design
node atf-cli.js shared list T-001 author=pinchymeow
node atf-cli.js shared list T-001 tag=review
```

## 6.2 Review 与 Reputation

这一组命令当前更适合 `claw army` 内部协作场景。

它们的目标是：

- 补 review 闭环
- 统计任务完成度
- 统计内部反馈质量
- 形成内部可读画像

它们当前不是：

- 公开市场信誉系统
- 身份认证系统
- 激励 / 结算系统

设置任务画像：

```bash
node atf-cli.js create 修 watcher timeout type=bugfix difficulty=4 priority=high tags=watcher,ops
node atf-cli.js profile T-001
node atf-cli.js profile set T-001 type=research difficulty=2 priority=normal tags=analysis
```

写入 Review：

```bash
node atf-cli.js review add T-001 pinchymeow f0x approved 这次交付边界清楚且可直接合入 type=delivery overall=4.5 quality=5 timeliness=4 communication=4.5 ownership=4.5
node atf-cli.js review add T-001 pinchymeow f0x needs_revision 结果可用但需要补回执链路 focus=FOC-xxx type=collaboration communication=3 ownership=3.5 timeliness=4
node atf-cli.js review add T-001 pinchymeow f0x approved review-trigger 有效闭环 fire=TGF-xxx trigger=TRG-xxx type=task overall=4
```

查看任务 Reviews：

```bash
node atf-cli.js review list T-001
node atf-cli.js review list T-001 f0x
node atf-cli.js review list T-001 reviewer=pinchymeow
node atf-cli.js review list T-001 type=delivery
node atf-cli.js review list T-001 outcome=approved
node atf-cli.js review pending
node atf-cli.js review pending f0x
node atf-cli.js review pending type=research status=completed limit=5
node atf-cli.js review pending status=completed min_age=4 limit=20
node atf-cli.js review backlog
node atf-cli.js review backlog f0x min_age=4 top=10
node atf-cli.js agent list
node atf-cli.js agent audit
node atf-cli.js agent register huntmind workspace=/root/.openclaw/workspace-huntmind
node atf-cli.js agent remap fake-no-such-agent f0x
node atf-cli.js agent remap fake-no-such-agent f0x apply=true
node atf-cli.js review show T-001 REV-xxx
```

重建 reputation / scores：

```bash
node atf-cli.js reputation rebuild
node atf-cli.js reputation list
node atf-cli.js reputation show f0x
```

重建内部 credits 账本：

```bash
node atf-cli.js credits rebuild
node atf-cli.js credits list
node atf-cli.js credits show f0x
```

直接看内部统计：

```bash
node atf-cli.js stats summary
node atf-cli.js stats agents
node atf-cli.js stats digest
node atf-cli.js stats digest days=1 stale_days=4 top=5
node atf-cli.js stats recent
node atf-cli.js stats recent days=1 agent=f0x limit=10
node atf-cli.js stats stale
node atf-cli.js stats stale days=4 agent=f0x status=completed top=10
node atf-cli.js stats tasks
node atf-cli.js stats tasks type=research review=pending limit=5
node atf-cli.js stats tasks review=pending min_age=4 limit=20
node atf-cli.js stats reviews
node atf-cli.js stats reviews min_age=4
node atf-cli.js stats reviews agent=f0x status=completed top=10
node atf-cli.js stats types
node atf-cli.js stats show f0x
```

跑一轮 Phase C Lite 自测：

```bash
npm run atf:phasec:smoke
node workspace/bin/atf-phasec-smoke.cjs --cleanup
```

默认会把测试数据留在仓库下的 `.tmp-atf-phasec-smoke/`，方便直接检查 `tasks/` 和 `data/` 产物。

跑一轮 Phase D 主动运营动作层自测：

```bash
npm run atf:phased:smoke
node workspace/bin/atf-phased-smoke.cjs --cleanup
```

当前 Phase D 最小入口：

```bash
node atf-cli.js action scan
node atf-cli.js action scan pinchymeow
node atf-cli.js action list status=pending
node atf-cli.js action inbox pinchymeow
node atf-cli.js action execute-pending pinchymeow mode=message
node atf-cli.js action execute-pending f0x mode=pending_task
node workspace/bin/atf-action-watcher.cjs --agent pinchymeow --mode message
node workspace/bin/atf-action-watcher.cjs --agent f0x --mode pending_task
```

推荐的生产环境测试入口：

```bash
node atf-cli.js agent audit
node workspace/bin/atf-action-watcher.cjs --dry-run --json --min-confidence 0.9
node workspace/bin/atf-action-watcher.cjs --agent pinchymeow --mode message --min-confidence 0.9 --limit 5
node workspace/bin/atf-action-watcher.cjs --agent f0x --mode pending_task --min-confidence 0.9 --limit 5
```

每次 watcher 运行会写一份审计摘要到：

- `data/action-watcher-runs/<runId>.json`
- `data/action-watcher-runs/latest.json`

回看入口：

```bash
node atf-cli.js action runs limit=10
node atf-cli.js action runs f0x status=completed limit=5
node atf-cli.js action run-show latest
node atf-cli.js action watcher-status
node atf-cli.js action watcher-status f0x warn_after_minutes=20
```

其中 `watcher-status` 适合直接接生产巡检：

- `status=ok|stale|failed|never_run`
- `latest_run` 会给出最近一次 run 的 age
- `pending_actions` 会显示当前 backlog 总量和按 agent / kind 的分布

这轮 action watcher 默认带的护栏是：

- 只执行已注册 agent 的动作 owner
- 默认 `max_risk=medium`
- 支持 `--min-confidence`
- 默认不执行 `requires_confirmation=true` 的动作
- `--dry-run --json` 会明确列出 `below_confidence / risk_exceeds_max / unregistered_owner / requires_confirmation`

统一 launcher 的最小入口：

```bash
node atf-cli.js launch scan
node atf-cli.js launch scan huntmind cooldown_minutes=15
node atf-cli.js launch list status=pending
node atf-cli.js launch inbox huntmind
node atf-cli.js launch show LCH-xxxxxxxx-xxxx
node atf-cli.js launch dispatch-pending huntmind mode=noop dispatcher=host-launcher
node atf-cli.js launch dispatch-pending huntmind mode=sessions_spawn dispatcher=host-launcher
node workspace/bin/atf-launcher.cjs --agent huntmind --mode noop
node workspace/bin/atf-launcher.cjs --agent huntmind --mode sessions_spawn
node workspace/bin/atf-launcher.cjs --dry-run --json
```

当前 launcher 的定位是：

- 读取 agent workspace 里的 `pending-task.json`
- 生成去重、带 cooldown / lease 的 `atf.launch-request.v1`
- 由控制平面统一 dispatch，而不是让 cron 直接硬绑到外部 `sessions_spawn`

统一控制面的正式入口：

```bash
npm run atf:control-plane -- --quiet-idle
npm run atf:control-plane:dry -- --json
node workspace/bin/atf-control-plane.cjs --quiet-idle
node workspace/bin/atf-control-plane.cjs --agent huntmind --json
```

这个 wrapper 会顺序串起：

1. `atf-watcher.cjs`
2. `atf-action-watcher.cjs`
3. `atf-launcher.cjs`

推荐部署形态：

1. 一条低频 control-plane cron 常驻
2. 一条 Task-Watcher / timeout watcher 常驻
3. Task-Watcher 发现真实变化时，额外补打一枪 one-shot control-plane
4. 不再保留 per-agent `sessions_spawn` cron

当前支持的 dispatch mode：

- `manual`
- `noop`
- `sessions_spawn`

其中 `sessions_spawn` 通过环境变量 `ATF_LAUNCH_SESSIONS_SPAWN_CMD` 调一个外部 bridge command。ATF 自己不假设 OpenClaw / Codex / 任何特定 session runtime，只保证：

- dispatch 前把 launch request 写成标准 payload
- 把 `ATF_LAUNCH_*` 环境变量传给 bridge command
- 成功时置 `lease`
- 失败时把 request 标成 `failed` 并留下 stderr / command artifact

bridge command 最少可以这样接：

```bash
export ATF_LAUNCH_SESSIONS_SPAWN_CMD='node /root/.openclaw/workspace/agent-taskflow/workspace/bin/sessions-spawn-bridge.cjs'
export ATF_SESSIONS_SPAWN_BACKEND_MODULE='/root/.openclaw/workspace/agent-taskflow/workspace/bin/real-sessions-spawn-backend.cjs'
export ATF_REAL_SESSIONS_SPAWN_MODE='stub'
node workspace/bin/atf-launcher.cjs --mode sessions_spawn --dispatcher host-launcher
```

bridge 会收到：

- `ATF_LAUNCH_PAYLOAD_PATH`
- `ATF_LAUNCH_ID`
- `ATF_LAUNCH_AGENT`
- `ATF_LAUNCH_WORKSPACE`
- `ATF_LAUNCH_TASK_ID`
- `ATF_LAUNCH_ACTION_ID`
- `ATF_LAUNCH_GUIDANCE`

repo 内置 bridge 还会补：

- `ATF_LAUNCH_PROMPT`
- `ATF_LAUNCH_PROMPT_PATH`

repo 内 backend 还支持：

- `ATF_REAL_SESSIONS_SPAWN_MODE=stub`
- `ATF_REAL_SESSIONS_SPAWN_CMD`
- `ATF_REAL_SESSIONS_SPAWN_MODULE`

也就是推荐分两步：

1. 先用 repo 内 backend + `stub` 验证 launcher 真 dispatch 到 sessions_spawn adapter
2. 再把 repo 内 backend 接到你真实的 runtime command / module

推荐优先走 `ATF_REAL_SESSIONS_SPAWN_MODULE`。repo 内 backend 现在会把真实 backend 返回的 `session_key / agent / task_id / action_id` 提到结果顶层，后续看审计更直接。

worker 侧要遵守一个硬约束：

1. 被唤醒后先处理目标 workspace 里的 `pending-task.json`
2. 处理完成后，必须回写到 ATF
3. 仅写日志、stdout 或本地说明，不算完成
4. ATF 回写成功后，再删除已消费的 `pending-task.json`

对 `stale_review_follow_up`，bridge prompt 现在分两种情况：

1. 如果被唤醒的是 reviewee 自己，明确禁止 self review，并要求通过 ATF 发起外部 review 跟进
2. 只有外部 reviewer 场景，才会建议 `atf review add ...`

这点很重要，因为 self review 不会关闭 stale review backlog。

真实 runtime 模板已经放在：

```bash
workspace/bin/real-sessions-spawn-runtime-template.cjs
```

最小 canary 切换：

```bash
cp workspace/bin/real-sessions-spawn-runtime-template.cjs /root/.openclaw/workspace/host/bin/real-sessions-spawn-runtime.cjs
# 编辑上面的文件，实现 spawnRuntimeSession()

export ATF_LAUNCH_SESSIONS_SPAWN_CMD='node /root/.openclaw/workspace/agent-taskflow/workspace/bin/sessions-spawn-bridge.cjs'
export ATF_SESSIONS_SPAWN_BACKEND_MODULE='/root/.openclaw/workspace/agent-taskflow/workspace/bin/real-sessions-spawn-backend.cjs'
export ATF_REAL_SESSIONS_SPAWN_MODULE='/root/.openclaw/workspace/host/bin/real-sessions-spawn-runtime.cjs'

node atf-cli.js launch scan huntmind cooldown_minutes=0
node workspace/bin/atf-launcher.cjs --agent huntmind --mode sessions_spawn --dispatcher host-launcher --limit 1 --lease-minutes 5
```

bridge 至少要求配置一个 backend：

- `ATF_SESSIONS_SPAWN_BACKEND_CMD`
- `ATF_SESSIONS_SPAWN_BACKEND_MODULE`

运行审计与健康检查入口：

```bash
node atf-cli.js launch runs limit=10
node atf-cli.js launch run-show latest
node atf-cli.js launch launcher-status
node atf-cli.js launch status
node atf-cli.js launch status huntmind json
```

其中：

- `launch status` 看 queue 本身有没有 `pending / leased / archived`
- `launch launcher-status` 看 launcher wrapper 最近有没有真的跑过、最近 run 是不是 stale / failed

默认根目录现在按平台走：

- Linux / WSL：`/root/.openclaw`
- Windows：`%USERPROFILE%\\.openclaw`

用内部画像做辅助参考：

```bash
node atf-cli.js assign recommend T-001
node atf-cli.js assign recommend T-001 top=5
```

这组命令只是辅助参考，不应该替代当前固定分工。

说明：

- `review` 当前支持 `task / delivery / collaboration`
- `outcome` 当前支持 `approved / needs_revision / rejected`
- `scores.json` 会汇总任务、消息、回执、反思和 review
- `overall_score` 是可重建的简化画像，不是最终市场信誉分
- `credits.json` 现在同时聚合“完成度积分 + 反馈积分”，不是预算、结算或 payout 系统
- `task_profile` 当前只做内部任务画像，支持 `type / difficulty / priority / tags`
- `status` 会直接显示任务画像、review 摘要，以及 assignee 的 reputation / credits 摘要
- `stats` 是更直接的内部统计入口，优先服务完成度和反馈查看
- `stats digest` 会把最近窗口、review 覆盖率和 stale backlog 压成一条巡检摘要，适合日常 first look
- `stats recent` 用于看最近 1 天或最近 N 天的任务活动窗口，可按 agent / type / status / review 过滤
- `stats stale` 用于直接切出 4 天以上的 pending review backlog，默认按最老任务优先展示
- `stats tasks` 用于直接看任务级完成度、反馈状态和完成度积分
- `stats tasks` 支持 `min_age=` / `max_age=`，可直接筛出 stale review backlog
- `stats reviews` 用于看外部 review 覆盖率，以及待评价 backlog 在 agent / type / status / age 上的分布
- `stats reviews` 支持 `min_age=` / `max_age=`，可直接聚焦 4 天以上的 stale backlog
- 自评会保留为 `self_review` 记录，但不会消除 pending backlog，也不会计入外部 review coverage
- `stats summary` 现在会直接给出 `stale_pending_reviews`，默认口径是 `age >= 4d`
- `stats summary` 会直接显示 `oldest_pending_age`，方便巡检时先看最老 backlog
- `stats types` 用于按 `task_profile.type` 看完成度、反馈和待评价积压
- `assign` 会在指派时直接显示目标 agent 的 reputation / credits 摘要
- `assign recommend` 仍然只是辅助参考，不应该替代当前固定分工
- `review pending` 用于找出 `completed / delivered` 但还没有形成 `task / delivery review` 的任务
- `review pending` 支持 `type=` / `status=` / `limit=` 过滤，并直接显示 `age=Xd`
- `review pending` 支持 `min_age=` / `max_age=`，便于只看 4 天以上或最近 1 天内的 backlog
- `review backlog` 会把 pending reviews 直接按 agent / type / age 汇总，并列出最该清的 backlog 任务
- `action scan` 会把 `stale review / 未响应消息 / what_needs_decision reflection` 推进成去重后的 `atf.action.v1`
- `atf.action.v1` 现在会带 `confidence / policy / evidence / verification`，便于 watcher / cron 做更稳的执行控制
- `atf.action.v1` 还会带 `attempt / reissue_of / cooldown_hours`，便于同一信号在冷却后继续 follow-up，而不是第一次催完就永久静默
- `action execute-pending` 当前支持 `message / pending_task / noop` 三种执行模式
- `action execute / execute-pending` 会先做 `preflight`，确认源信号仍成立，再做 `postflight` 检查产物是否真的写入
- 如果消息或决策信号在执行前已经被人闭环，对应 action 会被安全标记为 `skipped`，不会继续误发 follow-up
- `pending-actions.json` 和 `action-inboxes/<agent>.json` 是 Phase D 对 watcher / cron 最友好的消费入口
- `pending-launch-requests.json` 和 `launch-inboxes/<agent>.json` 是统一 launcher queue 的消费入口
- `agent audit` 会列出未知 agent / 脏 agent 的来源，帮助定位历史数据污染
- `agent register` 用于在服务器上补齐注册来源，不需要手改 `data/agents.json`
- `agent remap` 默认是 dry-run，只有加 `apply=true` 才会真正写回并重建索引
- 当前默认不再内置 `f0x` / `pinchymeow`；agent 来源统一走环境变量、`agents.json` 或 `agent register`
- 更重的身份、激励、结算设计会放到未来商用化阶段

## 7. 全局索引

当前 watcher / cron 最值得直接消费的是这两个文件：

- `ATF_DATA_DIR/pending-trigger-fires.json`
- `ATF_DATA_DIR/trigger-inboxes/<agent>.json`
- `ATF_DATA_DIR/pending-actions.json`
- `ATF_DATA_DIR/action-inboxes/<agent>.json`
- `ATF_DATA_DIR/pending-launch-requests.json`
- `ATF_DATA_DIR/launch-inboxes/<agent>.json`
- `ATF_DATA_DIR/scores.json`

其中：

- `pending-trigger-fires.json`
  全局 pending fires 汇总
- `trigger-inboxes/<agent>.json`
  单 agent 待处理 fires 汇总
- `pending-actions.json`
  全局 pending actions 汇总
- `action-inboxes/<agent>.json`
  单 agent 待执行动作 inbox
- `pending-launch-requests.json`
  全局 pending launch request 汇总
- `launch-inboxes/<agent>.json`
  单 agent 待 dispatch 的 launch request inbox
- `scores.json`
  当前可重建的 agent reputation 索引

推荐 watcher 最小工作流：

1. 定时执行 `node atf-cli.js trigger scan-all`
2. 读取 `pending-trigger-fires.json` 或某个 agent inbox
3. Agent 执行后调用 `trigger consume` 或 `trigger ignore`
4. 需要沉淀经验时调用 `reflect from-fire`

## 8. 自动联动

这些动作会自动产生日志或 firing：

- `update`
  会触发 task 级 `on_status_change`
- `update ... blocked`
  会额外触发 task 级 `on_blocked`
- `focus update`
  会触发 focus 级 `on_status_change`
- `focus update ... blocked`
  会额外触发 focus 级 `on_blocked`
- `msg send`
  会触发目标 agent 的 `on_message`

## 9. 当前边界

现在已经能用，但边界也明确：

- 不是实时消息系统
- 主要依赖 cron / heartbeat
- `trigger scan / scan-all` 是最小执行入口，不是完整执行引擎
- 目前更适合同机、共享 gateway 的多 agent 异步协作
