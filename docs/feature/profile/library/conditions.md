# 条件与 DNS 规则

条件只声明匹配，出口由 `defineRoutes` 的 `to` 给出。字段、选项与组合均严格校验，未知字段、访问器与非法数据报定义错误，不执行 getter。构造器保留输入快照；SDK 资源保留对象身份。

## 通用条件

| 构造器 | 输入与含义 | 选项 |
| --- | --- | --- |
| `match.domain` | 精确域名 | `includeSniffed?: boolean` |
| `match.domainSuffix` | 根域及点分隔的子域 | `includeSniffed?: boolean` |
| `match.ipCidr` | IPv4 或 IPv6 CIDR | `noResolve?: boolean` |
| `match.sourceIp` | 源 IP 或 CIDR；单地址按 `/32` 或 `/128` 编码 | 无 |
| `match.processName` | 大小写敏感的精确 basename，1–255 字符；拒绝路径分隔符、glob、逗号、括号及控制字符 | 无 |
| `match.port`、`match.sourcePort` | 1–65535 的闭区间；第二参数省略时为单端口，不能倒置 | 无 |
| `match.network` | `"tcp"` 或 `"udp"` | 无 |
| `match.all`、`match.any`、`match.not` | 逻辑组合，前两者展开后不能为空 | 无 |

域名使用小写 ASCII，无通配符或尾点，最长 253 字符；作者在声明前完成规范化。前五种构造器接受单值或只读数组，数组返回同序条件数组，空数组返回空数组，不折叠成逻辑或。选项批量应用到每一项。

