# 构建批次与发布生命周期

构建只写本地原生配置，部署由使用方拥有。检查与案例全部成功后才读取秘密，整批渲染成功后才创建待发布文件；后续 Profile 失败不能造成部分发布或读取部分秘密后继续成功。

## 输出目录与锁

调用开始时固定绝对输出根目录，检查 endpoint 状态目录与实际发布使用同一个根，不受可信配置代码的工作目录变化影响。新建目录权限 0700，文件 0600；这是 POSIX 权限保证，不推导为 Windows ACL 或远端文件系统保证。

输出根目录内 `.build-lock` 是 mkdir 独占锁。构建不能等待后抢占已有锁；占用报 `OUTPUT_LOCKED`，不自动删除。只有本批创建的锁可由本批清理。输出根和 `.generations` 必须是真实目录，拒绝符号链接；既有目录不靠声明权限假装已经私有。

## generation 与提交点

每批创建 `.generations/<UUID>`，文件按构建定义顺序写入，使用独占创建，文件名为 Profile key 加引擎扩展名。该目录包含秘密，不能作为日志、fixture 或公开审阅文件。

活动产物是 `out` 相对符号链接，目标为 `.generations/<UUID>`。先创建同根临时链接 `.out-<UUID>`，再一次 rename 到 `out`；rename 成功是整批提交点。同一批的全部文件同时生效，旧 generation 不自动回收。

既有 out 为符号链接时，只接受 `.generations/<UUID>` 或 `.generations/legacy-<UUID>` 的受管相对目标；目标须为真实目录。其它链接报 `UNMANAGED_OUTPUT_LINK`；普通文件或危险目录报 `UNSAFE_OUTPUT_DIRECTORY`，不能覆盖。

既有 out 为实体目录时，先整体 rename 到 `.generations/legacy-<UUID>` 保留备份，再切换新链接。切换失败必须尝试把完整备份 rename 回 out；恢复失败必须保留现场，不能声称旧产物仍可通过 out 读取。

## 清理

正常成功后删除临时指针和本批锁，保留新旧 generation 及实体目录备份。提交前失败时清理本批临时指针、未发布 generation 与本批锁。不得清理其它构建拥有的锁或历史文件。

恢复实体目录失败时，停止自动清理，保留锁、备份、新 generation、临时链接供人工恢复。协议不承诺断电事务，也不自动判断崩溃遗留锁是否安全。

## 失败与恢复

| code | published / exitCode | 状态与操作 |
| --- | --- | --- |
| `OUTPUT_DIRECTORY_REQUIRED` | false / 1 | 构建定义补 outDir 后重试，无发布 |
| `OUTPUT_LOCKED` | false / 1 | 不抢锁；维护者确认没有持锁进程，核对恢复现场后才可人工解除 |
| `UNMANAGED_OUTPUT_LINK`、`UNSAFE_OUTPUT_DIRECTORY` | false / 1 | 保留既有入口，维护者核对路径与符号链接，不盲目覆盖 |
| `PROFILE_PUBLISH_FAILED` | false / 1 | 提交失败；恢复成功时旧 out 保持，修复文件系统条件后重试 |
| `FAILED_CLEANUP_REQUIRED` | false / 1 | 未发布，本批未发布文件或锁可能残留，核对后人工清理 |
| `PUBLISHED_CLEANUP_FAILED` | true / 2 | 新批已生效，active 指向 out；清理临时文件或锁，不把它当作未发布重建 |
| `PUBLISH_RECOVERY_REQUIRED` | false / 2 | 实体目录恢复失败，out 可能缺失；保留全部现场，人工恢复完整旧目录或确认切换新 generation 后再清理 |

文件系统错误只给受控原因与建议，不回显原生系统异常、秘密或配置正文。发布文件系统失败归为 `PROFILE_PUBLISH_FAILED`；空路径等非法字段按[构建定义](library.md#definebuild)的定义错误处理。

人工恢复必须先确认没有存活构建，检查相对链接和完整 generation，再决定恢复旧目录还是完成新指针；不能只删除锁来掩盖缺失 out。处理历史 generation 时须考虑秘密保留，运行方自行确定保留和安全清理策略。

返回结构由[构建 API](library.md#runbuild)拥有，CLI 透传 0/1/2，不能仅凭 published 布尔值决定成功。恢复及清理的故障注入测试见[测试架构](../../engineering/testing/README.md)。
