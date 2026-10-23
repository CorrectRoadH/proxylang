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

## 完整 Surge 批次

buildSurgeProfilesToDirectory(profiles, output, resolveSecret?) 接受按声明顺序的设备名到 SurgeProfileInput 普通对象。设备名匹配小写字母数字起始、其后字母数字或连字符；1至16设备，生成 key.conf。空路径拒绝。全部编译成功后才按批次解析秘密并渲染；任一失败不写文件。默认秘密解析函数从环境读取，返回受控 BuildResult，不泄露原始异常。

此入口保留 out 相对符号链接协议：output/.generations/UUID 私有目录与0600文件，一次重命名指针 output/out；output/.build-lock 独占锁不抢占，旧 generation不自动清理。既有 buildToDirectory 的 active.json 协议不变。首次 out 实体目录迁移保留完整备份；指针失败恢复旧目录；恢复失败为 PUBLISH_RECOVERY_REQUIRED，保留锁、备份、新 generation、临时指针，out可能缺失，需人工恢复，不声称旧指针保留。

正常发布 true/0；提交后清理失败 true/2且active指向out；提交前失败false/1。清理未发布产物失败为FAILED_CLEANUP_REQUIRED；发布后为PUBLISHED_CLEANUP_FAILED。调用方透传exitCode，不能把true/2称作未发布。不承诺断电事务。测试真实I/O失败、秘密整批缓存、后续profile失败零读取、权限、非法路径与恢复现场。
