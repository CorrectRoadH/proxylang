---
format: concord.document/v1
id: clash-backends
title: Mihomo 与 Stash 后端边界
createdAt: 2026-10-21T12:15:57.882Z
kind: engineering
---

# Mihomo 与 Stash：复用规则，不合并平台身份

同一个策略模板应能在 Mihomo 和 Stash 中复用，但两个客户端不能被表示成一个笼统的 clash target。它们都使用 YAML，只说明传输格式相近；来源匹配、代理链和系统入口仍有不同版本边界。

## 语言与平台身份

Engine 扩展为 surge、sing-box、mihomo、stash。

策略 implementations 增加独立 mihomo 和 stash 键；共享 id、members 与规则模板不变。

没有对应键仍报 STRATEGY_IMPLEMENTATION_MISSING，Surge Smart 绝不自动变成 URLTest。

作者显式写 mihomo: group.urltest(...) 才选择 Mihomo 测速组；Stash 首期只接入 select。

Stash 的测速 URL 属于节点，多个组共享节点测试结果，不能保持当前组级 URL 契约，因此 group.urltest 在 Stash 报 GROUP_UNSUPPORTED；不能静默忽略 URL 或克隆节点。

后续若增加 Stash 原生测速机制，需单独设计节点测试资源。



目标仍由 engine、platform、精确 version 三元组查目录。首期注册 Mihomo 1.19.32（macos、linux）和 Stash 4.2.1（macos，对应 build 487）；不新增 iOS 枚举，iOS 版本号不能用来表示 macOS。未注册版本报 UNKNOWN_TARGET。注册的是可编码的有限能力，不声称整个客户端配置模型均已实现。

## 编译边界与输出

继续先检查整个输入树，再按 target lower strategy、验证协议与组能力、验证条件，最后渲染。共享 IR、首命中顺序、来源映射与静态解释保持不变。新引擎各自产生 YAML 文件；不把现有 sing-box JSON 分支作为其它引擎的默认分支。YAML 通过标准序列化库输出，密码是字符串值，包含引号、换行或逗号时仍保持原值，不能拼接注入规则。

Mihomo 与 Stash 共享明确相同的 proxy/group/rule codec；差异由 engine 显式分支和目录能力约束处理。

节点支持 HTTP、Trojan、AnyTLS、SS 和 VMess；Mihomo 另支持 VLESS。具体字段与 TLS/WS 边界见[代理资源契约](../proxy-resources/README.md)。订阅、provider、远程规则集、DNS policy 或 TUN 尚未实现。

两目标分别维护精确协议目录；Stash 4.2.1 不编码 VLESS。

Trojan 显式启用 UDP；Stash 节点另设 block-quic: off，避免客户端默认拦截改变语言行为。

HTTP/AnyTLS/VMess/VLESS 使用 TCP-only 检查，SS 显式启用 UDP。

TLS 使用 sni，不关闭验证。

两目标 via 均编码为 dialer-proxy，延续图检查与 TCP-only 传播；不能丢弃。



select 编码为 select，顺序保存，首成员是新配置的初始选择；运行时持久选择不由编译器控制。

Mihomo urltest 编码为 url-test，url 原样，interval 默认 180 秒，tolerance 默认 50 毫秒。

迁移入口 compileStrategyGroups 同样接受新引擎：返回类型不变，artifactKind 仍是 strategy-groups，content 是 YAML 顶层 proxy-groups 映射，仅包含组，不是可直接运行的配置。

节点 nativeName 映射和最终重名校验继续作用；Mihomo / Stash 原生名映射须额外拒绝 GLOBAL、PASS、COMPATIBLE、REJECT-DROP（不区分大小写）；DIRECT、REJECT 与 pl- 约束保持原样。

Mihomo 另外禁止 PASS-RULE。完整配置的稳定小写 ID 与原生大写内建名不会混淆。



## 规则保真

domain / domainSuffix 对应 DOMAIN / DOMAIN-SUFFIX；ipCidr 按地址族输出 IP-CIDR / IP-CIDR6，并启用 `no-resolve`。

