---
format: concord.document/v1
id: select-resources
title: 按元数据组合出口
createdAt: 2026-10-21T10:12:47.797Z
kind: use-case
feature: docs/feature/rule-composition/README.md
---

# 按元数据组合出口

## 用户目标

作为订阅节点的维护者，我希望按地区、供应商和标签选出节点并组成出口，不依赖展示名称的文本格式。

## 行为与边界

调用方用普通数组 filter/map 按自己的业务信息选择原代理对象或 ID，SDK 不存储地区、供应商和标签，也不提供专用选择器。SDK 按提供的成员顺序编译；选择组默认第一成员。组和拨号依赖共用引用检查，所有可选路径参与网络能力判断。HTTP 与 AnyTLS 按仅 TCP 处理。

## 验收条件

应用筛选多个地区时保持输入顺序与对象身份，传给 SDK 的纯代理对象不含业务属性；空组、引用缺失和组与 via 联合循环报错。含仅 TCP 节点的任一可选路径不能承接 UDP 或无约束默认流量。
