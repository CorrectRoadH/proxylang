---
format: concord.document/v1
id: proxy-resources
title: 代理节点与平台端点
createdAt: 2026-10-21T12:39:43.405Z
kind: engineering
---

# 代理节点与平台端点

## 要解决的问题

规则组合只需要一个可引用出口，却不能据此把出口实现都压成服务器加密码。SS 的 method、VMess/VLESS 的 UUID 是协议契约；Tailscale 则持有运行时网络身份。共享 ID 与路由动作，不共享一张装满可选字段的表。

## 数据与语法

`ProxyNode` 是按 `type` 区分的严格联合。共同字段为 id、server（完整配置仅 IP）、port、via、label、region、provider、tags。已有 HTTP（password 必需、username 可选）、Trojan/AnyTLS（password、serverName 可选）对象保持兼容，不改旧字段语义。新增 `proxy.http/trojan/anytls/shadowsocks/vmess/vless(options)` 返回对应具体节点类型；构造器只加 type，不解析秘密，schema 是运行时权威。

- Shadowsocks：type=shadowsocks，method 必填，只接受 aes-128-gcm、aes-256-gcm、chacha20-ietf-poly1305；password 为 Secret。支持 TCP/UDP，不接受 TLS、transport、SS2022 或插件字段。
- VMess：uuid 为 Secret；本次只实现 AEAD（alterId=0）和 aes-128-gcm 加密，不暴露其它 cipher/alterId。可选 tls 和 transport；UDP 暂不承诺，因为 packet encoding 尚未建模。sing-box/Mihomo/Stash 原生显式关闭 UDP / 限定 TCP。Surge 的 VMess 自动支持 UDP，语言只保证所生成路由不将 UDP 送到该节点；组合 fragment 时不能绕过此约束。
- VLESS：uuid 为 Secret；可选 tls 和 transport；同样 TCP-only。本次不支持 flow、Reality、XTLS、multiplex、packet encoding。
- tls 为 `{ serverName: string, alpn?: readonly string[] }`，serverName 必填以避免 WS Host 改变证书身份。存在即启用 TLS，默认校验证书。serverName 使用域名 schema；Surge 拒绝特殊字面量 off，避免关闭 SNI。ALPN 为非空、无控制字符、每项最多255字节的唯一列表。不支持 insecure 别名。TLS+WS 只能省略 ALPN 或明确使用 ["http/1.1"]。
- transport 为 `{ type: "ws", path: string, host?: string }`；无 transport 即普通 TCP。path 匹配 `^/[A-Za-z0-9/._~-]*$`，同时禁止 // 开头、query/percent/空白，避免 Mihomo 从 ed 查询参数隐式启用 early data；host 使用域名 schema。不支持 arbitrary headers、early data、gRPC/XHTTP 等字段。

所有未知字段严格报错。协议特有字段在类型与 schema 双重约束。UUID 仍是 Secret，compile 不读取；render 按使用位置验证规范 8-4-4-4-12 十六进制 UUID，无效报 `INVALID_UUID_SECRET`，不回显值。不同协议共用 token 只解析一次，不能因为缓存而跳过 UUID 格式验证。

## 精确目标与转换

|目标|新增节点|TLS / WS|端点|
|---|---|---|---|
|Surge macOS 6.10.0|SS、VMess|VMess TLS/WS；ALPN 暂不支持|无|
|sing-box 1.11.0|SS、VMess、VLESS|TLS/WS/ALPN|无|
|sing-box 1.12.0|SS、VMess、VLESS|TLS/WS/ALPN|Tailscale|
|Mihomo 1.19.32|SS、VMess、VLESS|TLS/WS/ALPN|无|
|Stash macOS 4.2.1|SS、VMess|TLS/WS/ALPN|无|

这是 proxylang 编码范围，不代表客户端完整能力。Stash 当前文档新增协议不能证明历史4.2.1支持，因此 VLESS 拒绝，原生检查仍未验证。Surge VMess UUID 编为 username，vmess-aead 显式 true、encrypt-method=aes-128-gcm，TLS 编为 tls/sni，WS 编为 ws/ws-path/ws-headers。SS 编为 ss + encrypt-method + udp-relay=true + block-quic=off。不可无损表示的 WS path 在 schema 阶段报错，不静默改写或推迟到读取 secrets 后；秘密分隔符仍由 render 拒绝。

sing-box 使用 shadowsocks/method/password，VMess uuid/security=aes-128-gcm/alter_id=0，VLESS uuid。两种 UUID 协议设 network=tcp，tls.enabled/server_name/alpn，transport.type=ws/path/headers.Host。

Mihomo/Stash 的 SS 为 ss/cipher/password，VMess 为 uuid/cipher=aes-128-gcm/alterId=0，VLESS 为 uuid。两种 UUID 协议设 udp=false、TLS 的 servername（Mihomo）或 sni（Stash），network=ws/ws-opts.path/headers.Host。SS设udp=true，已有节点输出不变。

能力检查先验证全数据树、引用与协议组合，再逐目标检查。行为不支持为 error（如 PROTOCOL_UNSUPPORTED、PROXY_OPTION_UNSUPPORTED、ENDPOINT_UNSUPPORTED）；只有 label 这样的纯展示字段允许 warning。warningsAsErrors 规则不变。TCP-only 状态穿透组与 via 图，UDP 可达规则和 fallback 拒绝不支持的出口。

## Tailscale 的身份和所有权

