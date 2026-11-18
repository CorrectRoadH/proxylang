# CLI

CLI 只读取当前目录下的 `proxylang.config.ts`，加载规则见[项目配置](format/project-config.md)。配置文件是可信的可执行代码，CLI 不对它做隔离。

## 命令

| 命令 | 作用 | 读取秘密 | 写文件 |
| --- | --- | --- | --- |
| `proxylang check [--json]` | 检查全部 Profile 与路由案例 | 否 | 否 |
| `proxylang build [--validation] [--json]` | 检查后生成并整批发布产物 | 是 | 是 |
| `proxylang explain --profile KEY (--request JSON \| --request-file FILE) [--json]` | 求值一个请求在一份 Profile 上的首条命中 | 否 | 否 |
| `proxylang targets [--json]` | 列出支持的目标，不加载配置 | 否 | 否 |
| `proxylang --help`、`proxylang <命令> --help` | 显示用法，不加载配置 | 否 | 否 |

## 输出

默认输出给人读的文本，写到 stdout；诊断按 Profile 分组，每条一行，包含严重程度、错误码、路径和源码位置。目标版本不匹配时也会显示支持的稳定版本。

加 `--json` 时 stdout 只有一个 JSON 对象：

| 命令 | 成功或检查失败时 |
| --- | --- |
| `check` | `checkBuild` 的结果 |
| `build` | `runBuild` 的结果 |
| `explain` | `explainProfile` 的结果，加上 `profile` 字段 |
| `targets` | `{ "targets": [{ "engine", "platform", "version", "modes", "artifact" }] }` |

参数错误、配置加载失败、请求无效等在得到库函数结果之前发生的失败，输出 `{ "ok": false, "code": string, "reason"?: string, "hint"?: string, "paths"?: string[], "origin"?: Origin }`。

配置文件自己的 `console.log`、`console.info` 输出在加载与求值期间被转到 stderr，所以 stdout 始终可以解析；stderr 的内容不属于契约。

人读输出示例（预期输出）：

```text
✗ phone  surge ios 5.23.0
  error UNLISTED_EXIT  routes[12].to  group "claude" is not listed in groups  proxy/routes.ts:47:5
✓ laptop  surge macos 6.11.0  auto: ai→surge-smart, smart→surge-smart
✓ gateway  sing-box linux 1.14.4  auto: ai→urltest; ruleSets: cn-direct→singBox
cases: 11 passed, 1 failed
  ✗ gateway "AI 服务走 AI 出口": expected ai, got DIRECT at routes[3] proxy/rule/remote.ts:5:3
check failed: 1 profile, 1 case
```

输出不包含秘密值与节点凭据。

## explain {#explain}

`--profile` 是构建定义 `profiles` 中的键。`--request` 与 `--request-file` 必须且只能给一个，内容是一个 [RouteRequest](../routing-cases/library.md#routerequest) JSON 对象。请求文件按调用目录解析，必须是不超过 1 MiB 的 UTF-8 普通文件，允许 BOM。

请求 JSON 中的规则集假设写成 `"ruleSets": { "<id>": true | false }`，CLI 在这份 Profile 用到的规则集中按 id 查找对象，再转换为 `Assumptions`；找不到时报 `ASSUMPTION_UNKNOWN_RULESET`。

参数结构在加载配置前检查；请求内容在配置加载并通过规范化之后才解析，所以配置错误优先报告。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | `check` 通过；`build` 已发布并完成清理；`explain` 得到结果，包括 `indeterminate` |
| 1 | 参数错误、配置加载失败、检查失败、案例失败、请求无效，或 `build` 未发布 |
| 2 | `build` 已发布新产物，但清理旧批次失败（`PUBLISHED_CLEANUP_FAILED`）；或者需要人工恢复（`PUBLISH_RECOVERY_REQUIRED`） |

## 错误

| code | 触发 |
| --- | --- |
| `INVALID_ARGUMENTS` | 未知命令、位置参数、未知或重复的选项、选项缺值 |
| `CONFIG_NOT_FOUND` | 当前目录没有 `proxylang.config.ts` |
| `CONFIG_LOAD_FAILED` | 加载失败；`reason` 为 `MODULE_NOT_FOUND`、`ACCESS_DENIED`、`INVALID_SYNTAX`、`EXECUTION_FAILED` 或 `INVALID_CONFIGURATION` |
| `INVALID_BUILD_DEFINITION` | 默认导出不是合法的构建定义 |
| `OUTPUT_DIRECTORY_REQUIRED` | `build` 时构建定义没有 `outDir` |
| `CHECK_FAILED` | 至少一份 Profile 有 error |
| `CASE_FAILED` | 至少一个路由案例失败 |
| `UNKNOWN_PROFILE` | `explain --profile` 指定的键不存在 |
| `INVALID_REQUEST` | 请求 JSON 无效或不符合 `RouteRequest` |
| `REQUEST_FILE_READ_FAILED` `REQUEST_FILE_TOO_LARGE` | 请求文件不可读、不是普通文件、不是 UTF-8，或者超过 1 MiB |
| 发布错误 | 见 [architecture](architecture.md#失败与恢复) |

错误信息不回显异常消息、配置源码、请求内容或秘密值。
