# proxylang

用 TypeScript 维护多台设备的代理配置，生成 Surge、sing-box、Mihomo 和 Stash 原生文件。共享节点与规则只写一次；每台设备明确选择自己的出口、客户端和设置。

## 从一份 Profile 开始

使用 Node 24（>=24.11.0）或 Node 26。安装 `proxylang`，在项目根目录创建 `proxylang.config.ts`：

```ts
import {
  defineBuild,
  defineProfile,
  defineProxyGroup,
  defineRoutes,
  defineSecrets,
  group,
  match,
  outbound,
  proxy,
  type Exit,
} from "proxylang";

const secrets = defineSecrets({
  EDGE_PASSWORD: { env: "EDGE_PASSWORD", validation: "validation-edge" },
});

const edge = proxy.trojan({
  id: "edge",
  name: "Edge",
  server: "192.0.2.10",
  port: 443,
  password: secrets.EDGE_PASSWORD,
});
const ai = defineProxyGroup({
  id: "ai",
  name: "AI",
  algorithm: group.auto(),
  members: [edge],
});

const sharedRoutes = (exits: { ai: Exit }) => [
  defineRoutes({ when: match.domainSuffix("internal.example"), to: outbound.direct }),
  defineRoutes({ when: match.domainSuffix(["ai.example", "chat.example"]), to: exits.ai }),
];
const sharedCases = (exits: { ai: Exit }) => [
  { name: "AI traffic uses AI", request: { domain: "chat.example" }, expect: exits.ai },
];

const laptop = defineProfile({
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  proxies: [edge],
  groups: [ai],
  routes: sharedRoutes({ ai }),
  fallback: outbound.direct,
  cases: sharedCases({ ai }),
});

export default defineBuild({ outDir: "generated", profiles: { laptop }, secrets });
```

```sh
npm install proxylang
npx proxylang check
npx proxylang build --validation
```

`check` 检查全部 Profile 和案例，不读取秘密或写文件。验证构建使用假值，生成 `generated/out/laptop.conf`。实际使用前为 `EDGE_PASSWORD` 提供生产来源，再运行 `npx proxylang build`；将文件交给客户端的部署流程由你负责。

## 心智模型

- **一台设备一份 Profile**：声明精确目标、节点、分组、有序路由、默认出口和引擎设置；构建定义的键决定文件名。
- **复用靠函数和数组**：共享路由、案例以所需出口为参数。嵌套数组按书写顺序展开，不需要另一套模板语言。
- **引用写对象**：`to`、`members`、`via`、`fallback` 和案例的 `expect` 引用构造器返回的资源。被引用资源必须列入同一 Profile 的 `proxies` 或 `groups`；内置出口使用 `outbound.direct`、`outbound.reject`。
- **首条命中**：按作者顺序求值，第一条命中决定出口；全部不命中才使用 `fallback`。
- **引擎差异写明处**：`group.auto()` 在 Surge 选择 Smart，在 sing-box 和 Mihomo 选择 URLTest；Stash 不支持它。规则集按引擎声明来源，不自动转换内容或替换机制。

资源的 `id` 用于诊断和案例，`name` 是原生名字，省略时使用 id。所有引用跟随同一个原生名字；改名可能重置客户端保存的选择。同一资源对象可以跨 Profile 复用，形状相同的普通对象不能代替 SDK 资源。

## 四个引擎

| 引擎     | 平台与精确版本             | 输出与边界                                                                                          |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| Surge    | macOS 6.10.0、iOS 5.21.0   | 完整 `.conf`；`surge.general/hosts/managed`，以及 `surge.tailscale/wireguard`                       |
| sing-box | macOS/Linux 1.12.0、1.14.4 | 完整或片段 `.json`；`singBox` 设置，TUN 只在 1.14.4 完整模式可用；`singbox.tailscale` 创建 endpoint |
| Mihomo   | macOS/Linux 1.19.32        | 完整或片段 `.yaml`；完整模式需 `mihomo.listener`                                                    |
| Stash    | macOS 4.2.1                | 片段 `.yaml`；宿主提供入口与 DNS，仅支持 select，不支持远程规则集                                   |

sing-box 完整模式默认开启，须提供 `singBox.listener`；Mihomo 默认输出片段。精确能力与模式矩阵见[目标](docs/feature/targets/README.md)。不受支持的行为报 error，不静默省略。

