# 语义与平台适配器

## Problem

平台原生配置类型不能直接决定公共语言的概念归属。需要让作者声明共同目标，同时能要求精确机制或覆写平台实现。

## Core Mental Model

公共模型拥有条件、资源引用和算法契约。平台适配器按 engine、platform、精确 version 把契约变成受支持的原生配置，并保留选择证据。不同实现可以满足同一个明确限定的算法家族契约，不承诺内部评分相同。

## Scope

先实现算法声明；下表是完整语言的归属决策，不表示所有条目已实现。

| 能力 | 通用部分 | 平台扩展与能力条件 |
| --- | --- | --- |
| 规则 | domain/suffix/keyword、IP、端口、network、进程名/路径；all/any/not；顺序、slot、模板 | 操作系统元数据可得性、逻辑深度、原生规则 token；正则方言未统一前不可通用化 |
| 动作 | direct、reject、route、默认出口 | 特定拒绝报文、嗅探/重写/解析动作，不能用 reject 代替全部拒绝方式 |
| 节点协议 | 协议身份、server/port、秘密引用、TLS 身份、WS 传输、via | 各协议特性与版本支持；Reality/flow 应是明确传输/安全扩展而非任意原生对象 |
| 策略 | 稳定 ID、有序成员、算法、选择证据 | Smart 专属调优、原生组选项与成员限制 |
| 算法 | select、auto、urltest；未来 fallback 与明确命名的 load-balance 机制 | 每个平台提供实现；不支持的机制或参数报错，不因同叫 load-balance 就合并哈希/轮询/随机 |
| 规则集与节点订阅 | 资源 ID、类型、引用、格式声明、更新要求 | 原生格式、加载者、缓存/下载代理；外部内容未知，静态不伪造匹配或节点列表 |
| DNS | 服务器身份、传输协议、地址、凭据引用、按条件选上游的意图 | 查询时机、缓存、fake-IP、fallback、平台路由与 DNS 耦合；先定义独立执行契约再实现共享流水线 |
| 入站与系统接管 | 显式 HTTP/SOCKS/mixed 监听、地址/端口/认证意图；TUN 是通用入站概念 | TUN 栈、路由安装、权限、接口排除和系统 DNS 劫持是平台设置，不能替应用执行 |
| 隧道 | WireGuard/Tailscale 是通用协议/资源概念；身份、密钥、地址、资源引用 | 生命周期和所有权尚不同：endpoint 与 proxy 角色不强转；持久状态、登录、MagicDNS、路由发布由具体资源契约约束 |
| 完整 profile | 共享节点、策略、规则和已定入站/DNS 声明 | 各引擎根配置、控制接口、托管更新、Surge MITM/Rewrite/Script；维持严格 typed profile |

仅支持一个平台不使一个概念失去通用资格。反之，多个平台都有相同字段也不证明语义一致。通用参数必须有确定单位、默认值、有效范围和是否必需；任何影响行为的不可兑现值均为 error。

### 算法契约

- select：由原生客户端/用户选择成员，初始候选顺序保留；不声称编译器拥有选择状态。
- auto：使用客户端的质量/可用性观测自动选择候选成员；允许原生评分、探测和切换时机不同，不承诺全局最低延迟、相同选中节点、严格成员顺序优先、零中断或所有成员失败时仍可用。只声明算法家族，无通用调优参数。
- urltest：要求 URL 探测实现及声明的测试参数；不能被 Smart 代替。探测结果与实际业务延迟并非同一指标。
- fallback（后续）：有序健康候选优先；恢复后是否抢占必须在其单独契约中明确。
- load-balance（后续）：需区分 round-robin、consistent-hash、random 等机制；哈希键与会话粘性必须明确。

Smart 与 URLTest 都是算法实现。Smart 可实现 auto 家族，URLTest 既可实现 auto，也可满足作者更窄的 urltest 要求。把 Smart 放在 surge 命名空间是指定具体实现，不是把自动选择概念排除出通用层。

### 首个切片 API

新增 PortableAlgorithm 对象联合：{type: 'auto'} | Extract<GroupAlgorithm, {type: 'select' | 'urltest'}>。

group.auto() 返回精确的 {type: 'auto'}；group.select()/group.urltest() 返回各自 Extract<GroupAlgorithm, {type: ...}>，不使用宽 GroupAlgorithm 返回类型。surge.smart() 返回精确的 surge-smart 对象。

StrategyDefinition 为公共 id/members 与两分支联合的交叉类型：{algorithm: PortableAlgorithm; implementations?: StrategyImplementations} | {algorithm?: never; implementations: StrategyImplementations}。

Strategy = StrategyDefinition & {type: 'strategy'}；strategy() 直接接收 StrategyDefinition，不使用消解联合约束的非分配式 Omit。StrategyImplementations 保持现有可选 engine 键及 GroupAlgorithm 值。

Strategy 保留 type/id/members；允许以下两个模式：

1. 旧模式：algorithm 未声明，implementations 必填，原有行为完全保留。
2. 通用模式：algorithm 必填，implementations 可省略或作为目标覆写。algorithm 不允许 surge-smart；具体 Smart 仍由 surge.smart() 表达。

