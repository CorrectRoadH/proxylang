# 约定项目配置入口

## CLI 单一入口

0.6.0 按用户要求移除配置位置参数和 `profile-build` 命令。`build`、`check`、`explain` 固定加载调用工作目录下唯一的 `proxylang.config.ts`。不向父目录搜索、不猜其它扩展名、不提供 --config 或旧命令兼容层。targets/help 不加载任何配置。配置仍是可信可执行模块，相对 import 由加载器按配置文件解析。命令不调用 shell。

命令：`proxylang build [--validation]`、`proxylang check`、`proxylang explain --target ID (--request JSON | --request-file FILE)`。

build 的 `-- --validation` 保留包管理器转发形式。

未知、重复、缺值、旧位置参数/--out/--config、废弃命令必须在 import 前拒绝。

输出 INVALID_ARGUMENTS 的通用 JSON，退出1。



文件不存在返回 CONFIG_NOT_FOUND。文件存在但加载失败继续 CONFIG_LOAD_FAILED 的受控 reason/hint，不泄漏原异常。依赖模块不存在不能误归因根配置缺失。使用 lstat 检查根配置（允许指向配置文件的 symlink），不执行向上自动发现。读取失败或非文件由受控加载错误处理。

## 两种现有配置

默认导出仍复用 `defineConfig` 的 Program Config 或 `defineBuild` 的 Profile BuildDefinition，不新建第三种 envelope。

通过自有数据字段 profiles 选择 Profile 路径。

随后严格 schema/defineBuild 验证，混合 programs/profiles 拒绝。

检查 descriptor 不执行 getter。

TS/CJS loader interop 保持既有行为。

未提供默认导出正常报无效配置。



两种定义增加可选 `outDir: string`，非空、无首尾空白，程序化 compile/runBuild 不强迫提供该字段。

CLI build 必须由配置提供，不默认猜路径。

CLI 在任何配置 import 前捕获调用 cwd。

根配置、request-file 与相对 outDir 均按这个固定根解析。

绝对路径保持。

CLI 不再接受 --out。

缺失报 OUTPUT_DIRECTORY_REQUIRED。

程序化 runBuild(input, output) 保留显式 output 的原优先级，程序化 buildToDirectory 不变。

defineBuild 必须快照保存 outDir。

runBuild 在任何回调执行前以函数调用时 cwd 将显式 output 固定为绝对路径。

检查与秘密解析后的 publishProfiles 必须使用同一个绝对根，禁止 秘密解析函数/preflight 的 chdir 改变落盘位置。

CLI 传入按 import 前 cwd 固定的绝对输出路径。



Profile build 使用现有 runBuild 及整批编译/秘密快照/原子发布，--validation 保持原有语义并仍写验证产物。Program build 不接受 --validation，返回 VALIDATION_PROFILE_REQUIRED，不能静默忽略。

## 只读检查

Profile 的 check 新增 `checkBuild(input)` 程序化函数，验证 defineBuild、1..16文件名、全部目标、可用 outDir 的端点状态目录冲突。导出 ProfileCheckResult：

```ts
{ok:boolean,code:string,profileCount:number,outputDirectoryChecked:boolean,profiles: readonly {id:string,engine:"surge"|"sing-box"|"invalid",ok:boolean,code?:string,diagnostics:readonly Diagnostic[]}[]}
```

成功 code=CHECKED。

失败 code 沿用实际校验错误。

非法 envelope/文件名返回空 profiles。

其余逐设备只投影受控诊断，不返回 compilation。

未提供 outDir 或未走到路径检查时 outputDirectoryChecked=false。

路径检查已执行（包括冲突失败）为true。

失败退出1。

不调用 preflight/resolveSecret、不渲染、不创建输出目录/锁/指针。

不验证运行时秘密可用性，不承诺回调执行结果。



将现有 publish 内整批编译与端点路径检查提取为共用内部函数，checkBuild 与 runBuild 的实际发布前编译走同一逻辑。不复制整个编译器。runBuild 仍先验证 envelope/validation 秘密解析函数，再 preflight，后整批编译，最后秘密解析/发布，保持旧顺序及0/1/2结果。checkBuild 不把成功 compile 当作原生二进制或生产验收。

Program check/explain 输出保持原语义，不读秘密。

Profile explain 明确 EXPLAIN_PROFILE_UNSUPPORTED，不能假装解释外部规则。

仅选项结构、目标非空字符串和 request/request-file 互斥在导入前检查，非法报 INVALID_ARGUMENTS。

inline JSON 解析/Request schema、request-file 读取和目标存在性均在配置编译成功后。

依次保留 INVALID_REQUEST/REQUEST_FILE_* /UNKNOWN_TARGET 的旧优先级，不额外在 import 前解释 JSON。



## 消费与验收

it-infra 将 proxy/config.ts 移至根 proxylang.config.ts，调整相对 imports 并写 outDir:"proxy"。

build:proxy 改为 `proxylang build`，test:proxy 为 `proxylang build --validation`。

check:proxy 保留 TypeScript 并加 `proxylang check`。

根配置纳入 proxy tsconfig、lint/fmt、CI proxy路径触发、workspace-validate.yml 独立 lint，以及 surge-deploy.yml superseded-inputs 发布过期构建保护清单。

旧临时 CLI 示例迁移为各自工作目录的约定配置，保留 TS/ESM/CJS、秘密脱敏、原子发布与恢复故障覆盖。



重点回归：缺根配置与缺依赖分别报错。

无父目录发现。

无效参数/帮助零import。

两种配置 check 零 秘密解析函数/preflight/写盘。

配置目录/导入路径/outDir边界。

Program validation拒绝。

旧命令明确拒绝。

Profile批次失败不读秘密、发布0/1/2与恢复hint原样。

真实打包CLI在隔离目录运行。

完整 verify/Concord/消费tgz及公开包检查，四份完整配置与代理ID保持0.5.0基线。

不重载设备。

公开发布沿用会话授权。



## 设计审查收敛

独立 GPT-6.1 Sol 静态审查 CONDITIONAL：调用 cwd 与回调 chdir 隔离、根配置的 CI 发布保护和请求错误优先级三项已明确。checkBuild 公共结果也按上文固定。实际测试与发布验收独立于设计审查。
