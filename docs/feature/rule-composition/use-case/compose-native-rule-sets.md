---
format: concord.document/v1
id: compose-native-rule-sets
title: 组合命名规则集与原生外部条件
createdAt: 2026-10-22T06:07:29.418Z
kind: use-case
feature: docs/feature/rule-composition/README.md
---

# 组合命名规则集与原生外部条件

用户将可复用的匹配条件命名为规则集，在规则使用处绑定出口。集合支持 any/all/not、嵌套集合及平台原生条件；具有顺序和动作的模板仍使用 policy/use。

原生外部条件保留客户端格式及资源引用，由客户端下载和更新。编译器不拉取内容、不转换平台文件、不生成更新服务。跨平台复用通过 TS 函数参数传入各自原生条件。

目标不匹配、资源定义冲突、字段无效或组合无法表达时构建失败。静态解释不能确定远程条件时报告 STATIC_RULESET_UNKNOWN，案例报告 CASE_INDETERMINATE，不能将未知当作未匹配。

## 验收

- 本地集合嵌套后保持逻辑结构和规则顺序，来源可追踪。
- 相同原生资源重复使用只声明一次，不同定义同 ID 拒绝。
- 生成配置保留原生远程引用及更新间隔，构建不访问规则 URL。
- 任意层的跨引擎原生条件均拒绝，UDP 能力检查不依赖远程内容。
- unknown 遵守三值逻辑，失败不替换既有活动产物。

详见[组合与原生入口设计](../../../engineering/composable-rule-sets/README.md)。
