# 测试架构

给开发 proxylang 的维护者与 agent。测试分层组织，每一层回答一个问题；一层通过不代表另一层也通过（[t-14](../../taste.md#t-14)）。新增或修改行为时，先确定它属于哪一层，再在那一层补测试。

## 分层

| 层 | 位置 | 回答的问题 | 不能证明 | 运行 |
| --- | --- | --- | --- | --- |
| 构造器与规范化 | `test/authoring/`、`test/model/` | 公开构造器是否接受合法输入、拒绝非法输入；规范化是否产生正确的资源表、出口引用与诊断 | 原生配置是否正确 | `vp test run` |
| 类型契约 | `test/types/` | 合法写法能通过类型检查，`@ts-expect-error` 标出的写法会被编辑器拒绝 | 运行时校验 | `vp run typecheck` |
| 路由求值 | `test/routing/` | 首条命中、缺失字段、`includeSniffed`、`indeterminate` 与案例结果是否符合[路由案例](../../feature/routing-cases/README.md) | 客户端运行时的实际选路 | `vp test run` |
| 生成结果比对 | `test/golden/` | 每个目标上，每类声明编码成的原生文本是否与已审阅的期望文件逐字节相同 | 客户端能否加载这份配置 | `vp test run` |
| 原生检查 | `test/native/` | 生成结果比对中的每份 sing-box 与 Mihomo 产物，能否通过对应固定版本内核的配置检查 | 节点连通、DNS、TUN 是否工作 | CI 的 native 任务；本地 `vp run test:native` |
| CLI 与发布 | `test/cli/`、`test/build/` | 命令参数、人读与 JSON 输出、退出码；批次发布在每个故障注入点的结果 | 安装后的包是否完整 | `vp test run` |
| 隔离安装 | `scripts/verify-package.mjs`（`vp run verify`） | `npm pack` 后在临时目录安装，ESM 与 CJS 配置都能 check、explain、build，发布的类型声明可用 | 使用方的真实配置 | `vp run verify` |
| 使用方验收 | 使用方仓库 | 真实的多设备配置在当前构建上能 check、`build --validation`，全部路由案例通过 | 设备上的实际网络行为 | 发版前手动运行 |

## 各层的写法

**构造器与规范化**：每个公开构造器至少一个正例和每个具名错误码的反例。断言错误码与 `paths`，不断言错误消息文本。Profile 片段用 `test/fixtures/` 中的工厂函数构造，节点地址只用 `example.com`、`192.0.2.0/24` 与 `2001:db8::/32`，秘密只用 `defineSecrets` 声明的 `TEST_*` 名字，并且都带 `validation` 值。

**类型契约**：用于 [t-8](../../taste.md#t-8) 中“类型先于运行时”的保证，例如 Surge Profile 不能写 `singBox` 字段，`surge.smart()` 不能放进 sing-box Profile 的分组。

**路由求值**：表格驱动。每条求值规则都有命中、不命中、字段缺失与 `indeterminate` 的例子。

**生成结果比对**：每个目录 `test/golden/<target>/<场景>/` 包含 `profile.ts`（导出一份 Profile）和期望产物 `expected.conf` 或 `expected.json`。测试用固定的秘密读取函数渲染并逐字节比较。更新期望文件使用 `vp run test:golden:update`（本次重构新增的脚本），更新后的 diff 与源码改动一起审阅。场景按能力划分，例如协议、分组算法、链式代理、规则集、DNS、TUN、隧道，每个支持的目标都覆盖它支持的场景。

**原生检查**：CI 为每个 sing-box 目标版本（1.12.0、1.14.4）与 Mihomo 1.19.32 下载固定版本的内核，核对 SHA-256，在隔离目录中对每份对应的期望产物运行配置检查。`fragment` 产物先放进一份最小的宿主配置 fixture 再检查，同时断言片段本身不含入站、DNS 等宿主负责的部分。Surge 与 Stash 没有可在 CI 中运行的检查器，它们的产物只由生成结果比对和使用方验收覆盖，这一点在发版说明中写明。

**CLI 与发布**：在临时目录中运行构建出的 `dist/cli.js`。发布测试通过 `publish` 的文件系统接口注入失败，覆盖加锁、写入新批次、切换指针、清理旧批次各阶段的失败，并检查 `out` 与磁盘状态。

**使用方验收**：在使用方仓库中安装当前构建出的 tarball，运行 `proxylang check` 与 `proxylang build --validation`，并运行使用方自己的测试。路由意图由使用方 Profile 中的案例保证，proxylang 不与旧版本的产物做兼容比较。API 变化时，使用方在同一次验收中完成迁移。验证构建不读取生产来源，产物里只有作者声明的验证值。

## 约束

- 测试只通过公开导出或 CLI 观察行为，不导入 `src/` 的内部模块，`test/model/` 与 `test/routing/` 除外，它们分别测试规范化与求值的内部契约。
- 测试不访问网络。原生检查下载内核属于 CI 任务的准备步骤，不在测试代码中进行。
- 同一行为只在最低能观察到它的那一层断言。生成文本由比对层负责，其它层不对生成文本做字符串匹配。
- Concord 关联：测试用 `@use-case` 指向它验证的 Use Case 步骤或 Feature 规则。关联只说明测试与契约的对应关系，不是覆盖率。
