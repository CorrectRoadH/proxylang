---
format: concord.document/v1
id: strategy-implementations
title: 为同一出口声明不同平台算法
createdAt: 2026-10-21T11:37:18.248Z
kind: use-case
feature: docs/feature/target-compilation/README.md
---

# 为同一出口声明不同平台算法

## 用户目标

作为同时维护主设备和备用设备的作者，我希望 AI、开发等规则只引用一个逻辑出口，并为这个出口显式选择各平台算法，复用候选节点筛选。

## 行为与边界

strategy 持有稳定 id、非空 members 和 implementations。group.select 与 group.urltest 是通用算法声明，surge.smart 是 Surge 专属算法。通用表示有明确的行为模型，不代表每个后端已经支持；例如 Surge 后端不能直接编码组级 URLTest 测试地址，就拒绝该组合。

作者可以为同一 strategy 声明 Surge Smart 和 sing-box URLTest。这是两种明确选定的实现，不承诺评分、切换时机或连接连续性等价。目标依据 engine 选择实现，再按 platform 和精确 version 检查能力。不同版本可以引用不同平台程序；不会靠捕获编译错误去尝试另一种算法。

完整编译检查全部分支的结构、全部资源依赖与网络能力；每个目标得到不可变的具体组和 strategySelections，CLI check 与构建 manifest 保留选择证据。缺失实现、引擎错配、不支持的算法、Smart 嵌套组均阻止产出。旧 type: smart 不自动升级为新机制。

compileStrategyGroups 是独立的迁移边界，只接收 target、真实节点目录、strategies 与可选 names 映射。它只证明组拓扑及序列化，不证明节点协议、via、DNS、规则或入口。结果固定含 ok、artifactKind、diagnostics、selections、content；artifactKind 为 strategy-groups，失败时 content 为 null 且 selections 为空。输入目录不含凭据，输出不称为可运行的完整配置。

## 验收条件

同一策略在 Surge 6.10.0 输出 smart，在 sing-box 1.11.0 与 1.12.0 输出 urltest；成员顺序一致。非法未选分支仍报错，目标计划互不污染。名字注入、最终名字重复、缺失引用、循环和空成员被拒绝；完整编译保留 TCP-only 与 via 限制。原生解析检查与静态语义测试独立记录，不以解析通过证明备份设备可用。
