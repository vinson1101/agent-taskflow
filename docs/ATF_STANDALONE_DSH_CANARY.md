# ATF 原任务链路 × DSH：独立试点

隔离试点沿用 ATF CLI、任务目录的 `ctx.json`、事件信箱、运行时派发记录和义务 verifier。DSH 只是执行评审，不另建任务真相。提交新版本存入原任务的 outputs；只在验证者、任务、义务、版本、SHA-256、relay 任务 ID、原请求和专用会话均匹配时才能确认结果。退回保留原 task ID，迟到版本仅将旧义务标为 superseded。

本分支不是生产配置。不安装或修改任何系统组件，不注册新账号，不开放公网端口，不停用户已有服务。只用合成材料和现有获准的 DSH 专用测试会话；限 loopback relay 0.6.3。用新的 0700 空目录独立运行，不复制任何实际项目资料或令牌。专用会话由操作者执行 `atf agent register <reviewer> runtime=dsh dsh-session=<dedicated-session-id>` 登记在隔离 registry，runner 会做这一步。验收提交只指定 reviewer，不能改选会话；派发、回执读取和验收重新核对登记与启用状态。变更会话须以新的 reviewer 单独登记；不往任务提交参数传真实凭据。若模型回执无法按 RPC 归因，停止验收，不放宽判定。只验证隔离链路；独立 verifier 不调用既有生产触发器、积分或声誉副作用。

## 本机操作者启动与状态

`npm start` 不带参数只显示入口帮助，不是后台进程。用已安装的 CLI，在已存在的父目录下选一个新目录：

```sh
atf standalone init "$HOME/atf-isolated-pilot" --prepare-cue-inbox
atf standalone status "$HOME/atf-isolated-pilot"
```

`init` 创建独立的 0700 根目录及 `workspace`、`tasks`、`data`；可省略 `--prepare-cue-inbox`，该选项只创建空目录，不启用 Cue。命令不接管或覆盖已有根目录，不配置或启动任何 Agent、relay 或服务。请将结果中 `env` 的五个路径在**干净的专用终端**逐项设置（不要把 JSON 当成 shell 脚本执行），再使用正常 `atf` CLI；环境不会写入配置。只有确已核对专用 DSH 会话并获得授权后才登记 reviewer。Cue 另按[手工导入方式](./ATF_PUBLIC_RESEARCH_IMPORT.md)显式启用，相关批准与派发仍分开。

`status` 只读验目录和最多 100 项、每项最多 8192 字节的本地事件状态计数。它不输出任务正文、回执内容或凭据，也不连接 relay；`snapshot_complete: false` 代表部分统计，不能当完整队列或实时运行状态。查看具体任务用 `atf ctx <task-id>`；已有待对账派发用 `atf dsh-review settle <原事件ID>`，核对后才用 `atf verify <task-id>`。资料不全时按下文恢复，不猜测重发。

## 核查

- `npm test` 检查既有五组公开 smoke。
- `npm run atf:dsh:hardening:test` 检查严格路径预检、同任务写竞争、部分写入后恢复、reviewer 禁用及同一队列中的非法事件隔离。
- `npm run atf:dsh:integrated:smoke` 使用本机模拟 relay 测试真实 ATF CLI，**不是实际 DSH 接通证据**。
- 真实 DSH 验证：现有已确认 token 仅随环境传递，不输出或保存。设置 `ATF_STANDALONE_ROOT`（空 0700 目录）、`ATF_DSH_LIVE_PILOT=dedicated-test-session`、`ATF_DSH_TEST_SESSION_ID`、`ATF_DSH_RELAY_TOKEN`。必要时加 `ATF_DSH_RELAY_URL`（默认 `http://127.0.0.1:7391`），再以 Node 22+ 执行 `node workspace/bin/atf-dsh-integrated-canary.cjs`。默认每阶段等待至多 120 秒；可通过 `ATF_DSH_PILOT_TIMEOUT_MS` 有界调整。
- runner 以独立进程调用 `atf create`、`dsh-review submit`、`event dispatch`、`dsh-review settle`、`verify`、`ctx`、`status`、`obligation show`。v1 退回，且派发只在观察到真实 HTTP 202 后模拟丢弃 ACK，由新进程对账；v2 真实通过回执延迟到 v3 已登记后才进入 ATF，旧义务应 superseded；v3 精确匹配后 verifier 才关闭任务。每版匹配一条实际 relay 记录，并读回唯一 ATF 原任务。
- 没有匹配时保留待对账，不尝试重新 POST。已写 intent 但查不到 relay 记录，不能区分崩溃发生在请求发出之前还是之后；待操作人用原请求、会话和 relay 证据明确处置，不得自动猜测或清除意图后重发。Case 卡住要保留隔离原始证据，不把新请求冒充恢复，也不报告已验收。成功摘要不含会话 ID、令牌或原会话正文。试点尚未规定生产迁移、自动返工、权限体系或公网 API。

