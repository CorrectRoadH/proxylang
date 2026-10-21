---
format: concord.document/v1
id: early-language-design
title: 早期语言设计快照
createdAt: 2026-10-21T10:13:34.225Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# proxylang：TypeScript 代理配置语言

> 阅读提示：本文件保留早期“公共配置＋平台扩展”草案。最新方向讨论见[平台机制说明](./how-proxylang-handles-platforms.md)，采用共享策略与平台程序分层。本文件的顶层结构及扩展插入 API 暂不作为后续实现的定案依据；历史审查结论不覆盖这一方向调整。

状态：基础设计独立 Review 复核 PASS；本轮命名、warning 与多版本表述由主 agent 修订并静态核对，未追加独立 Review。尚未实现或进行客户端兼容性验收。日期：2026-10-21。

## 1. 目标与边界

用户用一份 TypeScript 配置表达节点、出口选择、路由规则及共享资源；构建器按目标内核、平台、精确版本生成原生配置。不同客户端具有专属机制，语言允许明确表达它们，而不要求所有功能都能跨客户端运行。

基本原则：

1. 共用语义进入核心语言；原生专属语义进入命名空间扩展。
2. 支持某个语言构造，不等于每个目标都支持它；构建时逐目标证明可表达性。
3. 保留规则顺序、连接路径和拒绝意图；不静默删除、不支持时不自动直连。
4. 格式转换可自动完成，行为变化必须由用户显式选择。
5. TypeScript 是构建期语言；不把 TS 回调自动变成客户端运行时脚本。

本轮只定义语言与编译边界，不实现 SDK，不生成实际配置，不安装客户端，不修改系统代理。首期不承诺历史版本全覆盖、任意配置反向导入或第三方插件动态加载。

## 2. 语言形式与完整例子

采用嵌入 TypeScript 的声明式 DSL。普通 TS 负责变量、函数、模块和组合；SDK 构造器返回不可变描述对象，没有网络、注册、文件写入或全局状态副作用。

```ts
// proxy.config.ts —— 拟议 API
import {
  defineConfig, proxy, group, outbound,
  rule, match, action, secret,
} from "proxylang";

const hk = proxy.trojan("hk", {
  label: "香港",
  server: "hk.example.com",
  port: 443,
  password: secret.env("HK_PASSWORD"),
  tls: { serverName: "hk.example.com", verify: true },
});

const main = group.select("main", {
  label: "默认代理",
  members: [hk, outbound.direct],
  initial: hk,
});

export default defineConfig({
  languageVersion: 1,
  proxies: [hk],
  groups: [main],
  routing: {
    rules: [
      rule("block-ads", match.domain("ads.example.com"), action.reject()),
      rule("local-net", match.ipCidr("192.168.0.0/16", {
        resolve: "never",
      }), action.route(outbound.direct)),
      rule("example", match.domainSuffix("example.com"), action.route(main)),
    ],
    fallback: action.route(main),
  },
});
```

所有资源必须显式注册。引用未注册资源时报错，不进行隐式依赖收集。声明顺序不决定引用合法性，允许引用先声明但后注册的对象；编译器建立图后统一检查。

## 3. 核心概念与类型

| 概念 | 责任 | 不承担的责任 |
| --- | --- | --- |
| Proxy | 与一个代理服务端建立连接，描述协议、认证、传输与 TLS | 决定哪些流量使用它 |
| Group | 在若干连接出口间选择 | 执行任意路由动作 |
| OutboundRef | 引用 proxy、group 或内置 direct | 充当拒绝、嗅探等动作 |
| Match | 描述请求元数据上的匹配条件 | 执行用户 JS 回调 |
| Rule | 稳定 ID、Match 和 Action 的有序绑定 | 隐式排序与合并 |
| Action | 路由、拒绝，或明确的原生流水线动作 | 冒充代理节点 |
| RuleSet | 一组无动作的匹配条件 | 内嵌出口或隐式更新策略 |
| Extension | 特定目标的声明、规则或选项 | 绕过版本与依赖检查 |

示意类型（省略品牌类型及构造器签名，不是可独立编译的声明文件）：

```ts
type OutboundRef = ProxyRef | GroupRef | DirectRef;

type CoreAction =
  | { type: "route"; to: OutboundRef }
  | { type: "reject"; behavior: "deny" };

type Match =
  | { type: "domain"; value: string }
  | { type: "domain-suffix"; value: string }
  | { type: "ip-cidr"; value: string; resolve: "never" | "if-needed" }
  | { type: "network"; value: "tcp" | "udp" }
  | { type: "destination-port"; value: number }
  | { type: "rule-set"; ref: RuleSetRef }
  | { type: "all"; items: readonly Match[] }
  | { type: "any"; items: readonly Match[] }
  | { type: "not"; item: Match };

interface Rule {
  readonly id: string;
  readonly when: Match;
  readonly then: CoreAction;
}
```

