# 通用语义与平台实现边界

## Decision

Selected: [semantic-adapters](plans/semantic-adapters/README.md)

## Rationale

公共算法要求与平台适配器分离，满足共享意图且保持具体实现可追溯。auto 明确允许评分和切换差异，urltest 要求固定机制与参数；旧配置不被隐式迁移。

独立原生 Codex / GPT-6.1 Sol 审查结论为 CONDITIONAL：架构可采用，需补齐 C8 范围与公共类型。方案已将 C8 收敛为拒绝未知调优字段，明确精确构造器返回类型、StrategyDefinition 联合和归一化 requestedAlgorithm。主 agent 核对后接受这两项修正。

## Rejected Options

native-only 要求每个平台重复算法声明，未满足 G1；无法用增加原生构造器替代公共算法归属设计。

## Residual Risks

设计审查不是运行证明。auto 不保证各平台选出同一节点或具有相同故障切换行为；固定版本原生解析仍需独立检查。DNS、TUN、隧道及 Smart 调优字段不属于首个实现切片。
