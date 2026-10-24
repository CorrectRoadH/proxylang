# 嗅探域名参与匹配

## 命名与行为

规则选项 includeSniffed?: boolean 表达追加匹配：false 或未提供沿用引擎原有域名规则行为。

true 在原路由域名之外，额外尝试 TLS SNI 和 HTTP Host（含 :authority），任一来源命中即可。

此处 sniffed 专指这两类域名，不包含 QUIC 或其它协议发现。

静态 Request.domain / tlsSni / httpHost 对应三类已有输入。

缺失的值不命中，大小写处理沿用域名匹配规则。

不改写目的地址，不生成全局嗅探配置，不保证获得被加密或缺失的域名。

sniff 表示连接识别动作，prefer-sniffed 表示优先使用识别域名，override-destination 表示改变实际连接目的地。

这三者不等价于 includeSniffed。

SDK 不为这些概念新增占位接口，也不把它们作为 includeSniffed 的隐式后端实现。

## 输入契约

match.domain/domainSuffix(value, { includeSniffed: true })、surge.match 的域名条件、surge.ruleSet，以及直接 Program/Profile/SurgeProfile 输入统一使用 includeSniffed。

DomainSource 与 sources 删除，不保留兼容别名。

extendedMatching 也仍被拒绝。

仅 domain/domainSuffix/native Surge ruleSet 或 SurgeCondition.ruleSet 可携带选项。

命名 ruleSet 的包装本身不带选项，内部叶子可带。

all/any/not 的自身选项以及 IP/进程条件上的 includeSniffed 即使 false 也拒绝。

选项必须是布尔值。

构造器先检查输入图和 own descriptors 再验证类型，命名 ruleSet 构造器也必须先 inspectDefinition，再 exactDefinition 校验 id/when，最后才展开/快照。

不执行 getter，不在 schema.parse 前丢失未知/non-enumerable/symbol 属性。

带 to 的 ruleSet 保留目标引用身份。

类型与运行时入口执行相同字段边界。

noResolve 的 undefined/false 区别不变。

## 后端能力

Surge true 生成 extended-matching，false/未提供不生成尾缀。

顶层尾缀在动作后，逻辑子条件尾缀在括号内。

直接 compileSurgeProfile 与 Program/Profile 在所有递归叶子执行一致校验。

sing-box/Mihomo/Stash 的 true 返回 MATCH_OPTION_UNSUPPORTED，包括逻辑嵌套、命名规则集和 Profile 转换入口。

false/未提供保留旧输出。

普通域名规则在外部开启嗅探时仍可能使用已识别域名，false 不承诺关闭外部嗅探。

sing-box 1.12 优先 metadata.Domain 再 Destination.Fqdn，Mihomo 优先 SniffHost 再 Host，因此不能通过开启 sniff 冒充多来源 OR。

## 资源身份

Program 与持有命名/原生规则集 ID 的 Profile 输入在降低/消除 ID 前执行已有 validateRuleSets 身份和 URL 校验。

Profile 先验证并收集递归条件中的命名/原生集合，再调用同一检查，不引入第二套注册表。

直接 SurgeProfile 没有规则集 ID，继续采用 URL/格式/有效间隔约束。

同 URL 不同 includeSniffed 允许存在，冲突只针对同 ID。

自动 ruleSet ID 与相同显式 ID 的冲突比较将 includeSniffed:false 和未提供视为等价。

true 与它们不同。

作者快照保留显式 false。

递归命名规则集叶子同规则。

仅身份计算省略 false，不规范化其它选项。

不含新选项的资源维持旧 ID 算法，noResolve:false 仍与未提供不同。

删除数组子集/排列排序逻辑，不增业务 selector 或匹配选项工厂。

## 迁移与验收

本变更破坏旧公共 sources 输入，按 0.9.0 迁移现有消费者。

三来源全集迁为 true，destination-only 迁为 false，未提供保持未提供。

部分来源子集原本不能编译到任何目标，不模拟兼容。

代理 ID、规则与组顺序及四份 Surge 输出必须不变。

测试覆盖 a.example 原目标与 b.example SNI、c.example Host：true 能分别命中，false/未提供只匹配 a。

缺失来源、递归组合、命名/原生规则集、顶层/子条件尾缀。

所有 Program 目标、Profile 两引擎、直接 SurgeProfile 的 true/false/未提供/非法布尔/旧字段/错误字段位置均须覆盖。

类型验收拒绝旧 sources 和 DomainSource，并覆盖 SurgeCondition、surge.match 与 ProfileCondition 在 IP/进程/逻辑节点上的 includeSniffed:false 负例。

SurgeCondition 按域名、IP、普通原子、逻辑、规则集拆判别联合。

surge.match 使用每类允许的选项签名。

ProfileCondition 逻辑节点不声明 includeSniffed。

Schema 同步位置拒绝，不仅编译后检查。

保持图预算、getter 拒绝、to 对象身份和快照隔离测试。

不以删除数组测试删掉其它保护。

规则集测试覆盖 false/未提供自动 ID 相等、显式同 ID 不同出口复用、命名叶子复用、true 与 false 冲突、noResolve false/未提供仍有区别。

同步 match-options、surge-profile 用例、README 和消费方文档，保留官方机制对比。

基线固定 SDK 77c094f / npm 0.8.0 与消费 6c71aca8。

改前记录四份完整原始字节 hash 和代理 ID，使用相同秘密快照比较，不打印秘密。

SDK check、native 和隔离打包验证，消费方先临时 tgz 类型/构建/字节验收。

独立设计审查及本地检查不构成 npm 发布或生产授权，发布仍遵守本会话授权范围。

## 官方依据

- [Surge 域名规则](https://manual.nssurge.com/rules/domain.html)
- [sing-box 1.12 域名匹配](https://github.com/SagerNet/sing-box/blob/v1.12.0/route/rule/rule_item_domain.go)
- [Mihomo 1.19.32 路由域名选择](https://github.com/MetaCubeX/mihomo/blob/v1.19.32/constant/metadata.go#L261)

## 设计审查

独立原生 Codex / GPT-6.1 Sol 静态审查 CONDITIONAL：命名构造器检查顺序、Profile 降低前身份检查及类型/schema 负向矩阵已纳入上述契约。

未运行验收。

重大影响是移除已发布 sources 公共输入及其部分来源解释能力，不能仅以重命名测试替代兼容和语义边界审查。