语言描述对象的判别字段统一命名为 `type`，不使用 `kind`。Rule 本身仍由 `id`、`when`、`then` 组成；匹配类型在 `when.type`，动作类型在 `then.type`，不额外添加重复的 rule 类型字段。构造器调用方式不变。

`reject` 不属于出口，不能作为通用 group 的成员。客户端允许在选择组中选择拒绝策略时，用该客户端的策略组扩展表达，避免把不同内核的“拒绝动作”误认为可拨号代理。

### 3.1 标识、引用和命名

- 每种资源有不可伪造的引用类型，禁止用普通字符串代替引用；运行时仍检查类型与归属，不能仅依赖 TS。
- 用户资源局部 ID 格式为 `[a-z][a-z0-9_-]*`；公共作用域内唯一，分支作用域见第 7.2 节。限定身份在整个配置内唯一，身份冲突即错误，即便对象内容相同。
- `label` 只控制展示，不参与引用；生成器用稳定 ID 建立目标名称映射。无法单独存 label 的目标以 ID 为原生名称，并报告 label 未呈现。
- 内置资源使用保留命名空间，生成器分配的辅助资源与用户资源隔离；输出名称必须做格式转义及冲突检测。
- 配置构造完成后快照化和校验，不保留 getter、函数、类实例或可变引用；秘密与资源引用在快照中保留专用 token。
- proxy 的拨号依赖和 group 成员依赖统一检测循环；未使用但已注册的资源也必须有效，不暗中剪掉不兼容资源。

### 3.2 Proxy 与连接路径

使用 `proxy.http`、`proxy.socks5`、`proxy.shadowsocks`、`proxy.trojan` 等协议专用构造器。协议选项使用判别联合；TLS、传输层选项只在协议允许的位置出现，避免任意组合。

端口必须为 1–65535 的整数，server 为域名或 IP；TLS 默认验证证书，不因目标缺少对应字段就关闭验证。密码等字段接受 `SecretRef`，可选支持字面量但同样标记为敏感数据。

后续通用 `dial.via: OutboundRef` 的语义为：先通过 via 连接到当前 proxy 服务端，再由当前 proxy 连接目的端；不是“把两个节点都放进一个组”。必须检查代理服务器域名在哪里解析、UDP 支持与依赖环，只有后端能保留这些语义时才提供支持。

WireGuard、Tailscale 等有 endpoint 或独立生命周期的机制先保留在目标扩展中，不强制塞入一个 TCP proxy 模型。协议加入通用层只代表建立统一描述，不代表所有后端都支持。

### 3.3 Group

首期通用层仅包含 `group.select`：members 有序、非空、不重复；initial 必须是成员。initial 表示没有有效持久选择时的初始项，不表示每次加载都强制覆盖用户运行时选择。

若后端以第一成员实现初始项，允许稳定地把 initial 放到首位，剩余项保持相对次序，并在转换报告中记载。只有具有相同初始／持久选择语义的目标适配器才接受此构造；不能把缺失持久化配置默认为已经支持。[S1]

`url-test`、fallback、load-balance 的探测、容差、切换、失败处理和会话策略不预设相同。先在原生命名空间提供，后续依据可验证的共同契约提升为通用构造。

## 4. Rule 的精确语义

通用规则按数组顺序匹配，第一条匹配的终结动作决定结果；全部不匹配时执行必填 fallback。fallback 只接受 route 或 reject，目标后端不得依赖自身隐式默认值。

`route` 一旦选中即不恢复规则扫描：出口不支持请求协议、拨号失败或连接不可用时，该请求失败，不转入后续规则或 direct fallback。编译器推导规则可能承载的网络协议，并检查组的全部可选路径及其拨号依赖。未限定网络的规则按 TCP、UDP 都可能到达处理；不能只看 initial 成员。原生行为可能继续扫描时，只有经验证的终结保护转换才可接受，否则报 `E_NON_TERMINAL_ROUTE`。动态成员能力无法证明时也必须报错，不以当前订阅快照代替未来成员保证。mihomo 对不支持 UDP 的出口可能继续匹配，是此检查的具体依据。[S7]

