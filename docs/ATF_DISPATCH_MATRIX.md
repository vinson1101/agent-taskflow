# ATF Dispatch / Interface Matrix

这份文档只回答一个问题：

**trigger、watcher wrapper、action、launch 四条控制链，分别暴露什么接口、默认写到哪里、失败后留下什么、下一步由谁消费。**

## 1. 当前结论

ATF 当前最容易被误读的地方，不是“有没有这些能力”，而是：

- 底层 capability
- wrapper 对外暴露
- 默认 mode
- 执行产物
- 失败语义
- 审计落点

这几层经常被混成一句话。

因此本页只做一件事：

**把四条控制链压成一张矩阵。**

## 2. 总览矩阵

| 链路 | 底层 capability | wrapper / 对外入口 | 默认 mode | 主要执行产物 | 失败/跳过语义 | 审计落点 | 下一步由谁消费 |
|------|------|------|------|------|------|------|------|
| Trigger executor | `pending_task / message / room / noop` | `atf trigger execute` / `execute-pending`；`workspace/bin/atf-watcher.cjs` 透传调用 | `pending_task` | `<taskDir>/pending-task.json` 或 `<taskDir>/messages/*.json` | `failed` / `skipped`；`room` 缺参时 fire 保持 `pending` | `<taskDir>/trigger-executions/*.json` | task 级 signal 由 agent / control-plane 后续消费 |
| Watcher wrapper | 调 `trigger scan-all -> trigger execute-pending`；支持 `to / thread / room` 透传 | `workspace/bin/atf-watcher.cjs` | 不额外改写默认值；透传到底层 trigger executor | summary 输出；实际产物由 trigger executor 决定 | wrapper 会先做本地 mode 白名单校验；底层失败仍会写 execution/audit | watcher stdout / JSON summary；task 级 `trigger-executions` | control-plane、巡检脚本、人工排障 |
| Action executor | `message / pending_task / noop` | `atf action execute` / `execute-pending`；`workspace/bin/atf-action-watcher.cjs` | 无隐式强制；常见是 `message` 或 `pending_task` | `<taskDir>/messages/*.json` 或 `<agentWorkspace>/pending-task.json` | 先 `preflight`，后 `postflight`；未通过时标记 `skipped`，不会盲目 dispatch | action record 自身的 `execution / verification`；`ATF_DATA_DIR/action-watcher-runs/*` | agent workspace signal、任务线程、巡检状态 |
| Launch dispatch | `manual / noop / sessions_spawn` | `atf launch dispatch` / `dispatch-pending`；`workspace/bin/atf-launcher.cjs` | `manual` 或 wrapper 指定值；control-plane 默认 `sessions_spawn` | `ATF_DATA_DIR/launch-dispatch-payloads/<launchId>.json` + `ATF_LAUNCH_*` env | request 可变成 `failed / leased / archived`；source 缺失时归档 | launch request history；`ATF_DATA_DIR/launcher-runs/*` | runtime bridge / backend / real session launcher |

## 3. 分链说明

### 3.1 Trigger

最小链路：

`trigger scan / scan-all`
-> `ATF_DATA_DIR/pending-trigger-fires.json`
-> `ATF_DATA_DIR/trigger-inboxes/<agent>.json`
-> `trigger execute / execute-pending`
-> `<taskDir>/pending-task.json` 或 `<taskDir>/messages/*.json`
-> `<taskDir>/trigger-executions/*.json`

关键点：

- 底层 mode 集合比 wrapper 文案更接近真实 capability
- `pending_task` 默认写任务目录，不写 agent workspace
- `message / room` 统一写任务级 `messages/`
- fire 被成功执行后会结算为 `consumed`

直接证据：

- `TRIGGER_EXECUTION_MODES`
- `buildTriggerHandoff`
- `buildAdapterMessageRecord`
- `settleTriggerFire`

## 3.2 Watcher wrapper

最小链路：

`workspace/bin/atf-watcher.cjs`
-> `trigger scan-all`
-> `trigger execute-pending`
-> 输出一轮 summary

关键点：

- wrapper 不是第二套执行器，只是对 trigger scan/execute 的封装
- wrapper 的 `--mode` 会先做本地白名单校验，再透传给底层 CLI
- wrapper 也可以把 `--to / --thread / --room` 显式透传给 trigger executor
- 真实执行产物和失败语义由 trigger executor 决定，不由 wrapper 决定

直接证据：

- `workspace/bin/atf-watcher.cjs`
- `buildScanArgs`
- `buildExecuteArgs`

## 3.3 Action

最小链路：

`action scan`
-> `ATF_DATA_DIR/pending-actions.json`
-> `ATF_DATA_DIR/action-inboxes/<agent>.json`
-> `action execute / execute-pending`
-> `<taskDir>/messages/*.json` 或 `<agentWorkspace>/pending-task.json`

关键点：

- `action pending_task` 专指写入目标 agent workspace
- action 不直接“看见 pending 就发”；先 `preflight`，执行后再 `postflight`
- 同一信号可通过 `dedupe_key + cooldown_hours + reissue_of` 形成重新 follow-up

直接证据：

- `ACTION_EXECUTION_MODES`
- `runActionPreflight`
- `runActionPostflight`
- `dedupe_key`
- `cooldown_hours`

## 3.4 Launch

最小链路：

读取 `<agentWorkspace>/pending-task.json`
-> `ATF_DATA_DIR/pending-launch-requests.json`
-> `ATF_DATA_DIR/launch-inboxes/<agent>.json`
-> `launch dispatch / dispatch-pending`
-> `ATF_DATA_DIR/launch-dispatch-payloads/<launchId>.json`
-> `ATF_LAUNCH_*` env
-> bridge / backend / runtime

关键点：

- launch queue 和 dispatch payload 都在 `ATF_DATA_DIR`
- `lease_expires_at` 和 `cooldown_minutes` 是 launch 层自己的约束，不是 trigger/action 的副产品
- source `pending-task.json` 不存在时，launch request 会归档而不是继续派发

直接证据：

- `LAUNCH_DISPATCH_MODES`
- `PENDING_LAUNCH_REQUESTS_FILE`
- `LAUNCH_DISPATCH_PAYLOADS_DIR`
- `dispatchLaunchRequest`
- `lease_expires_at`
- `cooldown_minutes`

## 4. 推荐表述

以后给团队或评审解释时，优先使用下面四句：

- `trigger 负责把 due signal 执行成 task 级 signal 或 task 级 message`
- `watcher wrapper 负责批量跑 trigger，不定义第二套产物语义`
- `action 负责把 backlog / reply / decision 这类信号推进成 follow-up message 或 agent workspace signal`
- `launch 负责把 agent workspace signal 升格成统一唤醒队列，并把 dispatch handoff 交给 runtime bridge`
