# ATF Watcher 集成说明

这份文档只回答一个问题：

如果你要把当前版本的 ATF 接到 `cron / watcher / heartbeat`，应该怎么接。

## 1. 当前结论

当前仓库里：

- 有完整的 CLI 协议层
- 有 Trigger / Message / Reflection / Focus 对象层
- 有 `trigger scan / scan-all`
- 有 watcher 可直接消费的全局索引

当前仓库里没有：

- 真正的 `workspace/bin/atf-watcher.cjs` 本体
- 完整实时执行引擎

所以推荐做法不是“等待 watcher 先实现”，而是：

1. 用外部 `cron` 定时调用 `node atf-cli.js trigger scan-all`
2. watcher 或 agent 进程读取全局 pending 索引
3. agent 执行后调用 `trigger consume` / `trigger ignore`
4. 需要沉淀时调用 `reflect from-fire`

补充：

- 当前仓库内已经有最小 `Trigger Action Executor`
- 可以直接用 `trigger execute` / `trigger execute-pending`
- 默认执行模式是 `pending_task`，会把 pending fire 落成任务目录下的 `pending-task.json`

## 1.1 当前状态（2026-04-19）

服务器侧外部 `atf-watcher.cjs` 已完成一版最小接入，可视为 watcher v1.6。

已验证：

- 会先调用 `node atf-cli.js trigger scan-all`
- 会读取 `pending-trigger-fires.json`
- 会按 `owner_agent` 路由 fire
- 会调用 `trigger consume`
- 不会破坏旧的任务状态机、超时检测、DLQ 和 delivery 检测
- Feishu 通知链路仍正常

这意味着当前 ATF 的 Trigger fire 协议已经不只是“可定义”，而是已经能被 watcher 消费。

## 2. 需要消费的文件

最关键的两个文件：

- `ATF_DATA_DIR/pending-trigger-fires.json`
- `ATF_DATA_DIR/trigger-inboxes/<agent>.json`

含义：

- `pending-trigger-fires.json`
  全局 pending fires 汇总，适合 watcher 总控脚本
- `trigger-inboxes/<agent>.json`
  单 agent 待处理 fires，适合某个 agent 自己轮询

辅助文件：

- `ATF_PENDING_DECISIONS_JSON`
- `ATF_PENDING_DECISIONS_MD`

这两个只和 `block / decide` 流程有关，不是 Trigger 主链的必需消费面。

## 3. 推荐最小链路

推荐把 watcher 拆成 3 个责任：

### 3.1 扫描器

职责：

- 定时执行 `trigger scan-all`
- 只负责把 due trigger 转成 fire

命令：

```bash
node atf-cli.js trigger scan-all
```

可选：

```bash
node atf-cli.js trigger scan-all f0x
node atf-cli.js trigger scan-all at=2026-04-19T23:31:00+08:00
```

### 3.2 路由器

职责：

- 读取 `pending-trigger-fires.json`
- 或读取 `trigger-inboxes/<agent>.json`
- 决定把哪条 fire 发给哪个 agent / session / heartbeat

它不需要解析任务目录，不需要重新算 due，不需要猜 owner。

### 3.3 收敛器

职责：

- agent 执行后写回：
  - `trigger consume`
  - 或 `trigger ignore`
- 需要记录经验时写：
  - `reflect from-fire`

命令：

```bash
node atf-cli.js trigger consume T-001 TGF-xxx f0x 已执行
node atf-cli.js trigger ignore T-001 TGF-xxx pinchymeow 暂不处理
node atf-cli.js reflect from-fire T-001 TGF-xxx pinchymeow what_changed 这次触发有效
```

## 4. 推荐 cron 频率

因为你当前系统本来就依赖 heartbeat / cron，所以不要把扫描频率设计得太激进。

推荐分层：

### 4.1 Trigger scan

如果只是最小运行：

- 每 5 分钟一次

如果任务更多、对时效更敏感：

- 每 1 分钟一次

不建议：

- 少于 30 秒一轮

因为当前 ATF 不是实时事件系统，频率太高只会放大噪音和重复扫描压力。

### 4.2 Agent inbox 消费

如果 agent 自己通过 heartbeat 醒来：

- 跟 heartbeat 同步

如果单独做 cron：

- 每 5 到 15 分钟一次较稳妥

### 4.3 Reflection / learnings promote

推荐后置：

- Reflection 可以按事件触发
- learnings promote 建议低频，比如每天 1 到 2 次

## 5. Linux cron 示例

### 5.1 全局扫描

