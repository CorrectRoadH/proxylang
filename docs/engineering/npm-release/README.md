# npm 版本发布

维护者发布 proxylang 前，须另有明确发布授权。版本 tag `vX.Y.Z` 与 package.json、package-lock.json 根版本及根包版本一致，提交属于 main。普通分支与 PR 只运行检查；tag 必须是稳定版本。

## 发布准备

运行 check、verify 与 concord check，审阅公开源码、文档、示例和 tarball，确认不含私人信息或秘密。按[测试架构](../testing/README.md)完成使用方当前 tarball 的迁移、check、验证构建和测试。原生检查与实际网络验收分开报告。

资源原生名字采用 name 或 id；重命名可能使客户端持久分组选择重置，发版说明须写明。Surge 与 Stash 缺少自动化原生检查器，不能宣称已通过原生验收。

## CI 与同一安装包

release.yml 在版本 tag 或 workflow_dispatch 时调用同一份 ci.yml，等待 SDK/CLI、sing-box、Mihomo、秘密扫描通过。发布 job 再核对版本与 main 祖先关系，冻结安装，执行 `vp run test:package -- --keep`。

安装包只允许 package.json、README.md、dist 下的 JS 与声明文件；隔离目录安装验证 SDK 导入、公开类型及 TS/ESM/CJS 配置的 CLI 路径。验证成功后发布同一个 tgz，不重新打包；失败不 publish。

Concord 文档检查由本地维护者独立完成，release workflow 不安装 Concord，不需要其读取凭据。

## 发布身份与触发

npm Trusted Publisher 必须绑定本仓库的 release.yml 与允许发布的身份；首次包名认领由包所有者完成，不把本地登录当作 CI 授权。发布使用 GitHub 托管 runner、OIDC 与 npm 12.2.1，只有发布 job 开启 id-token:write，不存长期 npm token。

已获授权后，维护者推送 main 的同版本 tag 触发发布。手动 workflow 必须选择 main；默认 publish=false，只检查、打包与验证公开完整性；显式 publish=true 才执行发布。workflow 的存在和检查通过都不构成授权。

发布命令对保留的 `.cache/release/proxylang-*.tgz` 使用 public、provenance 与 ignore-scripts。公开验证最多等待约 10 分钟，核对版本和精确 tarball SHA-512。npm 接受上传不等于可安装；超时报告失败，不重发已存在版本、不覆盖 tag。

消费者固定公开版本并提交锁文件。本地 tarball 用于验收，不能把机器本地路径提交为正式依赖。Trusted Publisher 的配置方式见 [npm 官方文档](https://docs.npmjs.com/trusted-publishers/)。
