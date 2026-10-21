---
format: concord.document/v1
id: artifact-publication
title: 可靠生成本地配置产物
createdAt: 2026-10-21T10:12:51.064Z
kind: feature
constitutionRefs:
  - docs/constitution.md#c-003
---

# 可靠生成本地配置产物

用户从可信 TypeScript 配置生成一批本地产物。检查与解释不解析密码，构建按 token 在批次内解析一次。配置使用结构化编码，不能安全表达的秘密使整批失败。

所有文件写入私有 generation 后才原子切换活动指针。输出根独占锁不自动抢占；失败清理本次未发布产物，旧产物保持有效。输出不是远程部署，也不启动代理。

## 用户故事

- [失败时继续使用上一批配置](use-case/publish-generation.md)
