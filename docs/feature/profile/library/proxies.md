# 节点、链式构造与端点

`proxy.*` 按协议返回具体的冻结节点类型。连接字段只接收协议允许的数据，密码、UUID 与密钥使用 `SecretRef`，定义和 check 不读取值。资源引用与对象身份见[编写 API](README.md#引用规则)。

## 共同字段

`id` 必填，匹配 `^[a-z][a-z0-9_-]{0,63}$`，不能以 `pl-` 开头。`name` 可选，原生名字为 `name ?? id`。`server` 与 `port` 必填，端口为 1–65535 整数；不在构建机解析域名。`via` 可选，只接受节点或分组对象，表示先经过它再连接当前节点，不自动登记依赖。

节点只承载协议、连接参数、id、name 与目标原生选项。业务分类由应用的普通记录和数组维护，不接受 `region`、`provider`、`tags` 或任意 metadata；按业务筛选时保留原节点对象，不能复制成形状相同的新对象。

完整配置通常要求 server 为 IP；sing-box 接受域名，并由声明的 DNS 引导。Surge 原生配置接受域名节点，由客户端解析；fragment 的宿主负责直接 DNS 路径。目标不能提供所需解析语义时拒绝，不在构建期替换成固定 IP。

## 协议字段

| 构造器 | 认证字段 | 其它字段与约束 |
| --- | --- | --- |
| `proxy.http` | `password` 必填、`username` 可选，均为秘密引用 | TCP-only；不接受 TLS 或 Surge UDP 选项 |
| `proxy.trojan`、`proxy.anytls` | `password` 必填 | 可选 `serverName`、`skipCertVerify`；默认校验证书 |
| `proxy.hysteria2` | `password` 必填 | 可选 `serverName`、`skipCertVerify`、`portHopping`、`portHoppingInterval`；支持 TCP/UDP，不接受 `tcpFastOpen` |
| `proxy.shadowsocks` | `password` 必填 | `method` 只接受 `aes-128-gcm`、`aes-256-gcm`、`chacha20-ietf-poly1305`；不接受 TLS、WS、插件或 SS2022 |
| `proxy.vmess` | `uuid` 必填 | AEAD，固定 `alterId: 0` 与 `aes-128-gcm`；可选 `tls`、`transport`；TCP-only |
| `proxy.vless` | `uuid` 必填 | 可选 `tls`、`transport`；扩展见[sing-box](sing-box.md#vless-扩展)；未显式开启 UDP 编码时为 TCP-only |

UUID 在使用时验证为 8-4-4-4-12 十六进制格式，非法时报 `INVALID_UUID_SECRET`，不回显值。批次缓存不能跳过各使用位置的格式校验。

`tls` 为 `{ serverName, alpn?, skipCertVerify? }`，存在即启用 TLS；serverName 必填，避免 WS Host 改变证书身份。Surge 拒绝特殊值 `off`。ALPN 是非空且唯一的列表，每项最多 255 字节、无控制字符；TLS+WS 只能省略 ALPN 或写 `["http/1.1"]`。Surge 不支持显式 ALPN。

`transport` 只接受 `{ type: "ws", path, host? }`，host 为域名。path 匹配 `^/[A-Za-z0-9/._~-]*$`，禁止 `//` 开头、query、percent 与空白。不支持任意 headers、early data、gRPC 或 XHTTP。省略 transport 为普通 TCP。

`portHopping` 为分号分隔端口或闭区间，例如 `443;40000-60000`，不得倒置或超出 1–65535。主端口仍必填，Surge 启用跳跃后忽略它；跳跃不能在 Surge 与 `via` 同用。`portHoppingInterval` 为正整数秒，必须同时声明跳跃列表，省略时使用客户端默认。

## 目标选项与 UDP

普通协议节点可声明 `tcpFastOpen?: boolean`。Surge 支持；sing-box 编码 `tcp_fast_open`，但 AnyTLS 不接受 true。其它目标遇到显式值（包括 false）拒绝。Trojan/AnyTLS 的 `skipCertVerify` 与 VMess/VLESS 的同名 TLS 字段按目标能力编码，不可丢弃。

`surge?: { udpRelay?: boolean; blockQuic?: "auto" | "on" | "off" }` 是明确的目标选项。HTTP 拒绝；SS 可用 udpRelay true/false，Trojan/AnyTLS 仅接受 true；VMess 只接受 blockQuic。SS 默认开启 UDP、`block-quic=off`；显式 udpRelay false 使该路径 TCP-only。blockQuic auto/on 不等于禁用全部 UDP。

sing-box 接受 Trojan/AnyTLS/SS 的 `surge.udpRelay: true`，因为与该目标的既有 UDP 能力相同；其余 Surge 专属参数拒绝。AnyTLS 在 Surge 与 sing-box 支持 UDP，其它目标保持能力目录的限制。

TCP-only 沿全部可选成员及 `via` 路径传播；非 TCP 限定路由和 fallback 指向这种路径时报 `TCP_ONLY_EXIT`，显式拒绝策略的例外见 [Surge](surge.md#不支持-udp-的出口) 与 [sing-box](sing-box.md)。编码支持不证明远端节点或 QUIC 可连通。

## builder

`proxy.builder(base)` 接受已由构造器创建的具体协议节点，返回不可变 builder。`.via(nodeOrGroup)`、`.name(text)`、`.tcpFastOpen(boolean)` 都返回新 builder，`.build()` 返回独立冻结的同协议节点。分叉互不污染，SDK 引用与秘密句柄按身份保留。

`.via()` 替换一个依赖，不追加路径；`A.via(B)` 的路径为客户端 → B → A → 目的地。未 build 的 builder 不是节点，不能列入 Profile。builder 不负责登记出口，完整依赖图由 Profile 检查。

## `proxyId`

`proxyId(namespace, name)` 返回 `node-` 加 `sha256(JSON.stringify([namespace, name]))` 的前 16 个十六进制字符。两个参数必须是非空字符串，保留大小写，不规范化或推断业务属性；错误不回显值。它只生成稳定 id，不改变节点对象或原生名字。

## sing-box Tailscale endpoint

`singbox.tailscale({ id, name?, hostname, stateDirectory, acceptRoutes, bootstrapResolver, authKey?, exitNode?, exitNodeAllowLanAccess? })` 返回 `SingBoxEndpoint`。hostname 是 DNS 单标签，bootstrapResolver 是 IP；authKey 为秘密引用，exitNode 为 IP，exitNodeAllowLanAccess 只在 exitNode 存在时可写。

`stateDirectory` 接受规范的绝对或相对 POSIX 路径，例如 `/var/lib/mesh` 或 `identities/mesh`。拒绝根目录、空段、`.`、`..`、`$`、反斜杠和控制字符。相对路径也拒绝盘符前缀和以 `~` 开头的路径。客户端按自己的工作目录解析相对路径。重叠规则见[资源图](../../targets/README.md#资源图)，运行方须保证真实路径和身份独占。

只在带 `with_tailscale` 的 sing-box standalone 支持。列入 `Profile.proxies` 后可作为路由、fallback、案例出口与 `group.select()` 成员。`group.urltest()`、`group.auto()` 与节点 `via` 不接受直接引用。此端点不广告子网或出口，业务 MagicDNS 由作者配置。

客户端拥有登录、身份、路由批准和状态目录；没有 authKey 时由运行方提供已有身份或登录。SDK 与原生配置检查不创建、读取、复制或清理身份目录。引导 DNS 与业务 DNS 分开，详见[输出](../../targets/format/sing-box.md#endpoint)。
