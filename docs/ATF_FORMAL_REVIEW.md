# ATF 正式评审稿

这份文档只回答一个问题：

**基于当前公开仓库，ATF 到底是什么、已经成立到什么程度、下一步最该补什么。**

## 1. 最终结论

ATF 当前可以被严谨地描述为：

**运行在 OpenClaw 之上的异步多-agent 协作控制层。**

它已经打通了一条明确的内部控制面主链：

- 任务协议
- trigger 扫描与执行
- action follow-up
- launch dispatch
- write-back 与审计回写

它当前最适合的场景是：

- 内部
- 异步
- 非实时
- 多-agent 协作运营

它当前还不适合的场景是：

- 实时多-agent 会话系统
- 跨组织可信协作
- 开放市场优先
- 把 runtime 成功返回直接当成闭环完成

## 2. 仓库已证实的事实

### 2.1 当前定位

README、产品文档和商业文档当前口径一致：

- ATF 是异步多-agent 协作控制层
- 当前产品/架构定义明确分成四层
- 当前主线是内部控制面，而不是市场、支付或实时系统

直接证据：

- [README.md](/D:/code project/agent-taskflow/README.md:1)
- [ATF_PRODUCT_GUIDE.md](/D:/code project/agent-taskflow/docs/ATF_PRODUCT_GUIDE.md:1)
- [ATF_BUSINESS_STRATEGY.md](/D:/code project/agent-taskflow/docs/ATF_BUSINESS_STRATEGY.md:1)

### 2.2 存储与运行拓扑

ATF 当前不是“纯 task repo 系统”，而是：

- task repo 保存任务事实与协作对象
- `ATF_DATA_DIR` 保存 pending 索引、agent inbox、launch queue、dispatch payload 和部分可重建投影

直接证据：

- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:24)
- [ATF_STORAGE_MODEL.md](/D:/code project/agent-taskflow/docs/ATF_STORAGE_MODEL.md:8)

### 2.3 三条标准链路

当前最稳的表达方式是：

- `trigger pending_task -> <taskDir>/pending-task.json`
- `action pending_task -> <agentWorkspace>/pending-task.json`
- `launch -> ATF_DATA_DIR/pending-launch-requests.json / launch-inboxes/<agent>.json / launch-dispatch-payloads/<launchId>.json + env bridge`

直接证据：

- [ATF_WATCHER_INTEGRATION.md](/D:/code project/agent-taskflow/docs/ATF_WATCHER_INTEGRATION.md:41)
- [ATF_ACTION_LAYER.md](/D:/code project/agent-taskflow/docs/ATF_ACTION_LAYER.md:86)
- [ATF_STORAGE_MODEL.md](/D:/code project/agent-taskflow/docs/ATF_STORAGE_MODEL.md:35)

### 2.4 当前控制链边界

当前仓库已经能把四条控制链讲清：

- trigger executor
- watcher wrapper
- action executor
- launch dispatch

它们的 capability、默认 mode、执行产物、失败语义和审计落点，当前都已经可以落到代码和文档里。

直接证据：

- [ATF_DISPATCH_MATRIX.md](/D:/code project/agent-taskflow/docs/ATF_DISPATCH_MATRIX.md:1)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:72)

### 2.5 Phase C / Phase D 成熟度

- Phase C 当前是 **Phase C Lite / 内部调度信誉层**
- Phase D 当前已有 3 类动作和一层轻量护栏，但不应被称为成熟动作平台

直接证据：

- [ATF_REPUTATION_LAYER.md](/D:/code project/agent-taskflow/docs/ATF_REPUTATION_LAYER.md:1)
- [ATF_ACTION_LAYER.md](/D:/code project/agent-taskflow/docs/ATF_ACTION_LAYER.md:1)

### 2.6 watcher `room` 模式历史不一致

repo 内部曾经存在一个明确的不一致点：

- watcher 集成文档写 `room`
- 底层 trigger mode 集合支持 `room`
- 但 wrapper `--help` 先前没有写 `room`

当前这次整改已经把 wrapper help 对齐到了 `pending_task|message|room|noop`。

直接证据：

- [ATF_WATCHER_INTEGRATION.md](/D:/code project/agent-taskflow/docs/ATF_WATCHER_INTEGRATION.md:85)
- [atf-cli.js](/D:/code project/agent-taskflow/atf-cli.js:72)
- [atf-watcher.cjs](/D:/code project/agent-taskflow/workspace/bin/atf-watcher.cjs:79)

## 3. 基于证据的判断

### 3.1 ATF 今天最值钱的部分

ATF 当前最值钱的不是“单个 agent 更聪明”，而是：

**多-agent 协作秩序更稳定、更可追踪、更可审计。**

它已经把以下几类能力收敛成统一控制面：

- 任务派发
- 状态跟踪
- 漏项 follow-up
- 统一唤醒
- 审计留痕

这对内部多-agent 协作运营已经有明确实战价值。

### 3.2 当前最大的风险不是“功能太少”

当前更高优先级的问题是：

- 语义边界如果不正式化，容易继续被误读
- write-back 还是系统契约，尚未成为统一强制保证
- 身份、reviewer 权限、自动验收、争议处理仍未硬化

这些问题比“再多加几个对象”更值得优先处理。

### 3.3 当前成熟度判断

ATF 当前已经是一个成立的内部异步多-agent 控制平面。

但它还不是：

- 已硬化完成的通用协作协议平台
- 已成熟的跨组织可信系统
- 可以直接拿来做开放市场的基础设施

这个判断来自当前状态文档、定位文档和不变量文档，而不是额外脑补。

## 4. 当前整改重点

### P0

- 修表述不一致
- 固化存储模型
- 固化三条标准链路术语
- 修评审脚注与证据链

### P1

- 输出 dispatch / interface matrix
- 输出编号化不变量
- 固化对外定位模板

### P2

- 身份与治理硬化
- 再考虑跨节点实时通信
- 最后再谈预算、结算、激励闭环

详细优先级见：

- [ATF_REMEDIATION_MEMO.md](/D:/code project/agent-taskflow/docs/ATF_REMEDIATION_MEMO.md:1)

## 5. 一句话判断

ATF 当前已经足够支撑“内部多-agent 协作控制面”这件事；它下一步最需要补的不是更大的叙事，而是：

**更硬的语义边界、更清楚的执行接口、更正式的治理约束。**
