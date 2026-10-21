---
format: concord.document/v1
id: rule-composition
title: 组合与复用路由策略
createdAt: 2026-10-21T10:12:46.707Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-001
---

# 组合与复用路由策略

维护多台设备的代理配置时，用户可以把同一组条件和有序规则复用到多个平台程序，并为每个实例绑定不同出口。

条件与动作分离；规则按作者顺序首命中，块守卫与后代条件同时成立。模板通过声明的出口槽位引用资源，不捕获具体节点。只有平台程序声明最终默认动作。

类型判别字段使用 `type`。重复路径、缺失或多余绑定、未声明槽位、循环数据、未知字段和无效条件必须拒绝。

## 用户故事

- [复用规则而保留优先级](use-case/compose-policy.md)
- [按元数据组合出口](use-case/select-resources.md)
