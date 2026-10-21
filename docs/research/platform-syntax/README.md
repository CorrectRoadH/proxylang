---
format: concord.document/v1
id: platform-syntax
title: 从家庭代理需求反推语言语法
createdAt: 2026-10-21T11:05:41.401Z
kind: research
sources: []
---

# 从家庭代理需求反推 proxylang 的语法

这是一份待审查的语言设计提案，不是现有 SDK 的支持声明。它解决 it-infra 的规则、出口、规则集与平台机制如何进入语言的问题。先确定语义，再扩展编译器，最后迁移消费者；不以保留原生文本完成语言设计。

## 一份策略为什么不能等于一份配置

it-infra 的 M4 配置实际包含三个决定：哪些请求走哪个逻辑出口；出口如何选节点或连接家庭网络；请求进入程序后能看到什么信息。ZimaCube 可以共享第一个决定，却不一定使用相同的选路算法、网络入口或设备识别方式。

因此保留 `policy / rule / block / use / slot` 为语言中心。增加条件与数据集参数、可绑定出口，以及有类型的平台程序。TypeScript 的 import、函数和数组负责源码组织，编译器接收可检查的声明树，不能只接收最后拼好的原生文本。

`rule` 的判别字段仍为 `type`。不引入泛化的 `kind`、任意原生字符串或一个囊括全部客户端字段的大对象。

## 首先把“怎样组合”表达完整

共享策略声明三类参数：`exits` 是动作出口槽位，`matches` 是条件槽位，`sets` 是具名规则集槽位。分别用 `slot('proxy')`、`matchSlot('device')`、`setSlot('vendor')` 引用；`use` 的 `bindings`、`matchBindings`、`setBindings` 分别绑定三类参数。现有 `bindings` 保持出口用途，避免同一名字同时表示条件和出口。

条件槽位必须绑定合法条件树；集合槽位必须绑定无动作的匹配集合，不能绑定带 FINAL 的原生完整规则表。嵌套实例只允许显式转绑定外层槽位。三类参数各自严格检查遗漏、多余和循环引用。

例如 P2P 策略不必固化“如何认出这台 NAS”：它把 `matchSlot('device')` 与源端口、目标端口及网络条件组合，动作仍是 direct。M4 程序绑定按 MAC 识别的条件，另一程序可以明确绑定源 IP 条件。替换发生在绑定处，因此共享策略顺序不变。

但这不是编译器认可 MAC 等价于 IP：绑定应附 `reason`，构建报告记录条件指纹和实际实例绑定。MAC 与 IP 的替代只允许作者显式选择；IP 归属或地址固定需要部署证据。不能根据目标缺少 MAC 就自动回退为 IP。

`block` 的守卫仍与后代条件 AND，`sequence` 只按顺序组合。`use` 不附加默认动作。飞书优先屏蔽、LAN 优先 Home、Home 优先 DEV、Steam 商店优先下载域名，都直接体现为序列，不靠规则类型排序。

## Smart 是出口算法，不是通用的“自动选择”

共享策略只使用 `slot('proxy')`，平台程序决定绑定什么。增加有类型的资源构造器：通用 `group.select(...)`，平台专属 `surge.smart(...)`、`singbox.urltest(...)`。同一个出口意图在两个程序中可分别绑定这两种资源，但这是两套显式策略，不是 Smart 的自动转换。

