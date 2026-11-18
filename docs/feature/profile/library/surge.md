# Surge Profile 设置与隧道

目标为 macOS 6.11.0 与 iOS 5.23.0。`surge` 是普通严格对象，接受 `general`、`hosts`、`managed`。节点和隧道列入 Profile 的 `proxies`；分组、路由和 fallback 使用对象引用。

## General 与 Host

`general` 接受单对象或嵌套片段数组，按深度优先、从左到右浅合并；后者整键覆盖，数组不拼接、嵌套对象不深合并，键顺序遵循对象浅合并顺序。每个片段独立校验，非法值不能被后面的覆盖掩盖。

| General 字段 | 接受值 |
| --- | --- |
| `udp-policy-not-supported-behaviour` | `REJECT`、`DIRECT` |
| `loglevel` | `verbose`、`info`、`notify`、`warning` |
| `dns-server` | `system`、IP 或 IP:port 的非空列表 |
| `encrypted-dns-server` | https/h3/quic/tls/tcp DNS URL 的非空列表 |
| `show-error-page-for-reject`、`exclude-simple-hostnames`、`ipv6`、`bypass-system`、`replica` | boolean |
| `http-api-web-dashboard`、`proxy-restricted-to-lan` | boolean |
| `internet-test-url` | HTTP(S) URL，无认证或 fragment |
| `skip-proxy` | 域名模式、IP 或 CIDR 的非空列表 |
| `ipv6-vif` | `auto`、`always`、`disabled` |
| `tls-provider` | `default`、`openssl` |
| `bypass-tun` | CIDR 非空列表 |
| `always-real-ip` | 域名模式非空列表 |
| `http-api`、`external-controller-access` | `{ password: SecretRef, listen: IP:port }` |
| `hijack-dns` | IP、IP:port、`*` 或 `*:port` 的非空列表 |
| `http-listen`、`socks5-listen` | IP 或 IP:port |

列表最多 1000 项，地址端口均受类型校验，拒绝控制字符和原生语法注入。iOS 拒绝 macOS 专属的 `bypass-system`、`replica`、`tls-provider`、`bypass-tun`、`external-controller-access`，也拒绝 processName、MAC 条件。

`hosts` 接受 `SurgeHost` 的嵌套片段，条目为 `{ pattern, address?, server? }`，address 与 server 至少一个。pattern 支持原生域名 glob；address 为 IP 或域名别名；server 为 system、IP DNS 或加密 DNS。顺序保留，不覆盖或去重。与通用 `dns` 的合并及冲突见[DNS 规则](conditions.md#dns-规则)。

## 托管配置

`managed` 为 `{ url, query?, intervalSeconds, strict }`。URL 为 HTTP(S)，不能含 query、fragment 或认证；query 是字符串或秘密引用的字典，用标准 URL 编码，不用生成后替换。query 键以字母开头，只含字母数字、下划线、连字符，最长 128；字符串值最长 4096。intervalSeconds 是 60–2147483647 的整数，strict 是 boolean。

托管 URL 只在渲染时合并秘密查询值。秘密异常及原生格式不能安全表达的值使用固定错误，不打印原文。

## Tailscale

`surge.tailscale({ id, name?, sectionName, authKey, hostname, dnsServer?, autoAddMagicDnsRule?, idleKeepalive? })` 返回 Surge 隧道。authKey 是秘密引用；hostname 为域名；dnsServer 为 DNS 字符串列表；autoAddMagicDnsRule 为布尔值；idleKeepalive 为 -1–2147483647 的整数。

## WireGuard

`surge.wireguard({ id, name?, sectionName, privateKey, selfIp, dnsServer?, mtu?, peers })` 返回 Surge 隧道。privateKey 为秘密引用，selfIp 为 IPv4，mtu 为 576–9000 整数，peers 为 1–1000 项。

每个 peer 为 `{ publicKey, endpoint, allowedIps, presharedKey?, persistentKeepalive? }`。endpoint 为 hostname:port 或 IP:port，allowedIps 为非空 CIDR 列表。publicKey 为 32 字节规范 base64，privateKey 与可选 presharedKey 在渲染时按相同格式校验。persistentKeepalive 为 0–65535 整数。

两种隧道的 sectionName 都匹配 `^[A-Za-z][A-Za-z0-9_-]{0,127}$`，Profile 内唯一。SDK 生成 Proxy 行与专属 section，保留显式字段，不管理运行身份、登录或连接。

select 和 Smart 都可包含 Surge 隧道；Smart 不能包含分组或内置出口。Surge 隧道不能用作 `via`。名称、编码和逻辑选项位置见[Surge 输出](../../targets/format/surge.md)。

## 分组测试参数

`defineProxyGroup` 的 `surge` 分支为 select 分组设置可用性测试：`url` 是 HTTP(S) 测试地址，`intervalSeconds` 与 `timeoutSeconds` 是正整数秒，分别编码为该分组的 `url`、`interval`、`timeout` 参数，取值范围沿用现行实现。省略 `surge` 分支时不输出这些参数。

## 不支持 UDP 的出口

仅当合并后的 `general["udp-policy-not-supported-behaviour"]` 显式为 `REJECT` 时，非 TCP 限定路由和 fallback 可以选择 TCP-only 终端节点或含此类节点的分组。原生客户端按实际选中的终端节点拒绝不支持的 UDP；SDK 不添加辅助拒绝路由，不改变分组成员、顺序或路由。省略或设为 `DIRECT` 时仍执行严格 `TCP_ONLY_EXIT` 检查，不依赖客户端默认值。

这项豁免只适用于终端节点自身，不沿 `via` 传播。对非 TCP 限定路由和 fallback，展开出口的分组成员后，任何节点的 `via` 中存在 TCP-only 可选路径时仍报 `TCP_ONLY_EXIT`：HTTP 终端经支持 UDP 的前置可用，UDP 节点或 HTTP 节点经 TCP-only 前置仍不可用。其它引擎的检查保持不变。

General 的各片段仍独立校验，后片段整键覆盖决定最终策略，非法枚举不能由后值掩盖。`explain` 与 cases 只解释逻辑出口，不模拟运行时分组选择或 UDP 连通性。
