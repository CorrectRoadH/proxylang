---
format: concord.document/v1
id: composable-rule-sets
title: 可组合规则集与客户端外部资源
createdAt: 2026-10-22T06:03:31.422Z
kind: engineering
---

# 可组合规则与平台原生能力入口

## 统一组合，不抹平平台机制

proxylang 统一条件组合、规则顺序、出口引用与配置构建。平台独有能力通过有类型的原生入口进入同一程序。Surge 外部规则只是一个例子，不建立一个强制为每个平台提供等价文件的通用远程资源。

外部规则保留原生引用，由客户端下载、更新及缓存。编译器不下载、转换内容或运行更新服务。多个平台的原生声明可以被同一 TS 函数作为参数使用；作者决定是否代表同一种业务规则，编译器不证明远程内容一致。

## 组合语法与命名

`ruleSet({ id, when })` 返回 type=ruleSet 的命名条件集合，when:Match。`match.ruleSet(set)` 返回同一条件引用。when 支持 any/all/not 及其它命名集合。规则集不包含动作或 FINAL；有动作且有顺序的复用单元仍是 policy/use。模块组织使用 TS import，不新增文本 include。

原生条件与共享 Match 使用同一组合入口：

```ts
const media = ruleSet({
  id: "media",
  when: match.any(
    surge.ruleSet({ id: "streaming", url: "https://example.com/media.list" }),
    match.domainSuffix("example.org"),
  ),
});
rule("media", media, slot("proxy"));
```

按平台复用时写 TS 函数 `mediaRules(external: Match)`，调用者传入各自原生条件。Surge 条件误用于 sing-box 时报 NATIVE_TARGET_MISMATCH。

本地结构为 `{type:"ruleSet",id,when:Match}`。原生远程条件使用固定 type= nativeRuleSet、engine、id、url 及平台字段，组成严格判别联合。

- `surge.ruleSet`：format 为 rule-set 或 domain-set，默认 rule-set。
- `singbox.ruleSet`：format 为 source 或 binary。
- `mihomo.ruleProvider`：behavior 为 domain/ipcidr/classical，format 为 yaml/text。
- Stash 原生入口需要独立固定版本验证，不自动继承 Mihomo 支持。


Mihomo/sing-box 的 intervalSeconds 必填，整数60..2147483647。Surge 可省略，表示使用客户端默认更新间隔。URL 为 HTTP(S)，无用户名密码和fragment，禁止空白、控制字符、逗号、引号、反斜杠及圆括号，最大2048字符，防止原生语法注入；使用者不得将秘密放进 URL。暂不暴露任意 header、下载代理及缓存路径。生成缓存名称只使用已校验ID。

## 还需要哪些原生入口

|接入位置|典型机制|参与通用组合的边界|
|---|---|---|
|Match|外部规则、Surge extended-matching、MAC/process、客户端网络环境|作为条件叶子；all/any/not 能力需独立验证；未知运行时数据不可猜测|
|Action|sing-box `sniff`/`resolve`/`hijack-dns`、Surge 特定 reject 行为|区分继续处理与终结路由；不能强装成普通 route，也不能重排|
|Node|Tailscale、WireGuard、特有协议与协议选项|统一节点 ID 和 route 引用；按能力检查 UDP、组成员、via、测速|
|Group algorithm|Surge Smart、客户端 fallback/load-balance|保留原生算法，由已有 strategy 显式选择实现，不默认互换|
|Resource|代理订阅、规则 provider、证书或脚本资源|定义与引用分离；明确运行时加载和状态归属；禁止编译时执行远程脚本|
|Program|DNS 分流、fake-IP、TUN、嗅探、路由预处理|作用于整个程序，不能伪装为可任意移动的规则块|
|Integration|Surge module、rewrite、MITM、客户端脚本|平台专属且明确顺序、权限及持久状态；不作为通用规则文本拼接|

以上是接入位置，不是宣称全部已实现。此次落地命名条件组合与 Surge/sing-box/Mihomo 原生外部规则入口，其余遵循相同结构逐项增加。Tailscale 应回归作者层 nodes；sing-box 输出 endpoints 是后端细节。其身份/DNS生命周期与平台字段迁移需单独完成契约，不能在本次规则集改动里顺便改名了事。

## 编译职责与冲突

第一层为通用组合，第二层为有类型的平台机制，最后才是范围受限的不透明原生数据。此次不提供无边界 raw(text) 或任意配置覆盖。以后确需透传时，必须标注引擎、位置和无法验证范围；生成器拥有的 rules/outbounds/资源ID不得被末尾 merge 覆盖。

完整输入树先通过严格 schema、循环/深度/数据预算校验。rulesets 模块负责命名集合一致性和展开，按原生 engine 校验使用位置，收集远程声明。相同程序的规则集ID独立于节点ID，但本地/远程共用；同 ID 不同定义为 RULESET_ID_CONFLICT。结构等价重复引用去重，比较规范字段而非对象属性顺序。一个原生 URL 在 Surge 中不得使用不同 format 或不同更新间隔。

