---
format: concord.document/v1
id: authoring-quality
title: DSL 作者体验与持续验收
createdAt: 2026-10-23T05:27:59.684Z
kind: engineering
---

# DSL 作者体验与持续验收

## 目标与边界

保留规则顺序、模板出口绑定、精确客户端版本、秘密解析与整批发布语义。类型检查提前拒绝原本会被编译器拒绝的声明；动态 Config 与 JavaScript 输入仍由运行时验证。最低消费及开发运行时统一为 Node.js 24.11.0，仅支持 Node 24 主版本，满足 Vite+ 1.3.0 的要求。

## 类型约束

Slot、Rule、Block、Use 与 Entry 以槽位名字为泛型参数，默认 string 兼容动态声明。slot 保留字面量；rule、block、sequence 与 use 保留组合中的槽位类型。policy 只从 exits 推导允许的槽位，rules 不得扩大该集合；嵌套 use 的绑定值属于外层槽位。use 要求完整且仅包含已声明的 bindings，包括预先保存到变量的绑定对象。defineConfig 从 programs 的已知键约束 targets 与 cases 的 program 引用；宽化为 Config 的动态输入继续由 compile 验证。无新运行时对象种类与序列化格式。

## 安全诊断

保持 INVALID_SCHEMA 与 CONFIG_LOAD_FAILED 错误码。schema 使用判别字段定位已知分支，并报告字段路径与静态约束提示；不输出输入值、未知字段名、原始 Zod 消息或用户异常。CLI 加载错误仅输出受控原因和固定建议，区分缺失模块、权限、语法转换及其它执行失败；不输出源码、堆栈或原始异常。异常属性以数据描述符读取，不执行用户 getter。

## CI 与验收

Linux CI 保留 SDK、CLI、Concord、秘密扫描和 Mihomo 检查。新增 sing-box 1.11.0 与 1.12.0 精确版本原生检查，下载验证固定 SHA-256；1.12.0 的 Tailscale 案例要求 with_tailscale 且不创建身份目录。原生检查仅解析配置，不作为网络验收。

CI 分别在 Node 24.11.0 与当前 Node 24 安装、构建并执行全套检查，在隔离目录安装实际 tarball，执行 SDK、导出类型、CLI check/explain/build 及 ESM/CJS 配置加载。类型负例同时覆盖源代码与已发布声明，避免打包丢失泛型。既有目标版本不删除或升级。

验收包含 vp run check、vp run test:package、最低 Node 24.11.0 的包验收、精确原生检查、Concord check/trace gaps 及 workflow 语法检查。没有可用内核的平台单独报告，不用其它内核代替。

## 宿主系统与配置路径

SDK/CLI CI 覆盖 Ubuntu 和 macOS，均验证 Node 24.11.0 与当前 Node 24。原生客户端检查继续独立运行，宿主系统矩阵不改变目标目录。Windows 暂无等价的文件权限、锁与原子发布验收，不能据纯配置可生成宣称完整支持。

实际 CLI 测试从不同工作目录读取带空格、中文的配置路径，加载相邻模块，并向带空格、中文的输出路径连续发布。explain 请求文件避免 shell JSON 转义；帮助与非法参数不执行配置顶层代码。安装包验证也覆盖请求文件，避免仅源码入口通过。
