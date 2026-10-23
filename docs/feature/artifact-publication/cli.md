# CLI 命令契约

## 命令清单

| 命令 | 输入与结果 |
| --- | --- |
| `proxylang targets` | 无配置输入，输出精确目标目录 JSON；额外参数拒绝。 |
| `proxylang check config.ts` | 加载默认导出配置，检查所有目标与案例，输出诊断、来源和运行前提；不读取秘密。 |
| `proxylang explain config.ts --target ID --request JSON` | 检查配置后解释请求，输出条件树、首命中或默认动作；目标和请求必填。 |
| `proxylang explain config.ts --target ID --request-file FILE` | 从 UTF-8 JSON 普通文件读取请求，替代内联 JSON。 |
| `proxylang profile-build config.ts --out DIRECTORY [--validation]` | 加载 defineBuild 默认导出，整批编译通用 Profile，发布 .conf/.json 到同一 out 指针；沿用 0/1/2 与恢复 hint。 |
| `proxylang surge-build config.ts --out DIRECTORY [--validation]` | 加载 defineSurgeBuild 默认导出，预检、整批编译/渲染并发布完整 Surge 配置。 |
| `proxylang build config.ts --out DIRECTORY` | 检查并整批渲染，发布活动指针，输出状态与文件路径；输出目录必填。 |
| `proxylang --help`、`-h`、子命令帮助或无参数 | 输出 JSON 用法和可信配置提示，不加载配置。 |

`check` 不接受选项；`explain` 和 `build` 拒绝未知、重复、缺值选项。配置是可信 TS/ESM 或 CJS 模块，执行其顶层代码；不是隔离环境。加载异常不回显源码、原异常或秘密。CONFIG_LOAD_FAILED 附带受控 reason 和固定 hint：MODULE_NOT_FOUND（配置或导入模块不存在）、ACCESS_DENIED（权限不足）、INVALID_SYNTAX（语法或转换失败）、EXECUTION_FAILED（其它加载或执行失败）。诊断格式化不执行异常属性 getter；未知异常保持通用提示。可信配置本身及其加载器的执行副作用不属于输出脱敏保证。

## 输出与错误

所有命令输出 JSON。检查和解释成功退出 0；无效参数、配置加载失败、编译或案例失败、请求格式错误及未知目标退出 1。配置检查先于解释请求，配置错误优先返回。

构建退出 0 表示指针发布且清理成功；1 表示没有发布；2 表示指针已经发布但提交后清理失败。应按发布状态处理退出 2，不能假设活动配置未变。报告不包含秘密或原生配置正文。

片段不是完整网关。原生验证状态保持独立，构建不会自动执行原生二进制或部署服务。旧 generation 不自动清理；输出权限和错误恢复遵守 [批次发布故事](use-case/publish-generation.md)。

## 最小调用

构建 SDK 后运行 `node dist/cli.js check examples/home.ts`。成功时 JSON 包含 `ok: true`、案例结果及目标计划摘要，失败时非零退出并给出诊断。

解释调用示例见[项目 README](../../../README.md)。每次实际运行的证据通过 Concord runner 或工程 Memory 单独记录。

## 命令帮助与请求文件

全局 --help/-h，以及 targets/check/explain/build 后的 --help/-h，输出 JSON 用法且不加载配置。帮助命令拒绝多余参数。选项值不能为空或只含空白，缺值与重复选项在加载前拒绝。

explain 支持 --request-file FILE，替代 --request JSON；两者必须且只能提供一个。文件为 UTF-8 JSON 普通文件，最多 1 MiB，可带 UTF-8 BOM。路径相对调用目录；配置中的相对 import 仍相对配置文件。配置检查仍先于请求读取，保留已有错误优先级。

文件不存在、不可读、UTF-8 解码失败或不是普通文件报 REQUEST_FILE_READ_FAILED；超过限制报 REQUEST_FILE_TOO_LARGE；JSON 或请求 schema 无效报 INVALID_REQUEST。错误不回显文件内容或系统异常。此入口不读取 stdin，不把文件当可执行配置加载。

## Surge 构建入口

参数在加载配置前验证，未知/重复/缺值/额外位置参数拒绝为 INVALID_ARGUMENTS，profileCount=0、warnings={}、validation=false。--out 的值不能以 - 开头，可用 ./ 前缀。-- 只允许在完整 --out DIRECTORY 后且紧接最后一个 --validation，用于 vp 参数转发。surge-build --help/-h 仅单独使用，不加载模块。

默认导出支持可信 TS/ESM/CJS。加载失败固定 PROFILE_DEFINITION_FAILED、profileCount=0；无效 envelope 固定 INVALID_BUILD_DEFINITION；无效程序化 options 固定 INVALID_BUILD_OPTIONS。预检抛出 PREFLIGHT_FAILED、非法警告返回 INVALID_PREFLIGHT_WARNINGS。

这些失败 warnings 为空，预检阶段 profileCount 已固定。validation 缺秘密解析函数 在预检前报 VALIDATION_RESOLVER_REQUIRED。成功及 host 失败保留 warnings/validation/profileCount 和全部原 BuildResult。输出不包含原异常；模块、loader、回调的自行输出不属于此保证，配置约定不得输出。

0/PUBLISHED 表示 published=true；2/PUBLISHED_CLEANUP_FAILED 仍为 published=true 且 active 指向 out。发布前失败为 false/1。PUBLISH_RECOVERY_REQUIRED 原样保留 hint，out 可能缺失，现场需要保留，不补 active、不清理、不重试。CLI 原样透传 exitCode。

profile-build 使用与 surge-build 相同的参数语法、可信模块边界、预检和退出码规则。全部目标编译与端点状态隔离通过后才解析秘密，不自动删除端点状态或迁移平台扩展。