```ts
const automatic = strategy({
  id: 'automatic',
  members: ['hk', 'jp'],
  algorithm: group.auto(),
});
const tuned = strategy({
  id: 'tuned',
  members: ['hk', 'jp'],
  algorithm: group.auto(),
  implementations: {
    'sing-box': group.urltest({ url: 'https://example.com/probe', intervalSeconds: 180 }),
    surge: surge.smart(),
  },
});
```

覆写必须满足算法契约：auto 仅接受 urltest 或 surge-smart，select 仅接受 select；urltest 仅接受归一化参数完全相同的 urltest（URL 精确相同、间隔默认 180 秒、容差默认 50 毫秒）。不同参数不是覆写该要求，而应另声明 strategy。通用模式的非法未选分支仍作结构与算法兼容性校验；旧模式保留未选分支仅作结构校验的现有行为。目标支持性和资源限制在选中分支检查。

### 选择与编译

顺序为：严格 schema → 通用/显式算法要求 → engine 覆写或目标 adapter 默认 → 精确目标能力与成员检查 → 原有资源图与网络能力检查 → 原生编码。不是尝试编译失败后切换算法。

首个 auto 默认映射：Surge macOS 6.10.0 → surge-smart；sing-box 1.11.0/1.12.0 与 Mihomo 1.19.32 → urltest。URLTest 默认 URL 为 https://www.gstatic.com/generate_204，intervalSeconds=180，toleranceMs=50。该 URL 是原生客户端运行时探测地址，编译不访问它；用户可通过 implementations 明确改 URLTest 参数。Stash 4.2.1 暂无 auto 实现，返回 GROUP_UNSUPPORTED。完整 Surge profile SDK 暂不接受通用 Strategy，不因新增公共入口而声称已接入。

目标目录继续拥有可用具体实现，并以 autoGroup 字段逐精确条目记录默认 auto 实现（surge-smart/urltest/null）。lowering 接收完整目标而非仅 engine。适配器默认映射必须受目标目录门控，不能对目录外版本推断支持。未选 engine 的分支保留结构和契约验证，但不为其虚构 target。

StrategySelection 保留现有 id/engine/algorithm/members；仅通用模式新增 requestedAlgorithm: PortableAlgorithm 与 implementationSource ('default' | 'override')。requestedAlgorithm 是经 schema 归一化的参数对象：urltest 补齐默认间隔与容差，select/auto 保留 type；与 algorithm 一样深冻结。algorithm 仍是实际原生实现，旧模式不增加字段。check/manifest 透传选择证据。资源引用保持 strategy ID；explain 返回该 ID，不根据算法推测最终节点。

新增 ALGORITHM_CONTRACT_MISMATCH 表示覆写不满足声明；algorithm 和 implementations 都缺失为 INVALID_SCHEMA。旧 STRATEGY_IMPLEMENTATION_MISSING、ALGORITHM_ENGINE_MISMATCH、GROUP_UNSUPPORTED 与 SMART_MEMBER_UNSUPPORTED 继续适用。

### 迁移与资源生命周期

原 implementations-only 输入不迁移、不重解释、不改输出。新增公共入口与现有编译器共享 lowering 与编码；不得建立第二份组编译器。输入不可变、产物批次秘密快照与原子发布保持现状。暂不改独立 Surge profile 的 schema、发布 workflow 或版本号。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-no-silent-weakening) | satisfied | auto 显式允许实现差异，固定算法与参数拒绝弱化 | 算法契约与选择顺序；设计论证 |
| [L2](../../LIMITS.md#l2-compile-only) | satisfied | 所有运行状态由原生客户端拥有 | 资源生命周期；设计论证 |
| [L3](../../LIMITS.md#l3-compatibility) | satisfied | 新模式显式 opt-in，旧模式与证据形状不变 | 迁移边界；待实现回归验证 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-portable-intent) | satisfied | algorithm + adapter 默认，无需重复平台分支 | API 与 C1/C2 设计 |
| [G2](../../GOALS.md#g2-explicit-ownership) | satisfied | 能力矩阵明确共享不变量及平台职责 | 归属表与编译顺序 |
| [G3](../../GOALS.md#g3-incremental-delivery) | satisfied | 首个切片限策略，既有 API 不破坏 | 迁移方案与 C3/C7 |

## Acceptance

验证所有 CASES 场景；类型测试拒绝空 strategy 与原生算法冒充公共算法；运行时测试 JavaScript/未知字段与未选分支。完整编译、compileStrategyGroups、check/manifest 三处选择证据一致且深冻结。执行项目 check、安装包验收、既有精确内核 native check；Surge 原生检查不可用时明确列出，不声称运行时选路一致。

## Reference evidence

- [Surge Smart](https://manual.nssurge.com/policy-groups/smart.html)：真实连接质量与站点记忆参与选择，成员限制不能忽略。
- [sing-box URLTest](https://sing-box.sagernet.org/configuration/outbound/urltest/)：URL、周期、容差以及连接中断选项属于具体实现。
- [Mihomo URLTest](https://wiki.metacubex.one/config/proxy-groups/url-test/)：探测 URL、周期与切换容差。

这些官方文档支持机制区分，不替代固定版本的原生配置检查。
