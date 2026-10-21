---
format: concord.document/v1
id: strategy-implementation
title: 通用机制与策略实现
createdAt: 2026-10-21T11:27:36.268Z
kind: engineering
---

# 通用机制、具名策略与平台算法

## 实施边界

把 it-infra 的 Smart/AI/DEV 选路作为真实消费者，先打通策略定义、精确目标选择、编译和消费方生成。规则、Tailscale 和数据集的完整语法按研究提案继续设计，不能把未实现功能宣称完成。不迁移生产发布入口或改写未知平台字段。

通用性按行为契约判断，不按当前后端数量判断。顺序规则、布尔条件、模板参数、直连/拒绝、节点引用、手动选择是通用。URL 测速的共同参数可以通用，但运行期调度与连接切换不承诺完全相同；平台额外字段不得自动填成另一种机制。Surge Smart 的真实连接评分与重试是专属算法。

## 确定的语法

新增 `strategy({ id, members, implementations })` 作为 Group 的一个变体，type 为 strategy。members 仍是稳定资源 ID 数组；implementations 是可选 surge 与 sing-box 字段组成的严格对象，至少一个分支。每分支是结构化 GroupAlgorithm，包含 type: select / urltest / surge-smart。

构造器 `group.select()` 返回 select 算法；`group.urltest({url, intervalSeconds?, toleranceMs?})` 返回通用 urltest 算法；`surge.smart()` 返回 surge-smart。`strategy` 返回可放入 Program.groups 的对象，规则仍使用 route(id)。禁止原生文本、未知键、回调或自动算法替代。

urltest 继续保持 URL 必填、禁止认证和 fragment、默认 intervalSeconds=180、toleranceMs=50；sing-box 编码 idle_timeout=30m、interrupt_exist_connections=false。Surge 的测速 URL 是成员或全局配置，组内 url 参数无效；因此通用 urltest 在 Surge 报 GROUP_UNSUPPORTED，不自动改变全局或节点 URL。Surge Smart 成员必须全是节点，不能含组。所有可选路径与 via 继续参与资源图和 TCP-only 校验。

既有 select/urltest Group 数据形式保持合法；既有 smart 数据形式继续报 GROUP_UNSUPPORTED，不偷偷改变旧契约。Surge Smart 只能由明确的新 surge-smart 算法生成。urltest 仍只在已具备正确编码的目标支持。通用语法不等于所有后端都有实现。

## 编译与证据

先校验整个声明树，包括未选分支结构，再按精确 target 的 engine 选择算法。没分支报 STRATEGY_IMPLEMENTATION_MISSING；surge-smart 放在 sing-box 分支报 ALGORITHM_ENGINE_MISMATCH。选择算法之后执行完整资源图与能力验证，不回退到其它分支。

TargetPlan.program 必须是该目标的独立、不可变程序快照，groups 只含具体算法，不保留未决 strategy。TargetPlan.strategySelections 记录策略 ID、选择引擎、算法及原始成员；check 和 manifest 均输出这项记录。策略选择是用户声明的差异，不发“语义等价”的保证，也不把它当可忽略 unsupported warning。

缺少实现、未知目标、循环引用、成员缺失、TCP-only 与不合法 Smart 成员都阻止整批发布。explain 的终结出口仍是逻辑策略 ID，不假装知道实时选中了哪个节点。

## it-infra 消费边界

新建 proxy/proxylang 包，固定 vendor npm tarball 与锁文件，不依赖相邻 checkout。真实 provider 的节点仅提取 name、region、provider 等无秘密目录，显式生成稳定 ID 到原生名称的映射；不把凭据写入新文件或日志。

在消费方定义 Smart、AI Smart、DEV Smart、各地区策略的声明，Surge 使用 surge-smart、sing-box 使用 urltest。仅将这些策略组替换为新生成来源；外层手动组、Home/Tailscale 与设备规则继续原机制，未由 proxylang 验证的部分必须标明。

