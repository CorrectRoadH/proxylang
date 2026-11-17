# 项目术语

术语定义与解释在本页维护；局部术语在所属文档目录的 `concepts.md` 中维护。

## Profile {#profile}

一台设备的完整代理配置声明，由 `defineProfile` 创建。

一份 Profile 包含目标、出口资源、有序路由、默认出口、DNS 规则和目标引擎专属的设置。构建时，一份 Profile 生成一个原生配置文件，文件名取自它在构建定义里的键。

## 目标 {#target}

Profile 要生成的客户端，由引擎、平台和精确版本组成，例如 `{ engine: "surge", platform: "ios", version: "5.21.0" }`。

能力判断以目标为单位。同一引擎的两个版本是两个目标，不在版本之间推断支持情况。

## 引擎 {#engine}

执行配置的代理客户端或内核，取值为 `surge`、`sing-box`、`mihomo` 与 `stash`。

引擎决定输出格式和可用机制。专属于某个引擎的字段写在 Profile 中与引擎同名的字段（`surge`、`singBox`、`mihomo`、`stash`），或者写进带引擎分支的构造器。

## 出口 {#exit}

路由命中后流量去往的地方：Profile 中的节点、分组、隧道，或者内置的直连与拒绝。

路由、分组成员、`via` 与 `fallback` 直接引用资源对象。共享规则写成以出口为参数的函数，每份 Profile 传入自己的资源，这就是同一份规则在不同设备上走不同出口的机制。

## 节点 {#node}

一个代理服务器的连接声明，由 `proxy.trojan`、`proxy.vless` 等协议构造器创建。

节点包含协议字段、服务器地址、端口和秘密引用。它是出口的一种，可以直接作为路由目的地，也可以作为分组成员。

## 分组 {#group}

一组候选出口加上一种选择算法，由 `defineProxyGroup` 创建。

算法可以是手动选择 `group.select()`、固定参数测速 `group.urltest()`、由目标决定具体实现的 `group.auto()`，或者 Surge 专属的 `surge.smart()`。

## 隧道 {#tunnel}

由客户端自己维护连接状态的出口，例如 Surge 的 Tailscale 与 WireGuard，以及 sing-box 的 Tailscale endpoint。

隧道带有身份与状态，同一个身份不能被两台设备共用，所以通常每台设备单独声明。

## 路由 {#route}

一条“条件 → 出口”的规则，由 `defineRoutes` 创建。

Profile 的路由按顺序排列，第一条命中的路由决定出口，都不命中时使用 `fallback`。

## 条件 {#condition}

路由的匹配部分，由 `match.*`、`surge.match.*` 或规则集构造器创建，可以用 `all`、`any`、`not` 组合。

`match.*` 是各引擎都支持的条件，`surge.match.*` 只用于 Surge 目标。

## 规则集 {#rule-set}

由客户端在运行时下载并解释的一组外部规则，由 `ruleSet` 创建，并按引擎给出来源。

规则集的内容不在 proxylang 里，因此路由案例无法静态判断它是否命中，需要在请求里声明假设。

## 路由案例 {#route-case}

一条对路由意图的断言：给定请求，指定 Profile 首条命中的出口应当是什么。

路由案例写在 Profile 的 `cases` 中，`expect` 引用出口对象。`check` 与 `build` 执行全部案例，任何一条失败都阻止发布。

## 构建定义 {#build-definition}

`proxylang.config.ts` 默认导出的对象，由 `defineBuild` 创建。

它包含要生成的 Profile、输出目录和读取秘密的方式。

## 产物 {#artifact}

`build` 写到输出目录的原生配置文件集合，Surge 是 `.conf`，sing-box 是 `.json`，Mihomo 与 Stash 是 `.yaml`。

一次构建的全部产物作为一批切换：所有 Profile 都成功后，活动目录 `out` 才指向新的一批。

## 秘密引用 {#secret-ref}

`defineSecrets` 返回的集合上的一个属性，是代表密码、密钥等敏感字段的不带值的句柄。

`check` 与 `explain` 只检查引用本身；`build` 时才按集合中声明的来源读取值，并且只写入产物。