TargetPlan 增加 nativeRuleSets，包含当前程序用到的原生定义；源规则保留 nativeRuleSet 叶子。本地集合展开为既有逻辑条件，保持条件嵌套和规则顺序；sourceMap.origin 追加 rule-set:<id>，记录涉及的定义而非伪称单一来源。远程URL不会写入错误消息。逻辑深度按展开后计算。

Surge 顶层明确编码 `RULE-SET,url,policy,update-interval=N` 或 `DOMAIN-SET,url,policy,update-interval=N`。未提供 interval 时省略参数，沿用客户端默认值。依据为官方两个规则类型的参数说明，checker 仅验证语法。

逻辑内分别编码 `(RULE-SET,url)` 和 `(DOMAIN-SET,url)`，使用客户端默认更新间隔。逻辑嵌套且显式设置 interval 时，首版报 RULESET_COMPOSITION_UNSUPPORTED。原生 checker 的 OK 不能证明未知位置的参数有效，因此不采用未经证实的 inline 包装技巧。其它目标不继承此限制。

Mihomo 输出 rule-providers，以及 RULE-SET,id 条件；生成路径 rule-providers/pl-<id>.yaml或.txt，下载proxy固定DIRECT。sing-box 输出 route.rule_set 的 remote/tag/url/format/update_interval/download_detour=pl-direct，以及 rule_set 条件。不自动启用持久缓存或新增状态目录；fragment 运行方提供客户端工作目录和下载DNS路径。资源生命周期与下载失败处理均由客户端负责，不承诺超出原生行为的失败回退。

## 静态解释与诊断

远程条件没有本地可知内容，ConditionTrace.matched 扩为 boolean|null。all 中 false 优先，any 中 true 优先，not unknown 仍 unknown。explain 遇到可能影响首命中的 unknown，抛固定 STATIC_RULESET_UNKNOWN；不能猜测后续规则或fallback。cases 转为 CASE_INDETERMINATE 并使编译失败。普通规则提前命中、false守卫或true并集仍可确定。

truthPossibilities 对远程条件始终保守返回 false/true，远程内容不能证明TCP-only安全。原生条件可能触发DNS解析、extended matching，manifest 要分别声明本地条件的语义及原生内容由客户端解释的边界。EXTERNAL_RULESET_UNVERIFIED warning 按目标每个资源一次，可由warningsAsErrors升级。缺目标支持、组合不可表达、字段未知为error。

资源声明与引用均保留在输出，不承诺远程文件有效或匹配行为跨平台相同。客户端更新不会重新调用proxylang，也不会执行本地policy cases。

## 验收

测试覆盖多层集合、混合原生与共享条件、any/all/not、不同policy出口绑定、重复引用去重、同ID冲突、跨引擎误用、URL注入、字段严格校验、unknown真值传播及case失败、UDP保守检查。真实build失败保留active，compile/render/build不请求远程URL。

原生检查只使用隔离本机fixture或不下载资源的checker；不访问生产规则源。不把语法检查声称为持续更新实测。README及示例必须展示按参数组合不同原生条件，避免多平台配置表成为唯一用法。Concord绑定use-case、源码及测试。此任务不修改it-infra、部署流程或Worker工具链。

依据：[Surge规则集](https://manual.nssurge.com/rules/ruleset.html)、[Surge逻辑组合](https://manual.nssurge.com/book/understanding-surge/cn/)、[sing-box规则集](https://sing-box.sagernet.org/configuration/rule-set/)、[Mihomo原生provider](https://wiki.metacubex.one/config/rule-providers/)。固定版本是否支持由代码证据及原生检查验证。


## 审查收敛后的执行契约

独立原生 Codex GPT-6.1 Sol 审查为 CONDITIONAL。必要修订如下，实施遵循这些约束。

先对完整输入执行 assertData 和严格 schema，再遍历每个 program 原始 Entry/Match 树，包括 policy、block 守卫，登记定义并检查 ID 冲突和引擎归属。不会因布尔真假跳过非法声明。随后 expandRules 展开 policy 和集合，再按 target 收集实际输出的远程引用。

展开结果最多10000条规则、100000个条件节点及100000个origin项，深度上限64。预算按实际出现次数累计，超限返回 EXPANSION_LIMIT，停止该程序展开；不返回部分计划。每个program独立ID空间，属性顺序不影响定义比较。

案例结果改为判别联合：确定时保留 `{id,passed,actual:{rule,action}}`；不确定时为 `{id,passed:false,code:"CASE_INDETERMINATE"}`，不包含actual。compiler只捕获具名StaticRuleSetUnknownError，追加诊断后继续其余案例。CLI explain将该异常映射为同名固定错误码，退出1。

保留所有原生条件的位置和顺序，不做布尔消除或重排。三值推导只描述给定元数据下的静态判断，不证明运行时没有DNS、下载失败或其它副作用，也不验证原生条件改变后续元数据的效果。
