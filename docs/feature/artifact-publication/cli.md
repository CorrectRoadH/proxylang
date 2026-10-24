# CLI 命令契约

## 约定配置

CLI 固定读取调用目录中的 `proxylang.config.ts`，默认导出 `defineConfig(...)` 或 `defineBuild(...)`。不向父目录搜索、不接受位置配置路径、--config 或 --out。profile-build、surge-build 已移除。构建的 outDir 由配置显式提供。

配置是可信可执行 TS 模块，支持所在 package scope 的 ESM/CJS interop。不是隔离环境。相对 import 仍按配置文件解析。CLI 在 import 前捕获 cwd，配置及回调的 chdir 不改变配置发现、请求文件或输出目录的基准。完整行为见[约定项目配置](project-config.md)。

## 命令清单

| 命令 | 输入与结果 |
| --- | --- |
| `proxylang targets` | 不加载配置，输出精确目标目录 JSON。 |
| `proxylang check` | Program 检查全部目标及案例。Profile 使用 checkBuild 检查全部设备与可用输出目录隔离。不读秘密、不执行 preflight、不写产物。 |
| `proxylang build` | 从配置的 outDir 整批编译渲染发布。Profile 使用 runBuild，Program 使用 buildToDirectory。 |
| `proxylang build --validation` | 仅 Profile 支持，使用应用提供的验证 秘密解析函数。仍生成产物，不是只读检查。 |
| `proxylang explain --target ID --request JSON` | 仅 Program 支持，检查配置后解释请求，输出条件树与命中结果。 |
| `proxylang explain --target ID --request-file FILE` | 请求由 UTF-8 JSON 普通文件提供，替代内联 JSON。 |
| `proxylang --help`、`-h`、子命令帮助或无参数 | 输出 JSON 用法、配置文件名及可信配置提示，不加载配置。 |

## 参数与错误优先级

未知命令、位置参数、未知/重复/缺值选项在 import 前返回 INVALID_ARGUMENTS。check/targets 不接受选项。帮助必须单独使用。build 只允许 --validation，另接受 `-- --validation` 的包管理器转发形式。不能重复。

explain 在 import 前检查选项结构、非空目标字符串，以及 --request/--request-file 必须且只能提供一个。配置加载与编译完成后，才解析 inline JSON 或读取请求文件，再校验 Request schema，最后检查目标存在性。配置错误优先于请求内容错误，不在 import 前解释 JSON。

根配置缺失报 CONFIG_NOT_FOUND。存在但加载失败为 CONFIG_LOAD_FAILED，带受控 reason/hint：MODULE_NOT_FOUND（导入依赖不存在）、ACCESS_DENIED、INVALID_SYNTAX、EXECUTION_FAILED。异常消息、源码、秘密及异常属性 getter 不进入诊断。配置/loader自行输出不属于此保证。

缺 outDir 的 build 报 OUTPUT_DIRECTORY_REQUIRED。Program 的 --validation 报 VALIDATION_PROFILE_REQUIRED。Profile 编译通过后 explain 报 EXPLAIN_PROFILE_UNSUPPORTED。不支持机制不会被悄悄忽略。

## 请求文件

request-file 相对 import 前捕获的调用目录，允许中文、空格路径及 UTF-8 BOM。最多1 MiB普通文件。不存在、不可读、无效UTF-8或非普通文件报 REQUEST_FILE_READ_FAILED。超限报 REQUEST_FILE_TOO_LARGE。JSON/schema无效报 INVALID_REQUEST。目标不存在报 UNKNOWN_TARGET。错误不回显内容或系统异常，不读取 stdin 或执行文件。

## 结果与发布

全部输出 JSON。check/explain 成功退出0，参数/加载/编译/案例/请求失败退出1。Profile check 的 ProfileCheckResult 只投影受控逐设备诊断，成功code=CHECKED。未配置 outDir 时 outputDirectoryChecked=false，不能声称已验证状态目录与输出目录隔离。

构建0/PUBLISHED表示指针发布和清理成功。1表示未发布。2/PUBLISHED_CLEANUP_FAILED仍为published=true且active指向新产物。PUBLISH_RECOVERY_REQUIRED保留hint，out可能缺失，保留现场、不补active、不自动清理或重试。

Profile构建先验证envelope与validation 秘密解析函数，再preflight、整批编译与端点隔离，最后批次共享秘密快照和原子发布。无效envelope为INVALID_BUILD_DEFINITION，preflight异常/非法警告分别为PREFLIGHT_FAILED/INVALID_PREFLIGHT_WARNINGS。程序化runBuild显式output优先，并在回调前固定绝对根。

输出不包含秘密或原生配置正文。构建不自动执行原生二进制或部署服务。旧generation不自动清理。恢复遵守[批次发布故事](use-case/publish-generation.md)。

## 最小调用

在包含约定配置的示例目录运行 `node ../../dist/cli.js check`，例如 `examples/home`。检查不需要秘密。build需要配置outDir和应用实际凭据。实际运行证据通过测试或工程Memory独立记录。

0.7.0 构建秘密入口为 `secrets: secrets({ values, env, validation })`；旧回调字段移除，完整行为见[秘密值声明](secret-inputs.md)。
