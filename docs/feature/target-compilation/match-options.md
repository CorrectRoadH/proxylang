# 通用条件选项与外部规则路由

## 声明与兼容

域名和 CIDR 属于通用条件，不能因选项而要求作者换成 Surge 构造器。版本 0.5.0 增加可选参数，保留已有声明与无选项输出。

`match.domain/domainSuffix(value, { extendedMatching?: boolean })` 的 true 表示对请求域名、已观测 TLS SNI、已观测 HTTP Host 做逻辑或；不替换连接目的地址，也不改变其它规则的候选域名。false 和未指定保持旧语义。`Request` 新增可选 `tlsSni`、`httpHost`，静态解释按上述来源匹配；缺失来源不命中，不代表运行时可以解密不可见信息。

Surge 可原生输出 `extended-matching`。sing-box、Mihomo、Stash 的嗅探能力不自动证明支持同一条规则同时比较多个来源；在本版本中 true 明确返回 `MATCH_OPTION_UNSUPPORTED`。禁止把此选项降低为全局 sniff 或覆盖目的域名。后续后端只有通过来源冲突案例才能开放。

`match.ipCidr(value, { noResolve?: boolean })` 同时支持 IPv4/IPv6。true 表示此条件不为判断成员关系主动发起 DNS；false 允许目标原生解析。Surge/Mihomo/Stash 映射各自 `no-resolve`，sing-box 对显式该选项返回 `MATCH_OPTION_UNSUPPORTED`，不将配置拼写当作运行语义证明。无选项保持 Program 及 Profile 各自既有默认值；静态解释始终只使用 Request.ip，不执行解析。

选项是 Match 的已知字段，schema 仅允许域名携带 extendedMatching、CIDR 携带 noResolve。递归逻辑、命名规则集展开、Program 和 Profile 均执行能力拒绝，不读秘密。通用构造器不接受 getter/未知选项并保留输入快照。

## 混合组合

通用 atom 返回精确类型，不返回整个 Match 联合。Profile 的逻辑组合允许通用条件和平台条件共同出现；`match.all/any/not` 用保留输入条件的泛型结果表达，不把任意 Surge 条件扩入 Program 的通用 Match。遇到 MAC 等平台叶子仍只由目标对应编译器接受。

## 外部规则直接路由

外部规则由各引擎构造器声明，直接带出口，不新增手写路由对象联合：

```ts
surge.ruleSet({ url: "https://example.com/direct.list", format: "rule-set", to: outbound.direct })
mihomo.ruleSet({ url: "https://example.com/direct.yaml", format: "yaml", behavior: "domain", intervalSeconds: 86400, to: "proxy" })
singbox.ruleSet({ url: "https://example.com/direct.srs", format: "binary", intervalSeconds: 86400, to: "proxy" })
```

各函数重载：提供 to 返回现有 RouteDefinition；不提供 to 返回精确引擎 NativeRuleSet 条件。id 可省略，按全部资源字段（不含 id/to/type）稳定排序序列化并取 SHA256 前16位，前缀 ruleset-；显式 id 维持旧语义。Surge format 默认 rule-set；其他格式必须明确，Mihomo 还必须 behavior，sing-box/Mihomo 必须更新间隔。原有 mihomo.ruleProvider 保留为同一构造器的兼容名字，不维护第二套实现。

构造器 inspect 原输入拒绝 getter/cycle/预算超限、exact/schema 拒绝未知字段及 engine 错配，检查后才散列。NativeRuleSet 为数据快照；to 对象保留身份供 Profile 资源解析，不递归克隆出口。defineProfile 后仍统一冻结快照。Profile.routes 继续只接受 RouteDefinition，未提供 to 的资源不能误当路由；不扩散新 authoring 形态，不修改 normalize 类型。规则集可继续作为条件放应用 Matches 数组，消费方用同一 engine.ruleSet 函数，移除 surge.match.ruleSet 的外部 URL 用法；内置 LAN/SYSTEM 继续显式 Surge 条件。

Surge Profile 顶层保留 update interval 和匹配选项，命名 ruleSet 透明；all/any/not 内显式 interval 拒绝（即使只有一个子条件也视为嵌套）。同一规范化 URL 的 format 或有效 interval（默认 86400）冲突必须拒绝。Program NativeRuleSet 的 Surge 分支也接受同样选项。资源下载、静态不可判定、冲突校验沿用现有机制；不在 SDK 下载或转换第三方规则。相同资源、不同出口保持各行原顺序，不能合并或排序。

## 验收

固定消费方 ad8c9aa2、SDK 0.4.0 基线。迁移所有普通 IP、带扩展匹配的域名以及可移出的 MAC 组合通用 atom；remote.ts 的独立外部路由改 engine.ruleSet({...to})。保留真正的内置 LAN/SYSTEM、MAC 与 Surge 格式外部条件。

测试覆盖 SNI/Host 与请求域名相同和冲突、来源缺失、反向和嵌套规则、选项目标拒绝、IP 双栈与选项位置、外部资源快照/getter/预算/重复引用及格式拒绝。原生 Surge/Mihomo 语法检查，SDK verify/包隔离安装、Concord check/trace，消费方临时 tgz 与公开包构建均须通过。四设备输出 SHA256 与代理 ID 必须不变。公开发布与 push 沿用本会话授权，不重载设备。

## 设计审查

2026-10-24 独立原生 Codex GPT-6.1 Sol 静态审查 CONDITIONAL：唯一 P2 为新增 Surge Profile 更新间隔的嵌套与 URL 冲突语义未闭合，已按上文补齐；需以对应实现与回归验收，不将设计审查当运行证明。当前 Profile 目标仍仅 Surge/sing-box；Mihomo 构造器的条件形式用于既有 Program，不在本轮扩展 Profile 目标。
