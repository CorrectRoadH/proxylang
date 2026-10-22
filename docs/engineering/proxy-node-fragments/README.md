---
format: concord.document/v1
id: proxy-node-fragments
title: 节点片段与链式声明
createdAt: 2026-10-22T08:23:19.608Z
kind: engineering
---

# 节点片段与链式声明

本文定义 SDK 契约，支持 it-infra 将 provider 节点编码交给 proxylang。继承规则与文件布局归消费方，协议编码、名称与引用检查归 SDK。该边界不把局部片段通过当作完整设备配置有效。

## 写法与数据

保留 `proxy.http(options)` 等构造器返回纯数据的兼容接口。新增 `proxy.builder(node)`，接受已类型化节点，返回不可变 builder；`.via(id)`、`.label(text)`、`.tcpFastOpen(boolean)` 返回新 builder，`.build()` 返回独立、冻结的原协议节点数据。调用 `.via()` 替换该节点的一个拨号依赖，不追加路径；构造 A.via(B) 表示 client → B → A → destination。builder 不自动注册 B，不接受原生名称作为 ID，不接受整节点隐式注册。不增加与节点现有 via/label 属性同名的方法到数据对象；未 build 的对象在 compile 中被拒绝。

示例：

```ts
proxy.builder(proxy.http({
  id: "exit", server: "proxy.example.com", port: 8080,
  username: secret("USER"), password: secret("PASS"),
})).label("🇭🇰 示例节点").via("relay").build()
```

新增 `tcpFastOpen?: boolean` 共用字段；Trojan/AnyTLS 增加 `skipCertVerify?: boolean`，VMess/VLESS 的 tls 增加同名字段。HTTP 和 SS 不接受 TLS 校验字段。初期新选项只为 Surge 6.10.0 实现；其它目标遇到显式值（包括 false）报 PROXY_OPTION_UNSUPPORTED，待有对应编码和验收后扩充，不静默忽略。

增加严格 `surge?: { udpRelay?: boolean; blockQuic?: "auto" | "on" | "off" }`，作为明确的平台参数逃生口，不能用于其它引擎。HTTP 拒绝该对象；SS 支持 udpRelay true/false。Trojan/AnyTLS 只接受 true，false 报错。官方文档将这两种协议列为自动支持 UDP，不能将被原生忽略的开关伪装为禁用语义。VMess 只支持 blockQuic，仍维持现有语言 TCP-only 路由约束。未指定时保持既有 SDK 输出；SS 默认 block-quic=off，可显式 auto 恢复旧配置默认。

旧 provider obfs/obfs-host 不在本次编码范围，适配器必须对非空值明确失败；非支持 cipher 也失败。不能因旧 schema 接受就丢弃。

SS 的 surge.udpRelay=false 在 Surge 上关闭 UDP，静态能力必须标为 TCP-only 并经组成员及 via 依赖传播，拒绝 UDP 可达路由及 fallback。

AnyTLS 在 Surge 上更正为具备 UDP 协议能力；其它平台能力沿用原保守限制，不能全局删除 TCP-only。Surge block-quic=auto/on 不是全 UDP 禁用；静态能力不证明 QUIC 可用或运行时连接。

## 节点片段 API

新增 `compileProxyNodes(input: unknown): ProxyNodeCompilation` 与 `renderProxyNodes(compilation, resolveSecret): ProxyNodeArtifact`。compile 不读秘密、不生成含凭据文本；render 使用既有 秘密解析函数 契约和 RenderError 固定代码，一批 token 只解析一次。

拒绝伪造或失败 compilation；以模块私有 WeakMap 保存成功 compilation 对应的计划，编译结果不接受从 JSON 反序列化后渲染。

输入 `ProxyNodeInput` 唯一结构：

- target: `{ engine: "surge", platform: "macos", version: "6.10.0" }`，首期仅这一精确目标，不假装支持其它片段后端。
- nodes: readonly ProxyNode[]，按输入顺序输出，最多1000项。
- names?: Readonly<Record<string,string>>，只允许映射输入节点 ID。最终名为 names[id] ?? id；label 继续是元数据，不改变现有全配置输出。消费方明确提供 names[id]=原 node.name。
- externals?: readonly `{ id: string; nativeName: string; kind: "proxy" | "group" }`[]，最多1000项且 nodes+externals总数不超过1000。它们是由完整配置拥有的原生符号，只可被本片段节点 via 引用；不生成假组、不允许 route 或完整 Program 使用它们。

`ProxyNodeCompilation` 的固定字段为：

- ok: boolean。
- artifactKind: "proxy-nodes"。
- diagnostics: readonly Diagnostic[]。
- bindings: readonly `{ id: string; nativeName: string }`[]，仅输入节点。
- requirements: readonly `{ id: string; nativeName: string; kind: "proxy" | "group"; usedBy: readonly string[] }`[]，仅实际使用的 external。

requirements 按声明顺序，usedBy 按节点顺序。失败时 bindings、requirements 均为空，无部分产物。成功 compilation 的元数据深冻结。计划从经校验的独立输入副本构造并深冻结，仅在 WeakMap 内保存，不向调用者暴露可修改 plan。修改原始 nodes、names、externals 或嵌套字段不能改变后续渲染；身份标记本身不替代不可变数据。

