# 目标与原生输出

给需要知道某份 Profile 能否生成、会生成成什么样的作者。每份 Profile 指定一个精确[目标](../../concepts.md#target)；proxylang 按能力目录检查这份 Profile，再编码成这个客户端的原生配置。不支持的行为报错，不降级（[t-6](../../taste.md#t-6)）。

## 支持的目标

| 引擎 | 平台 | 版本 | 模式 | 产物 |
| --- | --- | --- | --- | --- |
| `surge` | `ios` | `5.21.0` | 完整配置 | `.conf` |
| `surge` | `macos` | `6.10.0` | 完整配置 | `.conf` |
| `sing-box` | `macos`、`linux` | `1.12.0`、`1.14.4` | `standalone` 或 `fragment` | `.json` |
| `mihomo` | `macos`、`linux` | `1.19.32` | `standalone` 或 `fragment` | `.yaml` |
| `stash` | `macos` | `4.2.1` | 只有 `fragment` | `.yaml` |

不在表中的组合报 `TARGET_UNSUPPORTED`。增加一个目标，就是在能力目录中新增一行，并为它补上生成结果比对；能做到时再补原生检查，见[测试架构](../../engineering/testing/README.md)。

`fragment` 只生成出站、分组、路由和规则集定义，供作者合并进自己已有的配置；入站、系统接管和 DNS 由宿主配置负责。fragment 不能包含需要宿主之外资源的声明，例如 listener、TUN、endpoint、`cacheFile`。

## 能力

本表是能力目录的摘要；协议选项、版本与模式之间的完整矩阵写在各引擎的输出页中。单元格写“不支持”的能力，在该目标上使用时报 error。实现时发现本表与现有行为不符，先报告并修正本表，再改代码。

| 能力 | Surge | sing-box | Mihomo | Stash |
| --- | --- | --- | --- | --- |
| 协议 | http、trojan、anytls、hysteria2、shadowsocks、vmess | 再加 vless；部分 vless 扩展只在 1.14.4 | 再加 vless | 同 Surge |
| 分组算法 | select、Smart | select、urltest | select、urltest | select |
| `group.auto()` | Smart | urltest | urltest | 不支持 |
| 分组成员中的隧道 | select 与 Smart 可以包含 Surge 隧道 | endpoint 不能作为成员或 `via`，只能作为路由出口 | 无隧道 | 无隧道 |
| `match.processName` | 只在 macOS | 支持 | 支持 | 支持 |
| `includeSniffed: true` | extended-matching | 只在 1.14.4 且 `singBox.domainMatching: "prefer-sniffed"` | 不支持 | 不支持 |
| 规则集 | `surge` 分支 | `singBox` 分支 | `mihomo` 分支 | 不支持 |
| 隧道 | `surge.tailscale`、`surge.wireguard` | `singbox.tailscale` | 不支持 | 不支持 |
| DNS 规则 | `[Host]` | `dns.rules`，只在 `standalone` | 不支持 | 不支持 |
| TUN | 不适用 | 只在 1.14.4 `standalone` | 不支持 | 不支持 |

`group.auto()` 与 `group.urltest()` 省略参数时的默认测速 URL、间隔与容差，以及 sing-box 额外输出的 `idle_timeout` 等固定字段，沿用现行实现，写在 [sing-box 输出](format/sing-box.md)与 [Mihomo 输出](format/mihomo.md)中。

编码细节见 [Surge 输出](format/surge.md)、[sing-box 输出](format/sing-box.md)、[Mihomo 输出](format/mihomo.md)与 [Stash 输出](format/stash.md)。Surge 与 Stash 没有可以自动运行的原生检查，它们的产物由生成结果比对和使用方验收覆盖。

## 资源图

- 分组成员与节点的 `via` 构成一张依赖图，图中不能有环，包括“节点 → `via` 分组 → 成员节点”这样跨类型的环。
- 节点的 TCP-only 属性沿所有可选路径传播：一个出口的任何可选路径上有 TCP-only 节点时，指向它的路由必须用 `match.network("tcp")` 限定，`fallback` 也不能指向它，除非 sing-box Profile 声明了 `singBox.unsupportedUdp: "reject"`。
- sing-box endpoint 的状态目录互不包含，也不能与构建的输出目录重叠；同一批次中两份 Profile 声明相同状态目录也是重叠。

## 原生名字

- 每个资源在原生配置中的名字是 `name`，省略时是 id。四个引擎都一样：Surge 的策略名、sing-box 的 tag、Mihomo 与 Stash 的 `name`。所有引用位置（分组成员、默认成员、`via` 对应的 `underlying-proxy`/`detour`/`dialer-proxy`、路由与 `final`）都使用同一个原生名字。
- 原生名字在一份 Profile 内必须唯一，不能与内置出口名（`DIRECT`、`REJECT` 等）相同，也不能包含该引擎格式的分隔符。冲突报 `DUPLICATE_NATIVE_NAME`，非法字符报 `NAME_UNSAFE`。
- 修改资源的 `name` 会改变原生名字。客户端里保存的分组手动选择可能因此重置一次，这一点写进发版说明。

## 编码规则

- 作者路由的相对顺序在原生配置中保持不变。引擎需要时会在作者路由之间插入辅助原生规则（例如 sing-box 的嗅探、DNS 劫持与解析动作）；插入位置与原生序号到作者路由序号的映射写在对应的输出页中，诊断与案例结果总是使用作者路由序号。
- `fallback` 编码为该引擎的默认出口，例如 Surge 的 `FINAL` 与 sing-box 的 `route.final`。
- 规则集按引擎去重：sing-box 与 Mihomo 中，来源相同的两个规则集对象只生成一个定义，规则详见 [Profile 编写 API](../profile/library/README.md#规则集)。
- `group.auto()`、规则集来源和原生名字映射记录在 check 结果的 `selections` 中。
- 同样的 Profile 每次生成字节相同的产物。

## 诊断

check 结果中的每条诊断有 `severity`、`code`、`profile`、`path`，能取得定义位置时还有 `origin: { file, line, column }`。`path` 指向规范化模型，例如 `routes[12].to`、`groups.ai.members[3]`。

| code | severity | 触发 |
| --- | --- | --- |
| `TARGET_UNSUPPORTED` | error | 目标或模式不在能力目录中 |
| `DUPLICATE_ID` | error | 同一 Profile 中两个不同的资源或规则集对象使用同一个 id |
| `UNLISTED_EXIT` | error | 路由、分组成员、`via`、`fallback` 或案例引用的对象没有列在这份 Profile 的 `proxies` 或 `groups` 中 |
| `SECRET_UNDECLARED` | error | 引用的秘密不属于构建定义的秘密集合 |
| `GROUP_CYCLE` | error | 分组成员与 `via` 构成环，诊断列出环上的全部 id |
| `MEMBER_TYPE_UNSUPPORTED` | error | 分组成员或 `via` 的类型不被目标允许，例如 sing-box endpoint |
| `TCP_ONLY_EXIT` | error | 出口的可选路径上有 TCP-only 节点，但路由没有限定 TCP，或者用作 `fallback` |
| `PROTOCOL_UNSUPPORTED` | error | 节点协议不被目标支持 |
| `PROXY_OPTION_UNSUPPORTED` | error | 节点选项不被目标支持，例如某个版本不支持的 vless 扩展 |
| `GROUP_ALGORITHM_UNSUPPORTED` | error | 分组算法不被目标支持 |
| `ALGORITHM_ENGINE_MISMATCH` | error | 引擎专属算法用在了别的引擎 |
| `CONDITION_UNSUPPORTED` | error | 条件或条件选项不被目标支持，例如 iOS 上的 `processName`、Mihomo 上的 `includeSniffed: true` |
| `RESOLVE_NESTED` | error | 会触发解析的条件出现在 `all`、`any`、`not` 内部，而目标只能在整条规则之前解析 |
| `RULESET_UNSUPPORTED` | error | 目标不支持规则集 |
| `RULESET_SOURCE_MISSING` | error | 规则集没有目标引擎的分支 |
| `RULESET_SOURCE_CONFLICT` | error | 两个规则集的来源地址相同，但其它来源字段不同 |
| `DNS_UNSUPPORTED` | error | 目标或模式不支持 Profile 的 DNS 规则 |
| `TUNNEL_UNSUPPORTED` | error | 隧道类型不被目标支持 |
| `ENDPOINT_STATE_OVERLAP` | error | endpoint 状态目录之间、或者与输出目录互相包含 |
| `DUPLICATE_NATIVE_NAME` | error | 两个资源的原生名字相同，或与内置出口名相同 |
| `NAME_UNSAFE` | error | 原生名字包含该引擎格式的分隔符或控制字符 |

各引擎输出页中还可以定义专属诊断码，但不能与本表重名。

## 用户故事

- [为设备检查并生成原生配置](use-case/check-device-target.md)
