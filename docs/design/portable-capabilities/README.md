---
format: concord.document/v1
id: portable-capabilities
title: 通用语义与平台实现边界
createdAt: 2026-10-23T06:11:44.976Z
kind: design
alternatives:
  - semantic-adapters
  - native-only
constitutionRefs:
  - docs/constitution.md#c-002
decision:
  selected: semantic-adapters
  reason: 通用算法意图由平台适配器实现；保持固定机制约束、选择证据与既有输入兼容。独立审查的类型与范围问题已修正。
  at: 2026-10-23T06:19:49.834Z
  targets:
    - docs/feature/target-compilation/README.md
---

# 通用语义与平台实现边界

## Problem

现有 strategy 共享成员，却要求作者按 engine 提供 implementations，并将 Smart 标为平台专属算法。用户要求算法本身成为通用概念，由平台提供实现。仅补规则原子无法解决这一公共语言边界。

## Core Mental Model

通用性由用户表达的语义决定，不由原生字段名称或当前支持平台数量决定。能力分为精确语义、可替换算法实现、平台扩展三类；每个抽象必须写明不变量、允许变化的行为、能力条件及可观察结果。

strategy 拥有出口 ID、成员与算法要求；平台适配器拥有原生实现选择与编码；原生客户端拥有探测、选择、连接及运行状态。编译器不启动后台测速，不在 JavaScript 中接管流量。

## Scope and Tradeoffs

本方案定义语言整体归属，首个实现切片为 strategy 的通用算法声明。更广的 DNS、TUN、订阅、隧道公共模型仍须有各自契约及验收，不能仅据归类表开放未实现字段。当前 API 保持兼容；本设计不授权部署、发布或真实网络接管。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- [语义与适配器](plans/semantic-adapters/README.md)
- [仅原生分支](plans/native-only/README.md)