消费方使用新增 `compileStrategyGroups({ target, nodes, strategies, names? })`：nodes 是真实节点目录的 id 与 nativeName（不含秘密），strategies 是 Strategy[]。target 严格包含 engine/platform/version，必须命中已有目录。该专用入口生成组配置与 strategySelections，不生成节点、规则、默认动作或完整配置。

它检查节点/组 ID 和 nativeName 唯一、每个成员必须是输入节点或策略、依赖循环、Smart 只含节点、非空成员与目标算法能力；只声明组结构正确，不声明协议网络能力或外部 via 正确。完整 compile 仍执行真实资源网络能力检查，不能使用专用入口绕过完整程序验证。

nativeName 必须非空、无首尾空白，为单行可打印 Unicode，禁止控制符、逗号、等号、方括号、括号、井号、分号，且不能为 DIRECT/REJECT 或 pl- 前缀；最终映射后的全部节点和策略名称（包含省略映射时的默认 ID）统一查重并做保留字检查。既有 emoji 和空格名称保留。映射只用于边界序列化，内部仍用稳定 ID。错误只回显固定原因和路径，不含输入值。

策略在专用入口允许额外 `nativeName` 映射，通过 `names` 字典提供 id 到名称，字典只能含已声明策略 ID。返回值固定为 ok/diagnostics/selections/content/artifactKind，artifactKind 恒为 strategy-groups；失败 content 为 null、selections 为空。Surge content 是组行文本；sing-box content 是只含组对象的 JSON 数组，含节点引用但没有节点定义，必须标记 artifactKind=strategy-groups，不可称为完整配置。两个入口复用同一算法选择和组序列化函数。

消费方实际节点来自被设备引入的 provider 目录，顺序保持；不读取凭据构造占位节点。只有生成的 Surge 组行进入已有配置，完整配置仍由旧构建器组装并执行 Apple 回归护栏；完整原生语法需另外运行离线 check。iOS 不借用 macOS target：消费方只接 M4，声明期望编译目标 macOS 6.10.0，不将该声明当成远端实际版本证据，MacBook 与 iPhone 组片段保持原构建，直到核实其精确版本。

## 验收

同一 strategy 在两个目标产出不同算法且来源相同；未知分支、未选分支非法、目标算法错配拒绝；Smart 嵌套组拒绝；网络与 via 限制不被绕过；两目标计划不会互相污染。

实际 it-infra 的 Surge 组有效行与旧脚本逐行比较；节点顺序保持。fixture 验证两算法编码、名称注入、未知引用和空成员错误。精确版本离线 native check 与语义测试分开记录，不启动服务。

## 为什么把边界放在这里

共同抽象的是“这条规则交给哪个出口”和“哪些节点可以参与选择”。Smart 的真实连接评分与 URLTest 的主动测试没有同一套算法参数，因此共享 strategy 的身份与成员，在 implementations 中保留算法差异。作者明确选择两种实现，编译器负责把选择兑现并留下证据。

这也决定了诊断等级：展示 label 不输出可以 warning，作者可以 warningsAsErrors；缺少算法实现、版本不支持或匹配行为无法保持必须 error。只警告后继续输出，会把不完整转换误当成有效配置。用户显式选择 URLTest 分支则属于声明的行为，不产生“自动降级”告警。

通用条件、顺序、规则模板与出口绑定在已有规则层组合。Tailscale 生命周期、远程规则集更新、extended-matching 的观测来源与 MAC 匹配入口仍有专属约束，其语法见未采用的研究提案，不能因为策略组可生成就视为全部可移植。

原生语义依据：[Surge Smart](https://manual.nssurge.com/policy-groups/smart.html)、[Surge URL Test](https://manual.nssurge.com/policy-groups/url-test.html)、[sing-box URLTest](https://sing-box.sagernet.org/configuration/outbound/urltest/)。
