# ATF 结论到证据对照表

这份文档只回答一个问题：

**正式评审里常用的关键结论，分别应该挂到哪些直接证据文件。**

## 1. 使用原则

- 一条关键结论，优先挂最直接的一手文件
- 如果结论横跨文档与代码，可以挂 2-3 个证据源
- 不用“差不多相关”的文件凑脚注

## 2. 关键结论映射

| 关键结论 | 直接证据 |
|------|------|
| ATF 当前定位是异步多-agent 协作控制层 | `README.md`、`docs/ATF_PRODUCT_GUIDE.md` |
| 当前定位收敛在内部控制面，而不是市场/支付/实时系统 | `docs/ATF_PRODUCT_GUIDE.md`、`docs/ATF_BUSINESS_STRATEGY.md` |
| 当前产品/架构定义分成四层 | `README.md` |
| 当前不是纯 task repo，而是 task repo + `ATF_DATA_DIR` 双落地 | `atf-cli.js`、`docs/ATF_STORAGE_MODEL.md` |
| trigger `pending_task` 默认落在 taskDir | `docs/ATF_WATCHER_INTEGRATION.md`、`atf-cli.js` |
| action `pending_task` 默认落在 agent workspace | `docs/ATF_ACTION_LAYER.md`、`atf-cli.js` |
| launch 走 queue + payload + env bridge | `docs/ATF_WATCHER_INTEGRATION.md`、`atf-cli.js` |
| watcher `room` 模式存在文档/实现表述不一致 | `docs/ATF_WATCHER_INTEGRATION.md`、`atf-cli.js`、`workspace/bin/atf-watcher.cjs` |
| Phase C 是 Lite，面向内部信誉层 | `docs/ATF_REPUTATION_LAYER.md` |
| Phase D 已有三类动作与护栏，但不是成熟平台 | `docs/ATF_ACTION_LAYER.md` |
| runtime 不承担状态真相 | `README.md`、`docs/ATF_STORAGE_MODEL.md` |
| action 已有 preflight / postflight 机制 | `docs/ATF_ACTION_LAYER.md`、`atf-cli.js` |
| launch 已有 cooldown / lease 机制 | `atf-cli.js`、`docs/ATF_INVARIANTS.md` |
| 身份、reviewer 权限、自动验收、争议处理仍未硬化 | `docs/ATF_CURRENT_STATE.md` |
| 当前不适合跨组织可信协作或开放市场 | `docs/ATF_CURRENT_STATE.md`、`docs/ATF_BUSINESS_STRATEGY.md` |

## 3. 推荐脚注组合

### 3.1 讲总体定位时

推荐挂：

- `README.md`
- `docs/ATF_PRODUCT_GUIDE.md`

### 3.2 讲实现边界时

推荐挂：

- `atf-cli.js`
- `docs/ATF_STORAGE_MODEL.md`
- `docs/ATF_DISPATCH_MATRIX.md`

### 3.3 讲当前缺口时

推荐挂：

- `docs/ATF_CURRENT_STATE.md`
- `docs/ATF_INVARIANTS.md`

### 3.4 讲 Phase C / Phase D 时

推荐挂：

- Phase C：`docs/ATF_REPUTATION_LAYER.md`
- Phase D：`docs/ATF_ACTION_LAYER.md`

## 4. 不推荐的挂法

下面这些是应当避免的：

- 用 `ATF_REPUTATION_LAYER.md` 去支撑 Phase D 动作能力
- 用 `ATF_ACTION_LAYER.md` 去支撑 Phase C Lite 的整体定义
- 用 README 单独支撑 watcher help 文本差异
- 用商业文档替代代码落点来证明 queue / payload / mode 细节

## 5. 一句话结论

正式评审最容易掉分的不是判断本身，而是：

**结论能成立，但证据没有挂到最直接的文件。**
