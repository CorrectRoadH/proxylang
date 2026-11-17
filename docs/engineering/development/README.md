# 开发工作流

维护者先读项目原则、术语、架构和行为所属的 Spec，再修改实现与测试。Concord 只检查文档及显式关联，项目工具直接执行测试；关系完整不等于测试通过。

## 文档与实现

运行 `concord --skill` 并按任务读取 document、code、test。Spec 写当前行为、约束和验收；可复用经验留在 memory，过程、运行结果和交付进度留在任务报告。页面按路径拥有身份，不维护人工索引。

源码用 `@concord-implements` 关联实际行为 owner，测试用 `@use-case` 或 `@feature` 关联断言范围。修改或删除页面时同步维护注释引用。完成前运行 `concord check`；用 `concord trace gaps --json` 查看显式关系，不将缺口当成覆盖率。

## 工具链

项目使用 Node 24（>=24.11.0 且 <25）或 Node 26（>=26.0.0 且 <27）、Vite+ 1.3.0 与 npm 锁文件。工具配置统一在 vite.config.ts；不并发运行会重写 dist 的构建任务。

| 命令 | 用途 |
| --- | --- |
| `vp install --frozen-lockfile` | 按 package-lock.json 安装，不改依赖选择 |
| `vp pack` | 构建 ESM SDK、CLI 与声明，保留 dist/index.js、dist/cli.js、dist/index.d.ts |
| `vp check` | 格式、lint 与类型检查 |
| `vp run typecheck` | 项目与类型契约检查 |
| `vp test run` | 单元、生成结果比对、CLI 与发布测试 |
| `vp run check` | 打包后执行格式、lint、类型与测试 |
| `vp run verify` | 依赖 check，再用同一次 dist 做隔离安装验收，不缓存结果 |
| `vp run test:package -- --keep` | 独立构建并保留通过验收的发布 tarball |
| `vp run test:golden:update` | 更新期望文件，逐项审阅 diff |
| `vp run test:native` | 使用预备好的固定内核做离线配置检查 |
| `vp run dev` | pack watch，不执行用户配置或启动代理 |
| `vp run docs:check`、`vp run docs:gaps` | Concord 文档与关系检查 |

依赖由授权任务使用 vp add/remove 管理；冻结安装使用 vp install。Node 环境可用 `vp env current`、`vp env doctor` 核对。受 Concord 管理的 Markdown 与配置不批量格式化。

## CI

CI 在 Ubuntu/macOS 与 Node 24.11.0、当前 Node 24、Node 26.0.0 和当前 Node 26 矩阵执行冻结安装、verify 和 CLI 示例检查/构建。隔离安装验收启用 npm engine-strict，确保实际发布包接受对应运行时，并执行 ESM/CJS 配置的 CLI check、build 和 explain。示例只使用保留地址、TEST_* 名字与假值。秘密扫描检查 Git 历史，输出必须脱敏。

原生检查独立下载 sing-box 1.12.0、1.14.4 与 Mihomo 1.19.32，核对 SHA-256 后在隔离目录检查，不启动代理。endpoint 检查要求 with_tailscale 且不创建身份目录；fragment 用最小宿主配置。Surge 和 Stash 不具备自动化检查器，不能用其它引擎通过代替。

Concord 由维护者本地执行，CI 不要求安装 Concord 或配置其凭据。完整测试职责、目录与未验证边界见[测试架构](../testing/README.md)。检查、打包与 CI 都不授权 npm 发布、部署或系统网络操作。
