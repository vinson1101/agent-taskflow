# ATF 指导文档

这些文档用于统一 AgentTaskFlow 的当前定位、未来方向和判断标准。

## 当前推荐阅读顺序

1. [当前项目计划](../PLAN.md)
2. [ATF 产品定义](./ATF_PRODUCT_GUIDE.md)
3. [ATF 当前状态](./ATF_CURRENT_STATE.md)
4. [ATF 对外定位模板](./ATF_POSITIONING_TEMPLATE.md)
5. [ATF v2 Reliability Control Plane](./ATF_RELIABILITY_CONTROL_PLANE.md)
6. [ATF 外部参考](./ATF_EXTERNAL_REFERENCES.md)
7. [ATF 存储模型](./ATF_STORAGE_MODEL.md)
8. [ATF Dispatch / Interface Matrix](./ATF_DISPATCH_MATRIX.md)
9. [ATF Invariants](./ATF_INVARIANTS.md)
10. [ATF 调用说明](./ATF_RUNTIME_USAGE.md)
11. [ATF Watcher 集成说明](./ATF_WATCHER_INTEGRATION.md)
12. [ATF Action Layer (Phase D)](./ATF_ACTION_LAYER.md)
13. [ATF Reputation Layer (Phase C Lite)](./ATF_REPUTATION_LAYER.md)
14. [历史自主能力路线图](./ATF_AUTONOMY_ROADMAP.md)
15. [ATF 能力演进图](./ATF_CAPABILITY_EVOLUTION.md)
16. [ATF 商业价值与路径](./ATF_BUSINESS_STRATEGY.md)
17. [ATF 整改 Memo](./ATF_REMEDIATION_MEMO.md)
18. [ATF 正式评审稿](./ATF_FORMAL_REVIEW.md)
19. [ATF 结论到证据对照表](./ATF_EVIDENCE_MAP.md)

## 使用原则

- `PLAN.md`、产品定义、当前状态和对外定位是当前 source of truth；历史 Phase 文档只证明已有设计和实现。
- 当前主线已经吸收 Clawith 式 `Focus / Trigger Binding / Agent Messaging / Reflections` 的最小协议对象；除非特别说明，不再把重平台 / 市场化设计当成当前阶段前提。
- 新主线是事件优先、runtime-neutral、OpenClaw/Hermes 双运行时和 A2A compatibility，不再继续增加一套自定义外部通信协议。
- `README.md` 仍然保留运行方式和现状说明。
- 历史阶段材料已经归档到 `archive/legacy-docs/`，早期原型代码归档到 `archive/legacy-prototype/`；它们更多反映黑客松阶段、旧 TODO、支付原型和阶段性草稿，不应替代本目录作为当前判断依据。
