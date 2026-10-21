# 架构

## 从策略到产物

TypeScript SDK 产生纯数据。`schema.ts` 校验输入并拒绝未知字段，`rules.ts` 展开模板、绑定槽位、累积守卫并解释顺序。规则不会按类型自动排序。

`compiler.ts` 创建不可变快照，检查资源引用、循环、网络约束和目标能力，执行配置案例，生成每目标计划。任一目标失败不暴露部分可发布结果。

`proxies.ts` 拥有协议专属字段的目标检查与节点编码，`render.ts` 按目标组合原生配置，仅在渲染批次解析秘密。`host.ts` 管理锁、权限、generation 与活动指针。`cli.ts` 加载可信配置并提供命令入口；它不是沙箱。

## 契约边界

[规则组合](feature/rule-composition/README.md)拥有顺序、条件与模板语义；[策略解释](feature/policy-explanation/README.md)拥有静态解释与案例断言。

[目标编译](feature/target-compilation/README.md)拥有能力目录及编码约束；[产物发布](feature/artifact-publication/README.md)拥有秘密处理与文件生命周期。公共参数详见 [SDK 参数细则](implementation-v0.md)。

平台程序持有自己的节点、有状态端点、组、默认动作和运行前提，共享策略只通过槽位绑定资源。不同内核的 DNS、探活和入口机制不自动合并；长期 Provider 设想见 [研究说明](research/platform-model/README.md)。

## 验证边界

纯语义测试、CLI 与文件系统集成测试、精确版本原生语法检查分层记录。任何一层都不替代生产联网或 ZimaCube 故障切换验收。