独立链路使用 `atf reconcile`。旧 control-plane 在 standalone 模式会在创建锁前拒绝。任务原件先持久化、事件后入队；若中断，使用完全相同的来源事件与版本重放即可修复缺失记录，不另开任务。有派发意图却无可归属 relay 回执时，不自动补投。CI 中仅跑合成回归和模拟 relay，不连接真实 DSH。

### 本机派发前检查失败

事件为 `blocked_review_dispatch` 时，`atf reconcile` 或不带 ID 的 `atf event dispatch` 不会自动重试。先核对并修正隔离配置、已批准的 reviewer 绑定或产物，再用 `atf event dispatch <完整 event ID>` 显式恢复同一事件。只有在没有持久派发意图时才会重新尝试；意图记录存在但无法读取或解析，也按已有意图处理。若返回 `intent_exists_reconcile`，或事件已处于 `awaiting_reconcile`，保留原记录，改用 `atf dsh-review settle <同一 event ID>`；不要删除意图、换 ID 或重发。

无 relay task ID 的 ACK 对账固定只读取指定专用会话的 `/tasks?sessionId=…&limit=100`。如果结果列表超过 100 条、已截断、没有相符记录或有多条相符记录，当前实现保持 `pending_reconcile`；不是未派发的证明。由操作人结合原始请求及 relay 审计人工查证，不能因此再次 POST。

### 换验收人，不开新任务

在隔离模式中，原任务的当前产物评审仍待验时，可执行：

```sh
atf dsh-review handoff <task-id> <当前-event-id> <已登记的接手者> [理由]
atf event dispatch <返回的新-event-id>
atf dsh-review settle <返回的新-event-id>
atf verify <原-task-id>
```

接手者必须是已启用的 DSH reviewer，并绑定本次义务此前未用过的专用会话。命令不接受端点或会话替换参数。它保留任务 ID、待验义务 ID、版本和 SHA-256；仅换当前评审尝试，旧、新事件及请求各自留痕。换人命令不直接调用 DSH，随后才派发新事件。若出错，先按原命令的相同事件 ID、接手者、理由重放以完成写入；过期的另一请求不会覆盖后续的接手者。若检测到交接还未写完，新版本提交会被阻止，先重放该交接。

交接**不取消或重发**原尝试。原尝试已获响应或回执未知时，仍可用原事件 ID 查询中继并记录本地对账结果（仅当其原会话仍获授权）；原尝试结果不能当作接手者回执，也不会阻塞不同会话的接手。原尝试曾通过但尚未被 verifier 应用时，交接生效后同样不再有权关单。验收只认当前事件、验收人、专用会话和原产物版本；已取消或归档的任务不会再派发。该试点不变更服务或公网权限。

双会话实测使用同样的本地已授权 relay 和新 0700 空目录。操作者先在 relay 上核验两个专用测试会话分别绑定不同的隔离工作区；禁止使用默认或真实工作会话。将 opt-in 写作 `ATF_DSH_LIVE_PILOT=two-dedicated-test-sessions`，分别通过 `ATF_DSH_TEST_SESSION_ID` 和 `ATF_DSH_HANDOFF_TEST_SESSION_ID` 提供两会话，沿用上述 token 注入方式，然后运行 `node workspace/bin/atf-dsh-handoff-canary.cjs`。实际读回须显示两个归因准确的 relay 记录各一条、ATF 原任务和义务各一条，旧结果不关单，且当前验收者的有效回执只能由 verifier 结案。

`npm run atf:dsh:handoff:smoke` 是同一 runner 的模拟模式；通过不等于真实 DSH 验收。
