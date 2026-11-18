# Stash 原生输出

Stash macOS 5.0.0（build 607）只生成 fragment `.yaml`，含 proxies、proxy-groups 与 rules，不生成入口、DNS、TUN、controller 或系统接管设置。宿主配置拥有入口和元数据前提；不能把回环 listener 当作 Network Extension。

## 名字、节点与分组

原生 name 为 `name ?? id`，成员、dialer-proxy、路由引用一致。名字遵守[通用安全限制](surge.md#名字与引用)，另保留 GLOBAL、PASS、COMPATIBLE、REJECT-DROP（不区分大小写）。

支持 HTTP、Trojan、AnyTLS、Hysteria2、SS、VMess 与 TCP-only VLESS。节点与组顺序保留。Trojan 显式 udp=true、block-quic=off；SS 用 ss/cipher/password、udp=true。VMess 用 uuid、cipher=aes-128-gcm、alterId=0、udp=false，TLS 使用 sni，WS 用 network=ws、ws-opts。Hysteria2 密码字段为 auth，跳跃端口用逗号分隔 ports，hop-interval 为秒数；显式 TLS 参数保持。via 用 dialer-proxy。

VLESS 输出 `uuid`、`tls`、`sni` 与可选的 WebSocket 传输，固定 `udp=false`。Stash 5.0.0 的 MTProto 与额外的 VLESS/Trojan 传输由宿主使用。 [官方发布说明](https://releases.stash.ws/appcast.xml)

只支持 select，成员编码 proxies，首项为新配置初始选择；客户端持久选择由运行时拥有。urltest 和 auto 报 `GROUP_ALGORITHM_UNSUPPORTED`，不生成默认 URL、间隔或容差。Stash 节点测速资源与组级固定 URL 不是同一契约，不能丢弃参数或克隆节点来替代。

## 路由与验证边界

域名、目的 IP、单端口、网络、进程与逻辑组合沿[对应 YAML 编码](mihomo.md#条件与-provider)。sourceIp、sourcePort、非单端口范围、远程规则集均拒绝，递归检查每个子条件。不把端口范围展开为大量规则。

IP 省略 noResolve 或 true 生成 `no-resolve`，false 省略；嵌套条件选项保留。每条作者路由生成一条规则，0-based 原生 i 对应 routes[i]，无辅助规则；末尾 MATCH 对应 fallback，没有作者路由序号。DIRECT/REJECT 是原生内置出口。

此目标没有自动化原生检查器，只报告生成结果比对与静态检查。block-quic=off 按字段契约编码，不宣称历史构建上的 QUIC 行为已实测；Mihomo 检查不能替代 Stash 验收。
