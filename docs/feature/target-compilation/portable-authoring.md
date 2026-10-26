# 通用匹配、DNS 与代理身份

## 目标与范围

作者优先使用通用 match；只有真正的平台机制使用 surge。此版本为 0.4.0，保留已有 Profile 与 Program 字段兼容，新增可选 dns。消费方四份 Surge 配置须完整字节相等。

普通 domain/domainSuffix、sourceIp、port/sourcePort、network、逻辑条件改用已有 match。扩展匹配、`no-resolve`、MAC、Surge 内置和远程规则集继续使用显式 Surge 语法，不把平台数据格式冒充通用规则集。

新增 match.processName(string)，语义为大小写敏感的精确 basename（1–255 字符）；拒绝路径分隔符、glob、逗号、括号及控制字符，平台扩展仍可表达路径和 glob。Match、request schema 和静态解释支持 processName。Surge macOS、sing-box Linux/macOS、Mihomo/Stash 已支持的桌面目标生成对应进程规则；不支持的平台明确拒绝。sourceIp 同时接受IP 字面量 与 CIDR。不存在平台匹配选项的静默丢弃。

## DNS 声明

导出 DnsRule = {readonly pattern:string; readonly server:string}。ProfileDefinition.dns 为 Fragments<DnsRule>，归一化 Profile.dns 为只读扁平数组，复用本次展开预算及快照检查。

pattern 最长 253 字符，server 最长 2048 字符；Profile 与直接 Program 在快照和比较前执行同样限制。pattern 仅接受精确域名与前导 *. 的子域模式。*.example.com 匹配非空子域、多级子域，不匹配 example.com 自身；比较忽略大小写。server 支持 IP 字面量或 HTTPS DoH URL，禁止认证、query、fragment，自定义端口和路径保留；省略路径按 /dns-query，显式 / 保留为 /。拒绝空端口、反斜线、空白及 URL 规范化会改变的路径。

单个 DNS 列表最多 2000 项，拒绝重复模式。若两个模式的匹配集合重叠且 server 不同，返回 DNS_RULE_CONFLICT；相同 server 的包含关系合法。由此避免跨引擎 Host 优先级差异改变解析目标。校验忽略大小写；Surge 保留文本，sing-box 降低时将 domain 和 domain_regex 转为小写。预算内二次比较上限固定为 2000 项。

Surge Profile 允许 dns 与 surge.hosts 同时声明，按 dns 在前、surge.hosts 在后的顺序合并到 [Host]，保留各自内部顺序与字段，不覆盖、不去重。合并后最多 2000 项。同一 pattern 忽略大小写后在两种入口重复时返回 DNS_HOSTS_CONFLICT，并提供 paths（扁平化后的 dns[i] 与 surge.hosts[j]）；即使内容一致也拒绝重复。不同原生 glob 的重叠保留 Surge 原生顺序语义，不猜测其与 address/alias 的交集；dns 内部仍执行 DNS_RULE_CONFLICT 检查。单独使用任一入口的行为不变。

sing-box Profile 将 dns 放入其 Program。Program 新增可选平面 dns 字段；只有 sing-box standalone 目标可使用非空 dns，其他目标返回 DNS_MODE_UNSUPPORTED 或 DNS_TARGET_UNSUPPORTED。空 dns 等价于未配置。不通过渲染后修改 JSON 实现。

sing-box 1.11/1.12 输出 DNS rules，精确域使用 domain，子域使用锚定 domain_regex（转义点，前缀 .+）。每条规则选择生成的 pl-domain-dns-N server，顺序保留。

普通 final DNS 及 Tailscale 专用引导 DNS 保持原值。有非空 dns 时，1.12 不生成 route.default_domain_resolver，使 DIRECT 的 ResolveDialer 使用未指定 Transport 的 DNSRouter.Lookup，按 dns.rules 选择服务器。

各代理 outbound 则显式使用 pl-dns 作为 domain_resolver，隔离代理服务器引导解析。无 dns 保持原有默认解析路径。1.12 的 UDP DNS 服务器均省略无意义的 DIRECT detour，以免运行时拒绝启动。此规则仅承诺本机发起的解析，不强制代理协议远端解析改为本机解析。

