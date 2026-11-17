# 生成并发布全部设备的配置

## 用户目标

配置作者希望一次生成全部设备的原生文件；其中一份失败时，设备继续使用上一批本地产物。

## 起始状态

当前目录有[项目配置](../format/project-config.md)，默认导出含 outDir、设备 Profile 与秘密集合。秘密引用都有对应来源；验证构建为每个被引用秘密声明格式合法的 validation 值。

## 完整路径

以下为预期用法与结果。

1. 执行 `proxylang check`，查看全部 Profile 的诊断与案例结果，不读取秘密，不创建输出文件。 {#check}
2. 全部通过后执行 `proxylang build --validation`，用声明的验证值生成整批文件；缺少验证值时失败，不读取生产来源。 {#validate}
3. 准备实际来源并执行 `proxylang build`，全部检查、案例和渲染成功后，out 一次指向新 generation。 {#publish}
4. 从 out 读取全部设备文件，按使用方自己的部署流程交给设备；本命令不操作客户端或远端。 {#consume}

## 结果与失败

正常成功退出 0。检查、案例、秘密或提交前失败退出 1，不发布部分配置。已提交但清理失败退出 2，显示 PUBLISHED_CLEANUP_FAILED；新批有效。实体目录恢复失败为 PUBLISH_RECOVERY_REQUIRED、退出 2，out 可能缺失，必须按[失败与恢复](../architecture.md#失败与恢复)处理，不能只重跑 build。

锁占用不抢占，旧 generation 不自动清理。多文件读取者如需固定同一批，应先固定 out 对应的 generation 再读取，以免跨并发切换混用两批文件。生成与原生配置检查不代表网络或设备生效。
