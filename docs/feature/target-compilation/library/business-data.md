# 代理业务信息边界

## SDK 输入

ProxyNode 只承载连接参数、id、label 与目标原生选项。region、provider、tags 不属于输入 schema，构造器类型不再接受这些字段，所有正式编译入口对包含这些字段的原始输入报告既有 schema/definition 错误。解析或快照前按 Reflect.ownKeys 与自有 descriptor 拒绝 symbol、accessor、不可枚举属性（仅数组内建 length 例外），不得由 schema 静默丢弃。SDK 不提供任意 metadata 容器，也不通过删除未知字段容忍旧输入。

selectNodes 与 selectProxies 不再导出或保留实现。调用方通过普通数组 filter/map 选择对象或 ID。SDK 接收选定的有序成员，仍验证成员引用、空组、依赖循环和协议能力。此变更作为 0.8.0 破坏性版本发布，无兼容别名。

proxyId(namespace, label) 保留散列算法与输出，首个参数只表示调用方命名空间，不存储或校验供应商元数据。label 参与目标显示名，继续保留；目标协议中 tls-provider 和 Mihomo rule-providers 等原生字段不受影响。

## it-infra 消费

proxy/provider/types.ts 只定义本地 ProxyEntry = { readonly region: string; readonly proxy: ProxyNode }，不建注册表、继承体系或 SDK 扩展 API。各供应商数组保留原序，工厂返回 region 和原协议构造结果的记录；协议对象没有业务字段。供应商归属由 westData、v2tun、lycheeip 数组自身表达，不重复存储 provider 字符串。地区代码属于消费方约定，SDK 不要求两位字母或任何地区分类。

设备维护 allEntries/laptopEntries，并在各自列表构造时映射出 proxies。createGroups 接收 entries，局部按 regions 筛选后 map(entry => entry.proxy)，保持来源顺序；供应商专用组以 lycheeip 的原 proxy 对象集合过滤当前设备 entries，避免引入设备之外的节点。uniqueProxy 按 id 过滤原 proxy 列表并保留唯一性断言。createSshGroup 仍接收纯 proxies。

不得在筛选时复制代理对象：Profile 的成员对象身份校验继续使用同一原始实例，跨设备列表可共享相同代理对象。wireguard/tailscale 直接进入 Profile，不需要地区包装。业务记录绝不传入 SDK、生成产物或 CLI diagnostics。

## 文档与验证

同步 select-resources、provider-nodes、surge-profile、portable-authoring、公开 README、示例和隔离安装包测试；当前行为 owner 不再宣称 SDK 支持元数据筛选。旧测试中的选择语义移到普通数组示例，SDK 保留空组、能力/引用拒绝和 Profile 对象身份断言；新增 ProxyNode 类型与四种正式编译入口拒绝业务字段的回归。删除仅验证被删除选择器自身图预算的测试；同批图预算在仍存在的定义/编译入口继续验证。

发布前记录当前 0.7.0 四份完整配置哈希与代理 ID，使用同一秘密快照通过临时 tgz 消费构建比较字节/ID，检查组成员原序和两个 Mac 原生语法。SDK verify、native checks、Concord check/trace、隔离包通过后发布 0.8.0，再将消费方固定到公开包并 frozen install/check/build；两库精确提交推送，等待 CI/Proxy 发布。无设备重载、无秘密输出。

## 需要审查的决定

破坏性移除 SDK 业务字段/选择器，将筛选所有权交回消费方。重点挑战对象身份、组成员顺序、供应商集合的设备边界、遗漏的输入路径、旧示例/契约迁移。sources API 可读性是另一问题，本方案不改它。

独立静态审查 CONDITIONAL 的 P2 收敛为上述描述符边界，回归直接将未经构造器、spread 或 snapshot 的原对象传入各编译 API，三种业务字段覆盖可枚举及不可枚举形态；Profile 覆盖 Surge 与 sing-box 两分支。预算测试迁至仍存在的定义入口，保留展开预算和空组断言。
