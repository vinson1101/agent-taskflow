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
- `ATF_WORKSPACE_F0X`
  `f0x` 的 workspace
- `ATF_WORKSPACE_PINCHYMEOW`
  `pinchymeow` 的 workspace

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
node atf-cli.js stats show f0x
```

跑一轮 Phase C Lite 自测：

```bash
npm run atf:phasec:smoke
node workspace/bin/atf-phasec-smoke.cjs --cleanup
```

默认会把测试数据留在仓库下的 `.tmp-atf-phasec-smoke/`，方便直接检查 `tasks/` 和 `data/` 产物。

用内部画像做辅助参考：

```bash
node atf-cli.js assign recommend T-001
node atf-cli.js assign recommend T-001 top=5
```

说明：

- `review` 当前支持 `task / delivery / collaboration`
- `outcome` 当前支持 `approved / needs_revision / rejected`
- `scores.json` 会汇总任务、消息、回执、反思和 review
- `overall_score` 是可重建的简化画像，不是最终市场信誉分
- `credits.json` 现在同时聚合“完成度积分 + 反馈积分”，不是预算、结算或 payout 系统
- `task_profile` 当前只做内部任务画像，支持 `type / difficulty / priority / tags`
- `status` 会直接显示任务画像、review 摘要，以及 assignee 的 reputation / credits 摘要
- `stats` 是更直接的内部统计入口，优先服务完成度和反馈查看
- `assign` 会在指派时直接显示目标 agent 的 reputation / credits 摘要
- `assign recommend` 仍然只是辅助参考，不应该替代当前固定分工
- `review pending` 用于找出 `completed / delivered` 但还没有形成 `task / delivery review` 的任务
- 更重的身份、激励、结算设计会放到未来商用化阶段

## 7. 全局索引

当前 watcher / cron 最值得直接消费的是这两个文件：

- `ATF_DATA_DIR/pending-trigger-fires.json`
- `ATF_DATA_DIR/trigger-inboxes/<agent>.json`
- `ATF_DATA_DIR/scores.json`

其中：

- `pending-trigger-fires.json`
  全局 pending fires 汇总
- `trigger-inboxes/<agent>.json`
  单 agent 待处理 fires 汇总
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
