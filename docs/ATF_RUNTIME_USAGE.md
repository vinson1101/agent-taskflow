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
```

`cron` 示例：

```bash
node atf-cli.js trigger add T-001 pinchymeow cron daily@23:30
node atf-cli.js trigger add T-001 pinchymeow cron weekly@mon@23:30
node atf-cli.js trigger add T-001 pinchymeow cron hourly@15
node atf-cli.js trigger add T-001 pinchymeow cron "cron:*/10 * * * *"
```

事件型 Trigger：

```bash
node atf-cli.js trigger add T-001 f0x on_message watch focus=FOC-xxx
node atf-cli.js trigger add T-001 pinchymeow on_status_change watch
node atf-cli.js trigger add T-001 pinchymeow on_blocked watch
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
node atf-cli.js reflect show T-001 RFL-xxx
```

## 7. 全局索引

当前 watcher / cron 最值得直接消费的是这两个文件：

- `ATF_DATA_DIR/pending-trigger-fires.json`
- `ATF_DATA_DIR/trigger-inboxes/<agent>.json`

其中：

- `pending-trigger-fires.json`
  全局 pending fires 汇总
- `trigger-inboxes/<agent>.json`
  单 agent 待处理 fires 汇总

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
