---
format: concord.document/v1
id: provider-review
title: Provider 方案审查
createdAt: 2026-10-21T10:12:53.265Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# Build Provider 设计审查

日期：2026-10-21。状态：初审 CONDITIONAL，修订复核 PASS（文档契约范围）。

主 agent 已在 [Build Provider 设计](./build-providers.md) 写明具体方案。范围为编译后端、目标支持声明、能力判断、转换计划及 host/provider 职责。此次仅设计，不实现源码。

需要独立挑战的重大边界：平台程序怎样进入目标后端；支持声明与真实转换如何保持一致；计划如何绑定输入；provider 是否越过资源、秘密或发布所有权。先前草案的 PASS 不覆盖这些新契约。

Review 使用 Herdr 中的原生 Codex / GPT‑6.1 Sol，只读检查，未再分派。完整共享策略接口、平台 schema 与首批精确版本仍待后续设计；不能把框架通过当成它们已经实现或验证。

## 初审与修订

独立 reviewer：Herdr `proxylang-provider-review`，原生 Codex `gpt-6.1-sol`，high；session `01a15dbe-c8e6-7393-b869-838a1df2f1e0`。初审为 CONDITIONAL，主 agent 修订以下五项后，reviewer 针对性复核 PASS，无残余阻塞。

| 问题 | 修订位置与决定 |
| --- | --- |
| fragment 的外部前提不完整 | 第 2 节定义外部绑定、条件保证、standalone 闭合条件及原生检查限制；未定义组合契约的片段不支持 |
| 省略字段会继承版本默认差异 | 第 5、8 节规范化稳定默认值；目标原生默认须显式选择且已知，不适用于要求稳定的共享语义 |
| 多节点转换可能重复消费 | 第 7 节规定同一表示消费互斥、只读依赖共享、跨阶段显式数据流和辅助资源编码路径 |
| 秘密解析不一致 | 第 8 节规定 token 构建内一次解析、跨目标复用；校验和发布使用同一物化文件，轮换重新构建 |
| 提交后 warning 与严格模式矛盾 | 第 6、12 节限定严格模式在提交前，区分未发布与已发布但维护失败的退出状态 |

审查为文档静态检查；未运行编译器、客户端或网络行为测试。
