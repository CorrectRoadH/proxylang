---
format: concord.document/v1
id: clash-backends
title: 复用组合规则构建 Mihomo 与 Stash
createdAt: 2026-10-21T12:16:59.491Z
kind: use-case
feature: docs/feature/target-compilation/README.md
---

# 复用组合规则构建 Mihomo 与 Stash

## 用户目标

作为维护不同客户端配置的作者，我希望复用规则模板与出口名字，并看到每个精确目标无法承载的机制，而不是维护易漂移的复制配置。

## 行为与边界

Mihomo 1.19.32（macOS/Linux）和 Stash 4.2.1（macOS，build 487）拥有独立 engine 与 strategy 实现键，输出 YAML。目标检查未知版本、不支持条件和算法；嵌套子条件也不能被省略。Surge Smart 不自动变成 URLTest。

两者支持 HTTP、Trojan、AnyTLS、SS、VMess 和 select；Mihomo 另支持 VLESS；Mihomo 支持现有 urltest，Stash 节点级测速不能等价为组级 URL，因此暂时拒绝 urltest。Stash 4.2.1 拒绝来源 IP、来源端口、目标端口范围与 standalone。Mihomo 支持这些条件及 loopback 显式代理 standalone；两者都支持 fragment，片段不代表已部署的系统代理。详见[转换机制](../../../engineering/clash-backends/README.md)。

## 验收条件

共享 policy 的顺序、绑定与 sourceMap 在各目标一致；原生字段按目标编码，IP 规则不触发解析。YAML 中的秘密字符串完整往返，失败整批不发布。不支持的行为报 error，展示 label 仍报 warning。Mihomo 原生 checker 使用精确版本在隔离目录执行；Stash 静态检查不冒充原生或网络验收。
