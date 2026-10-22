---
format: concord.document/v1
id: npm-release
title: npm 版本发布
createdAt: 2026-10-22T07:00:37.537Z
kind: engineering
---

# npm 版本发布

发布目标是 npm 包 proxylang。版本 tag `vX.Y.Z` 必须与 package.json 和 package-lock.json 的版本一致，且提交属于 main。普通分支与 PR 只运行检查，不发布。首版采用稳定版本，不接收预发布 tag。

## 发布门禁

release.yml 调用同一份 CI，等待 SDK/CLI、Concord、Mihomo 和秘密扫描全部通过。发布 job 再从 tag 构建安装包，在仓库外临时目录安装该包，验证 SDK 导入、CLI、TypeScript 配置加载与构建。

验证后发布同一个 tgz，不重新打包。包文件清单只允许 package.json、README.md 和 dist 下的 JS、声明文件。临时消费者和包在验证后清理；失败不执行 publish。普通 CI 也运行安装包验证。

npm 发布使用 GitHub 托管 runner 和 OIDC，权限仅在发布 job 开启 id-token:write。npm CLI 固定12.2.1，运行时 Node24；不存储长期 npm token。首次发布前需确认 npm 包名归属和发布身份。

## npm 侧准备

本包的 Trusted Publisher 配置为：用户 CorrectRoadH、仓库 proxylang、workflow 文件 release.yml。此 workflow 不使用 GitHub environment。发布身份需允许直接 npm publish。

若包尚不存在，先由 npm 所有者完成首次发布及包名认领，再配置 Trusted Publisher；不要把本地登录状态假定为 CI 已授权。首次手工发布也应先运行完整检查和安装包验证。配置方式以 [npm 官方说明](https://docs.npmjs.com/trusted-publishers/) 为准。

## 操作

在 main 的版本提交中同步两个 manifest；检查通过后推送对应 tag。CI 成功仅证明流程检查通过，npm 上出现该版本才证明发布完成。相同版本不可覆盖；发布失败应先检查 npm 是否已接收，不能删除或覆盖已有版本。

消费者使用 `npm install --save-exact proxylang@X.Y.Z`，随后提交 lockfile。替换 it-infra 的 vendor 与节点迁移属于消费仓库的独立改动。

首次由所有者发布时，先完成下列检查，再用 npm 登录身份发布已验证的包：

```sh
vp run check
vp run test:package -- --keep
npm login
npm publish .cache/release/proxylang-0.1.0.tgz --access public --ignore-scripts
```

首次发布后配置 Trusted Publisher。以后先更新 package.json 和 lockfile，提交 main，再创建同版本 tag；例如下一个版本为0.1.1时：

```sh
npm version 0.1.1 --no-git-tag-version
# 提交并推送版本改动，确认 main 检查通过
# 再推送同版本 tag，触发 npm workflow
git tag v0.1.1
git push origin v0.1.1
```

## 公开延迟与恢复

发布后最多等待约10分钟，查询公开版本并核对 SHA512。npm 接受上传不代表公开可安装；等待超限时任务失败，不重发已有版本。

手动运行 release.yml 只执行完整检查、构建安装包及公开完整性验证，跳过发布。选择仍对应待验证版本的分支；例如 main 仍为该版本时使用 `gh workflow run release.yml --ref main`。包内容不同会校验失败，不能覆盖远端版本或修改 tag。
