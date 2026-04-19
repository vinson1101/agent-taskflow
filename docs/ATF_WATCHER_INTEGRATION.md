# ATF Watcher 集成说明

这份文档只回答一个问题：

如果你要把当前版本的 ATF 接到 `cron / watcher / heartbeat`，应该怎么接。

## 1. 当前结论

当前仓库里已经有：

- 完整的 CLI 协议层
- Trigger / Message / Reflection / Focus 对象层
- `trigger scan / scan-all`
- watcher 可直接消费的全局索引
- 仓库内可见的 `workspace/bin/atf-watcher.cjs`
- 最小 `Trigger Action Executor`
- `pending_task / message / room / noop` adapter
- 显式 `handoff` payload

当前仓库里还没有：

- 常驻实时执行引擎
- 更丰富的 Trigger Action Adapter（直达 session / bot）
- 分布式 broker / relay / websocket 层

所以当前推荐的最小接法已经不是“手写 watcher 原型”，而是直接跑这条链：

1. `trigger scan-all`
2. `pending-trigger-fires.json` / `trigger-inboxes/*.json`
3. `trigger execute-pending`
4. `pending-task.json` / `messages/*.json` / `trigger-executions/*.json`
5. `reflect from-fire`

默认执行模式是 `pending_task`，会把 pending fire 落成任务目录下的 `pending-task.json`，同时把 execution 记录写进 `trigger-executions/`。如果显式使用 `mode=message` 或 `mode=room`，则会生成 `handoff` 消息，而不是任务文件信号。

## 2. 仓库内可见的 watcher v1

入口文件：

- `workspace/bin/atf-watcher.cjs`

推荐调用：

```bash
node workspace/bin/atf-watcher.cjs --help
node workspace/bin/atf-watcher.cjs --agent f0x --executor watcher-v1
node workspace/bin/atf-watcher.cjs --agent f0x --dry-run
npm run atf:watcher -- --agent f0x --executor watcher-v1
```

当前支持的主要参数：

- `--agent <name>` 只执行某个 agent 的 pending fires
- `--executor <name>` execution record 里的执行者名字
- `--mode <mode>` 强制执行模式，支持 `pending_task|message|room|noop`
- `--limit <n>` 限制本轮执行数量
- `--at <ISO>` 用指定时间运行 scan
- `--note <text>` 附加 execution note
- `--no-scan` 只执行，不扫描
- `--no-execute` 只扫描，不执行
- `--dry-run` 只输出 summary，不实际执行
- `--json` 输出 JSON summary

脚本默认行为：

1. 调用 `node atf-cli.js trigger scan-all`
2. 统计 pending 数量
3. 调用 `node atf-cli.js trigger execute-pending`
4. 输出本轮 summary

## 3. 推荐最小链路

### 3.1 扫描

职责：

- 定时执行 `trigger scan-all`
- 只负责把 due trigger 变成 fire

命令：

```bash
node atf-cli.js trigger scan-all
node atf-cli.js trigger scan-all f0x
node atf-cli.js trigger scan-all at=2026-04-19T23:31:00+08:00
```

### 3.2 路由

职责：

- 读取 `pending-trigger-fires.json`
- 或读取 `trigger-inboxes/<agent>.json`
- 把 fire 路由到对应 agent / heartbeat

当前最简单的做法，是直接按 agent 跑：

```bash
node workspace/bin/atf-watcher.cjs --agent f0x --executor watcher-v1
```

### 3.3 执行与沉淀

职责：

- 执行 pending fire
- 写入 `trigger-executions/*.json`
- 把 fire 结算为 `consumed`
- 需要时继续沉淀 `reflect from-fire`

命令：

```bash
node atf-cli.js trigger execute-pending f0x executor=watcher-v1 limit=20
node atf-cli.js trigger execute-pending f0x executor=adapter-message mode=message
node atf-cli.js trigger execute-pending pinchymeow executor=adapter-room mode=room room=design
node atf-cli.js reflect from-fire T-001 TGF-xxx pinchymeow what_changed 这次触发有效
```