任何外部依赖成功编译都带 EXTERNAL_REFERENCE_UNVERIFIED warning，说明完整组装仍须验证。

`ProxyNodeArtifact` 的固定字段为 artifactKind: "proxy-nodes"、content: string、entries: readonly `{ id: string; content: string }`[]。

entries 每个节点一项，按输入顺序，每项 content 是一行加换行。顶层 content 为 entries 内容顺序拼接，无 [Proxy] 头，空节点输出空串。消费方用 entry.id 按原 provider 归属分文件，不解析原生行。

SDK 不写文件、不切换目录；消费方在同一 staging 中完成节点和策略渲染后再切换。不得将 artifact/content 存入无秘密 manifest。

## 名称、引用和完整性

逻辑 ID 沿用既有 idSchema；最终原生名允许中文、emoji、内部空格，禁止空串、首尾空白、控制字符和 Surge 分隔符，沿用策略片段的256字符上限和保留字规则。节点与外部符号在逻辑 ID 和最终名两个命名空间分别查重；未知 names 键、重复映射和与 DIRECT、REJECT、REJECT-DROP、REJECT-NO-DROP、REJECT-TINYGIF 或 pl- 前缀冲突均错误。所有 via 必须精确匹配本批节点或显式 external 的 ID；输出通过统一 ID→原生名表编码，禁止直接输出逻辑 ID 或 label。内部 via 自环/多节点环失败；整个声明树先严格校验，再做目标支持检查，再渲染。

external 不声明虚构的依赖图或 UDP 保证。SDK 只验证内部引用图到外部边界，不能证明完整图无环、组存在、组成员有效或实际拨号能力。消费方必须逐设备、按实际 include 闭包检查符号种类、名称唯一性及节点/组联合环，不能用全目录符号存在替代设备实际包含。未知动态外部组形态必须拒绝。

原生 checker 是附加证据，不能代替结构校验。片段的 requirements 明确传递这个责任。完整 Program 继续拒绝未知 via，不因为新 API 放宽。

`server` 在新节点片段支持 IP 或既有域名 schema，域名不由构建机解析、不替换为固定 IP。完整配置入口仍保持 IP-only，域名节点在那里返回专门的 PROXY_HOSTNAME_MODE_UNSUPPORTED；直到引导 DNS 与跨目标解析所有权另行设计。字段结构校验共享 host schema，入口语义校验区分模式，避免普通配置意外得到未经设计的 DNS 行为。Surge 自己解析域名；有 underlying-proxy 时遵守原生远端解析行为。

## 编码与兼容

共用节点 codec 接收显式名称解析函数，完整配置默认仍是 ID。Trojan/AnyTLS 选项输出 sni、skip-cert-verify、tfo、udp-relay、underlying-proxy；只有作者明确声明新选项才附加对应参数，不添加 block-quic。现有 SS 的 block-quic=off 默认保持，新 escape 参数可覆盖为 auto。错误不回显输入节点、凭据、秘密解析异常或原生配置文本。metadata、诊断、bindings、requirements 均不包含秘密解析结果。

本次不改变 provider 继承：HTTP username/password 为 node ?? provider；其它协议 password 仅 provider；via 为非空 node 值优先 provider。它们只属于 it-infra adapter。多 provider 必须作为一个逻辑批次校验名称与引用，一次 render 产生 entries 后按 ID 分配到 provider 文件。各设备最终需要的节点集合仍由消费方 include 解析确定，SDK 不读取 provider 文件或设备目录。

## 验收与证据

单元与真实入口测试覆盖 builder 分叉不污染、非纯数据及未 build 的 builder 拒绝、稳定顺序、中文名称、重复/保留名、外部声明、未声明引用、内部环、完整图责任、域名仅片段、秘密一次解析/固定错误、全部协议新选项拒绝边界。

AnyTLS UDP 仅 Surge 修正，未知字段和 SS obfs/cipher 明确失败。完整 render 与片段 codec 字段一致；失败不调用秘密解析函数。

消费方四配置 baseline 比较优先逐字节；仅字段顺序不同可使用逐节点协议/地址/端口/所有参数键值精确比较，不忽略新增、缺失参数。真实 Surge6.10.0离线检查不等于网络连接或iOS验收。消费方方案见 it-infra 的 docs/engineering/proxy-language/node-migration.md；发布后仅 npm 固定版本消费。

依据：[Surge AnyTLS](https://manual.nssurge.com/policies/anytls.html)、[UDP](https://manual.nssurge.com/policies/udp.html)、[共同参数和拨号链](https://manual.nssurge.com/policies/parameters.html)、[TLS](https://manual.nssurge.com/policies/tls.html)。官方当前说明仅是字段和语义依据，不将 checker 接纳未知参数视为有效证据。

外部符号和完整图验证所有权、域名解析边界及片段 compile/render 契约，已经消费方互审及独立原生 Codex GPT-6.1 Sol Review。独立结论 CONDITIONAL 的四项修订已纳入：SS 禁用 UDP 的能力传播、逐设备闭包和动态组拒绝、Surge 内建保留名、私有不可变计划与深冻结元数据。该审查是静态设计依据，未运行测试或原生检查。
