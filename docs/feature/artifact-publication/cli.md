# CLI 命令契约

## 命令清单

| 命令 | 输入与结果 |
| --- | --- |
| `proxylang targets` | 无配置输入，输出精确目标目录 JSON；额外参数拒绝。 |
| `proxylang check config.ts` | 加载默认导出配置，检查所有目标与案例，输出诊断、来源和运行前提；不读取秘密。 |
| `proxylang explain config.ts --target ID --request JSON` | 检查配置后解释请求，输出条件树、首命中或默认动作；目标和请求必填。 |
| `proxylang build config.ts --out DIRECTORY` | 检查并整批渲染，发布活动指针，输出状态与文件路径；输出目录必填。 |
| `proxylang --help` 或无参数 | 输出 JSON 用法和可信配置提示，不加载配置。 |

`check` 不接受选项；`explain` 和 `build` 拒绝未知、重复、缺值选项。配置是可信 TS/ESM 或 CJS 模块，执行其顶层代码；不是隔离环境。加载异常不回显源码、原异常或秘密。

## 输出与错误

所有命令输出 JSON。检查和解释成功退出 0；无效参数、配置加载失败、编译或案例失败、请求格式错误及未知目标退出 1。配置检查先于解释请求，配置错误优先返回。

构建退出 0 表示指针发布且清理成功；1 表示没有发布；2 表示指针已经发布但提交后清理失败。应按发布状态处理退出 2，不能假设活动配置未变。报告不包含秘密或原生配置正文。

片段不是完整网关。原生验证状态保持独立，构建不会自动执行原生二进制或部署服务。旧 generation 不自动清理；输出权限和错误恢复遵守 [批次发布故事](use-case/publish-generation.md)。

## 最小调用

构建 SDK 后运行 `node dist/cli.js check examples/home.ts`。成功时 JSON 包含 `ok: true`、案例结果及目标计划摘要，失败时非零退出并给出诊断。

解释调用示例见[项目 README](../../../README.md)。每次实际运行的证据通过 Concord runner 或工程 Memory 单独记录。
