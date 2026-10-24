---
format: concord.document/v1
id: build-targets
title: 为多个客户端版本检查转换
createdAt: 2026-10-21T10:12:50.504Z
kind: use-case
feature: docs/feature/target-compilation/README.md
---

# 为多个客户端版本检查转换

## 用户目标

作为维护主设备和备用设备的作者，我希望同一策略按不同版本生成合法配置，并在某个目标不支持时看到明确原因。

## 行为与边界

目标分别引用匹配引擎的平台程序。sing-box 1.11.0 与 1.12.0 使用各自 DNS 格式，AnyTLS 只在目录支持的版本可用。Surge 目标限制展开逻辑深度。默认片段声明外部前提；独立配置仅提供本机显式代理与直连 DNS。

## 验收条件

未知版本、引擎不一致、协议或组不支持都阻止整批构建。展示 warning 可升级。原生检查按精确版本独立执行，不以静态通过证明网络连通。节点 IP、DNS 与入口边界必须明确。

## 作者反馈

defineConfig 对已知 programs 键检查 target 与 case 的 program 引用。schema 错误保留 INVALID_SCHEMA，提供字段路径与受控约束提示，不回显输入值、未知字段名或原始错误文本。动态配置的运行时校验不因类型约束而省略。

## 通用 Profile

defineProfile 声明 target、proxies、groups、routes、fallback。proxies 统一普通代理与隧道；平台扩展直接使用 surge 对象或 singBox 字段。proxies/groups/routes/hosts 接受有序嵌套数组，General 片段浅合并整键覆盖且逐片段严格校验。目的地接受已登记资源 ID 或同一实例；内置出口使用 outbound。详见[片段组合契约](../profile-composition.md)。构建图保持共享实例身份，深只读快照与原输入隔离。公共结构可编译为 Surge 或 sing-box；专属扩展、选项、算法与端点不能静默移植。

compileProfile 按精确目标适配现有编译器。Surge 递归转换公共 IPv6 CIDR、单项逻辑与命名规则集，保留未知字段供严格校验；无法表达刷新间隔时拒绝。sing-box 拒绝 Surge 条件选项与组顶层健康检查参数，urltest 参数来自算法；name 是显示元数据，逻辑 tag 使用 id。singBox.mode 区分 fragment 与 standalone，独立模式必须提供 listener，片段不冒充完整运行配置。

设备 Profile API 只提供统一入口，不保留 Surge authoring/build 旧签名。通用组与路由类型直接描述公共结构及显式平台能力；平台 compile/render 仍可独立使用。
