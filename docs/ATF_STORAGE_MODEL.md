# ATF 存储模型

这份文档只回答一个问题：

**ATF 当前哪些文件是事实真相，哪些是运行队列，哪些是可重建投影，哪些只是审计留痕。**

## 1. 当前结论

ATF 当前不是“纯 task repo 系统”，而是：

- `ATF_TASKS_DIR` 负责沉淀任务事实与协作对象
- `ATF_DATA_DIR` 负责沉淀运行期索引、队列、调度 payload 和部分聚合结果
- agent workspace 负责承接被唤醒前后的局部运行信号

理解 ATF 最稳的方式不是只看目录，而是先分清 4 类落点：

- `truth`
- `queue`
- `projection`
- `audit`

## 2. 四类落点

| 类别 | 作用 | 典型示例 | 丢失后怎么办 |
|------|------|------|------|
| `truth` | canonical record；描述任务事实、协作对象和正式协议对象 | `ctx.json`、`focus-items/`、`triggers/`、`trigger-fires/`、`messages/`、`receipts/`、`reflections/`、`reviews/`、`actions/`、`shared-context.json` | 不应直接删除；需要从备份、VCS 或其他外部恢复 |
| `queue` | 待处理、待分发、待唤醒的运行期信号与队列 | `<taskDir>/pending-task.json`、`<agentWorkspace>/pending-task.json`、`ATF_DATA_DIR/pending-trigger-fires.json`、`trigger-inboxes/`、`pending-actions.json`、`action-inboxes/`、`pending-launch-requests.json`、`launch-inboxes/`、`launch-dispatch-payloads/` | 一般可以通过重扫、重建索引或重新 dispatch 恢复；但 in-flight payload 丢失会影响当前这次唤醒 |
| `projection` | 从 truth / queue 派生的可重建摘要、统计或画像视图 | `ATF_DATA_DIR/scores.json`、`ATF_DATA_DIR/credits.json`、CLI `status / stats / assign recommend` 输出、watcher status 摘要 | 允许重建；不应当作唯一真相 |
| `audit` | 执行、扫描、dispatch、follow-up 的留痕与取证材料 | `trigger-executions/`、`ATF_DATA_DIR/action-watcher-runs/`、`ATF_DATA_DIR/launcher-runs/`、`ATF_DATA_DIR/control-plane-runs/`、launch request history | 丢失不应改变任务真相，但会损失巡检和追溯能力 |

## 3. 三条标准链路术语

后续文档统一使用下面三句，不再混写：

- `trigger pending_task -> <taskDir>/pending-task.json`
- `action pending_task -> <agentWorkspace>/pending-task.json`
- `launch -> ATF_DATA_DIR/pending-launch-requests.json / launch-inboxes/<agent>.json / launch-dispatch-payloads/<launchId>.json + env bridge`

补充说明：

- `assign`、`dlq retry` 等直接任务流也会写任务目录下的 `pending-task.json`
- 这不改变上面的标准术语；它只是说明同一个 signal 文件会被多条链复用
- `launch-dispatch-payloads/<launchId>.json` 是 dispatch handoff artifact，不是任务事实真相

## 4. 每条链路落到哪里

### 4.1 Trigger

`trigger scan / scan-all`
-> `ATF_DATA_DIR/pending-trigger-fires.json`
-> `ATF_DATA_DIR/trigger-inboxes/<agent>.json`
-> `trigger execute-pending`
-> `<taskDir>/pending-task.json` 或 `<taskDir>/messages/*.json`
-> `<taskDir>/trigger-executions/*.json`

结论：

- fire 本身和 execution 记录属于 task repo 侧协议/审计对象
- pending fire 汇总和 agent inbox 属于 `queue`
- `pending_task` 默认落在任务目录，不落在 agent workspace

### 4.2 Action

`action scan`
-> `ATF_DATA_DIR/pending-actions.json`
-> `ATF_DATA_DIR/action-inboxes/<agent>.json`
-> `action execute-pending`
-> `<taskDir>/messages/*.json` 或 `<agentWorkspace>/pending-task.json`

结论：

- action 对象本身在任务目录下
- pending action 汇总和 agent inbox 属于 `queue`
- `action pending_task` 专指写入目标 agent workspace 的 signal 文件

### 4.3 Launch

`launch scan`
-> 读取 `<agentWorkspace>/pending-task.json`
-> `ATF_DATA_DIR/pending-launch-requests.json`
-> `ATF_DATA_DIR/launch-inboxes/<agent>.json`
-> `launch dispatch / dispatch-pending`
-> `ATF_DATA_DIR/launch-dispatch-payloads/<launchId>.json`
-> `ATF_LAUNCH_*` 环境变量 / bridge command

结论：

- launch queue 在 `ATF_DATA_DIR`
- launch dispatch payload 是 queue-adjacent handoff artifact
- runtime 负责唤醒；ATF 负责 queue、lease、payload、audit 和 write-back 契约

## 5. 哪些可以重建

| 落点 | 是否可重建 | 当前路径 |
|------|------|------|
| trigger pending 索引 / inbox | 可重建 | `atf trigger rebuild-index` |
| action pending 索引 / inbox | 可重建 | `atf action rebuild-index` |
| launch queue | 可重扫生成 | `atf launch scan` |
| reputation / credits | 可重建 | `atf reputation rebuild` / `atf credits rebuild` |
| 任务事实对象 | 不应依赖重建 | 需要备份或外部恢复 |
| audit run 摘要 | 下一轮可产生新的 `latest`，但历史 run 不会自动补回 | 保留原文件更稳妥 |

## 6. 推荐表述

以后描述 ATF 时，优先用这两句：

- `task repo 保存任务事实与协作对象；ATF_DATA_DIR 保存运行索引、分发队列和部分可重建投影`
- `runtime 不承担状态真相；ATF 承担协议、队列、审计和 write-back 契约`
