# 项目配置文件

CLI 固定加载调用目录的 `proxylang.config.ts`，不向父目录搜索或猜测其它扩展名。配置是可信可执行模块，不是沙箱；相对 import 以配置文件为准，TS、ESM 与 CJS 加载互操作都由隔离包测试验证。

## 默认导出

```ts
import { defineBuild, defineProfile, outbound } from "proxylang";

const laptop = defineProfile({
  target: { engine: "surge", platform: "macos", version: "6.11.0" },
  proxies: [], groups: [], routes: [], fallback: outbound.direct,
});

export default defineBuild({ outDir: "generated", profiles: { laptop } });
```

默认导出必须是 `defineBuild` 的结果，字段与错误见[构建 API](../library.md#definebuild)。`outDir` 可在只读检查时省略，build 必填；非空、无首尾空白、不含 NUL。根文件允许指向普通配置文件的 symlink；不可读或不是文件时报受控加载错误。

## 路径与加载顺序

CLI 在任何 import 前固定调用目录，根配置、request-file 与相对 outDir 都按此根解析；绝对路径保留。程序化 runBuild 同样在调用时固定输出根，之后检查与发布不可分离到不同目录。

未知命令、未知/重复/缺值选项、位置参数、request 输入互斥等结构错误在 import 前拒绝。help 与 targets 不加载配置。配置缺失报 CONFIG_NOT_FOUND，依赖缺失不能误报根配置不存在；加载失败报 CONFIG_LOAD_FAILED，受控 reason 与 CLI 输出以[命令页](../cli.md)为准。

导出值检查 descriptor，不执行 getter。无默认导出、混合或未知字段拒绝；构造器错误作为配置加载失败报告，不能继续逐 Profile 语义检查。请求 JSON 内容与请求文件读取在配置加载和规范化成功后处理，保留配置错误优先级。

加载与求值期间的 console.log/info 转到 stderr，JSON stdout 保持可解析。此约定不隔离可信代码任意写 process.stdout 的行为。check/explain 不调用秘密来源或创建输出目录、锁、generation。
