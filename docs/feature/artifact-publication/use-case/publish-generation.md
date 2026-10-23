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

runBuild({profiles, resolveSecret?}, output) 接受按声明顺序的设备名到通用 Profile 的普通对象。设备名匹配小写字母数字起始、其后字母数字或连字符；1至16设备，按目标引擎生成 key.conf 或 key.json。空路径拒绝。全部编译成功后才按批次解析秘密并渲染；任一失败不写文件。默认秘密解析函数从环境读取，返回受控 BuildResult，不泄露原始异常。

此入口保留 out 相对符号链接协议：output/.generations/UUID 私有目录与0600文件，一次重命名指针 output/out；output/.build-lock 独占锁不抢占，旧 generation不自动清理。既有 buildToDirectory 的 active.json 协议不变。首次 out 实体目录迁移保留完整备份；指针失败恢复旧目录；恢复失败为 PUBLISH_RECOVERY_REQUIRED，保留锁、备份、新 generation、临时指针，out可能缺失，需人工恢复，不声称旧指针保留。

正常发布 true/0；提交后清理失败 true/2且active指向out；提交前失败false/1。清理未发布产物失败为FAILED_CLEANUP_REQUIRED；发布后为PUBLISHED_CLEANUP_FAILED。调用方透传exitCode，不能把true/2称作未发布。不承诺断电事务。测试真实I/O失败、秘密整批缓存、后续profile失败零读取、权限、非法路径与恢复现场。

## 应用构建定义

defineBuild 固定 profiles 深复制快照与可选 preflight、resolveSecret 回调。纯数据预算沿用既有校验；快照和 envelope 冻结。runBuild 在预检前固定本批次，原对象及预检闭包修改原输入不改变此次编译。回调由可信应用提供，不能自行输出。

预检返回最多1000个大写字母数字下划线警告码，按首次出现顺序计数；异常和非法返回使用固定错误码。秘密回调接收 token 与只读 validation 标志，且仅在整批编译成功后的渲染阶段调用。生产默认惰性读环境；validation 必须提供应用秘密解析函数，不猜测测试秘密。

新入口返回原 BuildResult 全部字段及 warnings、validation、profileCount；预检前错误使用空 warnings，未固定配置前数量为0。原 host 的 active、hint、exitCode 均原样透传；恢复失败不清现场、不补 active、不重试。

## 通用 Profile 批次

defineBuild/runBuild 及 profile-build CLI 复用预检、警告、秘密延迟与退出码协议。批次快照保留对象别名，全部目标编译后才共享按 token.name 缓存的秘密解析。sing-box 端点状态目录与输出目录相同或互为祖先时，在秘密读取与发布前报 ENDPOINT_STATE_OVERLAP。不证明跨设备状态目录全局独占。

Profile key 与引擎决定 .conf/.json 文件名，整批以 out 单次切换；旧代、恢复现场与 0/1/2 结果不变。仅保留 profile-build 设备构建入口；Program API/CLI 是独立能力。

设备构建只有 defineBuild/runBuild/profile-build 一套实现，不提供 Surge 专用包装 host、旧函数名或 CLI 转发。输出落盘与恢复协议不因 authoring API 收敛而改变。