每 5 分钟扫一次：

```cron
*/5 * * * * cd /root/.openclaw/workspace/agent-taskflow && node atf-cli.js trigger scan-all >> /tmp/atf-trigger-scan.log 2>&1
```

### 5.2 单 agent inbox 消费

假设你有一个外部脚本 `consume-f0x.js`：

```cron
*/10 * * * * cd /root/.openclaw/workspace/agent-taskflow && node consume-f0x.js >> /tmp/atf-f0x.log 2>&1
```

### 5.3 每晚复盘

```cron
30 23 * * * cd /root/.openclaw/workspace/agent-taskflow && node nightly-reflection.js >> /tmp/atf-nightly.log 2>&1
```

## 6. Watcher 最小伪代码

总控 watcher：

```js
run("node atf-cli.js trigger scan-all");
const pending = readJson(`${ATF_DATA_DIR}/pending-trigger-fires.json`);
for (const fire of pending.items) {
  routeToAgent(fire.owner_agent, fire);
}
```

单 agent watcher：

```js
const inbox = readJson(`${ATF_DATA_DIR}/trigger-inboxes/f0x.json`);
for (const fire of inbox.items) {
  run(`node atf-cli.js trigger execute ${fire.task_id} ${fire.fire_id} executor=watcher-v1`);
}
```

更简化的批量写法：

```js
run("node atf-cli.js trigger execute-pending f0x executor=watcher-v1 limit=20");
```

## 7. 推荐触发器写法

### 7.1 interval

适合：

- 轮询
- follow-up
- 延迟复查

示例：

```bash
node atf-cli.js trigger add T-001 f0x interval 5m
node atf-cli.js trigger add T-001 f0x interval every:30m focus=FOC-xxx
```

### 7.2 cron

适合：

- 每日复盘
- 每周巡检
- 固定时间提醒

当前支持的最小写法：

```bash
node atf-cli.js trigger add T-001 pinchymeow cron daily@23:30
node atf-cli.js trigger add T-001 pinchymeow cron weekly@mon@10:00
node atf-cli.js trigger add T-001 pinchymeow cron hourly@15
node atf-cli.js trigger add T-001 pinchymeow cron "cron:*/10 * * * *"
```

### 7.3 事件型

适合：

- 收到消息后唤醒
- 任务阻塞后唤醒
- 状态变化后唤醒

示例：

```bash
node atf-cli.js trigger add T-001 f0x on_message watch
node atf-cli.js trigger add T-001 pinchymeow on_blocked watch
node atf-cli.js trigger add T-001 pinchymeow on_status_change watch
```

## 8. 推荐集成顺序

如果你现在要把外部 watcher 真接起来，顺序建议是：

1. 先接 `trigger scan-all`
2. 再接 `pending-trigger-fires.json`
3. 再接 `trigger-inboxes/<agent>.json`
4. 再接 `trigger execute-pending`
5. 最后接 `reflect from-fire`

不要一开始就做：

- 复杂 broker
- 跨节点 relay
- 实时 websocket
- 完整常驻执行引擎

## 9. 幂等与注意事项

### 9.1 不要重复消费同一 fire

一个 `fire_id` 只应被结算一次：

- `consume`
- 或 `ignore`

### 9.2 扫描不会重复生成 pending fire

当前 `scan / scan-all` 会检查：

- trigger 是否 `active`
- 是否已 due
- 是否已有 `pending_fire_id`

所以在 fire 未结算前，不会为同一 trigger 重复生成新的 pending fire。

### 9.3 归档会清掉 pending

如果 focus 完成或 trigger 被归档，对应 pending fire 会被自动转为 `ignored`。

### 9.4 本地验证建议先改路径

如果你要在本机或仓库内做 smoke，不要直接写死系统目录，优先设置：

```powershell
$env:ATF_TASKS_DIR = "D:\\tmp\\atf\\tasks"
$env:ATF_WORKSPACE_DIR = "D:\\tmp\\atf\\workspace"
$env:ATF_DATA_DIR = "D:\\tmp\\atf\\data"
```

## 10. 当前边界

这份集成说明是针对当前版本的最小可用闭环，不代表已经有完整 watcher 平台。

还没做的仍然包括：

- 仓库内可见的 `atf-watcher.cjs` 源码快照
- 更完整的 cron parser
- 更丰富的 trigger action adapter（直接触达 agent session / bot / room，而不只是 `pending-task`）
- 多节点 / 多 gateway 分布式路由

但对你现在的目标来说，这已经足够把外部 cron / heartbeat 接起来。
