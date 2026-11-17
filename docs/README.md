# proxylang 文档

proxylang 让一个人或一个小团队用 TypeScript 维护多台设备的代理配置。规则、节点和分组是普通的 TypeScript 值，可以在设备之间共享；每台设备写一份 Profile，为共享规则里的出口绑定自己的节点、分组和隧道，再生成 Surge、sing-box、Mihomo 或 Stash 的原生配置。设计以一个真实的多设备配置仓库为主要使用方，它的设备同时使用 Surge 与 sing-box。

它的价值在于三件事：

- **共享而不复制**：改一条共享规则，所有设备的产物都随之改变，设备之间的差异只出现在声明处。
- **发布前发现问题**：未知出口、分组循环、目标不支持的协议或条件、缺少引擎实现，都在 `check` 阶段一次报出，并指向源码位置。
- **保护路由意图**：路由案例断言关键请求走哪个出口，规则改动改变意图时阻止发布。

## 从这里开始

- [项目原则](taste.md)：作者的心智模型与开发体验的判断标准。
- [术语](concepts.md)与[架构](architecture.md)：概念定义、数据流与模块边界。

## Feature

- [编写 Profile](feature/profile/README.md)：构造器、出口引用、片段组合、链式代理与引擎专属字段。
- [目标与原生输出](feature/targets/README.md)：支持的目标、能力、编码规则与诊断。
- [路由案例](feature/routing-cases/README.md)：`explain` 与 `cases`。
- [构建与发布](feature/build/README.md)：构建定义、秘密、CLI 与产物批次。

## Engineering

- [测试架构](engineering/testing/README.md)：各层测试分别证明什么。
- [开发工作流](engineering/development/README.md)：工具链、CI 与 Concord。
- [npm 发布](engineering/npm-release/README.md)。

## Roadmap

- [从机场订阅生成节点模块](roadmap/subscription-import/README.md)
- [构建前查看产物变化](roadmap/build-diff/README.md)

用法示例见[项目 README](../README.md)。可复用的工程经验用 `concord memory search <关键词>` 查询。
