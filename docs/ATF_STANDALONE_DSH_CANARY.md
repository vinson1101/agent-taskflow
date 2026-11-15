# ATF 原任务链路 × DSH：独立试点

隔离试点沿用 ATF CLI、任务目录的 `ctx.json`、事件信箱、运行时派发记录和义务 verifier。DSH 只是执行评审，不另建任务真相。提交新版本存入原任务的 outputs；只在验证者、任务、义务、版本、SHA-256、relay 任务 ID、原请求和专用会话均匹配时才能确认结果。退回保留原 task ID，迟到版本仅将旧义务标为 superseded。

本分支不是生产配置。不安装或修改任何系统组件，不注册新账号，不开放公网端口，不停用户已有服务。只用合成材料和现有获准的 DSH 专用测试会话；限 loopback relay 0.6.3。用新的 0700 空目录独立运行，不复制任何实际项目资料或令牌。专用会话由操作者执行 `atf agent register <reviewer> runtime=dsh dsh-session=<dedicated-session-id>` 登记在隔离 registry，runner 会做这一步。验收提交只指定 reviewer，不能改选会话；派发、回执读取和验收重新核对登记与启用状态。变更会话须以新的 reviewer 单独登记；不往任务提交参数传真实凭据。若模型回执无法按 RPC 归因，停止验收，不放宽判定。只验证隔离链路；独立 verifier 不调用既有生产触发器、积分或声誉副作用。

## 核查

- `npm test` 检查既有五组公开 smoke。
- `npm run atf:dsh:hardening:test` 检查严格路径预检、同任务写竞争、部分写入后恢复、reviewer 禁用及同一队列中的非法事件隔离。
- `npm run atf:dsh:integrated:smoke` 使用本机模拟 relay 测试真实 ATF CLI，**不是实际 DSH 接通证据**。
- 真实 DSH 验证：现有已确认 token 仅随环境传递，不输出或保存。设置 `ATF_STANDALONE_ROOT`（空 0700 目录）、`ATF_DSH_LIVE_PILOT=dedicated-test-session`、`ATF_DSH_TEST_SESSION_ID`、`ATF_DSH_RELAY_TOKEN`。必要时加 `ATF_DSH_RELAY_URL`（默认 `http://127.0.0.1:7391`），再以 Node 22+ 执行 `node workspace/bin/atf-dsh-integrated-canary.cjs`。默认每阶段等待至多 120 秒；可通过 `ATF_DSH_PILOT_TIMEOUT_MS` 有界调整。
- runner 以独立进程调用 `atf create`、`dsh-review submit`、`event dispatch`、`dsh-review settle`、`verify`、`ctx`、`status`、`obligation show`。v1 退回，且派发只在观察到真实 HTTP 202 后模拟丢弃 ACK，由新进程对账；v2 真实通过回执延迟到 v3 已登记后才进入 ATF，旧义务应 superseded；v3 精确匹配后 verifier 才关闭任务。每版匹配一条实际 relay 记录，并读回唯一 ATF 原任务。
- 没有匹配时保留待对账，不尝试重新 POST。已写 intent 但查不到 relay 记录，不能区分崩溃发生在请求发出之前还是之后；待操作人用原请求、会话和 relay 证据明确处置，不得自动猜测或清除意图后重发。Case 卡住要保留隔离原始证据，不把新请求冒充恢复，也不报告已验收。成功摘要不含会话 ID、令牌或原会话正文。试点尚未规定生产迁移、自动返工、权限体系或公网 API。

独立链路使用 `atf reconcile`。旧 control-plane 在 standalone 模式会在创建锁前拒绝。任务原件先持久化、事件后入队；若中断，使用完全相同的来源事件与版本重放即可修复缺失记录，不另开任务。有派发意图却无可归属 relay 回执时，不自动补投。CI 中仅跑合成回归和模拟 relay，不连接真实 DSH。
