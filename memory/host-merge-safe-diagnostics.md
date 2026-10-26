---
format: concord.document/v1
id: host-merge-safe-diagnostics
title: Host 合并与安全诊断验证
createdAt: 2026-10-26T04:51:29.749Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# Host 合并与安全诊断验证

2026-10-26：实现 dns 与 surge.hosts 合并，重复模式保留字段索引；配置加载显示受控定义错误，秘密失败附带 token 名与底层原因，外层错误码保持兼容。

修改前的定向测试出现两项预期失败：合并配置被拒绝、secretName 不存在。修改后的 vp run check 通过，152 项通过、17 项原生测试跳过；vp run test:package 验证隔离安装的 SDK、类型、CLI check/build 通过。没有执行原生 Surge 运行验收或发布 npm 包。

tsx 加载可能创建另一 SDK 实例，因此 CLI 不依赖 instanceof，而仅投影 own data descriptor 中白名单错误码及受限字段索引。这是脱敏分类，不是错误来源认证。秘密嵌套原因由内部 WeakMap 保留，任意回调抛出的属性不能伪造缺失原因。

原生 Host 不同 glob 的重叠保留 Surge 顺序语义；仅跨入口重复 pattern 拒绝。消费仓库尚未升级。
