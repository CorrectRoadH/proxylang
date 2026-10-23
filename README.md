# proxylang

[![CI](https://github.com/CorrectRoadH/proxylang/actions/workflows/ci.yml/badge.svg)](https://github.com/CorrectRoadH/proxylang/actions/workflows/ci.yml)

**用 TypeScript 编写、组合和复用代理规则，构建 Surge、sing-box、Mihomo 与 Stash 配置。**

proxylang 是一个 TypeScript 配置 DSL 和编译工具。你用函数、数组和模块组织节点、规则与策略，指定客户端和版本，再生成对应的原生配置文件。

## 解决什么问题

代理配置越来越长后，难维护的往往是规则之间的关系：内网规则必须先于开发规则，工作与家庭设备共用一部分规则，同一个服务在不同设备上又需要走不同出口。复制配置和拼接 shell 脚本，会让这些关系散落在多个文件里。

proxylang 把这些关系直接写进代码：

- **组合规则**：把内网、工作、开发等规则拆成模块，按顺序组合；条件支持 `all`、`any`、`not`。
- **复用策略**：模板声明“需要一个代理出口”，使用时再绑定具体节点或组，同一份规则可以服务不同设备。
- **表达平台差异**：同一个出口在 Surge 使用 Smart，在 Mihomo 使用 URLTest，由作者显式选择。
- **提前发现问题**：按精确版本检查能力、引用与循环依赖；用请求案例检查首条命中规则，避免改动悄悄改变路由。

规则组合是核心，生成不同客户端的配置是它的出口。普通 TypeScript 的 `import`、函数和类型检查，负责把配置组织成可维护的项目。

## 快速开始

需要 **Node.js 24（最低 24.11.0）**。安装 npm 包：

```sh
npm install --save-exact proxylang@0.1.2
npx proxylang --help
```

将下面的 Usage 示例保存为 `proxy.config.ts`，即可执行 `npx proxylang check proxy.config.ts`。

若要运行仓库里的完整示例，另需 **Vite+ 1.3.0**：

```sh
git clone https://github.com/CorrectRoadH/proxylang.git
cd proxylang
vp install --frozen-lockfile
vp pack

# 检查现成的四客户端示例，不读取密码
vp exec node dist/cli.js check examples/clients.ts

# 用测试密码生成配置，不会启动代理
DEMO_PASSWORD=example-only vp exec node dist/cli.js build examples/clients.ts --out out/clients
```

[四客户端示例](examples/clients.ts)展示完整配置；下面从规则开始，逐步写出自己的版本。

## Usage

将下面三个 TypeScript 代码块按顺序保存为项目中的 `proxy.config.ts`。

### 1. 组合规则，给出口留一个位置

`rule(id, 条件, 动作)` 定义一条规则。`block` 把规则放在一起，还可以给整组规则添加共同条件；`policy` 把它们封装成可复用模板。

```ts
import {
  block,
  defineConfig,
  direct,
  group,
  match,
  policy,
  reject,
  route,
  rule,
  secret,
  sequence,
  slot,
  strategy,
  surge,
  use,
  type Engine,
  type Program,
} from "proxylang";

const local = block("local", [
  rule("intranet", match.domainSuffix("internal.example"), direct()),
  rule("lan", match.ipCidr("192.168.0.0/16"), direct()),
]);

const work = policy({
  id: "work",
  exits: ["proxy"],
  rules: [
    block(
      "services",
      [
        rule("github", match.domainSuffix("github.com"), slot("proxy")),
        rule("ssh", match.port(22), slot("proxy")),
      ],
      match.network("tcp"),
    ),
  ],
});

const routing = sequence(
  local,
  rule("ads", match.domainSuffix("ads.example"), reject()),
  use(work, { id: "office", bindings: { proxy: route("adaptive") } }),
);
```

这里的顺序就是匹配顺序：先处理内网，再拦截广告，最后应用工作规则。`services` 中每条规则都同时受 TCP 条件约束。

`slot("proxy")` 让模板不依赖具体节点名称。换一台设备时，可以把同一个 `work` 模板绑定到别的出口；规则正文不用复制。`sequence` 保留原始顺序，不排序、不去重，最终未匹配的流量交给程序的 `fallback`。

`slot` 是普通 TypeScript 函数，表示模板的出口参数；`route` 引用具体节点或组。编辑器会检查字面量槽位名称、缺失或多余的绑定，并沿嵌套块与模板保留提示。`defineConfig` 也会检查目标与案例引用的程序名称。动态输入仍由 `check` 验证。

### 2. 一个出口，显式选择平台策略

规则引用 `adaptive`，节点成员与出口名称可以共用，具体选路算法由每个平台独立声明。

```ts
const adaptive = strategy({
  id: "adaptive",
  members: ["edge"],
  implementations: {
    surge: surge.smart(),
    "sing-box": group.urltest({ url: "https://www.gstatic.com/generate_204" }),
    mihomo: group.urltest({ url: "https://www.gstatic.com/generate_204" }),
    stash: group.select(),
  },
});
```

Smart、URLTest 和手动选择的运行行为不同。这段代码明确表达作者的选择，编译器不会自行降级或替换算法。缺少目标实现，或目标版本不支持所选算法时，会报告错误。

### 3. 声明节点与构建目标

`program` 组合节点、策略组和规则；`target` 指定使用哪个程序，以及客户端、系统和精确版本。同一个程序也可以声明多个版本目标，分别检查和构建。

```ts
const program = (engine: Engine): Program => ({
  engine,
  nodes: [
    {
      id: "edge",
      type: "trojan",
      server: "192.0.2.10",
      port: 443,
      serverName: "edge.example",
      password: secret("PROXY_PASSWORD"),
    },
  ],
  groups: [adaptive],
  routing,
  fallback: direct(),
});

export default defineConfig({
  programs: {
    desktop: program("surge"),
    backup: program("sing-box"),
  },
  targets: [
    { id: "desktop", program: "desktop", engine: "surge", platform: "macos", version: "6.10.0" },
    { id: "backup", program: "backup", engine: "sing-box", platform: "linux", version: "1.12.0" },
  ],
  cases: [
    {
      id: "github-via-proxy",
      program: "backup",
      request: { network: "tcp", domain: "github.com", port: 443 },
      expect: { action: route("adaptive") },
    },
  ],
});
```

示例节点使用文档保留地址，实际使用时替换为自己的服务器 IP 和 TLS 域名。`secret` 引用环境变量，检查配置时不读取密码，构建时才解析。`cases` 用来检查请求是否走向预期的逻辑出口。

### 4. 检查、解释、构建

```sh
# 检查所有目标和请求案例
npx proxylang check proxy.config.ts

# 查看请求命中了哪条规则，以及规则来自哪个模板
npx proxylang explain proxy.config.ts --target backup \
  --request '{"network":"tcp","domain":"github.com","port":443}'

# 用测试密码构建；实际使用时由环境提供真实凭据
PROXY_PASSWORD=example-only npx proxylang build proxy.config.ts --out out
```

`explain` 展示条件匹配与逻辑出口，不模拟节点测速或网络连通性。`build` 生成原生配置，整批成功后更新 `out/active.json`，其中列出各目标文件路径；一个目标失败不会替换上一批结果。

配置错误提供字段路径和约束提示，例如端口越界会定位到对应规则的条件字段。加载失败会说明是模块缺失、权限不足、语法错误还是执行失败；诊断不会回显原始异常或配置中的秘密。

默认输出是包含节点、策略组和规则的 **fragment**，需要与客户端的入口、DNS 等配置组合。可选 `standalone` 提供本机显式代理配置；生成文件不等于部署或系统接管。

## 组合规则集与原生能力

规则集是可以命名、复用的匹配条件。`any`、`all`、`not` 可以组合本地条件、其它规则集，以及客户端原生能力；动作由使用处绑定。

```ts
import { match, ruleSet, rule, direct, surge } from "proxylang";

const streaming = surge.ruleSet({
  id: "streaming",
  url: "https://example.com/streaming.list",
});
const media = ruleSet({
  id: "media",
  when: match.any(streaming, match.domainSuffix("video.example")),
});
const mediaRule = rule("media", match.all(match.network("tcp"), media), direct());
```

`surge.ruleSet` 是 Surge 原生能力入口；sing-box 使用 `singbox.ruleSet`，Mihomo 使用 `mihomo.ruleProvider`。同一 TS 函数可以接收不同的原生条件，再组合业务规则。把 Surge 原生条件传给 sing-box 会报错，不会自动翻译规则文件。

生成配置仍保留外部资源引用，下载、更新、缓存由客户端完成。编译器不访问 URL；静态解释遇到无法确定的外部条件会报告 `STATIC_RULESET_UNKNOWN`，不会猜测默认出口。外部内容未验证会产生 warning，可由 `warningsAsErrors` 升级。

Surge 顶层引用可设置 `intervalSeconds`；嵌套逻辑使用客户端默认更新间隔，显式间隔暂报不支持。sing-box 与 Mihomo 的更新间隔是必填项，嵌套组合仍引用独立声明的资源。Stash 原生外部规则入口尚未实现。

完整的三平台组合与构建示例见 [examples/rule-sets.ts](examples/rule-sets.ts)。示例 URL 仅展示语法，实际使用时替换为自己的规则源。更完整的平台逃生舱边界见[设计说明](docs/engineering/composable-rule-sets/README.md)。

## 定义代理节点

用 `proxy.<协议>()` 定义节点。每种协议有自己的必填字段：SS 使用加密方法和密码，VMess／VLESS 使用 UUID；TypeScript 和运行时检查都会拒绝混用字段。

```ts
import { proxy, secret } from "proxylang";

const ss = proxy.shadowsocks({
  id: "ss",
  server: "192.0.2.10",
  port: 8388,
  method: "aes-128-gcm",
  password: secret("SS_PASSWORD"),
});

const vmess = proxy.vmess({
  id: "vmess",
  server: "192.0.2.20",
  port: 443,
  uuid: secret("VMESS_UUID"),
  tls: { serverName: "tls.example.com" },
  transport: { type: "ws", path: "/proxy", host: "ws.example.com" },
});

const vless = proxy.vless({
  id: "vless",
  server: "192.0.2.30",
  port: 443,
  uuid: secret("VLESS_UUID"),
  tls: { serverName: "vless.example.com" },
});
```

把这些值放进程序的 `nodes`，便可用 `route("ss")` 或策略组的 `members: ["ss", "vmess"]` 引用。还提供 `proxy.trojan`、`proxy.anytls`、`proxy.http`；已有对象声明仍可用。节点可带 `region`、`provider`、`tags`，供 `selectNodes` 组合筛选；`via` 引用另一个节点或组，声明拨号链。

TLS 的 `serverName` 是证书身份，WebSocket 的 `host` 是 HTTP Host，二者明确分开。省略 `tls` 表示不启用 TLS，省略 `transport` 表示普通 TCP。VMess 当前固定 AEAD／AES-128-GCM；VMess 与 VLESS 暂只允许 TCP 规则，不能作为覆盖 UDP 的 fallback。SS 支持三种 AEAD 方法及 TCP／UDP。

这些是当前已实现的有限组合：WebSocket 只接受普通路径，不接受查询参数或百分号转义；Reality、XTLS／flow、gRPC、SS2022 和插件尚未实现，传入会报错。VLESS 目前只编码到 sing-box 和 Mihomo。

### 链式声明与已有配置迁移

`proxy.builder(node)` 提供不可变的链式写法，最后 `.build()` 得到普通节点数据。`.via("relay")` 表示通过 relay 连接这个节点；重复调用会替换依赖，不会追加一跳。

```ts
import { proxy, secret, compileProxyNodes, renderProxyNodes } from "proxylang";

const exit = proxy
  .builder(
    proxy.http({
      id: "exit",
      server: "proxy.example.com",
      port: 8080,
      username: secret("PROXY_USER"),
      password: secret("PROXY_PASSWORD"),
    }),
  )
  .via("relay")
  .build();

const compiled = compileProxyNodes({
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  nodes: [exit],
  names: { exit: "🇭🇰 我的出口" },
  externals: [{ id: "relay", nativeName: "已有代理组", kind: "group" }],
});
if (!compiled.ok) throw new Error("节点编译失败");
const artifact = renderProxyNodes(compiled, (token) => process.env[token.name]);
// artifact.entries 提供每个节点的 id 和原生行，可按 provider 分文件。
```

节点片段目前仅支持 Surge macOS 6.10.0，允许域名服务器地址。它保留输入顺序，通过 `names` 映射原生名称；`label` 仍是元数据。外部组由已有配置提供，SDK 返回 `requirements` 并发出 warning；组装方必须逐设备检查实际包含的符号、种类及完整依赖图。片段不会生成占位组。

Surge 节点可显式声明 `tcpFastOpen`，Trojan/AnyTLS 可声明 `skipCertVerify` 和 `surge: { udpRelay: true }`。其它目标暂拒绝这些新选项。SS 可用 `surge: { udpRelay: false, blockQuic: "auto" }` 关闭 UDP 并保留原生 QUIC 策略；关闭 UDP 的约束会沿组与拨号链传播。详见[节点片段契约](docs/engineering/proxy-node-fragments/README.md)。

### Tailscale：有状态的网络端点

Tailscale 需要持久身份和引导解析，使用独立的 `endpoints` 声明。规则仍通过 `route(id)` 或 policy 的出口槽位引用它：

```ts
import { singbox, secret, match, rule, route, direct, type Program } from "proxylang";

const backup: Program = {
  engine: "sing-box",
  nodes: [],
  groups: [],
  endpoints: [
    singbox.tailscale({
      id: "home-net",
      hostname: "backup-proxy",
      stateDirectory: "/var/lib/proxylang/backup-tailnet",
      authKey: secret("TAILSCALE_AUTH_KEY"),
      acceptRoutes: true,
      bootstrapResolver: "9.9.9.9",
    }),
  ],
  listener: { port: 17890, resolver: "1.1.1.1" },
  routing: [rule("home", match.ipCidr("192.168.50.0/24"), route("home-net"))],
  fallback: direct(),
};
```

这个程序需要 **sing-box 1.12.0、`standalone` 目标及带 `with_tailscale` 的内核**。`bootstrapResolver` 仅供控制面引导解析，`listener.resolver` 负责普通 DNS。`authKey` 可省略，由运行方完成首次登录或提供已有身份。

构建只生成配置，不加入 tailnet、不创建身份目录、不启用 MagicDNS。状态目录应由单个运行实例独占，并独立于构建产物；端点暂不能放进策略组或作为 `via`。这是本机显式代理配置，尚不是 TUN 网关或已验收的整机备份。

[完整节点与 Tailscale 示例](examples/proxies.ts)包含五个构建目标和共用规则，可直接检查：

```sh
vp exec node dist/cli.js check examples/proxies.ts
DEMO_PASSWORD=example-only DEMO_UUID=11111111-2222-4333-8444-555555555555 \
  vp exec node dist/cli.js build examples/proxies.ts --out out/proxies
```

## 当前支持

| 目标     | 精确版本           | 平台         | 策略组                          |
| -------- | ------------------ | ------------ | ------------------------------- |
| Surge    | 6.10.0             | macOS        | select、Smart                   |
| sing-box | 1.11.0、1.12.0     | Linux、macOS | select、URLTest                 |
| Mihomo   | 1.19.32            | Linux、macOS | select、URLTest                 |
| Stash    | 4.2.1（build 487） | macOS        | select；仅 fragment，原生未验证 |

支持域名、IP、端口、网络类型与逻辑条件，节点协议包括 Trojan、HTTP、AnyTLS、Shadowsocks、VMess、VLESS，具体能力按目标版本检查。未知版本和影响路由行为的不支持项报错；可省略的展示信息报 warning，可用 `warningsAsErrors` 提升为错误。

Stash 当前拒绝来源 IP/端口、端口范围和组级 URLTest。完整配置的节点地址暂限 IP，独立 Surge 节点片段支持域名。HTTP、VMess、VLESS 及经过它们的代理链按 TCP-only 检查；AnyTLS 目前仅在 Surge 放行 UDP。远程节点订阅、MAC/进程匹配和 TUN 尚未实现。完整限制见 [SDK 细则](docs/implementation-v0.md)和 [Mihomo / Stash 转换边界](docs/engineering/clash-backends/README.md)。

配置文件是可信的 TypeScript 代码；构建产物包含密码，旧构建也会保留。凭据与产物管理见[构建契约](docs/feature/artifact-publication/use-case/publish-generation.md)。

## 更多示例与文档

- [代理协议与 Tailscale](examples/proxies.ts)：SS／VMess／VLESS 节点和独立家庭网络端点。
- [四客户端共用规则](examples/clients.ts)：同一个 policy，不同平台策略。
- [家庭与开发环境规则](examples/policies.ts)：规则模块、守卫与出口绑定。
- [多设备配置与请求案例](examples/home.ts)：节点筛选、代理链和路由回归案例。
- [设计与使用文档](docs/README.md)：规则组合、平台机制、CLI 与构建边界。
- [开发工作流](docs/engineering/development/README.md)：Concord 管理 Feature 与 Use Case，`vp` 负责构建和测试。