公开 `singbox.tailscale(options)` 返回 `TailscaleEndpoint`，type=`sing-box-tailscale`。`Program.endpoints?: readonly TailscaleEndpoint[]` 独立于 nodes。必须声明 id、hostname（DNS单标签）、stateDirectory、acceptRoutes:boolean、bootstrapResolver:IP。stateDirectory 为规范绝对 POSIX 路径，不允许根目录、空段、.、..、环境变量、反斜杠、控制字符。

可选 authKey:Secret、exitNode:IP、exitNodeAllowLanAccess:boolean（仅在 exitNode 存在时可用）。没有 authKey 表示运行方已有身份或另行登录，构建器不代办。

端点只支持带 with_tailscale 构建标签的 sing-box 1.12.0。顶层 endpoints 输出 type=tailscale、tag、state_directory、hostname、accept_routes，以及可选登录密钥、出口节点及 LAN 访问设置。

不广告子网/出口，不自动启用 MagicDNS。新增一个固定直连的 typed UDP DNS server `pl-ts-dns-<id>`，端点 domain_resolver 指向它；它与 standalone 的普通 DNS 共存，只负责控制面引导解析。

端点只允许 standalone，普通 DNS 与 final 必须指向 `listener.resolver` 对应的 pl-dns；fragment 报 ENDPOINT_MODE_UNSUPPORTED，避免单个引导 DNS 成为默认解析器。普通路由规则不会把端点自己的拨号再送回自身。

节点、组、端点共用唯一 ID 命名空间；route(id) 能引用端点，策略组成员与 node.via 暂时不能引用端点（ENDPOINT_REFERENCE_UNSUPPORTED），避免未经验证地承诺混用生命周期和拨号能力。端点支持 TCP/UDP。

组片段 API 没有 endpoints 参数，不能偷偷接受端点。

同一个程序中的 stateDirectory 不得重复或互为祖先。

不同目标是可选构建产物，不声称会同时运行；manifest 必须说明每个运行实例独占状态目录，跨程序/跨主机的排他性由运行方保证，不能同时运行共享身份的替代目标。构建和原生 check 不启动 tailnet，不创建、复制、读取、清理身份目录。

`buildToDirectory` 在写目录或读取 secrets 前，按规范路径检查 output 与所有 stateDirectory 的相等/祖先关系，重叠返回 ENDPOINT_STATE_OVERLAP。这是词法防误用，不是远端运行主机的符号链接证明；实际运行方必须保证状态目录及其真实路径独立于生成产物与清理范围。

输出 manifest 记录这个前置条件，身份与 generation 生命周期分离。

## 模块边界

types/schema 拥有判别模型与组合校验，dsl 拥有数据构造；新 proxies 模块拥有节点目标检查、凭据使用检查与三类编码器，render 继续拥有一次性秘密缓存和整批产物；compiler 拥有引用、目标和端点状态声明检查。host 只增加 output/state 重叠守卫，不负责运行时身份。避免 renderer 使用任何默认分支将未知协议编码成 HTTP/TLS。

## 验收

真实 compile/render 覆盖所有支持的组合、字段的精确原生输出、UUID秘密跨目标一次解析、无效UUID不泄漏、UDP经组/via拒绝、严格schema、目标版本拒绝、端点引用及重复/重叠状态路径。真实 build 验证失败保留active与不创建状态目录。

增加可运行 examples/proxies/proxylang.config.ts 和 README 用法。Surge 6.10.0、sing-box 1.11.0/1.12.0、Mihomo1.19.32在隔离目录离线校验；Tailscale用1.12.0 checker且确认不写身份目录，原生check不等于tailnet登录或连接验收。CI保留Node24/vp并执行新测试，Stash无native证据明确标注。

## 证据与审查

依据：[Surge SS](https://manual.nssurge.com/policies/shadowsocks.html)、[Surge VMess](https://manual.nssurge.com/policies/vmess.html)、[Mihomo VLESS](https://wiki.metacubex.one/config/proxies/vless/)、[Stash 协议](https://stash.wiki/proxy-protocols/proxy-types)、[sing-box1.12.0 endpoint字段](https://github.com/SagerNet/sing-box/blob/v1.12.0/option/tailscale.go)、[端点初始化与状态](https://github.com/SagerNet/sing-box/blob/v1.12.0/protocol/tailscale/endpoint.go)。当前文档只提供字段依据，精确版本原生checker承担配置接纳验证。

重大边界：核心节点联合、端点引用空间及持久身份所有权。需要独立原生 Codex GPT-6.1 Sol 审查，结论收敛后实施。独立原生 Codex GPT-6.1 Sol 审查结论为 CONDITIONAL。已采纳全部必要修订：拒绝 // authority 路径；TLS serverName 必填；Tailscale 仅 standalone 并隔离普通 DNS/final；Surge SS 显式开启 UDP、关闭 QUIC 阻断。AEAD 固定算法、WS query/percent 限制与 WS ALPN 限制亦获认可。实现须用原生检查及字段断言验证这些边界。

## 节点迁移扩展

链式 builder、Surge TLS/TFO/UDP 显式参数及域名节点片段按[节点片段契约](../proxy-node-fragments/README.md)实现。完整配置仍仅接受 IP；片段允许由原生配置拥有的外部符号。AnyTLS 在 Surge 支持 UDP；SS 显式禁用 UDP 后的 TCP-only 约束沿组及 via 传播。
