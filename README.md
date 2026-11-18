# proxylang

家里好几台设备，有的用 Surge，有的用 sing-box，每台的代理配置都要单独维护。节点和规则改一处，要去好几个文件里同步，漏改了也没人提醒。

proxylang 让你用 TypeScript 把这些配置写在一个地方：节点、分组和规则只写一次，每台设备各自挑出口、客户端和设置，最后生成 Surge、sing-box、Mihomo、Stash 能直接用的配置文件。写错了在生成之前就会报错，不会悄悄丢掉一部分配置。

## 支持哪些客户端

| 软件     | 支持程度 |
| -------- | -------- |
| sing-box | 最完整   |
| Surge    | 较完整   |
| Mihomo   | 常用功能 |
| Stash    | 基础     |

具体支持哪些平台、版本和功能，见[目标与原生输出](docs/feature/targets/README.md)。

## 五分钟上手

需要 Node 24（>=24.11.0）或 Node 26。安装 `proxylang`，在项目根目录新建 `proxylang.config.ts`：

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

`check` 检查所有设备的配置和测试用例，不读密码，也不写文件。`build --validation` 用假密码生成 `generated/out/laptop.conf`，方便你先看看结果。真正使用时，给 `EDGE_PASSWORD` 设好环境变量，再运行 `npx proxylang build`。生成的文件怎么送到设备上（托管配置、订阅、手动拷贝）由你决定。

## 几个基本概念

- **一台设备一份 Profile。** 里面写清楚这台设备用哪个客户端的哪个版本、有哪些节点和分组、按什么顺序分流、都不匹配时走哪里。`defineBuild` 里的键名就是生成的文件名。
- **复用就用函数和数组。** 几台设备共用的规则写成函数，把这台设备的出口当参数传进去。数组可以嵌套，按书写顺序展开，不需要另学一套模板语法。
- **引用直接写对象。** `to`、`members`、`via`、`fallback` 和用例里的 `expect` 都直接引用前面创建的对象。被引用的节点或分组必须放进同一个 Profile 的 `proxies` 或 `groups`；直连和拒绝用 `outbound.direct`、`outbound.reject`。
- **从上往下，第一条命中的规则生效。** 都不命中才走 `fallback`。
- **客户端之间的差异会明说。** 比如 `group.auto()` 在 Surge 上是 Smart，在 sing-box 和 Mihomo 上是 URLTest，Stash 不支持。规则集要为每个客户端分别写来源，proxylang 不会替你转换规则内容。

每个节点和分组有 `id` 和 `name`：`id` 用在报错和测试用例里，`name` 是客户端里显示的名字，不写就用 `id`。改 `name` 可能让客户端忘掉你上次在分组里手动选的节点。

## 一份规则集，给不同客户端用

下面的片段沿用上手示例里的导入和节点。

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

规则集只是匹配条件，出口在路由里另外写。某个客户端没写来源时会报错。同一个地址被引用多次，只生成一份定义；同一个地址写了不同参数也会报错。

proxylang 生成配置时不会下载规则集。规则集的下载、更新和缓存都由客户端自己负责。Surge 内置的规则集用 `surge.ruleSets.lan` 和 `surge.ruleSets.system`。

## 用测试用例守住分流规则

每个 Profile 可以写 `cases`：给一个请求，写明它应该走哪个出口。`check` 和 `build` 每次都会跑这些用例，有一个不过就不会生成文件。几台设备共用的用例同样写成函数。

远程规则集里有什么，proxylang 看不到，所以用例里要写明“假设这个请求命中了某个规则集”：

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

信息不够、判断不出走哪条规则时，用例会失败，并告诉你还缺什么。`ip` 是请求本身带的地址，`resolvedIp` 是域名解析后的地址。用例只模拟规则匹配：不做 DNS 查询，不管分组当前选的是哪个节点，也不检查节点能不能连通。详见[路由用例](docs/feature/routing-cases/README.md)。

## 密码和链式代理

`defineSecrets` 里每个密码可以来自环境变量（`env`），也可以直接写值（`value`）。配置里拿到的只是一个引用，检查和用例都通过之后才会读取真正的值。`--validation` 只用你写的 `validation` 假值，没写就报错，不会退回去读真密码。UUID 和 WireGuard 密钥的假值也要符合格式。

链式代理：先建好中转分组，再把它传给节点。

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

流量的路径是 客户端 → Relay → Exit → 目标网站。中转和出口都要放进 Profile，而且不能互相引用成环。也可以用 `proxy.builder(base).name("Exit").via(relay).build()` 从已有节点派生。Surge 里生成 `underlying-proxy`，sing-box 里生成 `detour`；Surge 不允许端口跳跃和 `via` 一起用。

## 命令行

命令行固定读取当前目录下的 `proxylang.config.ts`。这个文件是会被执行的代码，只运行你信得过的配置。

```sh
npx proxylang targets
npx proxylang check --json
npx proxylang explain --profile laptop --request '{"domain":"chat.example"}'
npx proxylang build --validation
npx proxylang build
```

`explain` 告诉你一个请求会命中哪条规则、走哪个出口；请求也可以放在文件里，用 `--request-file request.json`。要假设命中规则集，在请求 JSON 的 `ruleSets` 里以规则集 id 为键、`true`/`false` 为值。所有命令都支持 `--json`，参数和输出格式见[命令行说明](docs/feature/build/cli.md)。

`build` 要等所有设备的配置都生成成功，才把 `out` 指向新的一批文件；中途失败的话，`out` 仍然指向上一批。退出码 0 表示成功，1 表示没有发布，2 表示已经发布但清理旧文件失败或需要手动处理，具体看返回的 `code`。旧批次会保留下来，里面有密码，留多久、怎么清理由你决定。详见[构建与发布](docs/feature/build/README.md)。

最后提醒一句：配置能生成、能通过客户端的语法检查，不等于在你的网络里真的能用。proxylang 不会替你启动客户端或接管系统网络，上线前还是要在设备上实际试一下。
