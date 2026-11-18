# 路由案例

给想保护路由意图的作者。“家里的影视服务必须走 Home”“AI 服务不能直连”这类意图写成[路由案例](../../concepts.md#route-case)：给出一个请求，断言 Profile 首条命中的[出口](../../concepts.md#exit)。`check` 与 `build` 每次都执行全部案例，规则改动一旦改变了意图，发布就会被阻止（[t-10](../../taste.md#t-10)）。

## 上手

案例写在 Profile 的 `cases` 中，`expect` 引用出口对象。共享的案例和共享规则一样，写成以出口为参数的函数：

```ts
const sharedCases = (exits: { ai: Exit; home: Exit }) => [
  { name: "家里的影视服务走 Home", request: { domain: "media.home.example" }, expect: exits.home },
  { name: "AI 服务走 AI 出口", request: { domain: "chat.example", resolvedIp: "192.0.2.7" }, assume: { miss: [cnDirect] }, expect: exits.ai },
];

export const phone = defineProfile({
  // ...
  routes: sharedRoutes(groups),
  cases: sharedCases(groups),
});
```

运行 `proxylang check`，输出里每份 Profile 的每个案例各有一条结果。临时想知道某个请求会走哪里，运行：

```sh
proxylang explain --profile phone --request '{"domain":"chat.example"}'
```

输出首条命中的路由序号、源码位置和出口。

## 求值规则

求值在规范化后的 Profile 上进行，按这份 Profile 的目标解释条件，与渲染结果无关。proxylang 不模拟分组在运行时选中哪个节点，也不模拟 DNS 查询、连接失败或探测；结果是路由的出口对象，输出中用它的 id 表示。

### 顺序与三值

每个条件的结果是“命中”“不命中”或“未知”。未知表示结果取决于请求中没有给出的信息，并带有 `needs` 说明缺什么。

| 组合 | 结果 |
| --- | --- |
| `all` | 任一子条件不命中则不命中；否则任一未知则未知；否则命中 |
| `any` | 任一子条件命中则命中；否则任一未知则未知；否则不命中 |
| `not` | 命中与不命中互换，未知仍是未知 |

复合条件先求值全部子条件，再按上表合并；结果未知时，`needs` 取从左到右第一个未知子条件的 `needs`。路由按顺序求值：第一条命中的路由决定出口；遇到结果未知的路由时停止，整体结果是 `indeterminate`，因为这条路由可能命中；全部不命中时结果是 `fallback`。

### 原子条件

| 条件 | 读取 | 字段缺失时 |
| --- | --- | --- |
| `match.domain` `match.domainSuffix` | 候选域名，见下文 | 不命中 |
| `match.ipCidr` `surge.match.ipCidr6` | 当前已知的目标 IP，见下文 | 见下文 |
| `surge.match.ipAsn` | 当前已知 IP 的 `asn` | 没有已知 IP 时同 `ipCidr`；有 IP 但请求没给 `asn` 时未知（`needs: asn`） |
| `match.sourceIp` `match.port` `match.sourcePort` `match.network` `match.processName` `surge.match.macAddress` | 请求的同名字段 | 不命中；`network` 省略时为 `tcp` |
| 规则集、`surge.ruleSets.*` | 案例的假设 | 未知（`needs: ruleSet`） |

“字段缺失时不命中”意味着 `not` 包裹的缺失字段条件会命中。需要字段存在的意图，应该在请求里给出这个字段。

### 域名与嗅探

请求的 `domain` 是连接时已知的目标域名，`sniffedDomain` 是客户端从 TLS SNI 或 HTTP Host 嗅探到的有效结果。proxylang 不模拟 SNI 与 Host 冲突时的选择。

| 目标 | 域名条件读取的候选域名 |
| --- | --- |
| Surge | 不带 `includeSniffed` 时只读 `domain`；带 `includeSniffed: true` 时读 `domain` 或 `sniffedDomain`，任一匹配即命中 |
| sing-box 1.14.4，`domainMatching: "prefer-sniffed"` | 所有域名条件都读同一个有效域名：有 `sniffedDomain` 时用它，否则用 `domain` |
| 其它 sing-box 目标、Mihomo、Stash | 只读 `domain` |

### IP 与解析

proxylang 只在能确定客户端行为时模拟解析，其它情况返回未知，不做猜测。

请求的 `ip` 是连接建立时就已知的目标地址，例如应用直接连接 IP；`resolvedIp` 是客户端解析 `domain` 后用于 IP 规则的那个地址。`asn` 属于当前已知的那个地址。

- 有 `ip` 时，所有 IP 条件读 `ip`，不会发生解析。
- 没有 `ip` 时，求值从“未解析”状态开始，IP 条件不命中。
- 一条路由的条件本身就是触发解析的条件（不在 `all`、`any`、`not` 内部）时，客户端在求值这条路由之前一定会解析：状态变为“已解析”，从这条路由起 IP 条件读 `resolvedIp`；依赖当前 IP 的条件在请求没给 `resolvedIp` 时结果未知（`needs: dns`）。规则集触发解析时，无论案例假设它命中与否，解析状态都先推进；规则集自身仍按假设求值，没有假设时为 `needs: ruleSet`，不要求提供 `resolvedIp`。
- 触发解析的条件出现在 `all`、`any`、`not` 内部，且当前仍处于“未解析”状态、请求也没有 `ip` 时，结果未知（`needs: dns`），因为客户端是否解析取决于它的短路求值顺序。如果先前的顶层条件已经触发解析，则保持“已解析”状态：IP 条件有 `resolvedIp` 时直接匹配该地址，没有时仍未知（`needs: dns`），规则集仍按假设求值；不会因进入复合条件而重置解析状态。sing-box 目标在 check 阶段就拒绝这种写法（`RESOLVE_NESTED`）。
- 规则集内部的规则可能让客户端解析，proxylang 不模拟这种副作用；依赖它的后续 IP 规则，求值结果可能与客户端不同。

哪些条件触发解析由目标决定：

| 目标 | 触发解析的条件 |
| --- | --- |
| Surge | 没有 `noResolve: true` 的 IP 条件与 `ipAsn` |
| sing-box | 没有 `noResolve: true` 的 IP 条件，以及 `singBox` 分支声明 `resolve: true` 的规则集 |
| Mihomo、Stash | 显式写了 `noResolve: false` 的 IP 条件 |

proxylang 不模拟解析失败，也不模拟多地址时客户端选择哪一个地址；`resolvedIp` 由作者给出。

### 假设

- 案例的 `assume.hit` 与 `assume.miss` 只能列出这份 Profile 的路由实际用到的规则集对象，否则报 `ASSUMPTION_UNKNOWN_RULESET`。
- 两个规则集对象在目标上去重成同一个原生定义时，必须给出相同的假设，否则报 `INVALID_ASSUMPTIONS`。
- 一个案例在某份 Profile 上的结果是 `indeterminate` 时，这个案例失败，并提示需要补充的信息。

请求字段、返回结构与错误见 [library](library.md)，命令参数见 [CLI](../build/cli.md#explain)。

## 用户故事

- [用案例保护路由意图](use-case/protect-routing-intent.md)

## 验收

求值语义由单元测试覆盖，每条规则都要有命中、不命中与 `indeterminate` 的例子；`check` 与 `build` 在案例失败时不发布，由构建测试覆盖。
