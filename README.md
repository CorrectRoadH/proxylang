# proxylang

[![CI](https://github.com/CorrectRoadH/proxylang/actions/workflows/ci.yml/badge.svg)](https://github.com/CorrectRoadH/proxylang/actions/workflows/ci.yml)

用 TypeScript 组合路由策略，再编译到明确的客户端版本。

最有用的部分是把规则从配置文本里拆出来：**条件可以复用，规则块保留顺序，策略模板只声明出口，使用时再绑定节点或组。** 同一段策略可以给 Mac mini 和 ZimaCube 使用，不需要复制后再用 shell 替换名称。

```ts
import { block, match, policy, rule, slot, use, route } from "proxylang";

const work = policy({
  id: "work",
  exits: ["preferred"],
  rules: [
    block(
      "ssh",
      [rule("github", match.all(match.domain("github.com"), match.port(22)), slot("preferred"))],
      match.network("tcp"),
    ),
  ],
});

const routing = [use(work, { id: "office", bindings: { preferred: route("office-exit") } })];
```

出口也可以组合：规则引用同一个 `adaptive`，策略明确选择各平台的算法。

```ts
import { strategy, group, surge } from "proxylang";

const adaptive = strategy({
  id: "adaptive",
  members: ["jp", "sg"],
  implementations: {
    surge: surge.smart(),
    "sing-box": group.urltest({ url: "https://www.gstatic.com/generate_204" }),
  },
});
```

候选成员和出口名称共用；Smart 与 URLTest 的评分和切换机制各自保留。缺少实现或目标版本不支持时构建失败，实际选择写入 manifest。详见[通用机制与策略实现](docs/engineering/strategy-implementation/README.md)。

`block` 的守卫与所有后代条件同时成立才会匹配；`use` 给每个实例独立的规则路径。`sequence` 可以把数组和规则块串在一起，不排序、不去重。普通 TS 函数、数组和 import 负责组织文件，无须另造模板语法。程序顶层单独声明 `fallback`，避免某个共享片段提前吞掉后续规则。

完整例子：[共享规则](examples/policies.ts)、[节点、平台程序、三个构建目标和回归案例](examples/home.ts)。例子使用保留地址与测试凭据，不能作为真实代理服务器使用。

## 本地使用

需要 Node.js 24（24.11.0 ≤ 版本 < 25），以及 [Vite+ 1.3.0](https://viteplus.dev/guide/)。项目仍处于早期开发，尚未发布 npm 包。

```sh
git clone https://github.com/CorrectRoadH/proxylang.git
cd proxylang
```

```sh
vp install --frozen-lockfile
vp pack
vp run example:check
vp exec node dist/cli.js explain examples/home.ts --target zimacube --request '{"network":"tcp","domain":"store.steampowered.com"}'
DEMO_USER=example-user DEMO_PASSWORD=example-only vp run example:build
```

`check` 检查所有目标、引用、协议能力和 `cases`，不读取密码。`explain` 返回首条命中、逻辑出口、逐条条件结果及模板来源；它是静态解释，不模拟 DNS、探活、连接成功或策略组的运行时选择。

`build` 从环境变量解析 `secret('ENV_NAME')`，生成 `out/generations/<id>/`，整批成功后更新 `out/active.json`。消费者应先读取一次 active 指针，再使用其中的文件路径。一个目标失败不会更新指针；`manifest.json` 包含来源映射、前提、诊断和案例结果，不含明文密码。

TS 配置是可信的可执行代码，CLI 不是沙箱。默认导出配置，支持 ESM 项目与普通目录中的 TS 文件；请勿导入不可信配置。

## 已实现的边界

| 内容 | 当前实现                                                                            |
| ---- | ----------------------------------------------------------------------------------- |
| 条件 | 精确域名、域名后缀、IPv4/IPv6 CIDR、源地址、目的/源端口及区间、TCP/UDP、all/any/not |
| 组合 | 命名 block、守卫、参数化 policy、嵌套出口转绑定、顺序与实例来源                     |
| 动作 | direct、reject、route；首命中即终结                                                 |
| 节点 | Trojan、HTTP、AnyTLS；环境变量密码；via 链及循环检查；按地区/供应商/tags 筛选       |
| 组   | select；具名 strategy；Surge Smart 与 sing-box URLTest 显式分支                     |
| 构建 | 独立平台程序、精确目标目录、诊断、案例、原子整批输出                                |

目标目录由 `vp exec node dist/cli.js targets` 查看：

| 引擎     | 版本    | 平台               | 说明                                                  |
| -------- | ------- | ------------------ | ----------------------------------------------------- |
| Surge    | 6.10.0  | macOS              | select、显式 Smart；Trojan/HTTP/AnyTLS                |
| sing-box | 1.11.0  | Linux、macOS       | select/urltest；Trojan/HTTP；legacy DNS               |
| sing-box | 1.12.0  | Linux、macOS       | 增加 AnyTLS；typed DNS                                |
| Mihomo   | 1.19.32 | Linux、macOS       | select/urltest；Trojan/HTTP/AnyTLS；YAML              |
| Stash    | 4.2.1   | macOS（build 487） | select；Trojan/HTTP/AnyTLS；YAML fragment，原生未验证 |

未知版本拒绝，不把一个版本的成功推断为整个版本区间都支持。Mihomo 与 Stash 是独立目标，不使用笼统的 Clash 兼容声明。远程订阅与规则集、MAC/进程规则、完整 DNS 策略及 TUN 尚未实现。

Stash 4.2.1 暂不支持来源 IP/端口、端口范围和 standalone；节点共享测速结果无法保持现有组级 URL 契约，因此 `urltest` 报错。已有 select、域名/IP、单端口、网络与逻辑规则可组合使用。详见[转换边界](docs/engineering/clash-backends/README.md)。

[四客户端示例](examples/clients.ts)复用同一个 policy，并显式选择 Surge Smart、sing-box/Mihomo URLTest、Stash select：

```sh
vp exec node dist/cli.js check examples/clients.ts
DEMO_PASSWORD=example-only vp exec node dist/cli.js build examples/clients.ts --out out/clients
```

节点 `server` 暂限 IP 字面量，TLS `serverName` 可单独给域名；这样不会隐式发明节点域名的引导解析路径。HTTP 和 AnyTLS 首期按 TCP-only 检查，必须用 TCP 条件限定；任何可选成员或 via 路径不支持 UDP，整个出口都不能用于无约束规则或 fallback。

`compileStrategyGroups` 可单独生成标记为 `strategy-groups` 的迁移片段，只验证组拓扑与编码，不验证完整代理配置。

默认构建 `fragment`，组合方提供入口与直接 DNS 解析路径。可选 `standalone` 只生成 loopback 显式代理及固定直连 UDP DNS，不负责 LAN、TUN、IPv6、系统服务或故障切换。ZimaCube 的部署和实际接管仍需单独完成。

## 诊断与秘密

不支持且会改变流量行为的能力报 **error**，不删除规则、不更换出口机制。可安全省略的展示 `label` 报 **warning**；设置 `warningsAsErrors: true` 可阻止带 warning 的发布。诊断带 code、路径和 target。

域名使用小写 ASCII，不接受通配符或尾点。缺失字段让原子条件为 false，`not` 按普通布尔逻辑取反；因此 `not(domain(...))` 会匹配没有域名的请求。IP 条件不主动解析域名。详见[执行契约](docs/implementation-v0.md)。

原生配置文件含密码，目录权限为 0700、文件为 0600。Surge 无法安全表达的密码字符会使整个 build 失败，不做截断或替换。旧 generation 会保留，含旧密码，用户需自行决定保留和清理；不能只删 active 指针就认为密码已清除。输出锁不自动抢占，崩溃后的锁需确认没有构建进程后人工处理。退出码：0 成功；1 未发布；2 已发布但清理失败。

## 验证与设计

```sh
vp run check
# 本机已经准备精确版本原生校验器时；不启动服务
vp run test:native
```

原生测试从 `.cache/native/sing-box-1.11.0`、`.cache/native/sing-box-1.12.0`、`.cache/native/mihomo-1.19.32` 和安装的 Surge 读取校验器，先核对版本再执行离线检查，不会自动下载或启动代理。普通测试会明确跳过这四个环境相关测试。

[验收记录](docs/implementation-validation.md)区分 SDK/CLI 测试、macOS 原生配置检查和未进行的 Linux/网络实测。[设计入口](docs/README.md)说明规则组合、平台机制和 provider；长期设计不等于本期全部实现。

## 项目契约

[Concord 文档入口](docs/README.md)包含产品行为、用户故事、代码与测试关系。新增行为先更新对应契约，使用 `vp run docs:check` 与 `vp run docs:gaps` 检查。

Feature 和 Use Case 由 Concord 管理；Vite+ 负责工具链。CI 在 Node 24 执行检查、打包、测试及 CLI 示例，并单独运行 Concord 检查和秘密扫描，详见[开发工作流](docs/engineering/development/README.md)。