IP server 分别输出1.11 udp 地址或1.12 udp server。DoH 使用1.11 https address 或1.12 https server/server_port/path/tls；域名解析通过现有 listener 的 IP DNS 服务器 引导，避免 DoH 地址解析递归。1.12 DNS server 不设置 detour，显式 domain_resolver 指向 pl-dns；1.11 address_resolver 指向 pl-dns，detour 沿用直连。格式和默认行为按精确版本 native check 验收。

## 身份与消费方

SDK 导出 proxyId(namespace,label)，保留 node- 前缀与 sha256(JSON.stringify([namespace,label])) 前 16 位算法，大小写保持原值。输入为非空字符串，失败使用固定错误，不回显值。它只生成 ID，不猜地区或规范化供应商名。

消费方使用 proxyId 生成稳定 ID，groups.ts 引用同一 proxyId。地区与供应商归属由应用维护，协议对象不携带业务属性；详见[代理业务信息](business-data.md)。

hosts.ts 改为 dns.ts，数组类型 DnsRule，移到设备 Profile 顶层 dns。既有列表模式、DNS 服务器、顺序全部保留。settings.ts 的 Surge General 仍为明确平台扩展，不扩展此次任务至完整 DNS 系统或所有 General 字段。

## 验收与发布

测试覆盖 DNS 两个 sing-box 精确版本及 Surge、DNS 重叠/重复/无效字段、URL 与模式注入、片段快照/预算、失败零秘密读取、静态地址冲突、DNS 引导隔离和无 DNS 输出不变。两个版本的本地运行测试启动两台 UDP DNS stub，使用真实 mixed CONNECT 发出普通 DIRECT 域名请求，观察命中的 stub 与目的 HTTP 服务；还须验证大小写、多级子域及 apex 不命中通配符。

进程规则覆盖三类渲染器与静态解释、iOS 拒绝；错误匹配不能静默删除。proxyId 使用旧算法固定样本，并对消费方所有代理 ID 做前后对照。

执行 SDK verify、隔离安装包与原生检查，Concord check/trace，消费方类型/lint/正式构建/四份 SHA256/Surge 离线检查。迁移基线固定为消费方 09756708 与 SDK 0.3.0，使用同一秘密输入比较 /tmp/proxy-generic-baseline.json 四份 SHA256，先临时 tgz 消费构建并比对代理 ID。公开发布与 push 沿用用户明确授权，检查通过本身不授予发布权限。通过后按已有发布流程发布公开包，消费方锁公开版本并提交 push；不重载设备。独立审查重点是 DNS 模式与优先级、引导解析、失败/预算边界及 ID 稳定性。

## 依据

- [Surge DNS 映射](https://manual.nssurge.com/dns/local-dns-mapping.html)
- [Surge 规则参数](https://manual.nssurge.com/rules/overview.html)
- [sing-box DNS 规则](https://sing-box.sagernet.org/configuration/dns/rule/)
- [sing-box DNS 迁移](https://sing-box.sagernet.org/migration/)

## DNS 函数编写

导出 dnsRule(pattern: string, server: string): DnsRule，以及 dnsRule(patterns: readonly string[], server: string): DnsRule[]。单条和同服务器批量声明均构造原有普通数据，不引入另一种编译模型。调用前检查输入数据图，再复用 DNS schema 校验字符串、2000 项上限和冲突。返回新规则，不持有调用者数组。

输入顺序、大小写与重复项语义不变，不排序或去重。空数组生成空数组；相同模式仍按既有规则拒绝。多个函数结果在 Profile.dns 继续用现有片段数组组合；Program 使用平面数组。DnsRule 类型保留用于类型消费，作者无需写 satisfies DnsRule[]。

这是既有数据构造的局部可回滚增强，无渲染、域名匹配、DNS 引导或资源所有权变更。验收对比函数和对象输入的编译渲染字节，验证输入变更隔离、批量限制与冲突，消费方保持四份原始字节和代理 ID。
