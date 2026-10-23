---
format: concord.document/v1
id: publish-generation
title: 失败时继续使用上一批配置
createdAt: 2026-10-21T10:12:51.630Z
kind: use-case
feature: docs/feature/artifact-publication/README.md
---

# 失败时继续使用上一批配置

## 用户目标

作为依赖代理联网的设备维护者，我希望新配置只有全部成功时才替换活动配置，避免其中一个目标失败导致备用配置损坏。

## 行为与边界

用户运行 build，指定本地输出目录并提供环境变量秘密。构建持有独占锁，写入权限受限文件后切换 active 指针。消费者读取一次指针再使用对应文件。旧 generation 保留供用户自行管理。

## 验收条件

第二目标秘密编码失败不改变旧指针；并发构建仅一个持锁。指针提交失败删除未发布 generation。缺少秘密、文件系统错误、锁占用有非零退出；密码不进入报告。0 表示发布，1 表示未发布，2 表示发布后清理失败。

## 构建反馈

SDK 拒绝空输出路径，返回 INVALID_OUTPUT_DIRECTORY，不把空字符串解析成当前目录。OUTPUT_FAILED 保留为文件系统失败主错误码，并附带受控 reason 与 hint：ACCESS_DENIED、NO_SPACE、READ_ONLY、INVALID_DIRECTORY 或 IO_ERROR。报告不包含系统原始错误、秘密或配置正文。锁占用、秘密缺失和发布后清理失败也提供固定恢复建议；不自动删除已有锁。

发布文件格式、整批切换与退出码保持不变。macOS 与 Linux 验证带空格和中文路径、连续发布、失败保留旧指针及文件权限；这些保证不推导为 Windows ACL 或远端文件系统保证。
