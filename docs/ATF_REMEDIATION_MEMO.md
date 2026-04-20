# ATF 整改 Memo

这份文档只回答一个问题：

**ATF 当前最值得优先补的，不是新故事，而是哪几类边界、语义和治理问题。**

## 1. 当前判断

ATF 当前已经可以被稳定描述为：

**运行在 OpenClaw 之上的异步多-agent 协作控制层。**

它当前最适合的场景是：

- 内部
- 异步
- 非实时
- 多-agent 协作运营

它当前最不适合的场景是：

- 实时会话型产品
- 跨组织可信协作
- 开放市场优先
- 把 runtime 日志当成闭环真相

因此，这份 memo 的目标不是扩 scope，而是把当前控制面做得更：

- 不容易误读
- 不容易踩坑
- 更容易评审
- 更容易稳定运营

## 2. 当前优先级

### P0：一周内完成

#### P0-1 修 watcher `room` 模式表述不一致

目标：

- 让 wrapper help、集成文档、底层 capability 三者一致

交付物：

- `workspace/bin/atf-watcher.cjs --help`
- `docs/ATF_WATCHER_INTEGRATION.md`

完成标准：

- `room` 支持口径不再分裂

#### P0-2 固化存储模型

目标：

- 把 `truth / queue / projection / audit` 四类落点正式命名

交付物：

- `docs/ATF_STORAGE_MODEL.md`

完成标准：

- 团队内部能准确回答“哪些是事实真相，哪些是运行队列，哪些是可重建投影”

#### P0-3 固化三条标准链路术语

目标：

- 终止 `pending-task` 三条链混写

标准术语：

- `trigger pending_task -> <taskDir>/pending-task.json`
- `action pending_task -> <agentWorkspace>/pending-task.json`
- `launch -> ATF_DATA_DIR/pending-launch-requests.json / launch-inboxes/<agent>.json / launch-dispatch-payloads/<launchId>.json + env bridge`

交付物：

- README / current state / watcher / action 文档统一改写

完成标准：

- 新成员能在 15 分钟内讲清 trigger、action、launch 三条链

#### P0-4 修正式评审稿证据链

目标：

- 让关键结论都能被最直接文件落证

交付物：

- 正式评审稿
- 结论到证据对照表

完成标准：

- 不再出现“结论对，但脚注挂偏”的情况

### P1：2-4 周内完成

#### P1-1 输出 dispatch / interface matrix

目标：

- 把 trigger、watcher wrapper、action、launch 四条控制链压成一张表

交付物：

- `docs/ATF_DISPATCH_MATRIX.md`

完成标准：

- 只看矩阵就能回答“某个 mode 写到哪里、失败后留下什么、由谁消费”

#### P1-2 输出编号化不变量

目标：

- 把“运行原则”升级成团队可检查的约束

交付物：

- `docs/ATF_INVARIANTS.md`

完成标准：

- 每条不变量都能映射到代码锚点、脚本锚点或明确的未落地状态

#### P1-3 收敛对外定位模板

目标：

- 防止团队把内部控制面讲成开放市场或自治网络

交付物：

- `docs/ATF_POSITIONING_TEMPLATE.md`

完成标准：

- README、产品、商业、演示介绍对外口径一致

### P2：平台化之前再做

#### P2-1 身份与治理硬化

包括：

- 签名身份
- reviewer 权限治理
- 自动验收
- 争议处理

#### P2-2 再考虑跨节点实时通信

包括：

- broker / relay / websocket
- 跨组织互操作
- 更完整广播 / 订阅

#### P2-3 最后再谈预算、结算、激励闭环

前提：

- 身份与治理先硬化

## 3. 本轮明确不做

- 不新增一批抽象对象
- 不顺手发起大规模 CLI / 目录重构
- 不把内部控制面包装成“通用自治网络”
- 不把 `worker 必须回写` 写成已被系统强制验证的硬一致保证

## 4. 一句话结论

本轮整改的目的不是“讲更大的故事”，而是让 ATF 从“已经能跑、也能解释”继续推进到：

**团队内部更不容易踩坑，外部评审更不容易误读。**
