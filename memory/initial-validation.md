---
format: concord.document/v1
id: initial-validation
title: 初始实现验证记录
createdAt: 2026-10-21T10:12:52.219Z
kind: memory
memoryKind: note
state: captured
epoch: 0
promotions: []
history: []
---

# 首期实现与验收记录

日期：2026-10-21。本期实现以[执行契约](implementation-v0.md)为准，主目标是可复用、可组合、可解释的规则。

## 代码分工

- `src/dsl.ts`：用户构造器、组合函数和元数据筛选。
- `src/schema.ts`：严格数据边界、递归输入限制、无循环验证及不可变快照。
- `src/rules.ts`：模板出口绑定、守卫合成、实例路径、静态条件解释与网络可能性分析。
- `src/compiler.ts`：引用/循环检查、精确目标目录、能力判定、案例、来源映射；编译不读环境变量或写文件。
- `src/render.ts`：固定 Surge 与 sing-box 处理器，版本专属 DNS 编码，以及批次秘密解析。
- `src/host.ts`：输出锁、私有 generation、整批 active 指针提交与失败清理。
- `src/cli.ts`：可信 TypeScript 模块加载、check/explain/build/targets 正式入口。

这是固定内置 provider 流水线。`targetCatalog` 声明协议、组、DNS 编码与精确版本，处理器按这些条件转换；未实现长期设计中的开放插件、通用改写搜索、远程 fetch 或完整原生 schema 库。未知输入仍由严格语言 schema 阻止，原生输出另以精确版本校验。

## 已执行验证

SDK/CLI 测试覆盖模板嵌套、多实例不同出口、守卫、首命中、后缀边界、缺失字段与取反、IPv4/IPv6、TCP-only 路径、严格 schema、循环/重复引用、目标版本、warning 提升、秘密编码、两目标失败保留旧指针、锁竞争及真实 CLI TS/import 加载。验证命令与最终结果见文末。

以下原生校验器均在 macOS arm64 上只执行版本查询与配置 check，没有启动服务：

| 校验器 | 精确身份 | 检查内容 | 结果 |
| --- | --- | --- | --- |
| Surge | App 6.10.0，`surge-cli --check` | home 样例；所有条件、逻辑嵌套、IPv6、端口范围、三种协议、via/select、reject fallback | PASS |
| sing-box | 1.11.0，revision `d09d2fb665f1a4aa0cefb1ce0298539867ba487b` | home 样例；全部条件、Trojan/HTTP、via/select/urltest、legacy DNS、reject fallback | PASS |
| sing-box | 1.12.0，revision `2dcb86941f5db01bbe296acae555a3b1f38c0441` | 同上并含 AnyTLS、typed DNS/default resolver | PASS |

本地官方发布资产 SHA-256：1.11.0 为 `477efabc7c19e2e9c50ddc16fb663afdd3599dc6644d313f7b731d3de95c8189`，该发布 API 未提供 digest，只有本地哈希记录；1.12.0 为 `212915dd5be0ea1818203f7f5a2db8e16d15229f2a2f2a28a093c34cdce9fdfa`，与发布 API digest 核对一致。二进制在忽略目录 `.cache/native/`，不作为源码依赖提交。

## 没有把什么当作完成

离线 check 证明配置被该版本接受，不证明真实网络命中、DNS 路径、代理连接成功或跨客户端运行时等价。sing-box 的 Linux 目标生成了配置，但本轮未在 Linux 内核运行校验器或服务；不能把 macOS 校验当作 ZimaCube 验收。manifest 始终保留 `nativeValidation: not-run`，因为 CLI 自身没有执行原生校验，外部测试证据只记录于本文。

本期未修改 it-infra，未使用真实订阅凭据，未部署 ZimaCube，未切换 Mac mini 的代理或网络。完整迁移尚需远程规则集、DNS/嗅探、源设备语义和系统接管的独立实现。样例中的 source-IP 路由说明组合顺序，不代表 loopback 显式代理可观察原 LAN 设备地址。

设计经过独立 Herdr / 原生 Codex / gpt-6.1-sol Review。初审指出 DNS 引导出口及专属组默认值缺口；修订为固定直连 resolver、节点 IP 边界、urltest 稳定参数、smart 暂报 unsupported，复核 PASS。Review pane 已关闭。没有创建工作树或 Git 仓库。

## 最终命令结果

- `npm run check`：PASS。TypeScript 构建、SDK/测试/样例类型检查通过；39 项 SDK/CLI 测试通过，3 项需原生环境的测试明确跳过。
- `PROXYLANG_NATIVE_CHECK=1 node --import tsx --test test/native.test.ts`：PASS，3 项精确版本离线测试通过，无跳过。
- 正式 CLI 的 home 样例：check、explain、三目标 build 成功；样例覆盖 22 个程序级回归案例。仅使用 `example-only` 等假凭据。
- 原生检查分别覆盖默认路由与拒绝兜底，未启动服务；不宣称实际网络验收。
- 仓库状态：该目录不是 Git 仓库，没有执行初始化、提交或推送。残留 pane/tab/worktree：无。
