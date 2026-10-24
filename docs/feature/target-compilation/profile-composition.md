# Profile 片段组合与代理出口

## 输入与可观察语义

Profile 作者只声明 target、proxies、groups、routes、fallback 及 surge/singBox 平台扩展。

proxies 统一列出 ProxyNode、SurgeTunnel、TailscaleEndpoint；Profile 顶层拒绝 nodes/endpoints 字段，动态旧字段报 DEFINITION_UNKNOWN_FIELD。

底层 SurgeProfileInput 和通用 DSL Program 的 nodes/tunnels/endpoints 保持原契约。

此变更以 0.3.0 发布，迁移全部仓内 Profile 消费方和 it-infra；不引入双格式兼容解析。

导出 ProfileProxy = ProxyNode | SurgeTunnel | TailscaleEndpoint，Fragments<T> = readonly (T | Fragments<T>)[]。

proxies、groups、routes、surge.hosts 接受嵌套片段数组，深度优先从左到右展开，空片段合法，不去重、不排序、不推断注册资源。

groups 仍是显式数组，非按对象枚举隐式注册。

重复资源 ID 继续拒绝；重复规则继续按原顺序保留。

surge 直接接受普通对象，无须 surge.config；既有构造器 可保留作为无额外语义的构造器。

surge.general 接受 SurgeGeneral 单对象或其片段数组，按顺序浅合并，同名键由后者整体替换，数组字段不拼接、嵌套对象不深合并。

输出键顺序与原 JS spread 一致。

每个 General 片段独立通过原严格 General schema；每次 defineProfile 调用内按对象身份缓存成功结果，不跨调用复用，仍按每次出现执行浅合并；对首次校验的片段累计其展开数据大小，超过 100,000 次访问拒绝，避免不同外层对象复用大字段造成校验放大。

避免错误值被后续覆盖掩盖。

host 片段逐项保留顺序，由原编译器校验。

ProfileDestination 增加 string，字符串永远是本 Profile 资源 ID，可引用 proxy 或 group，不能用显示名，也不解释 DIRECT 等为内置出口。

内置出口继续使用 outbound 常量。

字符串通过当前 Profile 的完整资源表解析；缺失报 UNKNOWN_DESTINATION_ID，重复 ID 先报 DUPLICATE_RESOURCE_ID。

完整对象引用仍要求同一实例，不接受同 ID 的伪造对象。

组成员、路由目的地和 fallback 遵循同一规则；已有 via 字段保持编译器已有 ID 语义。

规则片段可静态 defineRoutes({ when: [...], to: 'proxy' })，无需接收 groups，也不允许回调、闭包或隐式设备上下文。

平台不支持的代理类型、条件、组算法和持久状态约束继续明确拒绝。

## 实现边界

src/profile.ts 的 defineProfile 先对完整输入执行 inspectDefinition，拒绝访问器、非纯数据、循环、超深及对象/边数超限；所有字段读取和展开在此之后。

使用单次共享 occurrence 预算（100,000 次访问）执行所有片段展开，包含数组节点与重复共享子片段，检查在遍历/追加前，避免 DAG 放大。

保留 64 层深度、20,000 对象、100,000 边的已有检查。

规范化后以保别名 structuredClone + deepFreeze 冻结整个 Profile；输入为归一化 Profile 时仍可重复调用，不丢失资源实例关系。

Profile 返回类型是已扁平化的 proxies/groups/routes/hosts 和已合并 General，不让消费端再次处理片段。

compileProfile 根据代理 discriminant 将 proxies 稳定分区为普通协议节点与目标平台隧道/端点；Surge 只接受 wireguard/tailscale 隧道，sing-box 只接受 sing-box-tailscale 端点。

原 lowering/编译器继续负责目标能力、引用环、最终名称、状态目录和安全约束。

统一资源命名空间跨普通代理、隧道和组，不因分区放过重复。

编译不得读取秘密。

字符串解析在 Surge 与 sing-box lowering 的目的地处理执行；对象引用检查保持。

不由 normalize 递归构造目标对象，避免引入循环或复制导致身份丢失。

Build 批次仍在 preflight 前固定快照，所有 Profile 编译成功才读取秘密和发布；非法后续 Profile 不影响旧产物、不读取任何秘密。

## 消费方迁移

it-infra 的设备保留完整托管 URL：

- https://surge.778917.xyz/iphone-16-pro.conf
- https://surge.778917.xyz/iphone-17-pro.conf
- https://surge.778917.xyz/m1-pro-macbook.conf
- https://surge.778917.xyz/m4mac.conf

proxies 可写 [westData, lycheeip, wireguardM1ProMacbook]。

groups 可写 [commonOrder, ai, aiSmart, home]。

general 可写 [base, realIpTailnet, platformMacos, roleLanListener]。

hosts 可写 [hostsBase, hostsTailnetMagicdns]。

各 rule 文件导出静态规则数组，routes.ts 导出静态有序角色数组；设备直接引用，无规则工厂调用。

代理组按节点/隧道的参数化构造仍有实际用途，保留。

Surge 扩展对象层保留，删除调用方 surge.config 包装。

## 取舍与验收

不增加 createDevice 布尔开关工厂，不用任意深合并，不从规则收集资源，不改变目标平台支持范围，不合并不同协议的类型。

字符串引用牺牲部分 TS 静态拼写约束，换取可复用静态规则；真实编译必须验证引用存在。

测试须覆盖：有序嵌套/空片段、重复规则、General 整值覆盖及非法被覆盖项、跨资源重复 ID、缺失字符串与错误对象引用、Surge WG/Tailscale 与 sing-box Tailscale 分区、非法跨平台代理。

还需覆盖 getter 零调用、循环/深度/DAG 放大预算、冻结快照及别名不丢失、批次失败零秘密读取/旧产物不变。

类型检查覆盖递归只读片段及拒绝旧 Profile 字段。

执行 SDK 全量 verify 与 tarball 消费测试；it-infra 类型/lint、四份完整配置 SHA256 与迁移前相同、四份 Surge 原生离线检查通过。

记录真实结果，不将构建或发布等同设备生效。

## 独立审查收敛

原生 Codex / GPT-6.1 Sol 的 CONDITIONAL P2（General 共享 DAG 校验成本放大）以本次调用身份缓存及首次校验累计工作预算收敛；验收包含重复共享大叶对象、不同对象共享大列表、跨调用修改后重新校验。

未改变输出合并语义。
