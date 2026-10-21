---
format: concord.document/v1
id: development
title: 文档与验收工作流
createdAt: 2026-10-21T10:13:35.267Z
kind: engineering
---

# 文档与验收工作流

## 产品契约归 Concord

Feature 说明稳定行为，Use Case 说明用户目标、操作与失败边界、可观察验收条件。先读 Constitution、Feature 和相关叶级 Use Case；新增行为先修改对应契约。不要把实现步骤或测试数量写成产品能力。

源码通过 @concord-implements 关联 Feature 或 Use Case，测试声明前用 @use-case 关联实际断言。关系不是覆盖率，也不能证明代理内核或网络行为。审查历史与运行收据通过 Concord Memory 命令管理，不在 Feature 记录开发流水账。

公开文档以仓库相对路径和示例数据为准。源码、测试、文档、锁文件都纳入发布前秘密扫描；缓存、环境文件、生成配置与私钥不进入 Git。

## 工具链归 Vite+

项目固定 Vite+ 1.3.0，统一使用 vp 入口。npm 是由 vp 调用的锁文件后端，不是另一套开发工作流。

- vp install --frozen-lockfile：按 package-lock.json 安装。
- vp check：格式、lint、类型检查。
- vp pack：构建 ESM SDK、CLI 和类型声明，保留 dist/index.js、dist/cli.js、dist/index.d.ts 入口。
- vp test run：执行 Vitest 测试。
- vp run check：先打包以提供样例自引用的导出类型，再执行检查、样例类型检查与测试；Concord command runner 使用同一命令。
- vp run docs:check 和 vp run docs:gaps：检查 Concord 文档及显式关系。

vite.config.ts 统一 lint、format、test、pack 配置。受 Concord 管理的 Markdown 与配置不交给格式化器批量改写，避免绕过作者摘要及元数据管理。Rule.then 是声明数据，不是 Promise 回调，lint 为此关闭 no-thenable 规则。

## CI 与验证边界

GitHub Actions 在 Linux 的 Node 24（最低 24.11.0，仅支持 24 主版本） 执行冻结安装、vp run check、CLI 示例检查与示例构建；样例只使用保留地址与固定测试字符串。另一任务使用固定发布版本的 Concord 包，先验证 SHA-256 再安装，执行 check、trace gaps 与 doctor。秘密扫描检查提交历史，不上传扫描中的秘密值。

Mihomo 任务使用固定 1.19.32 Linux 二进制，下载后核对 SHA-256，仅在隔离目录执行配置检查。Stash 没有自动化原生验证，不以 Mihomo 检查代替。

Concord command evidence 是整条命令结果，不是假定每个用例独立运行。CI 默认明确跳过三个需要精确版本本机二进制的原生测试；vp run test:native 仅在本机准备好 Surge 与 sing-box 时执行离线配置解析。CI 成功不证明 Linux 网关、DNS、节点连通、TUN 或故障接管。构建不发布 npm 包、不部署代理服务。
