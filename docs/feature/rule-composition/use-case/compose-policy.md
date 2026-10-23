---
format: concord.document/v1
id: compose-policy
title: 复用规则而保留优先级
createdAt: 2026-10-21T10:12:47.258Z
kind: use-case
feature: docs/feature/rule-composition/README.md
---

# 复用规则而保留优先级

## 用户目标

作为同时维护 Mac mini 与备用设备的配置作者，我希望只维护一份工作、家庭和服务规则，在各设备绑定自己的出口，避免复制后顺序或名称逐渐不一致。

## 行为与边界

作者用条件、规则块和策略模板组织规则；实例提供完整出口绑定。块可嵌套，守卫累积，实例路径与模板来源保留。后续规则不会在已命中规则拨号失败后重新执行。

## 验收条件

同一模板在两个实例绑定不同出口，结果与绑定一致；外层槽位可转绑定到内层。飞书允许规则先于包含飞书域名的屏蔽规则。LAN 与家庭规则先于设备规则，Steam 商店精确规则先于下载后缀规则。重复 ID、未声明或缺失槽位阻止编译。

## TypeScript 作者检查

字面量声明中的槽位名称沿 rule、block、sequence 与嵌套 use 保留；policy 的 exits 决定可用槽位，规则不能扩大声明。use 的 bindings 必须完整且无额外键，包括变量形式。动态字符串及 JavaScript 配置仍接受运行时验证。具体机制见 [作者体验与持续验收](../../../engineering/authoring-quality/README.md)。