- `domain`：规范化的完整域名相等。
- `domainSuffix("example.com")`：匹配根域本身及以点分隔的子域，不匹配 `notexample.com`。输入不接受前导点；域名做 IDNA ASCII 转换、去一个结尾点和小写规范化。适配器负责目标版本的差异。[S2]
- `ipCidr`：匹配目的 IP；CIDR 必须是合法且网络地址规范化的 IPv4/IPv6 网段。
- `resolve: "never"`：不因该条件触发 DNS；已有目的 IP 可匹配，否则条件为 false。
- `resolve: "if-needed"`：没有目的 IP 时允许解析；具体 resolver 必须有明确配置。未配置或目标无法表达同一路径则报错，不隐式采用某个平台系统 DNS。
- 其他元数据缺失时原子条件为 false；`not` 为布尔取反，因此 `not(domain(...))` 在域名缺失时为 true。这是语言语义，后端无法保持时拒绝该组合。
- `all`、`any` 至少包含一个条件；按给定次序短路求值。DNS 等可能产生副作用的匹配，不可因布尔代数转换而重排或提前执行。
- 多条规则展开仅在可证明终结结果、顺序、DNS 副作用相同的情况下允许。无法证明的组合报错，不尝试任意指数展开。
- `action.reject()` 只承诺拒绝连接，不承诺 RST、静默丢弃、ICMP 或 HTTP 响应形态；需要精确拒绝方式时使用扩展。

首期实现 domain、domainSuffix、禁止解析的 ipCidr 与 route/reject。network、端口、逻辑组合属于语言模型，但每个构造上线都须有独立能力与语义测试，不能因类型存在就标为支持。

## 5. RuleSet、订阅、DNS 与入口

### RuleSet

通用 RuleSet 是 Match 的有序列表，语义相当于短路 any，不能携带动作。`match.ruleSet(ref)` 使用它。首期只接受内联域名／CIDR 条件；后续本地及远程格式 importer 必须标明格式并严格解析，未知行不跳过。

构建时下载与客户端运行时下载是两个不同能力。构建下载获得固定内容并记录摘要；运行时 provider 的刷新、缓存、失败行为由对应目标扩展持有，不能伪装成可复现的静态 RuleSet。

### Proxy 订阅

未来构建期 importer 返回节点描述集合，随后由用户显式筛选和注册；不支持的协议或丢失字段必须给出诊断。动态 provider 保留为专属机制，其组成员在运行时变化，不能偷偷展开成构建时静态节点后声称等价。

### DNS 与流量入口

DNS 单独建模 resolver、查询路由、bootstrap、出口和失败策略；流量路由规则不等于 DNS 规则。首期未确定完整 DNS 契约，不暴露一个看似通用的 `dns: { servers: [...] }` 并假设等价。

首期允许由目标扩展配置原生 DNS；所有依赖 DNS 解析的语言构造仍必须检查该配置能满足其契约。hostname 形式的 proxy server 也需要适配器明确记录其解析策略，不能把流量规则中的 no-resolve 当成全局 DNS 禁用。

入口／TUN／系统代理接管属于目标运行环境。纯通用配置生成 routing fragment，不能宣称可直接运行；构建 profile 必须包含该目标入口与所需 DNS 等完整条件才可输出 standalone 配置。Surge 应用托管的入口可通过目标运行环境声明满足，不凭空生成监听端口。

## 6. 构建目标与版本

多版本是所有已实现后端共有的构建能力，不是 Surge 特例。目标矩阵为“内核 × 平台 × 精确版本”，同一内核和同一平台可以出现任意多个版本目标；每个目标有独立名称、能力检查、诊断和产物。以下 Surge、mihomo、sing-box 都只是矩阵示例，不代表这些版本已获支持。

```ts
// proxy.build.ts —— 版本只是接口示意，不代表已验收支持
import { defineBuild } from "proxylang";

export default defineBuild({
  entry: "./proxy.config.ts",
  diagnostics: { unsupportedPresentation: "warn", warningsAsErrors: false },
  targets: {
    desktop: { engine: "surge", platform: "macos", version: "6.0.0" },
    desktopNext: { engine: "surge", platform: "macos", version: "6.1.0" },
    phone: { engine: "surge", platform: "ios", version: "5.8.0" },
    router: { engine: "mihomo", platform: "linux", version: "1.19.0" },
    routerNext: { engine: "mihomo", platform: "linux", version: "1.19.1" },
    serverOld: { engine: "sing-box", platform: "linux", version: "1.11.0" },
    serverNew: { engine: "sing-box", platform: "linux", version: "1.12.0" },
  },
});
```

`build --target desktop` 只选择该命名目标，`build --all` 选择整个矩阵。输出以 target ID 隔离，例如同一 generation 内 `desktop/config.conf` 与 `desktopNext/config.conf`；不能仅以 engine 命名后互相覆盖。目标间不共享降级后的 AST；旧版本 warning 不自动传播到新版本。相同版本但不同客户端 profile 也可用不同 target ID 表达。

