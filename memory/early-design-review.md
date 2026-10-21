---
format: concord.document/v1
id: early-design-review
title: 早期语言方案审查
createdAt: 2026-10-21T10:12:52.738Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# 语言设计审查记录

日期：2026-10-21。

状态：基础设计初审 CONDITIONAL，修订后定向复核 PASS（仅文档阶段）；后续用户反馈修订由主 agent 静态核对，未追加独立 Review。

## 范围

审查 [语言设计](./language-design.md) 中首次确定的公共语言模型、目标版本语义、专属扩展边界与构建资源生命周期。此次只写设计，不实现源码。

主要问题：通用抽象是否错误承诺等价性；专属机制能否保留顺序与依赖；版本检查是否可维护；引用、秘密、外部资源及输出是否具有清晰生命周期。

## 角色

- 主 agent：调查、方案、修订与最终验收。
- 独立 Review：通过 Herdr 启动原生 Codex，模型 `gpt-6.1-sol`、high，任务名 `proxylang-design-review`，只读审查，不再分派。会话 `01a15d06-bfb4-7442-9100-d8c616c43132`。

## 初审与修订

初审结论 CONDITIONAL，四项 P1 阻塞定案，一项 P2 加固。主 agent 全部采纳：

| 发现 | 修订 |
| --- | --- |
| 目标局部 provider／group 无完整路由接入方式，空规则无锚点 | 第 7.2 节加入 scope、显式注册、目标 fallback 替换、冲突规则及完整例子；加入流水线边界 |
| route 未规定出口不支持 UDP 时的终结行为 | 第 4 节禁止恢复扫描，检查全部可能路径，无法证明时报错；核对 mihomo 官方 priority 文档 |
| before r2 与 after r1 位于同一间隙但缺少全序 | 第 7.3 节归一化 gap，以声明序全排序；锚点围绕整个展开块 |
| 多目标逐个发布不能保证整批一致 | 第 8 节采用不可变 generation、active.json 单原子提交点与独占锁；明确崩溃／取消／提交后清理边界 |
| 检查器回显、创建时权限、旧秘密清理未明确 | 第 8 节增加受限权限、检查器输出允许列表、旧 generation 清理与残留报告 |

完整 DNS 与精确版本支持表仍属于后续工作，不计入已完成实现或兼容性证明。

## 后续用户反馈修订

2026-10-21 用户要求不用 kind 命名、说明不支持 feature 的 warning，并确认多版本目标；随后明确 Surge 只是举例。

- Match、Action 与资源来源的判别字段统一为 type，Rule 保持 id／when／then。
- 多版本明确为所有已实现后端的通用矩阵，示例同时覆盖 Surge、mihomo、sing-box；相同内核同平台多个版本分别诊断与输出。
- 可省略的展示字段 warning，行为功能、required 和 unknown 保持 error；加入 warningsAsErrors、结构化诊断及整批发布规则。

这些是命名和已有保语义契约的局部澄清，没有改变资源所有权、信任边界或允许静默降级，不另启独立架构审查。主 agent 检查文档链接、代码围栏、命名一致性与相关前后条款；原有独立 PASS 仅对应上面的基础设计复核，不冒充本次修订的独立结论。

## 验证状态

独立 Review 复核确认四项 P1 与 P2 已闭合，未发现新的阻塞位置；核心契约可作为后续实现依据。主 agent 核对实际文件、修订范围和官方 UDP 行为证据后接受。

本轮仅新增 docs/README.md、docs/language-design.md、docs/design-review.md。Python 文档检查确认本地 Markdown 链接存在、代码围栏成对。目录尚未初始化 Git，未创建提交。

SDK、编译器、原生配置检查与运行时验收均未执行，示例 API 不可直接运行。未解决实现前置项：首批精确目标版本与检查器、完整 DNS／standalone profile，以及后续扩展具体 schema。
