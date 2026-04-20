# ATF Invariants

这份文档只回答一个问题：

**ATF 当前哪些约束应该被当成编号化不变量，而不是只停留在“运行原则”或“设计意图”。**

## 1. 当前结论

ATF 现在已经有一批足够关键的控制约束：

- write-back
- consume / settle
- lease / cooldown
- idempotency / dedupe
- preflight / postflight

这些约束里，有些已经明显落到了代码和脚本里，有些仍然更接近系统契约。

这份文档把它们拆成三类：

- 已落地不变量
- 部分落地的不变量
- 尚未硬保证的不变量

## 2. INV-001 文件不是状态真相

**定义**

`pending-task.json`、launch payload、watcher summary 都不是状态真相；任务控制流应以 task repo 中的正式对象为准。

**当前落点**

- `ctx.status`
- task 级对象：`triggers / trigger-fires / actions / reviews / reflections`

**代码/脚本锚点**

- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:1641)
- [README.md](/D:/code project/agent-taskflow/README.md:148)
- [ATF_STORAGE_MODEL.md](/D:/code project/agent-taskflow/docs/ATF_STORAGE_MODEL.md:26)

**状态**

部分落地。  
repo 和运行索引已经分层，但“所有人都必须只把正式对象当真相”的规则主要还是文档契约。

## 3. INV-002 Trigger fire 必须结算

**定义**

trigger fire 不应长期停留在“已执行但未结算”的模糊状态；应显式变成 `consumed` 或 `ignored`。

**代码/脚本锚点**

- `settleTriggerFire`
- `executeTriggerFire`
- `trigger consume`
- `trigger ignore`

**直接证据**

- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:1541)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:1724)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:6562)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:6580)

**状态**

已落地。

## 4. INV-003 Trigger 执行必须留下审计记录

**定义**

每次 trigger 执行，无论成功、失败还是跳过，都应留下可追溯的 execution record。

**代码/脚本锚点**

- `trigger-executions/`
- `saveTriggerExecution`
- watcher summary

**直接证据**

- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:1344)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:1679)
- [ATF_WATCHER_INTEGRATION.md](/D:/code project/agent-taskflow/docs/ATF_WATCHER_INTEGRATION.md:170)

**状态**

已落地。

## 5. INV-004 Action 执行必须先过 preflight，后过 postflight

**定义**

action 不应直接 dispatch；必须先确认源信号仍成立，再确认副产物真的写下。

**代码/脚本锚点**

- `runActionPreflight`
- `runActionPostflight`
- `execution.verification`

**直接证据**

- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:4186)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:4298)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:4729)

**状态**

已落地。

## 6. INV-005 Launch 派发必须受 lease / cooldown 约束

**定义**

同一 launch signal 不能被无限重复派发；必须受到 lease 和 cooldown 的双重约束。

**代码/脚本锚点**

- `lease_expires_at`
- `deriveLaunchCooldownMinutes`
- `deriveLaunchLeaseMinutes`
- `buildLaunchRequestState`

**直接证据**

- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:3210)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:3219)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:3528)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:3773)

**状态**

已落地。

## 7. INV-006 同一 signal 需要可去重并可重发

**定义**

ATF 不追求“只触发一次然后永久静默”；它要求：

- 同一 signal 可通过 `dedupe_key` 去重
- 在 cooldown 窗口之后可重新生成 follow-up

**代码/脚本锚点**

- action `dedupe_key / reissue_of / cooldown_hours`
- launch `dedupe_key / reissue_of / cooldown_minutes`

**直接证据**

- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:4435)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:4487)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:4540)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:3494)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:3612)

**状态**

已落地。

## 8. INV-007 Source 清除后不能继续派发

**定义**

如果 action/launch 的源信号已经闭环或源文件已消失，控制面不应继续派发旧请求。

**代码/脚本锚点**

- action `preflight`
- launch `archiveLaunchRequest`
- dispatch 前检查 `source_path`

**直接证据**

- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:4239)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:4253)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:3591)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:3720)

**状态**

已落地。

## 9. INV-008 Worker 必须回写 ATF 才算闭环

**定义**

仅有 runtime 日志、会话输出或 bridge 成功返回，不应当算任务闭环；闭环要求结果回写到 ATF 正式对象。

**代码/脚本锚点**

- 目前主要是 README / watcher integration 文档契约
- 还缺统一的代码级强制检查

**直接证据**

- [README.md](/D:/code project/agent-taskflow/README.md:61)
- [ATF_WATCHER_INTEGRATION.md](/D:/code project/agent-taskflow/docs/ATF_WATCHER_INTEGRATION.md:276)

**状态**

尚未硬保证。  
这是当前最重要的系统契约之一，但公开仓库里还不能算“已被统一强制验证”的不变量。

## 10. 未完全落地的不变量清单

下面这些约束已经有明显方向，但还不应写成“系统已强制保证”：

- write-back 一定发生且与 runtime 成功强绑定
- 所有 truth / queue / projection / audit 都有自动一致性检查
- 所有 wrapper 与底层 capability 永久保持自动对齐
- reviewer 权限治理、身份签名、自动验收、争议处理

## 11. 推荐用法

以后写评审或设计说明时，优先使用下面三句：

- `已落地不变量`：代码和脚本里已经能直接指出锚点
- `部分落地不变量`：有明确路径，但仍依赖文档契约或人工纪律
- `尚未硬保证`：不能写成系统强制保证
