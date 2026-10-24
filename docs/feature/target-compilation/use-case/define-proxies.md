---
format: concord.document/v1
id: define-proxies
title: 按协议定义代理与有状态端点
createdAt: 2026-10-21T12:39:44.031Z
kind: use-case
feature: docs/feature/target-compilation/README.md
---

# 按协议定义代理与有状态端点

作为复用路由规则的配置作者，我希望通过协议专属字段定义节点，让类型检查阻止密码、UUID、加密方法与传输参数混用；同时将家庭网络端点绑定到相同的规则出口槽位。

## 行为与边界

提供 proxy.http、proxy.trojan、proxy.anytls、proxy.shadowsocks、proxy.vmess、proxy.vless 构造器。节点为严格判别联合，已有对象语法继续有效。UUID与密码使用secret引用；compile/check/explain不读取秘密。新增SS支持三种AEAD方法；VMess为AEAD/aes-128-gcm；VMess/VLESS支持TLS与WebSocket（TLS必须声明serverName，WS禁止authority/query/percent路径），但暂为TCP-only。支持的精确目标、字段和限制见[代理资源契约](../../../engineering/proxy-resources/README.md)。

Tailscale 使用 singbox.tailscale 定义在 program.endpoints 中，独立持有hostname、stateDirectory、acceptRoutes、bootstrapResolver及可选登录密钥/exitNode。仅sing-box1.12.0 standalone支持；route可以引用，组成员和via暂不支持引用端点。不自动转换成Surge/Stash机制，不自动配置MagicDNS或广告路由。

构建器只生成配置，运行方拥有持久身份、登录、路由批准和状态目录。端点与节点/组共用唯一ID；同程序状态目录不可重复或嵌套，构建输出与状态目录不能重叠。不同构建目标不代表可以同时共享身份运行。

## 验收

支持字段逐个无损输出，错误组合与未知字段拒绝；不支持目标、ALPN或UDP路径报error而非warning。秘密按批次解析一次，UUID格式在render使用时验证且错误不回显值。失败保留旧active；生成与离线原生check不创建身份状态目录、不注册tailnet节点。请求案例保持规则顺序与逻辑出口；原生配置检查和实际网络验证分别报告。

代理只承载连接参数及配置身份，应用在协议对象外维护业务分类；完整边界见[代理业务信息](../business-data.md)。