Surge Smart 根据真实连接质量选择与重试，具有自己的成员限制和状态；它不等于周期 URL 探测。因此不提供含糊的 `auto` 算法，也不使用 `onUnsupported: 'urltest'` 偷换含义。[Surge Smart 文档](https://manual.nssurge.com/policy-groups/smart.html)

资源使用稳定 id 与分离的 label。通用选择组成员扩展为有类型的节点引用、组引用、direct 或 reject，支持现有 Distraction 与 Apple 的手工切换。Build Provider 逐项判断目标是否能表达这些成员及默认值；Smart 不会因此允许 DIRECT 或嵌套组。

组内重试与路由规则首命中是两个层次：选中的 Smart 可以重试成员，但不继续执行下一条路由规则。编译器检查成员和拨号依赖形成的联合图；不能用“外部出口声明支持 UDP”绕过真实资源检查。

## Tailscale 首先是一项有状态资源

不要把 Tailscale 直接放入普通远端节点的 server/port/password 结构。平台命名空间分别提供 `surge.tailscale(...)` 与 `singbox.tailscale(...)`，都能在本平台形成 route 可引用的出口，但保留自身字段、版本条件和运行身份。

sing-box 的 Tailscale endpoint 从 1.12 起存在，具有 state_directory、认证、路由接收等独立职责。当前语言只识别该内核版本，不代表已经实现 endpoint。编译器必须区分“目标内核具有功能”与“本后端实现了编码”。[sing-box Tailscale](https://sing-box.sagernet.org/configuration/endpoint/tailscale/)

状态目录是运行时资源，不放进每次原子发布的 generation，更不随构建清理。每个运行实例独占状态位置；构建只输出配置与目录需求，不创建 tailnet 身份、不注册节点、不读取已有状态。认证仍引用 Secret。两台设备不能默认共用身份目录。

共享 Home 策略只声明它匹配的域名/CIDR 与 home 出口槽位。MagicDNS、允许路由、DNS 引导、控制平面连接及本地网络绕行属于平台程序。能引用 endpoint 不等于 DNS 已配置；编译器检查显式依赖，连通性留给运行验收。

## 远程规则集需要数据契约，不能只写 URL

`ruleSet(...)` 声明集合身份、格式、来源和更新方式；`match.inSet(setSlot('vendor'))` 只把集合用于匹配，动作留在外层规则。不能把带出口的远端配置当作无动作集合，也不能对不认识的行静默跳过。

集合分两种生命周期。`snapshot` 在显式资源更新阶段下载、解析并锁定内容摘要；纯编译只读已提供的快照。`runtime` 保持原生远程集合语义，由客户端更新，必须明确源格式、目标格式、下载出口、缓存和更新间隔。

对 snapshot，可以把受支持的域名、IP、端口等条件转为公共条件集合，再由后端编码本地资源。解析器若遇到未知指令、动作或不支持的匹配选项，应返回行号错误，不能部分成功。集合 OR 内部也必须保持原格式的组合语义，不能把一行的 AND 展平成 OR。

对 runtime，只有内核能读取相同语义和格式时才直接引用。Surge RULE-SET 的 URL 不能原样写成 sing-box 规则集 URL。若需要格式转换服务，那是额外资源生产者；作者必须显式提供其产物，不由编译器隐式部署服务。[sing-box Rule Set](https://sing-box.sagernet.org/configuration/rule-set/)

snapshot 转换会改变“谁在何时刷新规则”的行为；这不是仅改文件后缀。既有 vendor 集合迁移必须选择生命周期，记录摘要或动态来源。静态解释未拿到 runtime 集合内容时返回未知，不能当作不匹配继续给出确定出口。

## extended-matching 揭示了条件的真正输入

普通 domain 条件匹配请求域名。Surge extended-matching 还尝试 TLS SNI 与 HTTP Host；这不是简单增加几个域名。语言应表达候选值来源，例如 `domainSuffix(value, { from: ['request', 'tlsSni', 'httpHost'], quantifier: 'any' })`。[Surge Domain Rules](https://manual.nssurge.com/rules/domain.html)

现有单参数形式保持已有“已观测请求域名”语义，不隐式扩充来源。新多来源条件表示：在指定来源可用的值中，任一满足就匹配。NOT 作用于整个表达式，不能分别取反后 OR。normalize 规则也必须定义，不能把来源不同的字符串未经处理直接比较。

平台程序负责信息取得。Surge 后端在支持条件与版本上编码 extended-matching；sing-box 程序可以显式包含 `singbox.sniff(...)` 等非终结步骤，但必须证明后续条件能读取对应来源。

嗅探可能只留下一个用于选路的域名，未必保留 request、SNI、Host 三份独立值。若后端不能证明“任一来源匹配”的语义，返回 `MATCH_SOURCE_UNREPRESENTABLE`，而非自动认为 sniff 等价。作者可以显式采用本平台的 `singbox.match.sniffedDomain(...)`；报告标明选择了不同条件。

这种差异不能只发 warning，因为命中范围会改变。编译器不会偷偷增加全局嗅探、DNS 查询或重写目的地址。元数据采集步骤的超时、失败行为和可见字段由平台构造器定义。

## MAC 需要语言能力、版本能力与环境能力同时成立

建议用 `match.sourceMac(...)` 表示来源设备 MAC。它描述需要的事实，不承诺任意客户端都有这个字段。Build Provider 检查版本和平台程序的采集机制，部署清单列出邻居解析或入口环境要求。

官方 sing-box 文档把 source_mac_address 标为从 1.14 起提供，并要求相应环境设置。因此不能笼统说它只属于 Surge，也不能据此把 1.12 目标标成支持。该文档中的版本标签也不是本项目已验证或已收录发行版的证据。[sing-box 路由条件](https://sing-box.sagernet.org/configuration/route/rule/#source_mac_address)

`processName` 同样不能认出远端 LAN 客户端里的进程；它描述当前执行环境能观测的进程。未知或缺失元数据与条件不匹配不同，解释器必须让作者知道是入口缺信息还是规则本身不成立。

## 平台程序是有类型的执行序列

通用策略只含匹配与终结动作。平台程序还可含本平台的 sniff、DNS 处理和 route-options 等非终结步骤；它们按顺序与 `use(...)` 实例一起组成 pipeline。步骤完成后是否继续、产生哪些元数据、失败怎样处理，都由平台节点契约决定。[sing-box 路由动作](https://sing-box.sagernet.org/configuration/route/rule_action/)

`surge.program(...)` 不接受 singbox 步骤；`singbox.program(...)` 不接受 Surge Smart。TypeScript 提供首层类型错误，运行时 schema 再验证配置来自 JSON 或动态函数时的错误。跨模块组合使用声明树，来源保留模块、策略、实例及资源 id。

内核特有机制是语言的一部分，但必须有命名空间、结构化字段、能力描述和专属编码器。不要暴露 `native: string` 或任意 JSON merge：它们会绕过引用、顺序、冲突和版本校验。

## Target 只选择程序，不能秘密改写策略

Build Target 指定 program、engine、platform、精确 version，以及已建模的发行形态或构建能力。Surge macOS 与 iOS 是不同目标；不能借 macOS 6.10 编译成功证明 iPhone 支持。sing-box CLI 与图形客户端的环境差异也需单独校验。

共享 TS 工厂可以构造两个平台程序，但关键差异应以命名的绑定声明呈现。不要给作者一个全局 `if (target...)` 黑箱后只保存最终对象；解释报告要保留选择了哪个程序、绑定了何种条件、出口算法及数据集生命周期。

需要跨版本备选时，用受控 `choose(...)` 声明带条件和 reason 的候选。只允许按 Build Provider 的静态能力描述选择，按声明顺序匹配，必须且只会选择一个；没有候选则错误。未选候选做结构验证，选中候选做完整语义验证。

`choose` 不捕获任意编译失败：引用缺失、循环、无效秘密、解析失败不能触发下一个候选。候选不得自动用 direct 或空规则替代缺失功能；显式行为差异必须出现在目标报告与目标专属案例中。首轮实现可以先使用两个显式程序，避免过早加入选择器。

## Warning 只用于不改变路由承诺的情况

| 结果 | 条件 | 行为 |
| --- | --- | --- |
| supported | 完整语义可编码，环境前提已声明 | 生成产物，列出未运行验收项 |
| unavailable | 版本不具备功能，或后端尚无实现 | error，不输出部分可发布批次 |
| unrepresentable | 缺少等价的匹配、算法或刷新语义 | error，建议可选择的明确方案 |
| environment-required | 缺少入口、元数据或资源依赖声明 | error；声明完整后仍保留部署验收要求 |
| advisory | 只影响展示或已显式选择的策略差异说明 | warning，可提升为 error |

诊断带 code、目标、策略实例路径、资源路径、能力版本要求、原因与修正方向。`allowUnsupported`、任意忽略 code、自动删规则都不进入语法。用户选了不同算法后产生的是可审计选择记录，不是“编译器成功等价转换”的证据。

## 解释器不能伪造运行结果

沿用现有请求 API 时，未提供的原子字段仍按既有契约为 false，NOT 按普通布尔逻辑处理，不偷偷改变已有案例。新增带来源的观察记录使用 `known / absent / unknown`：确定不存在是 absent，未提供或尚未观测是 unknown。

新解释模式对 unknown 使用三值逻辑，NOT unknown 仍为 unknown。若较早规则可能命中，就不能断言后面规则必定命中；返回可能分支或在该位置标记无法确定。它也不能假装实际执行过 sniff、远程集合刷新或 Smart 选择。

回归案例应区分请求域名与 SNI 冲突、缺失与未知、集合摘要变化、MAC 与 IP 绑定差异、相同策略在不同程序的出口算法。现有二值 API 保持明确兼容边界，新模式须单独命名及测试后再采用。

## 怎样从这里推进实现

先补结构化平台资源和精确目标能力：选择组动作成员、Surge Smart、sing-box Tailscale 及运行需求；它们让现有出口真正进入语言。然后实现条件与集合槽位，完整迁入本地规则组合。

再实现来源明确的域名条件、静态集合快照和相应解释模式。runtime 集合转换、非终结步骤、MAC 环境检查需要各自具体后端契约；未实现项持续报错，不用原生文本旁路。

最后才迁移 it-infra 构建，逐设备验证真实目标与旧配置语义。ZimaCube 的备用网关还需独立完成入口、DNS、路由、防火墙和故障切换验证。语言表达能力、原生配置合法、设备可运行，是三个验收结果。
