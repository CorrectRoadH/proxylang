---
format: concord.document/v1
id: singbox-tun
title: sing-box 1.14.4 与 TUN 配置
createdAt: 2026-11-04T02:50:28.068Z
kind: engineering
---


# sing-box 1.14.4 与 TUN 配置

## 目标与责任

精确目录新增 sing-box 1.14.4（macOS/Linux）。

保留 1.11/1.12 的输出。

SDK 只生成与校验配置，不启动内核、不创建接口、不安装系统路由；

TUN、路由与 DNS 劫持的运行和退出清理由 sing-box 进程负责，执行者须单独授权运行。

使用本机系统 Tailscale，不复制其他设备 endpoint 身份。

## 输入与输出

Profile 的 singBox 和底层 Program 增加可选 tun：address 为非空 IP CIDR 数组；

stack 为 system/gvisor/mixed；

autoRoute 与 strictRoute 为必填布尔值；

dnsMode 为必填 disabled/native/hijack；

routeExcludeAddress 为可选 IP CIDR 数组。

现有 listener（loopback mixed 端口、IP DNS 上游）保持必填，TUN 为附加入口。

仅 sing-box 1.14.4 standalone 支持 tun；

fragment、其他版本或其他引擎明确报 TUN_TARGET_UNSUPPORTED。

strictRoute=true 要求 autoRoute=true。

不得忽略字段。

渲染生成 tag pl-tun 的 tun inbound，address/stack/auto_route/strict_route/route_exclude_address 一一映射，dnsMode 映射 dns_mode。

采用内核按各地址族首个接口地址加一派生的 DNS 地址；

配置必须预留接口及派生地址，限制每族一个 CIDR，IPv4 前缀不大于 30、IPv6 不大于 126，接口不可位于子网最后地址。

dnsMode 仅控制原生 DNS 配置和自动劫持；

即使 disabled，下面显式路由仍会劫持已进入 TUN 的 53 流量。

启用 autoRoute 时 route.auto_detect_interface=true 防止出站回环。

路由最前添加限定 inbound=pl-tun 的 DNS 劫持（port=53，action=hijack-dns）。

不添加通用 sniff，不改变既有 includeSniffed 能力声明。

DNS 使用现有 listener IP DNS 上游 和显式 DNS 规则，typed DNS 编码按目标目录 dns 能力选择，移除仅等于 1.12.0 的硬编码。

VLESS 新增 flow=xtls-rprx-vision、packetEncoding=xudp/packetaddr、节点级 reality={publicKey,shortId}、utlsFingerprint 字段，仅 sing-box 1.14.4 支持这些新增字段。

Reality 必须显式配合 tls 和 utlsFingerprint=chrome，publicKey 是 32 字节无 padding base64url，shortId 是 0..8 字节偶数位 hex，Vision 必须配合 tls，且不接受 WS。

uTLS 指纹初期仅 chrome。

tls.skipCertVerify 在该精确目标映射 insecure（false 不丢弃）。

其他目标显式使用新增字段报 PROXY_OPTION_UNSUPPORTED。

仅所有引用目标均为 sing-box 1.14.4 时，显式 packetEncoding 开启 VLESS UDP 编码并省略 network:tcp；

未声明时编码和旧目标仍保守 TCP-only。

该能力向 select/urltest/via 传播，任一 TCP-only 路径仍禁止 UDP/fallback。

新字段在不支持目标上必须拒绝。

编码支持不代表服务端 UDP 实际可用。

Reality/uTLS 映射到 tls.reality/tls.utls，均写 enabled:true。

## 消费方

it-infra provider/tohno.ts 保存脱敏输出之外的正式节点参数，UUID 引用应用 secret。

订阅按 sing-box UA 获取，仅提取 VLESS 节点，剔除流量/重置/到期信息伪节点；

不引入订阅内的 DNS、规则、组、实验设置。

构建使用版本化节点快照，不引入网络构建步骤。

新增 13mac Profile，自有 select/urltest 组，仅使用此 provider，私网地址直连，剩余流量代理；

TUN 双栈地址与 tailnet 双栈排除地址显式声明，dnsMode=hijack。

bootstrap 用外部 IP DNS 上游；

不承诺系统 MagicDNS 分域共存，不接入 100.100.100.100。

系统排除路由不等于已验证 sing-box 进程绑定默认网卡后的 tailnet 可达性。

不改四个既有 Surge Profile。

JSON 发布扩展现有 immutable release 的上传、字节验证、指针清单三个步骤，Worker 允许 json 并返回 application/json；current.json 保留为控制文件，不得被路径或 release 白名单公开。原子指针与鉴权不变。

## 验收与非目标

正式 compileProfile/render 与底层 compile 入口验证新版本、协议字段、TUN 输出及错误目标、无效 CIDR、片段拒绝；

sing-box 1.14.4 check 验证完整 13mac JSON，现有测试保证旧版本行为。

Worker 测试 JSON 白名单读取、MIME、缺失 release 不回退与 current.json 拒绝。

SDK 未发布前消费者只作本地候选验证，不把本地 link 写入正式依赖；

报告发布前置条件。

生产上传、SDK npm 发布和系统 TUN 启动均不在本次实施授权内。

## 独立审查收敛

2026-11-03 原生 Codex GPT-6.1 Sol 独立 Review 为 CONDITIONAL。

C1 Reality 强制 uTLS、C3 Vision 强制 TLS 已纳入以上契约。

C2 明确 dnsMode、内核派生地址与 DNS 自指拒绝。

启用 TUN 时，listener 的 DNS 上游、DNS IP 上游、DoH IP 主机及端点引导 DNS 均不得指向回环、未指定地址或任一 TUN CIDR。

DoH 域名运行时解析后的回环无法静态证明。

接口、路由和原生 DNS 的正常启停由 sing-box 进程持有；

异常退出恢复、macOS strict_route 效果、DoH/DoT 无泄漏与 Tailscale 共存仍需运行验收。

review 确认无 TLS Vision 可通过 native check，故正式编译负例是必要证明。

## 域名节点

sing-box 1.14.4 完整配置接受域名节点地址，沿用输出的 `route.default_domain_resolver` 与外部 IP DNS 上游。旧目标继续拒绝完整配置中的域名节点。配置检查不证明域名可解析或节点可连接。
