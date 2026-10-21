---
format: concord.document/v1
id: policy-explanation
title: 解释与验证路由意图
createdAt: 2026-10-21T10:12:48.335Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-004
---

# 解释与验证路由意图

用户可以在不连接代理、不读取密码的情况下解释请求的首命中规则，并以回归案例保护规则组合。

解释返回条件树、来源路径与逻辑出口，明确静态语义。它不推断 DNS、探活、连接成功或组运行时选择。域名后缀含根域与点分隔子域，IP 条件不触发解析；缺失字段的原子条件为 false，取反按布尔逻辑执行。

## 用户故事

- [说明请求为何使用某个出口](use-case/explain-request.md)
- [让回归案例阻止错误构建](use-case/protect-routing.md)
