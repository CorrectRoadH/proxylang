# Mihomo 原生输出

Mihomo 1.19.32 在 macOS/Linux 生成 UTF-8 `.yaml`。节点、组和规则分别位于 proxies、proxy-groups、rules；序列化保留字符串值，不用原生文本拼接秘密。

## 名字、节点和分组

原生 name 为 `name ?? id`，所有组成员、dialer-proxy 与规则引用同步映射。名字遵守[通用安全限制](surge.md#名字与引用)，另保留 GLOBAL、PASS、COMPATIBLE、REJECT-DROP、PASS-RULE（不区分大小写）。

Trojan 显式 udp=true；SS 使用 ss/cipher/password、udp=true；HTTP、AnyTLS、VMess 与 VLESS 保守 TCP-only。VMess 使用 uuid、cipher=aes-128-gcm、alterId=0；VMess/VLESS 设置 udp=false，TLS 使用 servername，WS 使用 network=ws、ws-opts.path/headers.Host。Hysteria2 使用 password、sni、skip-cert-verify，ports 用逗号分隔、hop-interval 为秒数。via 编为 dialer-proxy。

select 编码 select，proxies 成员保持顺序；首成员为新配置初始选择，运行时持久选择由客户端拥有。urltest 编码 url-test，固定输出作者 URL、interval（默认 180 秒）、tolerance（默认 50 毫秒）。不添加 sing-box 的 idle_timeout 或 interrupt_exist_connections。

`group.auto()` 选择 URLTest，默认 URL 为 `https://www.gstatic.com/generate_204`，interval=180、tolerance=50；固定 urltest 的 URL 必填，禁止认证和 fragment。check 记录算法选择。

## 条件与 provider

domain/domainSuffix 编码 DOMAIN/DOMAIN-SUFFIX，CIDR 按地址族编码 IP-CIDR/IP-CIDR6；省略 noResolve 或 true 输出 `no-resolve`，false 省略。顶层选项放出口后，嵌套选项保留在对应条件内。sourceIp、sourcePort、port、network、processName 编码 SRC-IP-CIDR、SRC-PORT、DST-PORT、NETWORK、PROCESS-NAME；范围用 `a-b`。逻辑组合用 AND/OR/NOT。

rules 保持作者顺序，每条产生一条原生规则，0-based 原生 i 对应作者 routes[i]，不插入辅助规则。末尾 MATCH 对应 fallback，没有作者路由索引。内置出口编码 DIRECT/REJECT。

规则 provider 使用去重代表 id 作名字，type=http、url、interval、behavior、format，path 为 `rule-providers/pl-<id>.yaml` 或 `.txt`，下载 proxy 固定 DIRECT。规则用 RULE-SET,id 引用，不下载或转换远程内容。来源去重见[规则集](../../profile/library/conditions.md#来源冲突与复用)。

## standalone

fragment 只有上述片段，不带入口或 DNS。standalone 必须声明 listener，输出 mixed-port、allow-lan=false、bind-address=127.0.0.1。mode=rule、ipv6=false、geo-auto-update=false、sniffer.enable=false。

DNS enable=true、ipv6=false、enhanced-mode=redir-host。nameserver 与 default-nameserver 均为 `listener.resolver`；respect-rules、use-hosts、use-system-hosts 均 false，省略 dns.listen。不设置外部控制器或系统代理，不依赖 geodata 下载。Profile 的非空 DNS 规则与 TUN 不支持。

原生检查使用固定版本内核在隔离目录运行配置检查，不启动服务，不代表节点连通或 DNS 运行验收。