缺失请求字段与三值求值以[路由案例](../../routing-cases/README.md#原子条件)为准。逻辑组合不会去重、排序或消除条件；Surge 的逻辑嵌套最多 10 层。

## 嗅探与解析选项

| 目标 | `includeSniffed: true` | `noResolve` 的 IP 条件语义 |
| --- | --- | --- |
| Surge | 域名与有效嗅探域名做逻辑或；编码 `extended-matching` | 省略或 false 允许原生解析；true 编码 `no-resolve` |
| sing-box | 只有 `domainMatching: "prefer-sniffed"` 时允许 | 省略或 false 在该顶层路由前解析；true 只用已知 IP |
| Mihomo、Stash | 拒绝 | 省略或 true 编码 `no-resolve`；显式 false 允许原生解析 |

`includeSniffed` 只允许在域名条件与 Surge 规则集分支上。false 与省略均不附加匹配选项，不保证关闭客户端外部嗅探。sing-box 的 `prefer-sniffed` 影响全部域名条件，有效嗅探域名优先，缺失时用原域名；它不表示多来源逻辑或，也不改写实际连接目的地。

`noResolve` 只允许在 IP 条件、`surge.match.ipAsn` 与 Surge 规则集分支上。其它位置即使写 false 也拒绝。sing-box 的需解析条件在 `all`、`any`、`not` 内部报 `RESOLVE_NESTED`，不提前执行会绕过逻辑守卫的解析。

解析状态、规则集前置解析与缺失解析结果的行为见[IP 与解析](../../routing-cases/README.md#ip-与解析)。静态求值不进行 DNS 查询。

## Surge 专属条件

`surge.match.ipCidr6` 接受 IPv6 CIDR 和 `noResolve`；`surge.match.ipAsn` 接受 1–4294967295 的整数和 `noResolve`，不接受字符串或 `includeSniffed`。`surge.match.macAddress` 接受六组十六进制字节的冒号分隔地址，只在 macOS 目标可用。

`surge.ruleSets.lan`、`surge.ruleSets.system` 是内置规则集条件，分别编码 `RULE-SET,LAN` 与 `RULE-SET,SYSTEM`。它们不声明远程 URL 或更新间隔，静态求值通过假设判断。

## 规则集

`ruleSet({ id, surge?, singBox?, mihomo? })` 返回冻结的 `RuleSet` 条件。`id` 必填，分支至少一个。每个分支都是严格对象，类型和运行时校验一致；路由引用该对象，构造器不带出口。来源不下载、不转换；运行时下载、更新、缓存与失败处理由客户端拥有。

### Surge 分支

| 字段 | 类型 | 必填与默认 |
| --- | --- | --- |
| `url` | HTTP(S) URL | 必填 |
| `format` | `"rule-set"` 或 `"domain-set"` | 省略为 `"rule-set"` |
| `intervalSeconds` | 60–2147483647 的整数秒 | 可选；有效默认 86400，省略时不编码参数 |
| `includeSniffed` | boolean | 可选，按上文执行 |
| `noResolve` | boolean | 可选；true 附加 `no-resolve`，其它值不附加 |

逻辑嵌套中的规则集不能显式声明 `intervalSeconds`，即使只包一层或值为 86400 也拒绝。嵌套使用客户端默认更新间隔；不把未经确认的更新参数放入子条件。内置规则集不接受更新间隔。

### sing-box 分支

| 字段 | 类型 | 必填与默认 |
| --- | --- | --- |
| `url` | HTTP(S) URL | 必填 |
| `format` | `"source"` 或 `"binary"` | 必填 |
| `intervalSeconds` | 60–2147483647 的整数秒 | 必填，无默认 |
| `resolve` | boolean | 可选，默认 false |

`resolve: true` 只用于作者已确认内容为需解析目的 CIDR 的资源；SDK 不替作者证明远程内容。其解析在该顶层路由判断前发生，与假设的命中结果无关。逻辑嵌套中声明 true 报 `RESOLVE_NESTED`。

### Mihomo 分支

| 字段 | 类型 | 必填与默认 |
| --- | --- | --- |
| `url` | HTTP(S) URL | 必填 |
| `format` | `"yaml"` 或 `"text"` | 必填 |
| `behavior` | `"domain"`、`"ipcidr"` 或 `"classical"` | 必填 |
| `intervalSeconds` | 60–2147483647 的整数秒 | 必填，无默认 |

URL 最长 2048 字符，禁止认证、fragment、空白、控制字符、逗号、引号、反斜杠和圆括号。秘密不能放入 URL。不提供任意请求头、下载代理或缓存路径字段。

### 来源冲突与复用

同一对象可被多条路由引用，不改变路由顺序或次数。不同对象使用同一个 id 报 `DUPLICATE_ID`。目标缺分支报 `RULESET_SOURCE_MISSING`；Stash 使用规则集报 `RULESET_UNSUPPORTED`。

sing-box 以原字符串 `url`、`format`、`intervalSeconds` 去重；Mihomo 再比较 `behavior`。同 URL 的其它来源字段不一致报 `RULESET_SOURCE_CONFLICT`。代表名取路由顺序、条件从左到右深度优先首次引用的对象 id。

Surge 不生成共享资源定义，但同一 URL 的格式与有效更新间隔必须一致；省略间隔与显式 86400 的来源相同。URL 按原字符串比较。`includeSniffed`、`noResolve`、`resolve` 属于匹配语义，不参与来源比较；不同选项的路由分别保留。

## DNS 规则

`dnsRule(pattern, server)` 接受字符串或只读字符串数组；数组返回同序 `DnsRule[]`，空数组合法，输入被复制。`DnsRule` 为 `{ readonly pattern: string; readonly server: string }`，Profile 的 `dns` 接受嵌套片段。

pattern 最长 253 字符，只接受精确域名或前导 `*.`。通配符匹配非空、多级子域，不匹配根域；比较忽略大小写。server 最长 2048 字符，接受 IP 或 HTTPS DoH URL。DoH 禁止认证、query、fragment、空端口、反斜杠、空白及会被 URL 规范化改变的路径；自定义端口与路径保留，省略路径用 `/dns-query`，显式 `/` 保留。

展开后最多 2000 项，重复模式拒绝。匹配集合重叠且 server 不同报 `DNS_RULE_CONFLICT`，相同 server 的包含关系合法。不排序或去重。

Surge 将 `dns` 放在原生 hosts 前，合并后最多 2000 项。跨入口出现忽略大小写后相同的 pattern 报 `DNS_HOSTS_CONFLICT`，路径指向 `dns[i]` 与 `surge.hosts[j]`，即使内容相同也拒绝。不同原生 glob 保留客户端顺序语义。

sing-box 只在 standalone 支持非空 DNS 规则；Mihomo、Stash 不支持。空列表等价于未配置。编码与引导解析分别见各[目标输出页](../../targets/README.md#编码规则)。
