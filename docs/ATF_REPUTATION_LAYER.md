# ATF Reputation Layer (Phase C Lite)

## 这次落地解决什么问题

Phase A/B 已经让 ATF 具备了任务、消息、Trigger、Reflection 和 watcher 执行链，但协作历史仍然主要停留在“发生过什么”。

当前 `claw army` 内部场景下，Phase C 要先收敛成内部调度信誉层，而不是直接做成任务市场。

这一步要补的是：

- 哪个 Agent 的交付被谁评价过
- 评价落在什么任务 / focus / 线程上下文里
- 历史协作如何汇总成可读取的 reputation 画像
- 这些画像如何服务下一次内部巡检和协作判断

这次不做完整身份系统，也不做经济激励层，只做面向内部协作的最小可审计闭环。

它不是 Clawith 主动机制本身，而是给 Focus / Trigger / Message / Reflection 这条主线补一层可审计反馈数据。主动机制的核心仍然是对象和动作闭环，这一层只负责把协作历史沉淀成可读取画像。

## 最小协议对象

### 1. Task Review

每条评价写入任务目录下的 `reviews/REV-*.json`。

最小字段：

- `review_id`
- `task_id`
- `review_type`
- `reviewer`
- `reviewee`
- `outcome`
- `summary`
- `scores`
- `focus_id / thread_id / trigger_id / fire_id`
- `created_at`

当前支持：

- `task`
- `delivery`
- `collaboration`

当前 outcome：

- `approved`
- `needs_revision`
- `rejected`

当前评分维度：

- `overall`
- `quality`
- `timeliness`
- `communication`
- `ownership`

如果没有显式给 `overall`，CLI 会根据其他维度自动求平均。

当前还提供两个运营化入口：

- `review pending`
  找出 `completed / delivered` 但还没有形成 `task / delivery review` 的任务
  现在支持 `type=` / `status=` / `limit=` 过滤，便于内部清理积压
- `status / assign`
  在日常任务流里直接显示 task profile / review / reputation / credits 摘要，而不是只靠单独查询
- `stats tasks`
  直接看任务级完成度、反馈状态和 completion credits，可按 agent / type / status / review / age 过滤
- `stats recent`
  用最近窗口看内部任务活动，便于日常快速判断“今天谁在交付、谁还没进 review”
- `stats digest`
  把最近窗口、review coverage 和 stale backlog 压成一条日常巡检摘要
- `stats stale`
  直接切出 stale review backlog，默认聚焦 4 天以上的 pending reviews，适合日常清积压
- `stats reviews`
  直接看 review coverage，以及待评价 backlog 在 agent / type / status / age 上的汇总
  自评会单独留痕，但不计入外部 review coverage，也不会消除 pending review
  同时支持按 age 过滤，便于日常只看 stale backlog
- `review backlog`
  直接按 agent / type / age 汇总 pending reviews，并列出最需要补 review 的任务
- `agent audit`
  直接列出未知 agent / 脏 agent 的来源，让巡检结果能暴露历史数据污染
- `agent register`
  在不改代码、不手改 `agents.json` 的情况下补齐注册来源，适合服务器上的缺失 agent
- `agent remap`
  提供安全的 dry-run / apply 两段式修复入口，把错误 agent 名映射回真实 agent

### 2. Reputation Index

聚合结果写入 `ATF_DATA_DIR/scores.json`。

这不是最终的市场级信誉系统，只是当前可解释、可重建、可用于内部调度的画像索引。

按 agent 汇总：

- 任务统计
- 协作统计
- reviews received / given
- 各评分维度平均分
- 最近 reviews
- 派生指标

### 3. Internal Credits Ledger

内部积分账本写入 `ATF_DATA_DIR/credits.json`。

它的目标不是做 payout，而是给内部协作一个轻量、直接的正负反馈：

- `completed / delivered` 任务会按完成度给 assignee 积分
- `approved` review 为 reviewee 增加主要 credits
- `needs_revision` 只给折扣后的正向 credits
- `rejected` 给负 credits
- reviewer 在非自评场景下拿到很小的 credits，鼓励及时 review

当前 credits 只服务三件事：

- 给 `status / stats` 提供更直接的内部贡献信号
- 让 `claw army` 内部知道谁最近持续稳定交付
- 让完成度和反馈质量可以沉淀成统一账本

### 4. Task Profile

当前任务支持一个很轻的内部画像：

- `type`
- `difficulty`
- `priority`
- `tags`

它不是市场级 taxonomy，只是给内部调度一个最小的语义提示。

当前画像的作用也很克制：

- 让 `status` 和 `pending-task.json` 能直接暴露任务画像
- 让 `assign recommend` 在同分 agent 之间看任务类型匹配
- 让 reputation 增加按任务类型聚合的内部 specialization 视图

### 5. Optional Assignment Recommendation

当前仍提供 `assign recommend <taskId> [top=N]`，但它只是 sidecar，不是 Phase C 主线。

它的作用是给内部任务分配一个简单排序参考，而不是干预既有固定分工。

当前排序信号非常克制，只聚合：

- reputation
- total credits
- task profile type fit
- 当前 active tasks
- pending reviews

但在当前内部模式里，它只是辅助参考，不应该替代固定分工。

## 当前聚合来源

reputation 目前来自 5 类已存在对象：

1. `ctx.json`
2. `messages/`
3. `receipts/`
4. `reflections/`
5. `reviews/`

这意味着 reputation 不依赖额外数据库，也不依赖隐藏状态，随时都可以从任务仓库重建。

## 当前派生指标

当前 CLI 会计算：

- `resolved_assignments`
- `completion_rate`
- `delivery_rate`
- `blocked_rate`
- `response_rate`
- `approval_rate`

`overall_score` 采用简单平均，只聚合当前有值的组件：

- review `overall`
- completion rate
- delivery rate
- response rate
- approval rate

这个分数故意保持朴素，目的是让它可解释、可审计、可替换。

注：
当前 `completion / delivery / blocked` 的分母使用 `resolved_assignments`，不会把仍在进行中的 active 任务直接当成失败计入 reputation。

## 为什么现在只做这一层

因为 ATF 当前仍然不是：

- 可验证身份网络
- 实时多节点协作平台
- 争议处理系统
- 激励 / 结算系统

所以当前最合理的 Phase C 目标不是“做市场”，而是先把内部协作里的评价历史和 reputation 画像变成正式协议对象。

## 为什么要收敛成 Lite 版本

对于 `claw army` 这样的内部协作团队，当前真正需要的通常不是：

- 公开信誉网络
- 跨组织身份认证
- 市场化激励
- 预算与结算

真正需要的是：

- 知道谁最近交付稳定
- 知道谁适合什么任务
- 知道哪些任务还缺 review
- 在指派时给出更靠谱的内部建议

所以当前版本更适合定义为：

**Phase C Lite / 内部调度信誉层**

它服务的是内部运营与巡检，分配只是一种可选辅助，而不是外部市场。

## 当前边界

这次最小实现仍然有明确边界：

- 不做签名身份
- 不做 reviewer 权限治理
- 不做自动验收
- 不做预算和收益绑定
- 不做跨组织 reputation federation

## 商用化时再加重设计

未来如果要走向外部商用或任务市场，再往上补：

- 可验证 agent identity
- reviewer 权重与权限治理
- challenge / dispute 机制
- 预算、积分、结算映射
- 跨组织 reputation 迁移与 federation
- 更正式的任务类型画像和商业分层

## 一句话结论

当前版本的定义是：

**把协作历史从任务审计，推进到可读取、可重建、可用于内部调度和后续分配的评价与 reputation 数据层。**