区分 `surge`、`clash`、`clash-premium`、`mihomo`、`sing-box`。Clash 系内核分别维护适配器，不能以文件扩展名或 GUI 名称识别内核。初期优先 Surge、mihomo、sing-box；其余 engine ID 保留但未实现必须报错。

目标身份至少包含 engine、platform、精确 version。需要时增加 build 与由适配器校验的 build features，不能让用户凭空声明支持某个能力以绕过版本检查。GUI 客户端只作为额外的 client profile，不能替代内核身份；应用托管限制与内核能力求交集。

Surge 的不同平台独立判定版本，不横向比较 iOS 与 macOS 版本。[S3] 版本解析由各适配器负责，包含预发布版本／build 标识规则；首期不支持 `latest` 和浮动范围。

能力注册表按“语义能力＋选项组合＋目标条件”判断，而不是仅看字段名。例如：

```ts
type CapabilityResult =
  | { status: "native" }
  | { status: "lowered"; transform: string; evidence: string }
  | { status: "unsupported"; reason: string }
  | { status: "unknown"; reason: string };
```

每条映射记录文档来源、核对日期、适用版本区间、已测试的精确版本和实现测试。`unknown` 默认阻止构建；`unsupported` 按第 9 节判断 error 或可省略展示功能的 warning。不把“比已知版本新”当成支持证明。格式区间支持与原生验证状态分开报告。

sing-box DNS 与旧特殊 outbound 迁移说明了适配器必须维护目标结构转换，不能只在最终 JSON 上做键名替换。[S2] 当前版本文档不构成所有历史版本兼容性的证据。

## 7. 客户端专属机制

采用三层：通用核心 → 带命名空间的 typed extensions → 后端原生 AST。初期扩展随编译器发行，不开放任意第三方插件执行接口。

### 7.1 扩展声明和选择

```ts
import { extension } from "proxylang";
import * as surge from "proxylang/surge";
import * as mihomo from "proxylang/mihomo";
import * as singbox from "proxylang/sing-box";

const extras = [
  extension.forEngine("surge", {
    id: "surge-http",
    nodes: [
      surge.urlRewrite("example-redirect", {
        pattern: "^http://example\\.com/(.*)$",
        replacement: "https://example.com/$1",
        mode: "redirect-302",
      }),
    ],
  }),
  extension.forEngine("mihomo", {
    id: "mihomo-ui",
    nodes: [mihomo.groupOptions(main, { icon: "https://example.com/icon.png" })],
  }),
  extension.forEngine("sing-box", {
    id: "singbox-detect",
    nodes: [
      singbox.routeStep("detect-protocol", {
        before: "example",
        match: singbox.match.network("tcp"),
        action: singbox.action.sniff(),
      }),
    ],
  }),
];
// 在前面的 defineConfig 中设置 extensions: extras
```

这些工厂仅构造原生语义节点，不直接输出字符串。`forEngine` 的非匹配分支是用户明确限定的功能范围，在报告中记为 `not-applicable`；匹配引擎但版本不支持时必须产生第 9 节定义的 error 或 warning，不能以“不适用”跳过。能力依赖或行为差异不能降为展示 warning。

可增加 `extension.forTarget("phone", ...)` 精确选择构建目标；引用不存在的 target ID 报错。多目标配置的目标名来自 build 文件，不直接耦合内核版本字符串。

若某能力是整个配置不可缺少的要求，使用 `requirements: [surge.capability("http.url-rewrite")]`，不放进可跳过的分支。这样构建 mihomo 时会失败，而不是在缺失该功能后仍声称满足同一需求。

用户接受替代行为时，用互斥的目标分支分别写出实际行为；本版不提供改变网络行为的自动 best-effort、自动删除和隐式 fallback。第 9 节允许省略已证明不影响网络行为的展示字段并发出 warning。不同目标行为会记录在报告中，不称为等价转换。

### 7.2 目标局部资源与默认出口

复杂分支使用 `build(scope)` 构建期回调；该回调在基础配置求值时恰好执行一次，立即转为数据，不保留在快照里，也不在客户端运行。回调仅构造声明，不以当前构建目标为条件执行外部 I/O。`scope` 分配分支身份，`scope.use(mihomo)` 返回绑定该作用域的工厂。

