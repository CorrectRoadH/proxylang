---
format: concord.document/v1
id: protect-routing
title: 让回归案例阻止错误构建
createdAt: 2026-10-21T10:12:49.423Z
kind: use-case
feature: docs/feature/policy-explanation/README.md
---

# 让回归案例阻止错误构建

## 用户目标

作为调整共享策略的作者，我希望固定重要请求的规则和出口预期，在改动影响行为时立即发现并阻止构建。

## 行为与边界

配置中的案例指定程序、请求、预期动作及可选规则路径。所有案例使用同一展开语义；任何案例失败使整批编译失败，不提供部分可发布计划。

## 验收条件

将首命中拒绝动作误期望为直连时检查非零退出；恢复正确预期后通过。相同动作但规则路径不同也能检测顺序回归。