Surge 的 `includeSniffed: true` 匹配原域名或嗅探域名；sing-box 1.14.4 的 `domainMatching: "prefer-sniffed"` 对全部域名条件优先使用嗅探域名。两者语义不同。

## 跨引擎规则集

后续 TypeScript 片段沿用上手示例中的导入和节点。把声明放在 `defineProfile` 之前，再将路由、案例和新增出口列入相应字段。

```ts
import { ruleSet } from "proxylang";

const localServices = ruleSet({
  id: "local-services",
  surge: { format: "rule-set", url: "https://rules.example.com/local.list" },
  singBox: { format: "binary", url: "https://rules.example.com/local.srs", intervalSeconds: 86400 },
  mihomo: {
    format: "text",
    behavior: "domain",
    url: "https://rules.example.com/local.txt",
    intervalSeconds: 86400,
  },
});
const routes = defineRoutes({ when: localServices, to: outbound.direct });
```

`ruleSet` 是条件，路由单独给出出口。目标没有对应分支就报错。sing-box 与 Mihomo 对同来源资源去重，使用路由中先引用的规则集 id；相同 URL 的来源参数冲突会报错。更新、缓存和下载失败由客户端处理，构建不下载规则集，也不保证不同上游内容相同。Surge 内置集使用 `surge.ruleSets.lan` 和 `surge.ruleSets.system`。

## 用 cases 保护路由意图

Profile 的 `cases` 给出请求和期望出口；`check` 与 `build` 每次执行，失败阻止发布。共享案例用函数绑定每台设备的出口。

远程规则内容不能静态推断，案例通过对象声明假设：

```ts
const cases = [
  {
    name: "Local rule set uses direct",
    request: { domain: "service.example" },
    assume: { hit: [localServices] },
    expect: outbound.direct,
  },
];
```

缺少规则集假设或解析信息时，求值可能为 `indeterminate`，案例失败并提示缺少什么。`ip` 是入口已知地址，`resolvedIp` 是解析后用于规则的地址。求值不执行 DNS、不模拟分组当前选择、拨号或远端健康。完整语义见[路由案例](docs/feature/routing-cases/README.md)。

## 秘密与链式代理

`defineSecrets` 的每项选择 `env` 或 `value` 来源，返回不带值的句柄。构建只接受同一集合的引用；秘密仅在检查和案例通过后读取，批次中每项只读一次。`--validation` 只读取显式 `validation`，缺少就失败，不回退生产来源。UUID 和 WireGuard 密钥的假值也须符合对应格式。

先创建中转，再把它传给节点工厂：

```ts
const relay = defineProxyGroup({
  id: "relay",
  name: "Relay",
  algorithm: group.select(),
  members: [edge],
});
const createExit = (via: typeof relay) =>
  proxy.http({
    id: "exit",
    name: "Exit",
    server: "192.0.2.20",
    port: 8080,
    password: secrets.EDGE_PASSWORD,
    via,
  });
const exit = createExit(relay);
```

路径是客户端 → Relay → Exit → 目的地。节点和中转都要登记；成员与 `via` 构成的图不能有环。也可用 `proxy.builder(base).name("Exit").via(relay).build()` 派生节点。Surge 编码 `underlying-proxy`，sing-box 编码 `detour`；Surge 不允许端口跳跃与 `via` 同用。协议和 UDP 能力依目标检查，配置通过不证明远端可达。

## CLI

CLI 从调用目录固定加载 `proxylang.config.ts`，配置是可信可执行代码。

```sh
npx proxylang targets
npx proxylang check --json
npx proxylang explain --profile laptop --request '{"domain":"chat.example"}'
npx proxylang build --validation
npx proxylang build
```

`explain` 也可用 `--request-file request.json`。CLI 的规则集假设写在请求 JSON 的 `ruleSets` 中，以规则集 id 为键、布尔值为命中结果。所有命令支持 `--json`，参数与结果见[CLI 契约](docs/feature/build/cli.md)。

构建整批渲染成功后才切换 `out` 相对符号链接，正常失败保留上一批。退出 0 为成功，1 为未发布，2 表示已发布但清理失败或需要人工恢复；以返回的 code 为准。旧 generation 保留，维护者负责秘密产物的留存与恢复。详见[构建与发布](docs/feature/build/README.md)。

生成结果、原生语法检查和真实网络验收是不同证据；本工具不启动客户端或接管系统网络。