```ts
extension.forEngine("mihomo", {
  id: "subscription-routing",
  build(scope) {
    const m = scope.use(mihomo);
    const provider = m.proxyProvider("subscription", {
      source: { type: "http", url: "https://example.com/nodes.yaml" },
      refreshSeconds: 3600,
    });
    const pool = m.select("subscription-pool", { providers: [provider] });
    return {
      resources: [provider, pool],
      routing: {
        steps: [],
        fallback: m.action.route(pool),
      },
    };
  },
});
```

这是机制示意，具体 provider 参数和版本支持由后续 typed extension 定义与验收；动态成员不意味着自动通过通用终结性检查。

分支 resources 显式注册，routing 可引用该分支及公共资源，不能引用其他分支资源；即使两个分支恰好同时被选中，也不开放横向引用。简写 nodes 与 build 互斥；前者只能使用公共引用或无引用节点。所有分支的结构和引用作用域都先检查，目标能力只检查选中分支。

公共资源身份为 `core/id`，分支资源为 `extension-id/id`，分支 ID 全局唯一，同一作用域内资源 ID 唯一；这是对第 3.1 节配置内唯一身份的具体编码，不要求互斥分支里的局部名字彼此不同。生成器使用限定身份分配无碰撞原生名称。局部引用携带运行时 scope token；TS 尽量限制逃逸，但不能承诺对任意 JS 代码提供静态不可伪造性。

一个目标最多有一个选中分支声明 routing.fallback，它显式替换该目标的公共 fallback，报告同时列出原值和替代值；多个声明即报冲突，不按先后覆盖。只有此专门接口可替换 fallback，其他原生选项调优仍不能覆盖公共动作。公共 fallback 仍必填，供没有替代分支的目标使用；替换后再做当前目标的依赖与能力检查。

原生路由动作须明确其终结／继续语义。上例默认出口位置没有后续规则，必须保证失败时不转入目标的隐式直连；无法保证的版本或组配置拒绝构建。若把动态组作为公共语义的 route 出口，仍遵守第 4 节全部路径检查；只有显式原生路由 step 才可保留该客户端“继续匹配”等专属语义，并在报告中标出它与通用终结路由的差异。不得把原生动作自动提升为 CoreAction。

负例：公共 `action.route(pool)`、另一分支引用 provider、未注册 pool、两个选中分支都写 fallback，均构建失败。公共 rules 可以为空；上述例子不需要创建占位规则。

### 7.3 扩展的执行契约

每个扩展节点必须定义：

- engine／platform／版本要求和选项间互斥条件。
- 自身资源 ID、导出的品牌引用、依赖引用和敏感字段。
- 所属原生阶段及顺序，例如 HTTP rewrite、路由流水线、运行时 provider。
- 是终结动作还是继续执行动作，以及产生的元数据与运行环境需求。
- 对目标 AST 的写入范围、冲突键和验证方式。

规则插入位置必须且只能选一种：`before: ruleId`、`after: ruleId`、`at: "start"` 或 `at: "before-fallback"`。规则锚点必须是公共规则，首期不允许以另一个扩展为锚点。失效锚点报错，不能自动移动位置。

先把 N 条公共规则规范化为 N+1 个间隙：start 为 gap 0，before-fallback 为 gap N，before 第 i 条规则为 gap i，after 第 i 条规则为 gap i+1（i 从 0 开始）。同一间隙的全部贡献统一按 `(extensions 数组序号, 分支 steps 或 nodes 数组序号)` 排序，不区分原来使用了哪种锚点。N=0 时 start 与 before-fallback 都是 gap 0，最后再执行选定 fallback。

锚点围绕公共规则 lowering 后的整个连续展开块，不能插进块内。例：r1 展开为 [r1a,r1b]，A 声明在前且 before r2，B 声明在后且 after r1，结果必须是 `[r1a,r1b,A,B,r2]`；交换声明顺序则为 `[r1a,r1b,B,A,r2]`。会破坏块连续性或跨块重排的 lowering 不允许。

`after` 表示原生规则列表中的位置，不表示前一条终结规则匹配后仍会执行。fallback 永远位于完整路由流水线末尾。若扩展改变嗅探元数据，后续通用规则使用改变后的请求元数据，报告必须注明该影响；它不再与不含扩展的构建具有相同输入条件。

原生扩展导出的 proxy/group 引用只在其分支内可用；公共配置不能引用可能未被选中的资源。TS 用作用域品牌尽量约束，构建器仍验证。节点级调优只能修改其明确拥有的原生选项，不能覆盖核心的 server、TLS 验证、组成员、规则顺序或动作；目标 fallback 的替换只能走第 7.2 节专门接口。

两个扩展写同一资源的同一选项即错误，不采用 last-write-wins；同一数组类区域只能通过约定的有序贡献接口写入。已生成的 AST 不向用户开放任意深度合并。

