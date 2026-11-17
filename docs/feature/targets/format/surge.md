# Surge 原生输出

Surge macOS 6.10.0 与 iOS 5.21.0 生成 UTF-8 `.conf`。托管行在文件开头，随后按声明编码 General、Proxy、Proxy Group、Rule、Host 和隧道 section。没有原生检查器的自动化保证；生成结果比对不证明设备上的网络行为。

## 名字与引用

节点、隧道与组用 `name ?? id`，所有路由、成员与 `underlying-proxy` 同步使用此映射。名字允许 Unicode、emoji 与内部空格，最长 256 字符；拒绝空串、首尾空白、控制字符、行分隔符及 `,=[]()#;`。`pl-` 前缀及 DIRECT、REJECT、REJECT-DROP、REJECT-NO-DROP、REJECT-TINYGIF 不区分大小写保留。

名字非法报 `NAME_UNSAFE`，最终名字碰撞报 `DUPLICATE_NATIVE_NAME`。隧道 sectionName 独立检查唯一。修改名字可能重置客户端持久选择。

## 节点与分组

HTTP 编码用户名和密码；Trojan、AnyTLS 编码密码、SNI 与显式 TLS/TFO/UDP 参数。SS 编码 `ss`、`encrypt-method`、`udp-relay=true`、`block-quic=off`，显式选项按[节点契约](../../profile/library/proxies.md#目标选项与-udp)覆盖。

VMess UUID 编为 `username`，固定 `vmess-aead=true`、`encrypt-method=aes-128-gcm`，TLS 用 `tls`/`sni`，WS 用 `ws`/`ws-path`/`ws-headers`。Hysteria2 使用 `hysteria2`、`port-hopping`、`port-hopping-interval`，保留未声明字段的原生默认。链式代理使用 `underlying-proxy`。

select 编码 `select`，Smart 编码 `smart`，成员按声明顺序，不插入默认测试参数。select 首成员是新配置的初始选择，运行时持久选择由客户端拥有。`group.auto()` 选择 Smart；固定 `group.urltest()` 不支持，不生成 URLTest 默认 URL、间隔或容差。

## 条件与路由

域名、后缀、IPv4、IPv6、ASN、源 IP、目标端口、源端口、网络分别编码 DOMAIN、DOMAIN-SUFFIX、IP-CIDR、IP-CIDR6、IP-ASN、SRC-IP、DEST-PORT、SRC-PORT、PROTOCOL。进程和 MAC 分别编码 PROCESS-NAME、MAC-ADDRESS。all/any/not 编码 AND/OR/NOT，保留括号与子条件顺序。

顶层 `no-resolve`、`extended-matching` 与 `update-interval=N` 放在出口之后，逻辑子条件选项放在对应括号内。嵌套更新间隔拒绝。外部规则集编码 RULE-SET 或 DOMAIN-SET 加 URL，内置集合用 LAN/SYSTEM，不下载内容。

每条作者路由产生一条原生 Rule 行，无辅助路由重排；0-based 原生规则索引 i 映射作者 `routes[i]`。最后追加 FINAL，其来源是 fallback，没有作者路由序号。内置出口分别编码 DIRECT 与各 REJECT 形式。

## DNS 与隧道

通用 DNS 条目在 Host 段中位于原生 hosts 前，DoH 路径和端口保持。隧道生成 Proxy 行及对应 Tailscale/WireGuard section，字段与格式限制见[Surge 编写 API](../../profile/library/surge.md)。

密码、密钥等值只进入构建产物；参数中不能安全表达的逗号、控制字符或分隔符必须拒绝，不能截断、改写或插入原生行。