port 对应 DST-PORT；network 对应 NETWORK。

Mihomo 来源匹配使用 SRC-IP-CIDR、SRC-PORT，port 范围用 a-b 保持闭区间。

Stash 4.2.1 对 sourceIp/sourcePort 及 from != to 的 port 报 MATCH_UNSUPPORTED；递归检查包含 not/all/any 的每个子条件。

不展开成可能失控的几万条规则。

all / any / not 对应 AND / OR / NOT，嵌套条件不能遗漏 `no-resolve`；不支持某个子条件时整条规则与整批构建失败。

fallback 始终生成最后一条 MATCH，direct/reject 对应 DIRECT/REJECT。



客户端可拥有缓存、持久选择和不同元数据可见性。规则语言声明的是已观测元数据上的谓词：IP 条件不得主动触发 DNS。fragment 消费者必须提供这些前提，最终目标计划记录限制；静态解释不冒充运行时实测。

## 入口和验证

Mihomo standalone 仅输出 loopback mixed-port，mode: rule，allow-lan: false，bind-address: 127.0.0.1。

DNS enabled 为 true、enhanced-mode 为 redir-host、nameserver 与 default-nameserver 都是 `listener.resolver`。respect-rules 为 false；关闭 sniffing、IPv6 DNS 和 geodata 自动更新，mode 为 rule，不设置外部控制器或系统代理。

dns.use-hosts 与 dns.use-system-hosts 都为 false，dns.listen 省略，仅使用内部解析器。没有 GEO 规则与 provider，不依赖 geodata 下载。

Stash 首期只提供 fragment，standalone 报 MODE_UNSUPPORTED，因为系统 Network Extension 的接管不是一个 loopback listener 的等价实现。

未请求入口的 fragment 不携带入口参数。



不支持的条件、协议、代理链、组算法与运行模式都为 error；LABEL_NOT_EMITTED 仍是可升级 warning。编译不读秘密，整批失败不返回部分计划，构建不发布部分产物。

验收覆盖不同 target 共享一份 policy、显式 strategy 选择、未知版本、嵌套不支持条件、UDP 限制、via 图和最终名称碰撞、YAML 秘密往返与实际 CLI 原子构建。Mihomo 下载固定版本 checker，在隔离目录执行 -t，先核对版本；不得启动代理或修改系统网络。Stash 未取得可自动化的原生校验器前，只报告格式与静态检查，不标记 nativeValidation 为通过。原有 Surge / sing-box 测试必须继续通过。

## 来源与支持证据

- [Mihomo 1.19.32](https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.32)、[规则](https://wiki.metacubex.one/config/rules/)、[URLTest](https://wiki.metacubex.one/config/proxy-groups/url-test/)、[代理链](https://wiki.metacubex.one/config/proxies/dialer-proxy/)。
- [Stash 固定历史版本](https://stash.ws/macos/previous-versions)、[规则](https://stash.wiki/rules/rule-types)、[节点测试资源](https://stash.wiki/proxy-protocols/proxy-benchmark)、[协议](https://stash.wiki/proxy-protocols/proxy-types)、[代理链](https://stash.wiki/proxy-protocols/dialer-proxy)。来源规则标为 macOS 4.4 Beta，不能回填进 4.2.1 目录。当前在线文档不是历史构建全部能力的原生证明，因此 Stash 必须标记原生未验证。

## 审查收敛

独立原生 Codex / GPT-6.1 Sol 审查为 CONDITIONAL；采用两项修订：Mihomo 迁移名称禁用 PASS-RULE，standalone 明确禁用 hosts 并省略 DNS listener。实现验收须同时检查顶层与嵌套 AND/OR/NOT 的 `no-resolve` 位置。

Stash 4.2.1 的 `block-quic: off` 历史行为未取得原生验证，仅按官方现行字段编码，不宣称 QUIC 保真已实测。目标计划必须记录此限制。
