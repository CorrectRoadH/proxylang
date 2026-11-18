# sing-box Profile 选项

`target` 为 sing-box 1.14.4，平台为 macOS 或 Linux。引擎设置写入 `singBox`，字段严格校验。`mode` 省略为 standalone；fragment 只提供可合并的出站、分组、路由和规则集，宿主拥有入口、DNS、工作目录与元数据前提。

## 版本与模式矩阵

“拒绝”包括显式 false 或空对象；“需要”表示必须提供。“空”表示空 DNS 列表等同省略。

| 选项或能力 | standalone | fragment |
| --- | --- | --- |
| `listener` | 需要 | 拒绝 |
| 非空 Profile `dns` | 支持 | 拒绝 |
| `tun` | 支持 | 拒绝 |
| `domainMatching: "prefer-sniffed"` | 支持 | 支持 |
| `serverAliases` | 支持 | 支持 |
| `cacheFile` | 支持 | 拒绝 |
| `unsupportedUdp: "reject"` | 支持 | 支持 |
| Tailscale endpoint | 支持 | 拒绝 |
| 显式 IP `noResolve` | 支持 | 支持 |
| 规则集分支显式 `resolve` | 支持 | 支持 |
| `includeSniffed: true` | 需要 prefer-sniffed | 需要 prefer-sniffed |
| VLESS 扩展 | 支持 | 支持 |
| select 内置直连/拒绝成员 | 支持 | 支持 |

`listener` 为 `{ port, resolver }`，端口为 1–65535 整数，`resolver` 是 IP DNS 上游，只监听回环。fragment 不得静默忽略 listener。DNS 规则和辅助规则的原生编码见[输出页](../../targets/format/sing-box.md)。

`domainMatching` 只接受 `"prefer-sniffed"`，在业务规则前执行 HTTP/TLS 嗅探，所有域名条件优先使用有效嗅探域名，缺失时用原域名，不覆盖连接目的地。`includeSniffed: true` 不能隐式开启此设置。

`serverAliases` 是精确域名到域名/IP 的单跳字典，仅替换节点拨号 server，不改变业务 DNS；保留显式 TLS 身份，否则用原 server 作为 TLS 身份。不递归解析字典。

`cacheFile` 是布尔值。true 开启原生 `experimental.cache_file`，false 不生成；默认 `cache.db` 归客户端稳定工作目录，SDK 不创建或删除。无缓存时下载失败拒绝启动，有效缓存可跨重启复用，更新失败处理沿用客户端行为。

`unsupportedUdp: "reject"` 允许路由和 fallback 的候选含 TCP-only 节点；选中该出口时由原生拒绝 UDP，不切换为直连。它不改变节点能力，也不保证测速算法选择相同节点。省略时检查仍拒绝可能到达 TCP-only 路径的 UDP。

## TUN

`tun` 为 `{ address, stack, autoRoute, strictRoute, dnsMode, routeExcludeAddress? }`。address 是非空 CIDR 数组，stack 为 `system`、`gvisor` 或 `mixed`；autoRoute、strictRoute 为必填布尔值；dnsMode 为 `disabled`、`native` 或 `hijack`；排除地址为 CIDR 数组。

strictRoute true 要求 autoRoute true。每族只允许一个 CIDR，IPv4 前缀不大于 30，IPv6 不大于 126，接口不可位于子网最后地址，须为内核按接口地址加一派生的 DNS 地址预留空间。listener 仍必填，TUN 是附加入口。

listener DNS 上游、DNS IP 上游、DoH 的 IP 主机及 endpoint 引导 DNS 不得指向回环、未指定地址或 TUN 网段。SDK 不能证明 DoH 域名运行时不会解析到回环。

dnsMode 只控制原生 DNS 配置和自动劫持；显式的 TUN 53 端口路由仍会劫持进入 TUN 的 DNS。接口、系统路由与正常退出清理由客户端拥有；SDK 不启动内核、安装路由或接管网络。异常退出、系统 DNS 共存和实际路由须单独运行验收。

## VLESS 扩展

1.14.4 接受 `flow: "xtls-rprx-vision"`、`packetEncoding: "xudp" | "packetaddr"`、`reality: { publicKey, shortId }` 与 `utlsFingerprint: "chrome"`。Vision 必须 TLS 且不能用 WS；Reality 必须 TLS 与 chrome uTLS。

publicKey 为 32 字节无 padding 的 base64url；shortId 为 0–8 字节、偶数位 hex。显式 packetEncoding 允许该节点 UDP 并输出 `packet_encoding`；省略时仍为 TCP-only。其它目标遇到这些字段报 `PROXY_OPTION_UNSUPPORTED`，不能忽略。
