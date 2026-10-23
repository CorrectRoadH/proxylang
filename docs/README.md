# proxylang 文档

proxylang 用 TypeScript 组合规则，再按精确目标编译配置。产品契约由 Concord 管理。

- [规则组合](feature/rule-composition/README.md)：复用模板、保留优先级、绑定不同出口。
- [策略解释](feature/policy-explanation/README.md)：解释首命中，用回归案例保护路由意图。
- [通用语义与平台实现边界](design/portable-capabilities/plans/semantic-adapters/README.md)：规则、资源、算法与平台扩展的归属及适配器契约。
- [通用机制与策略实现](engineering/strategy-implementation/README.md)：为什么共享出口与候选成员、显式选择平台算法，以及 it-infra 的消费边界。
- [Mihomo 与 Stash 转换边界](engineering/clash-backends/README.md)：共享规则、独立能力与拒绝有损转换。
- [代理节点与平台端点](engineering/proxy-resources/README.md)：协议字段、TLS/WS、精确目标和 Tailscale 身份生命周期。
- [节点片段与链式声明](engineering/proxy-node-fragments/README.md)：provider 编码、fluent builder 与外部原生引用契约。
- [目标编译](feature/target-compilation/README.md)：平台程序、版本能力与不支持项诊断。
- [本地产物发布](feature/artifact-publication/README.md)：秘密隔离、原子批次与失败恢复。
- [CLI 契约](feature/artifact-publication/cli.md)：命令清单、输入输出与错误边界。
- [SDK 参数细则](implementation-v0.md)：语法、默认值与转换约束。
- [平台机制语法提案](research/platform-syntax/README.md)：用 it-infra 需求设计条件槽位、平台出口、规则集和信息来源；尚未定案或实现。
- [架构](architecture.md)与[设计依据](research/platform-model/README.md)：模块职责与平台差异。
- [文档与验收工作流](engineering/development/README.md)：用户故事写法、代码关系和验证尺度。
- [宪法](constitution.md)与[Concord 操作指南](concord.md)：项目约束及工具入口。

用法与可运行示例见[项目 README](../README.md)。历史调查、审查及验收记录使用 `concord memory index` 和 `concord memory recall` 查询；历史检查不代表本次执行结果。

- [可组合规则与原生能力入口](engineering/composable-rule-sets/README.md)：客户端外部规则与组合边界。