## 4. 需要消费的文件

最关键的文件：

- `ATF_DATA_DIR/pending-trigger-fires.json`
- `ATF_DATA_DIR/trigger-inboxes/<agent>.json`
- `<taskDir>/pending-task.json`
- `<taskDir>/messages/*.json`
- `<taskDir>/trigger-executions/*.json`

含义：

- `pending-trigger-fires.json`
  全局 pending fire 汇总，适合 watcher 总控脚本
- `trigger-inboxes/<agent>.json`
  单 agent 待处理 fire 视图，适合 agent 自己轮询
- `pending-task.json`
  当前最小执行模式的落地交付物
- `messages/*.json`
  `message / room` adapter 的 handoff 投递物
- `trigger-executions/*.json`
  fire 的执行审计记录

## 5. 推荐 cron 频率

### 5.1 Trigger scan

建议：

- 最小运行：每 5 分钟一次
- 任务更多且更看重时效：每 1 分钟一次

不建议：

- 小于 30 秒一轮

### 5.2 Agent watcher

如果 agent 通过 heartbeat 醒来：

- 跟 heartbeat 同步

如果单独跑 cron：

- 每 5 到 15 分钟一轮比较稳妥

### 5.3 Reflection / learnings promote

建议后置：

- Reflection 可以按事件触发
- learnings promote 建议低频运行

## 6. Linux cron 示例

### 6.1 全局 watcher

每 5 分钟跑一次：

```cron
*/5 * * * * cd /root/.openclaw/workspace/agent-taskflow && node workspace/bin/atf-watcher.cjs --executor watcher-v1 >> /tmp/atf-watcher.log 2>&1
```

### 6.2 单 agent watcher

```cron
*/10 * * * * cd /root/.openclaw/workspace/agent-taskflow && node workspace/bin/atf-watcher.cjs --agent f0x --executor watcher-v1 >> /tmp/atf-f0x.log 2>&1
```

### 6.3 只扫描不执行

```cron
*/5 * * * * cd /root/.openclaw/workspace/agent-taskflow && node workspace/bin/atf-watcher.cjs --no-execute >> /tmp/atf-scan.log 2>&1
```

## 7. 本地 smoke 建议

不要直接写死系统目录，优先用隔离环境：

```powershell
$env:ATF_TASKS_DIR = "D:\\tmp\\atf\\tasks"
$env:ATF_WORKSPACE_DIR = "D:\\tmp\\atf\\workspace"
$env:ATF_DATA_DIR = "D:\\tmp\\atf\\data"
```

最小验证链：

```bash
node atf-cli.js trigger follow-up T-001 f0x 1s focus=FOC-xxx
node workspace/bin/atf-watcher.cjs --agent f0x --executor watcher-v1
node atf-cli.js trigger fires T-001
node atf-cli.js trigger executions T-001
```

通过标准：

- fire 被扫描出来
- fire 被执行并结算为 `consumed`
- `pending-task.json` 生成
- `trigger-executions/*.json` 生成

Adapter smoke：

```bash
node atf-cli.js trigger execute-pending f0x executor=adapter-message mode=message
node atf-cli.js trigger review T-001 pinchymeow 1s thread=room:design
node atf-cli.js trigger execute-pending pinchymeow executor=adapter-room
node atf-cli.js trigger execute-pending f0x executor=adapter-skip mode=room
```

通过标准：

- `message` 模式会生成 `handoff` 消息并投给 agent
- `room` 模式会生成 `room:<name>` 线程消息
- 缺少 room 参数时得到 `skipped`，fire 仍保持 `pending`

## 8. 当前边界

这份文档描述的是当前版本的最小可用闭环，不代表已经有完整 watcher 平台。

还没做的仍然包括：

- 更完整的 cron parser
- 更丰富的 Trigger Action Adapter（直达 agent session / bot）
- 多节点 / 多 gateway 分布式路由
- 常驻实时 runtime

但对当前阶段来说，仓库里的 watcher v1 已经足够支撑下一轮 `scan-all -> execute-pending` 集成测试。
