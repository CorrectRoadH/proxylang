# Profile 编写 API

本页列出 `proxylang` 包中与 Profile 编写有关的全部公开导出。构建入口 `defineBuild`、`checkBuild`、`runBuild` 见[构建 library](../../build/library.md)，`explainProfile` 见[路由案例 library](../../routing-cases/library.md)。这几页没有列出的名字都不是公开 API。

所有构造器都返回冻结的普通数据，不读文件、环境变量或秘密。输入不合法时抛出 `ProfileDefinitionError`，它带有稳定的 `code` 与可选的 `paths`，不包含输入值。

## 引用规则

`Exit` 是可以作为出口的对象：节点、分组、隧道，以及 `outbound.*` 常量。所有引用字段只接受对象，不接受 id 字符串（[t-3](../../../taste.md#t-3)）。

| 字段 | 接受 |
| --- | --- |
| 路由 `to`、`fallback`、案例 `expect` | `Exit` |
| 分组 `members` | `Fragments<Exit>`；Surge 隧道可以作为 select 成员，sing-box endpoint 不能作为成员，见[资源图](../../targets/README.md#资源图) |
| 节点 `via` | 节点或分组 |
| 请求假设 `hit`、`miss` | `ruleSet` 返回的规则集对象 |
| 字段中的秘密 | `defineSecrets` 返回对象上的属性 |

被引用的资源必须列在同一份 Profile 的 `proxies` 或 `groups` 中，内置出口除外。对象按身份识别，规则见[对象身份](../../../architecture.md#对象身份)：同一个对象可以被多份 Profile 共用；在一份 Profile 中重复列出时只保留第一次；两个不同对象使用同一个 `id` 时报 `DUPLICATE_ID`。

只有 SDK 构造器创建的对象能作为资源；形状相同的普通对象在定义阶段报 `INVALID_RESOURCE`。

以下字符串不是出口引用，保持为字符串：资源的 `id` 与 `name`，构建定义 `profiles` 的键（产物文件名），CLI 的 `--profile` 与请求 JSON 中的规则集 id，秘密的环境变量名，以及地址、URL、域名等数据字段。

## 资源与 Profile

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `defineProfile` | `(input: ProfileDefinition) => Profile` | 校验字段集合、展开片段并冻结。`target` 的类型是支持目标的字面量联合，决定可以写哪个引擎专属字段 |
| `defineProxyGroup` | `(input: { id, name, algorithm, members }) => ProxyGroup` | `members` 展开后不能为空 |
| `defineRoutes` | `(input: { when: Fragments<Condition>, to: Exit }) => Route[]` | `when` 中的每个条件生成一条路由，顺序不变 |
| `proxy.http` `proxy.trojan` `proxy.anytls` `proxy.hysteria2` `proxy.shadowsocks` `proxy.vmess` `proxy.vless` | `(options) => ProxyNode` | 协议字段见[节点](proxies.md) |
| `proxy.builder` | `(base) => ProxyBuilder` | 为同一机场的节点共享字段的链式构造器 |
| `proxyId` | `(provider: string, name: string) => string` | 从机场名与节点名生成稳定、合法的 id |
| `surge.tailscale` `surge.wireguard` | `(options) => SurgeTunnel` | Surge 隧道 |
| `singbox.tailscale` | `(options) => SingBoxEndpoint` | sing-box Tailscale endpoint |
| `outbound.direct` `outbound.reject` | 常量 | 内置直连与拒绝，所有引擎可用 |
| `outbound.rejectDrop` `outbound.rejectNoDrop` `outbound.rejectTinyGif` | 常量 | 只用于 Surge 目标 |
| `defineSecrets` | 见[秘密](#秘密) | |
| `dnsRule` | `(pattern: string \| readonly string[], server: string) => DnsRule \| DnsRule[]` | 按域名指定 DNS 服务器 |

`ProfileDefinition` 的字段：`target`、`proxies`、`groups`、`routes`、`fallback`，可选的 `dns`、`cases`，以及与目标引擎对应的 `surge`、`singBox` 或 `mihomo`（Stash 没有专属字段）。`cases` 的结构见[路由案例 API](../../routing-cases/library.md#routecase)。

## 秘密

```ts
const secrets = defineSecrets({
  EDGE_PASSWORD: { env: "EDGE_PASSWORD", validation: "validation-edge" },
  MANAGED_TOKEN: { env: "MANAGED_TOKEN", validation: "validation-token" },
  LAB_PASSWORD: { value: "not-really-secret", validation: "validation-lab" },
});

proxy.trojan({ /* ... */ password: secrets.EDGE_PASSWORD });
defineBuild({ /* ... */ secrets });
```

- 返回的集合对象上，每个属性都是一个[秘密引用](../../../concepts.md#secret-ref)：不带值的冻结句柄，属性名就是秘密名，匹配 `^[A-Z][A-Z0-9_]*$`。拼错属性名是 TypeScript 错误。
- 每个秘密的来源二选一：`env` 读取这个名字的环境变量，`value` 是写在代码里的值。来源声明保存在集合内部，不在句柄上，不会进入 Profile、模型、诊断或 check 输出。
- 一份构建定义使用一个集合。句柄是否属于集合按对象身份判断：另一个集合里同名的句柄也报 `SECRET_UNDECLARED`。
- `build` 在 check 通过之后读取值，同一批次中每个秘密只读一次。值为空字符串或环境变量不存在时报 `SECRET_MISSING`，只给出秘密名。
- `build --validation` 使用每个被引用秘密的 `validation` 值，不回退到生产来源；缺少 `validation` 的秘密报 `SECRET_VALIDATION_MISSING`。

## 链式代理

节点的 `via` 声明先经过哪个出口再连接这个节点，例如住宅代理经过中转分组：

```ts
const relay = defineProxyGroup({ id: "relay", name: "Relay", algorithm: group.select(), members: relayNodes });
const residential = proxy.http({
  id: "residential-01", name: "Residential 01", server: "gateway.example.com", port: 10000,
  username: secrets.RESIDENTIAL_USER, password: secrets.RESIDENTIAL_PASSWORD, via: relay,
});
```

- `via` 接受节点或分组对象，不能是隧道或内置出口。需要按设备换中转时，把创建节点的代码写成以中转为参数的函数。
- 中转对象必须列在同一份 Profile 中。分组成员与 `via` 一起构成依赖图，有环时报 `GROUP_CYCLE` 并列出环上的全部 id。
- Surge 编码为 `underlying-proxy`，sing-box 编码为 `detour`。目标不支持的组合报 error，例如 Surge 上端口跳跃与 `via` 同用。

## 分组算法

| 导出 | 含义 | 目标上的编码 |
| --- | --- | --- |
| `group.select()` | 手动选择 | 所有引擎的手动选择组 |
| `group.urltest({ url, intervalSeconds?, toleranceMs? })` | 固定参数测速 | sing-box 与 Mihomo 的 `urltest`；Surge 与 Stash 报 `GROUP_ALGORITHM_UNSUPPORTED` |
| `group.auto()` | 按质量与可用性自动选择，由目标决定实现 | Surge 编码为 Smart，sing-box 与 Mihomo 编码为 URLTest；Stash 报 `GROUP_ALGORITHM_UNSUPPORTED` |
| `surge.smart()` | Surge Smart | 只用于 Surge 目标，成员只能是普通节点或 Surge 隧道，不能是分组或内置出口 |

`group.auto()` 的具体选择写进 check 结果的 `selections`。默认测速参数与 Smart 成员约束见[目标与原生输出](../../targets/README.md)。

## 条件

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `match.domain` `match.domainSuffix` | `(value: string, options?) => Condition`；`(values: readonly string[], options?) => Condition[]` | 传数组时返回同序的条件数组，`options` 作用于每一项 |
| `match.ipCidr` `match.sourceIp` `match.processName` | 同上，接受单个值或数组 | `processName` 在 Surge iOS 上不可用，见[能力](../../targets/README.md#能力) |
| `match.port` `match.sourcePort` | `(from: number, to?: number) => Condition` | 闭区间 |
| `match.network` | `(value: "tcp" \| "udp") => Condition` | |
| `match.all` `match.any` | `(...conditions: Fragments<Condition>) => Condition` | 展开后不能为空 |
| `match.not` | `(condition: Condition) => Condition` | |
| `surge.match.ipAsn` `surge.match.ipCidr6` `surge.match.macAddress` | Surge 专属原子条件 | 只用于 Surge 目标 |
| `surge.ruleSets.lan` `surge.ruleSets.system` | Surge 内置规则集常量，可直接作为条件 | 只用于 Surge 目标 |
| `ruleSet` | 见下文 | 外部规则集 |

`match.*` 的选项（`includeSniffed`、`noResolve`）与缺失字段语义见[条件](conditions.md)。`surge.match` 只包含 Surge 独有的条件，通用条件只通过 `match.*` 提供。

## 规则集

```ts
const cnDirect = ruleSet({
  id: "cn-direct",
  surge: { format: "rule-set", url: "https://rules.example.com/direct.txt" },
  singBox: { format: "binary", url: "https://rules.example.com/geolocation-cn.srs", intervalSeconds: 86400 },
  mihomo: { format: "text", behavior: "domain", url: "https://rules.example.com/direct.list", intervalSeconds: 86400 },
});

defineRoutes({ when: cnDirect, to: outbound.direct });
```

- `ruleSet` 返回一个条件，可以放进 `when`，也可以放进 `all`、`any`、`not`。
- `id` 必填，在 Profile 内唯一，用于原生定义的 tag 或 provider 名、诊断，以及 CLI `explain` 请求中的假设。
- `surge`、`singBox`、`mihomo` 分支至少写一个，各自的字段见[条件](conditions.md#规则集)。目标引擎没有对应分支时报 `RULESET_SOURCE_MISSING`；目标不支持规则集时报 `RULESET_UNSUPPORTED`。
- 下载来源由分支的来源字段决定：sing-box 是 `url`、`format`、`intervalSeconds`；Mihomo 再加 `behavior`。`resolve`、`noResolve`、`includeSniffed` 是使用这个规则集的路由的匹配语义，不属于来源。
- sing-box 与 Mihomo 按来源去重：两个规则集对象的 `url`（按原字符串比较）相同、其它来源字段也相同时，只生成一个原生定义，名字取路由中先被引用的那个规则集的 id；“先被引用”按作者路由顺序、条件内从左到右深度优先确定。`url` 相同但其它来源字段不同时报 `RULESET_SOURCE_CONFLICT`。Surge 的规则集写在每条规则上，不需要去重。
- 同一个规则集对象被多条路由引用不是重复，只生成一个定义。

## 引擎专属字段

`target.engine` 决定可以写哪个专属字段：Surge 写 `surge`，sing-box 写 `singBox`，Mihomo 写 `mihomo`；Stash 只生成片段，没有专属字段。类型上，Profile 只能写与目标引擎对应的那个字段；运行时同样拒绝，错误码为 `PROFILE_EXTENSION_UNSUPPORTED`。

| 字段 | 内容 | 细节 |
| --- | --- | --- |
| `surge.general` | `[General]` 字段的片段，按顺序浅合并，后者整键覆盖 | [Surge](surge.md) |
| `surge.hosts` | `[Host]` 条目片段 | [Surge](surge.md) |
| `surge.managed` | 托管配置 URL、更新间隔与 strict | [Surge](surge.md) |
| `singBox.mode` | `"standalone"` 生成完整配置；`"fragment"` 只生成出站、分组、路由与规则集定义，供合并进作者已有的配置，入站与 DNS 由宿主配置负责。省略时为 `"standalone"`。各选项在两种模式与两个版本上的可用性见 [sing-box](sing-box.md) | [sing-box](sing-box.md) |
| `singBox.listener` | 本地混合入站端口与解析服务器 | [sing-box](sing-box.md) |
| `singBox.tun` | TUN 入站 | [sing-box](sing-box.md) |
| `singBox.domainMatching` `singBox.serverAliases` `singBox.cacheFile` `singBox.unsupportedUdp` | sing-box 运行选项 | [sing-box](sing-box.md) |
| `mihomo.mode` | `"standalone"` 生成完整配置，必须同时给出 `mihomo.listener`；`"fragment"` 只生成可合并的片段。省略时为 `"fragment"` | [Mihomo](mihomo.md) |
| `mihomo.listener` | 本地混合入站端口与解析服务器，只监听回环地址 | [Mihomo](mihomo.md) |

## 公开类型

`proxylang` 导出的类型：`Profile`、`ProfileDefinition`、`Target`、`Exit`、`Route`、`Condition`、`RuleSet`、`Fragments`、`ProxyNode`（及各协议节点类型）、`ProxyGroup`、`GroupAlgorithm`、`SurgeTunnel`、`SingBoxEndpoint`、`DnsRule`、`SurgeGeneral`、`SurgeHost`、`Secrets`、`SecretRef`、`ProfileDefinitionError`，以及[构建](../../build/library.md)与[路由案例](../../routing-cases/library.md)页列出的结果类型。这里没有列出的类型不是公开 API。

## 错误

构造器与 `defineProfile` 只在结构错误时抛出，下表就是全部结构错误；它们大多已经被 TypeScript 类型拒绝。抛出发生在加载配置时，CLI 因此以 `CONFIG_LOAD_FAILED` 停止，并给出错误码、路径与抛出位置。引用、能力和案例方面的问题不抛出，由 check 对全部 Profile 一次汇总报告（[t-7](../../../taste.md#t-7)），诊断码见[目标与原生输出](../../targets/README.md#诊断)。

| code | 触发 |
| --- | --- |
| `INVALID_PROFILE_DEFINITION` | 顶层不是普通对象，或者有访问器、循环引用 |
| `UNKNOWN_FIELD` | 出现未声明的字段，`paths` 给出位置 |
| `INVALID_FIELD` | 字段类型或取值不合法，`paths` 给出位置 |
| `PROFILE_EXTENSION_UNSUPPORTED` | 专属字段与目标引擎不符 |
| `EMPTY_FRAGMENT` | `members`、`all`、`any` 展开后为空 |
| `INVALID_RESOURCE` | 资源字段收到的对象不是 SDK 构造器创建的 |
