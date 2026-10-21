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
