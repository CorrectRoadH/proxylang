# 域名来源选择

## 公共数据

0.7.0 用 sources 替代所有规则条件与原生 Surge 规则集的 extendedMatching，不保留旧字段别名。DomainSource 为 destination | tlsSni | httpHost。DomainOptions.sources 为 readonly DomainSource[]，只能含 1 至 3 个不同值。默认未提供等价于 [destination]，数组顺序不影响逻辑或语义，但快照保留原序。

match.domain/domainSuffix、surge.match 的域名条件、surge.ruleSet 及直接 Program/Profile/SurgeProfile 输入统一接受 sources。仅 domain/domainSuffix/ruleSet 可携带该字段。命名 ruleSet 只包装内部条件；逻辑 all/any/not 本身不能携带 sources，叶子仍可使用。旧 extendedMatching 及非法字段通过严格 schema 拒绝。

## 解释和能力

destination 使用 Request.domain，tlsSni 使用 Request.tlsSni，httpHost 使用 Request.httpHost。静态解释只比较显式选择的来源，缺失来源不命中，多个来源做逻辑或。不做网络嗅探、DNS 查询或目的地址改写。匹配大小写与现有规范化语义保持，不新增域名规范化。

Surge 仅接纳未提供、[destination] 或全部三个来源的集合。三者生成 extended-matching，单来源 destination 不生成尾缀。仅 SNI、仅 Host、两来源组合均返回 MATCH_OPTION_UNSUPPORTED，不偷偷扩大匹配范围。Program 和 Profile，以及直接 compileSurgeProfile，递归执行相同能力检查，包括命名和外部规则集。

sing-box/Mihomo/Stash 仅接受未提供或 [destination]，沿用既有目标域名匹配行为。其它组合返回 MATCH_OPTION_UNSUPPORTED。这里的 destination 是现有规则上下文中的目标域名，不保证引擎外部配置从未更新它。SDK 不自动生成全局 sniff，不开启目标覆盖，也不声称嗅探与按规则多来源匹配等价。

这次改变公共条件契约但不扩大后端能力。后续开放能力必须用不同目标域名、SNI、Host 的冲突案例证明，同时证明不影响其它规则或实际连接地址。依据为 Surge 域名规则的逐规则追加来源、sing-box sniff 动作和 Mihomo sniffer 的独立 override-destination 设置。

## 迁移与验收

消费方 true 迁移为三个来源，false 迁移为 [destination]，未提供选项保持不变。Surge 渲染结果应逐字节不变；自动规则集 ID 随资源字段变化可能改变，但代理 ID 不变，Surge 输出不引用该资源 ID。

验证静态解释来源缺失与冲突、所有非空子集、重复及未知来源、空数组、getter 与数组快照。验证所有目标的单条、逻辑、命名规则集及原生 Surge 规则集能力检查，直接输入与函数同契约；添加正负类型检查并确认旧字段拒绝。保留 noResolve 原有未指定/false 区别。四设备完整字节及代理 ID 对照；SDK verify、隔离 tgz、原生配置与消费 CI 验收。

## 身份比较与审查

仅在规则集自动 ID 和冲突比较中规范化 sources：按 destination、tlsSni、httpHost 固定顺序；[destination] 与未提供都不写身份字段。递归覆盖命名规则集内部叶子。构造结果和用户快照不重排。noResolve 未提供与 false 仍不等价，不改其身份策略。未使用 sources 的资源沿用原 ID 散列格式。

验收补充所有来源排列的自动 ID 相等；同显式 ID/URL、不同出口引用可共存；命名规则集等价叶子可复用；不同来源集合仍冲突。独立 GPT-6.1 Sol 静态 CONDITIONAL 的 P2 已按此闭合，旧 match-options 与 surge-profile 用例同步新契约。审查不代表实现验收。
