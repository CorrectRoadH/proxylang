# sing-box 原生输出

1.12.0 与 1.14.4 生成 UTF-8 `.json`，两者都有 macOS/Linux、standalone/fragment。具体版本与模式的选项矩阵由[编写页](../../profile/library/sing-box.md#版本与模式矩阵)唯一维护，两种模式都只接受该版本允许的字段。

## 模式与固定字段

| 内容 | 1.12.0 standalone | 1.12.0 fragment | 1.14.4 standalone | 1.14.4 fragment |
| --- | --- | --- | --- | --- |
| log、outbounds、route | 生成 | 生成 | 生成 | 生成 |
| loopback mixed 入站、typed DNS | 生成 | 不生成 | 生成 | 不生成 |
| DNS 路由 UDP 入口 | 不生成 | 不生成 | 有非空 dns 时生成 | 不生成 |
| endpoint 与其引导 DNS | 声明时生成 | 不接受 | 声明时生成 | 不接受 |
| TUN、cache_file | 不接受 | 不接受 | 声明时生成 | 不接受 |
| sniff、逐路由解析辅助动作 | 不生成 | 不生成 | 声明所需时生成 | 声明所需时生成 |

固定 `log.level=warn`。直连内部 tag 为 `pl-direct`；select 内置拒绝使用 `pl-reject` block 出站，只在支持它的 1.14.4 select 成员需要时生成。资源 tag 为 `name ?? id`，成员、default、detour、路由与 final 使用同一映射。名字的通用安全限制见[Surge 名字规则](surge.md#名字与引用)，sing-box 保留 DIRECT、REJECT 及 `pl-` 前缀。

standalone mixed 入站 tag 为 `pl-listener`，监听 127.0.0.1 和 listener.port。普通 typed UDP DNS 为 `pl-dns`，上游是 `listener.resolver`:53，策略 `prefer_ipv4`，DNS final 为 pl-dns；不设置导致 typed UDP 启动失败的无意义 direct detour。

fragment 不携带 inbounds 或 DNS，宿主必须提供入口、直接 DNS 路径、工作目录及路由元数据。fragment 的 `sniff/resolve` 是显式声明的路由行为，不推断宿主拥有相同设置。原生检查先合入最小宿主 fixture，并单独断言片段不含宿主字段。

## 分组与协议

select 编码 selector，outbounds 保持顺序，default 为首成员，`interrupt_exist_connections=false`。urltest 编码 URLTest，URL 必填，无认证或 fragment；省略参数时 interval=180s、tolerance=50，固定 `idle_timeout=30m`、`interrupt_exist_connections=false`。

`group.auto()` 选择 URLTest，默认 URL 为 `https://www.gstatic.com/generate_204`，interval=180s、tolerance=50；这是算法默认值，生成结果不得自行替换。固定 urltest 的 URL 仍由作者明确提供。组的运行时选择与持久状态不由静态解释模拟。

代理链用 detour。SS 使用 shadowsocks/method/password。VMess 固定 security=aes-128-gcm、alter_id=0；VMess 与没有显式 UDP 编码的 VLESS 输出 network=tcp。TLS 编码 enabled/server_name/alpn/insecure，WS 编码 type/path/headers.Host。

1.14.4 的 Reality、uTLS 分别输出 tls.reality、tls.utls 且 enabled=true；Vision 输出 flow，显式 packetEncoding 输出 packet_encoding 并省略 TCP 限定。Hysteria2 用 password 与 TLS 字段，跳跃端口转为冒号区间的 server_ports 并省略 server_port，间隔输出秒时长 hop_interval。

## 辅助规则与序号映射

按以下顺序生成原生 route.rules，仅生成满足前提的项：

1. 1.14.4 standalone 且有非空 dns：`inbound: ["pl-dns-listener"], action: "hijack-dns"`。
2. 配置 TUN：`inbound: ["pl-tun"], port: 53, action: "hijack-dns"`。
3. 1.14.4 声明 prefer-sniffed：`action: "sniff", sniffer: ["http", "tls"]`，不覆盖目的地。
4. 依作者顺序遍历路由；每条需要解析的顶层路由之前插入 `{ ip_cidr: ["0.0.0.0/0", "::/0"], invert: true, action: "resolve" }`，随后生成作者条件和终结动作。
5. fallback 为拒绝时在末尾生成 reject 动作；其它 fallback 使用 route.final。

解析守卫只在缺少 IP 时执行，后续规则复用结果；解析失败终止请求，不继续后继或 fallback。需解析的嵌套条件报 `RESOLVE_NESTED`。条件规则集的 `resolve` true 在判断它命中与否之前执行。

模型分别保存原生规则索引和作者路由序号，均为 0-based。前置 DNS/TUN/sniff 动作标为辅助，无作者路由序号；逐路由 `resolve` 映射到其所属作者路由并标为辅助；其后业务规则映射到同一作者路由。fallback 标为 fallback，不伪造 routes 索引。诊断、explain 与案例只报告作者路由序号。

## 条件、规则集与 DNS

逻辑条件用 logical/and/or 与 invert，CIDR、端口范围、来源 IP 与进程编码对应原生字段；端口范围用 `from:to`。拒绝动作为 `action: reject, method: default, no_drop: true`，其它动作用 route/outbound。

规则集定义在 route.rule_set，字段为 remote/tag/url/format/update_interval，download_detour 固定 pl-direct。tag 使用去重代表规则集 id，业务条件的 rule_set 引用同步映射；不使用出口显示名替代规则集 id。缓存文件是否开启由作者声明，不为规则集自动开启。

精确 DNS pattern 用 domain，通配 pattern 用锚定且转义的 domain_regex，不匹配根域；转为小写。每项对应 pl-domain-dns-N typed UDP 或 HTTPS server，HTTPS 保留端口、路径、tls.enabled，域名上游用 pl-dns 引导。

1.12.0 有 DNS 规则时省略 route.default_domain_resolver，让 DIRECT 通过 DNSRouter 按规则选服务器；代理服务器拨号显式用 pl-dns，隔离引导。无 DNS 规则时使用 pl-dns 默认解析器。

1.14.4 有 DNS 规则时，在 listener.port 的 UDP 侧生成仅监听 127.0.0.1 的 pl-dns-listener。pl-routed-dns 指向它，route.default_domain_resolver 与代理拨号使用它，进入本机 DNS 规则；DoH 引导始终直接使用 pl-dns，防止递归。无规则时默认解析器仍为 pl-dns。

## TUN 与 endpoint {#endpoint}

TUN 入站 tag 为 pl-tun，逐字段编码 address/stack/auto_route/strict_route/dns_mode/route_exclude_address。autoRoute true 同时设置 route.auto_detect_interface=true。输入约束和运行所有权见[TUN](../../profile/library/sing-box.md#tun)。

Tailscale 在 endpoints 中编码 type=tailscale、tag、state_directory、hostname、accept_routes 及可选 auth_key/exit_node/exit_node_allow_lan_access。另生成固定直连 typed UDP DNS pl-ts-dns-<id>，供 endpoint.domain_resolver 引用，业务 DNS final 仍是 pl-dns。SDK 不访问身份目录，checker 不得创建它。