### 7.4 专属机制如何落地

| 机制 | 语言位置 | 编译处理与边界 |
| --- | --- | --- |
| Surge URL/header rewrite、脚本、MITM | `proxylang/surge` 扩展 | 写入独立原生区域，验证执行阶段、资源与 HTTPS 前提；不翻译为域名路由规则 |
| mihomo 动态 proxy-provider、原生组算法 | `proxylang/mihomo` 扩展 | 保留 provider 引用、刷新和原生组语义；不伪装成静态 proxies |
| sing-box sniff、resolve 等流水线动作 | `proxylang/sing-box` 扩展 | 有序插入原生路由流水线，保留非终结动作的继续执行行为 |
| 客户端展示与应用托管选项 | 对应 client profile 扩展 | 与内核配置分开；无法验证的 GUI 行为标为未验证 |

Surge HTTP 处理有独立阶段，HTTPS 处理依赖 MITM，不能把 rewrite 当成普通 route。[S4] 脚本通过明确的本地资源文件或锁定远程资源引用打包，绝不把构建期 JS 闭包序列化为 Surge 脚本。构建不自动安装 CA、启用系统权限或运行脚本。

mihomo provider 的运行时更新是其独立机制。[S5] sing-box 原生路由动作包含终结与非终结动作，类型层面必须区分。[S6] 专属实现可以以后提升为通用能力，但需重新定义并验证共同语义。

### 7.5 不提供无限制 raw escape hatch

首期不提供 `raw` 字符串、任意原生对象合并或 postprocess 回调。缺少功能时增加 typed extension，让校验、引用及版本信息完整进入编译流程。用户可在编译器外自行改输出，但修改后不再受构建报告的兼容性结论覆盖。

## 8. 编译器职责与资源生命周期

```text
读取可信 TS → 求值并快照 → 校验配置与构建目标
  → 选择目标扩展 → 解析并固定构建期资源
  → 建立 IR 与引用图 → 检查语义与能力
  → 按目标降级为原生 AST → 校验 AST
  → 解析秘密并序列化 → 可选原生校验 → 输出产物及报告
```

模块边界：

- `language`：构造器、品牌引用、快照及语言版本，不依赖具体客户端序列化器。
- `compiler`：目标选择、引用图、语义校验、资源依赖、能力查询及诊断。
- `backends/<engine>`：版本知识、扩展 schema、lowering、原生 AST、序列化与原生检查器。
- `resources`：显式资源更新、缓存与锁定；不从编译器内部偷偷下载。
- `cli`：可信代码加载、文件 I/O、秘密解析、检查器进程与退出状态。

TS 模块按一次构建求值一次，得到相同基础快照后为每个目标派生独立 IR；目标转换不得修改共享输入。文件级位置尽力保留，至少提供资源 ID 和配置路径；不能承诺任意 TS 循环生成节点的精确原始行列。

编译核心只消费快照、目标、锁定资源和秘密 token；纯编译阶段不联网、不读环境、不启动客户端。TS 模块本身能执行任意代码，因此只加载可信配置，进程隔离不宣称为安全沙箱。

构建期资源通过显式 update 命令更新 lock；build 只消费本地已锁定的内容，缺失即失败。锁记录内容摘要、解析器版本和资源 ID；含认证 URL 不原样写入报告。摘要保证固定内容，不代表内容可信。

秘密只在当前目标实际需要时解析。报告不含秘密值或可用于猜测秘密的值摘要；输入摘要计算前用不含值的秘密 token 替换敏感字段。包含秘密的目录从创建时即设为 0700，文件为 0600（其他平台使用等价 ACL）；缺少秘密阻止该目标输出，不生成可误用的占位生产配置。原生检查器 stdout/stderr 可能回显配置，默认不向终端或报告转发；仅提取允许列表内且不含用户值的诊断码与位置，不能可靠提取时只报告退出状态。秘密也不得出现在命令行参数中。

每个目标先在临时 generation 内生成完整 artifact bundle（主配置、必要规则集／脚本和 manifest）。`build --all` 的全部目标在同一个 generation 完成；任一失败整批不发布，报告各目标诊断并非零退出。默认输出为 fragment；显式 `mode: "standalone"` 才检查完整 profile 并输出独立运行配置，mode 写入 manifest。

发布采用单提交点：输出根目录内 `generations/<build-id>/` 存放不可变 bundle，`active.json` 只记录当前 generation 与本批目标列表。先完成所有目标与 generation 的落盘，再以同文件系统原子 rename 替换 active.json；不逐个覆盖目标文件。消费者须读取一次 active.json 并固定 generation 路径，本设计不承诺外部程序跨两次读取指针的事务性。

