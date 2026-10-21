---
format: concord.document/v1
id: strategy-implementation-validation
title: Strategy 实现与真实消费者验收
createdAt: 2026-10-21T11:42:23.117Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# Strategy 实现与真实消费者验收

2026-10-21，采用具名 strategy、共同成员、显式 per-engine 算法。Herdr 原生 Codex / gpt-6.1-sol 的 pl-strategy-review 在 wC:p2R 完成只读审查，结论 CONDITIONAL。主 agent 收敛四项条件：统一 names 输入与 artifactKind 返回；拒绝空白名称并按最终名字全局查重；只迁 M4 六组、不改共用 ai_default.conf；期望编译目标不冒充设备实测版本。审查 pane 已关闭，无残留。

实现位于 src/strategies.ts、schema/types/dsl、compiler/targets/render，CLI check 与 host manifest 记录 strategySelections。两个入口复用算法选择和序列化。URL 校验发现既有 URL 构造器会抛异常，已转为结构诊断并由非法未选分支测试覆盖。

`npm run check`：45 通过、3 原生测试默认跳过。`npm run test:native`：Surge 6.10.0、sing-box 1.11.0、1.12.0 的三项原生离线检查通过，包含新增策略算法。Concord check、trace gaps、doctor 通过，gaps 为空。它们分别证明运行结果、显式关系和文档结构，不混称覆盖率。

it-infra 用固定 npm tarball 与锁文件消费 SDK。npm ci、typecheck 与 4 项测试通过，其中一项复制实际 shell 构建入口并使用已安装 SDK，验证成功生成及空候选失败后不重建配置。actionlint v1.7.7 检查修改的发布工作流通过（关闭外部 shellcheck 集成）；shell diff check 通过。

实际 `mise exec go@1.25.7 -- bash ../it-infra/proxy/build.sh` 完成，四份 Surge 配置有效行与迁移前逐行相同；两台 iPhone 与 MacBook 字节不变，M4 只有说明注释变化。完整 M4 配置额外通过 Surge 6.10.0 离线 check。vendor 包逐文件比对当前 dist，锁文件 SHA-512 完整性一致。

此验收不证明设备实际运行版本、网络连通或 ZimaCube 接管能力。sing-box 产物仅为六个策略组；节点/via、Tailscale、远程规则集、extended-matching、MAC 与网关 DNS/入口尚未迁移。没有 push、发布、远端重载或服务修改。私有迁移基线在比较完成后清理。
