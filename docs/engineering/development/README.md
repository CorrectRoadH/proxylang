# 文档与验收工作流

## 产品契约归 Concord

Feature 说明稳定行为，Use Case 说明用户目标、操作与失败边界、可观察验收条件。先读项目原则、Feature 和相关叶级 Use Case；新增行为先修改对应契约。不要把实现步骤或测试数量写成产品能力。

源码通过 @concord-implements 关联 Feature 或 Use Case，测试声明前用 @use-case 关联实际断言。关系不是覆盖率，也不能证明代理内核或网络行为。可复用经验归 Memory，待处理问题归 Issue；执行日志与验收记录留在任务交付中，不在 Feature 记录开发流水账。

公开文档以仓库相对路径和示例数据为准。源码、测试、文档、锁文件都纳入发布前秘密扫描；缓存、环境文件、生成配置与私钥不进入 Git。

## 工具链归 Vite+

项目固定 Vite+ 1.3.0，统一使用 vp 入口。npm 是由 vp 调用的锁文件后端，不是另一套开发工作流。

- vp install --frozen-lockfile：按 package-lock.json 安装。
- vp check：格式、lint、类型检查。
- vp pack：构建 ESM SDK、CLI 和类型声明，保留 dist/index.js、dist/cli.js、dist/index.d.ts 入口。
- vp test run：执行 Vitest 测试。
- vp run check：先打包以提供样例自引用的导出类型，再执行检查、样例类型检查与测试；由维护者或 agent 直接执行，Concord 不执行测试。
- vp run docs:check 和 vp run docs:gaps：检查 Concord 文档及显式关系。

vite.config.ts 统一 lint、format、test、pack 配置。受 Concord 管理的 Markdown 与配置不交给格式化器批量改写，保留文档的语义结构。Rule.then 是声明数据，不是 Promise 回调，lint 为此关闭 no-thenable 规则。

## CI 与验证边界

GitHub Actions 在 Ubuntu 与 macOS 的 Node 24.11.0 和当前 Node 24 矩阵执行冻结安装、vp run check、CLI 示例检查与示例构建；样例只使用保留地址与固定测试字符串。Concord 文档检查由维护者在本地执行；CI 不安装 Concord。秘密扫描检查提交历史，不上传扫描中的秘密值。

Mihomo 任务使用固定 1.19.32 Linux 二进制，下载后核对 SHA-256，仅在隔离目录执行配置检查。Stash 没有自动化原生验证，不以 Mihomo 检查代替。

验证结果按实际执行的命令和范围报告；Concord 的静态关系不代表测试通过。普通 SDK 测试跳过原生检查，独立 CI 任务执行固定 sing-box 1.11.0、1.12.0 与 Mihomo 1.19.32 检查；下载均验证 SHA-256，1.12.0 另检查 with_tailscale 构建标签和身份目录未创建。

Surge 只在准备好精确版本本机应用时运行，Stash 原生验证仍缺失。vp run test:native 需要全部相关内核；也可用 vp test run test/native.test.ts -t 指定内核与版本。隔离安装包验证同时检查 ESM/CJS 配置、CLI check/explain/build，以及源代码与发布声明的类型正反例。详见 [作者体验与持续验收](../authoring-quality/README.md)。

CI 成功不证明 Linux 网关、DNS、节点连通、TUN 或故障接管。构建不发布 npm 包、不部署代理服务。

## 统一 Vite+ 任务

vp run verify 通过 vite.config.ts 的 dependsOn 先执行 check，再运行隔离安装包验收。同一流程仅构建一次，包验收使用该次 dist，不与其它打包任务并发写 dist。任务不缓存验收结果。vp run test:package 仍可单独构建和验收，也保留发布流程的 --keep 参数。

vp run dev 使用 vp pack --watch 监听 SDK/CLI 构建；它不是 Vite 网页服务器，不执行用户代理配置。依赖增删使用 vp add / vp remove，冻结安装使用 vp install --frozen-lockfile。npm 是 package-lock.json 对应后端，保留实际 npm tarball 安装测试。

Node 环境可以通过 vp env current / vp env doctor 检查。最低要求仍为 24.11.0，CI 在最低版本及当前 Node 24 分别执行；不添加覆盖 CI 矩阵的本地固定版本。

## Concord 接入

使用 Concord 0.17.9 的 Markdown 文档模型：`docs/taste.md` 保存项目原则，`docs/concepts.md` 保存术语，`docs/writing.md` 保存写作规则。`concord.config.ts` 仅声明源码与测试目录。页面身份由路径决定，不声明版本、状态、时间或 ID 元数据。

先运行 `concord --skill` 获取已安装版本的指引。`vp run docs:check` 必须通过；`vp run docs:gaps` 用于查看显式关系缺口，不表示测试覆盖率。`concord doctor --json` 检查来源目录与静态关系。