工具提供的读取／导出流程持有同一输出根目录的共享锁，在读取 active.json 后把需要的完整 bundle 复制到调用方管理的位置再释放锁；与构建独占锁互斥，防止读取旧 generation 时被清理。直接读取内部 generation 路径的外部程序不享有此生命周期保证，不能将其作为客户端长期订阅路径。

发布前取得输出根目录的 OS 级独占锁，串行化整个构建到提交过程；锁忙时直接报告，不删除锁文件抢占。构建被取消或崩溃时 OS 释放锁，active.json 未提交则仍指向旧批次；新 generation 为待清理孤儿。提交之后即视为发布成功，即使清理旧产物失败，也不能改报“未发布”。原子替换不可用的平台／文件系统在写产物前报错；断电持久性还要求该平台适配器支持文件及目录 fsync，否则不声明此保证。

单目标 build 也是一个新 generation，只包含此次选中的目标；active.json 不混入旧目标，使用者需要全套产物时必须 build --all。默认不保留历史秘密配置：成功提交后清理不再活动的旧 generation；清理失败报告路径与警告，并在下一次持锁构建时重试。只清理已验证为本工具所有且非活动的 generation，拒绝跟随越界符号链接；不承诺安全擦除。构建进程失败时尽力清理本次临时目录，崩溃遗留同样在下次持锁时回收。输出不在客户端使用中由工具管理；部署若要长期使用须自行复制固定 bundle。构建器不负责部署、启用或客户端运行时状态。

## 9. 诊断与验收

### 9.1 不支持的 feature 如何 warning

能力检测结果与诊断等级分开。不能简单把所有 `unsupported` 改成 warning 后继续输出；每个 feature 由后端声明影响类别与省略方式，未声明的一律按行为功能处理。

| 情况 | 默认诊断 | 输出行为 |
| --- | --- | --- |
| 已知不支持，且仅影响图标、展示标签等呈现 | `W_UNSUPPORTED_FEATURE` | 省略该具体字段，保留资源与其网络行为 |
| 不支持代理协议、规则、DNS、TLS、入口或其他行为功能 | `E_UNSUPPORTED_FEATURE` | 当前目标失败，不能省略规则或改用 direct |
| 功能在 requirements 中明确要求，即使属于展示功能 | `E_REQUIRED_FEATURE` | 当前目标失败，required 优先于 warning 策略 |
| 能力状态 unknown、未实现后端或无法识别目标版本 | `E_UNKNOWN_CAPABILITY`／目标诊断 | 当前目标失败，不能猜测后忽略字段 |
| 已选功能已弃用但在该版本仍支持 | `W_DEPRECATED_FEATURE` | 按已验证格式输出，说明迁移方向 |
| 用户明确限定到其他目标的分支 | 报告 `not-applicable`，不发 warning | 不进入当前目标配置 |

仅“忽略后不改变连接、匹配、执行顺序、权限、秘密处理或资源依赖”的字段可被后端标为 presentation。一个节点混合展示字段和行为字段时，按字段分别检测，不能整节点丢弃；被忽略的字段也先经过类型、引用和冲突检查。不能把 URL Rewrite、嗅探或自动选路因为“不是必需”就归为 presentation。未知功能影响不能靠用户配置变成已知安全。

`diagnostics.unsupportedPresentation` 可取 `"warn"`（默认）或 `"error"`；`warningsAsErrors: true` 将全部 warning 提升为阻止发布的 error，适用于 CI。二者不提供把行为 error 降级或静默忽略的选项。该补充细化原有展示信息未呈现的报告，不放宽通用网络语义契约。

warning 必须给出 code、target ID、engine/platform/version、feature、资源 ID／配置路径、原因、实际处理（例如 omitted）和建议。只有有版本证据时才给出最低支持版本，不编造升级版本号。终端以 target 分组，机器报告保留结构化诊断；不打印秘密或认证 URL。

无 error 且未启用 warningsAsErrors 时，warning 不阻止构建，退出码为 0，并明确汇总警告数量；所有目标仍遵守整批提交规则。任何目标有 error，build --all 非零退出、不更新 active.json。warning 说明功能未完整呈现，不能将结果标为“无差异兼容”。

### 9.2 诊断示例与验收

示意诊断：

