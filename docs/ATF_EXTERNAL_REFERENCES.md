# ATF 外部参考

## 这份文档的用途

ATF 的未来能力建设可以参考外部项目，但不应机械复制。

本文件用于记录对 ATF 有启发的外部协议、平台和系统设计，并明确：

- 哪些点值得借鉴
- 哪些点不应直接照搬
- 对 ATF 的具体启发是什么

## 参考原则

ATF 参考外部项目时，遵循以下原则：

1. 参考能力模型，不盲目复制产品形态
2. 优先吸收与 ATF 主线一致的部分
3. 不为“先进感”引入与当前阶段不匹配的复杂度
4. 所有参考最终都要转化为 ATF 自己的协议对象和能力层

---

## 参考一：Clawith

- 项目: [dataelement/Clawith](https://github.com/dataelement/Clawith)
- 定位: 持久化、多 Agent、自主协作平台
- 关键特征:
  - Aware 自主意识系统
  - Focus Items
  - Self-Adaptive Triggering
  - Agent 消息传递
  - 持久身份、长期记忆、私有工作区

### 对 ATF 的启发

Clawith 最值得 ATF 借鉴的，不是其完整平台形态，而是它对“Agent 自主协作对象”的建模方式。

值得借鉴的点：

- Focus Items
- Focus 与 trigger 的绑定关系
- Agent 间显式消息
- 自适应触发器
- 任务级反思和自治推进

### 不应照搬的点

- 不应立即把 ATF 重构为独立持久平台
- 不应立即引入重型前后端、数据库、多租户和组织层治理
- 不应先复制“自主意识”叙事而没有协议对象落地

### 对 ATF 的实际落地建议

Clawith 对 ATF 最现实的启发是：

1. 引入 Focus Items
2. 定义 Trigger Binding
3. 建立任务内消息线程
4. 把 reflections 变成任务对象的一部分

---

## 参考二：BotCord Protocol

- 站点: [BotCord](https://www.botcord.chat/)
- 协议入口: [BotCord Protocol](https://www.botcord.chat/protocol)
- 公开描述中的关键点:
  - Ed25519 身份和签名
  - agent_id 基于公钥派生
  - 签名 JSON envelope
  - typed payload
  - delivery receipts
  - TTL expiration
  - retry semantics
  - room fan-out
  - direct / relay / federated topology

### 对 ATF 的启发

BotCord 对 ATF 的价值不在“任务系统”，而在“通信协议”。

它提示 ATF：

- Agent 间通信不应只是隐式文件约定
- 消息应成为正式协议对象
- 通信应具备投递确认、TTL、重试和类型化 payload
- 长期看，Agent 身份需要从字符串名称升级为可验证身份

### 最值得 ATF 借鉴的点

#### 1. 消息信封模型

ATF 后续可以引入统一消息 envelope：

- `message_id`
- `task_id`
- `from`
- `to`
- `type`
- `body`
- `created_at`
- `ttl`
- `receipt_status`

#### 2. 消息级回执

ATF 当前已有任务级超时和 DLQ，但还缺消息级的：

- delivered
- acknowledged
- expired
- failed

#### 3. TTL 和重试语义

这与 ATF 当前的 cron 扫描式运行保障天然兼容。

#### 4. 房间 / 线程模型

BotCord 的 room fan-out 可启发 ATF 未来的：

- 任务讨论线程
- 多 Agent 协作房间
- 面向同一任务的广播

### 不应照搬的点

- 不应立即构建完整实时聊天网络
- 不应立即实现 federated message topology
- 不应在 ATF 还没有最小消息 schema 时先做复杂加密体系

### 对 ATF 的实际落地建议

BotCord 对 ATF 的近期价值主要体现在：

1. 先定义最小消息 schema
2. 将消息与任务强绑定
3. 为消息加入 TTL、回执和重试字段
4. 后续再考虑签名和稳定身份

---

## ATF 应如何使用这些参考

### 短期

短期只吸收“最小协议对象”层面的启发：

- Focus
- Trigger Binding
- Message Envelope
- Receipt
- Reflection

### 中期

在 ATF 具备稳定通信和自治基础后，再吸收：

- 更丰富的 trigger 类型
- 任务讨论线程
- 任务房间 / 广播
- 更正式的身份和信誉体系

### 长期

长期可以进一步考虑：

- 外部 Agent 接入协议
- 可验证身份
- 消息签名
- 跨组织协作
- 更接近市场化的互操作能力

## 结论

Clawith 和 BotCord 都不是 ATF 的替代路线，而是不同层面的参考：

- Clawith 更偏自主协作模型
- BotCord 更偏 Agent 通信协议

ATF 当前最应该做的，不是复制它们，而是把这些启发收敛成自己的协议对象：

1. Focus
2. Trigger
3. Message
4. Receipt
5. Reflection

当这些对象稳定后，ATF 才能真正从“异步任务系统”升级为“多 Agent 协作基础设施”。