```text
E_UNSUPPORTED_CAPABILITY target=router
extensions.surge-http: required capability surge.http.url-rewrite
target mihomo@1.19.0/linux cannot satisfy this requirement

E_DANGLING_REFERENCE target=desktop
routing.rules[2] (example): group main is not registered

E_EXTENSION_CONFLICT target=router
extensions.a and extensions.b both write group main option icon

W_UNSUPPORTED_FEATURE target=desktop
target surge@6.0.0/macos feature=presentation.label
groups.main.label: separate display label cannot be emitted; omitted
native name remains the stable resource ID; routing is unchanged
```

warning 例子仅演示诊断结构，实际 feature／版本支持结论由能力表提供，不是对示例版本的兼容性声明。

报告包含编译器／语言版本、精确目标、非敏感输入摘要、资源锁信息、能力映射、转换、应用与跳过的目标分支、运行前提，以及 native validation 的 passed／failed／not-run 状态。不得把生成成功叫作运行验收通过。

必要验收：

1. 类型用例：不能把 RuleSet 当出口、reject 当组成员或把目标局部引用放入公共规则。
2. 语言负例：重复 ID、悬空引用、循环、空组、无效 initial、非法端口、扩展冲突与失效锚点。
3. 行为用例：域名根／子域／相似后缀、元数据缺失与 not、DNS 不解析、规则优先级、fallback 及扩展阶段顺序；补充 UDP 命中不支持 UDP 的节点／混合成员组且后续为 direct 的反例；空公共规则下的原生 provider → group → fallback；混合 before/after 锚点及规则展开全序。
4. 版本用例：同一输入对至少两个同内核精确版本生成适用结构；测试支持边界两侧、移除版本和未知版本。没有实现证据不得把示例版本列入支持矩阵。
5. 原生检查：在可用的精确客户端版本上运行配置检查；Surge 可使用离线 `surge-cli --check <path>`，其余以该版本帮助确定命令。检查器版本必须匹配目标，不能用新版验证结果冒充旧版证明。
6. 集成测试：真实内核配本地可控代理／DNS 服务验证连接路径和 DNS 副作用；fake 只模拟外部服务。原生语法检查与运行行为测试分别报告。
7. 生命周期：多目标互不污染，秘密不进入日志（包括会回显输入的原生检查器），锁定构建不隐式联网；注入 active.json 提交前／后失败、取消、崩溃与并发构建，验证旧批次或新批次完整可见，以及孤儿／旧秘密产物的清理。
8. warning 矩阵：已知可省略展示字段为 warning，行为功能与 required 为 error，unknown 不冒充 unsupported；warningsAsErrors 阻止整批发布。相同配置对同内核同平台不同版本分别输出诊断与独立文件，并确认未静默丢弃规则。

## 10. 实现分期与待验证项

- 第一阶段：SDK 基础、静态 proxy、select、基本 rule、显式 fallback、目标识别、最小 typed extension 框架与三个后端。只承诺核实过的协议／版本；可先输出 fragment，standalone 必须满足完整运行前提。
- 第二阶段：RuleSet 导入与锁、完整 DNS 契约、目标入口 profile、同内核多版本转换与原生行为测试。
- 第三阶段：动态 provider、更多原生组、脚本／rewrite、TUN 与高级协议；每个功能按语义与版本证据进入能力表。

实施前仍须选定首批精确目标版本及可用检查器；完成 DNS 和 standalone profile 的独立契约后才能实现相应功能。本设计没有将上述未完成内容伪装成已验证兼容性。公共模型与专属扩展边界属于重大设计，须独立审查后再定案和实现。

## 11. 资料与证据范围

2026-10-21 核对以下官方在线文档。它们用于证明机制差异，不能代替历史版本源码及运行验收。

- [S1：Surge Manual Selection Group](https://manual.nssurge.com/policy-groups/select.html)
- [S2：sing-box Migration](https://sing-box.sagernet.org/migration/)
- [S3：Surge Policy Overview](https://manual.nssurge.com/policies/overview.html)
- [S4：Surge HTTP Processing](https://manual.nssurge.com/http/overview.html) 与 [HTTP Request Script](https://manual.nssurge.com/scripting/http-request.html)
- [S5：mihomo proxy-providers](https://wiki.metacubex.one/en/config/proxy-providers/)
- [S6：sing-box Rule Action](https://sing-box.sagernet.org/configuration/route/rule_action/)
- [S7：mihomo Routing Rules](https://wiki.metacubex.one/en/config/rules/)

## 12. 审查状态

独立 Review 及修订详见 [设计审查记录](./design-review.md)。基础设计初审问题已收敛并复核 PASS；后续 type 命名、展示 warning 与通用多版本矩阵由主 agent 按用户反馈修订，未追加独立 Review，不将原有 PASS 外推为本次修订的独立审查。明确延期的功能仍须先补齐具体设计与版本证据。
