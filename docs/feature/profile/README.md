# 编写 Profile

给用 TypeScript 维护多台设备代理配置的作者。每台设备写一份 [Profile](../../concepts.md#profile)，规则、节点和分组作为普通值在设备之间共享。引用一律写对象：共享路由写成以[出口](../../concepts.md#exit)为参数的函数，每台设备传入自己的分组、节点或隧道（[t-3](../../taste.md#t-3)）。

## 上手

```ts
import {
  defineProfile, defineProxyGroup, defineRoutes, defineSecrets,
  group, match, outbound, proxy, type Exit,
} from "proxylang";

export const secrets = defineSecrets({ TEST_PASSWORD: { env: "TEST_PASSWORD" } });

const edge = proxy.trojan({
  id: "edge",
  name: "Edge",
  server: "proxy.example.com",
  port: 443,
  password: secrets.TEST_PASSWORD,
});

// 共享规则：参数是它需要的出口，不关心具体是哪台设备。
export const sharedRoutes = (exits: { ai: Exit; proxy: Exit }) => [
  defineRoutes({ when: match.domainSuffix(["internal.example", "corp.example"]), to: outbound.direct }),
  defineRoutes({ when: match.domainSuffix(["ai.example", "chat.example"], { includeSniffed: true }), to: exits.ai }),
];

// 设备：创建自己的分组，再用它们调用共享规则。
const proxyGroup = defineProxyGroup({ id: "proxy", name: "PROXY", algorithm: group.select(), members: [edge] });
const ai = defineProxyGroup({ id: "ai", name: "AI", algorithm: group.auto(), members: [edge] });

export const laptop = defineProfile({
  target: { engine: "surge", platform: "macos", version: "6.10.0" },
  proxies: [edge],
  groups: [proxyGroup, ai],
  routes: sharedRoutes({ ai, proxy: proxyGroup }),
  fallback: proxyGroup,
  cases: [{ name: "AI 服务走 AI 出口", request: { domain: "chat.example" }, expect: ai }],
});
```

把 `laptop` 放进[构建定义](../build/README.md)后，运行 `proxylang check`，可以看到这份 Profile 通过检查、案例通过，并列出 `ai` 分组在 Surge 6.10.0 上选择的算法 `surge-smart`。如果 `sharedRoutes` 调用时漏传 `ai`，TypeScript 会直接在编辑器里报错。

## 规则

- **片段**：`proxies`、`groups`、`routes`、`dns`、`cases` 以及 `surge.general`、`surge.hosts` 都接受任意嵌套的数组，按书写顺序展开。共享与组合靠 TypeScript 的 `import`、函数和数组完成（[t-2](../../taste.md#t-2)）。
- **对象引用**：路由的 `to`、分组的 `members`、节点的 `via`、`fallback` 和案例的 `expect`，只接受资源对象或内置出口 `outbound.*`。被引用的资源必须列在这份 Profile 的 `proxies` 或 `groups` 中，否则报 `UNLISTED_EXIT`。列表决定资源在原生配置中的顺序。
- **id 与名字**：每个资源有 `id`，在 Profile 内唯一，用于诊断、案例结果和原生配置中的内部引用；`name` 设置在客户端里显示的名字，省略时显示 id（[t-9](../../taste.md#t-9)）。
- **顺序**：路由按展开后的顺序生成，首条命中决定出口（[t-4](../../taste.md#t-4)）。
- **引擎专属内容**：只对一个引擎有效的设置放在 Profile 的 `surge`、`singBox` 或 `mihomo` 字段，只对一个引擎有效的条件和隧道使用 `surge.*` 或 `singbox.*` 构造器。需要按引擎给出不同实现的对象，比如自动选择算法和规则集，在同一个声明里写出各引擎的分支（[t-5](../../taste.md#t-5)）。
- **秘密**：秘密由 `defineSecrets` 一次声明，字段里引用它返回的对象。定义、检查和求值阶段都只看到引用。

构造器的签名、返回值与错误见 [library](library/README.md)。各引擎如何编码这些声明、哪些目标支持什么，见[目标与原生输出](../targets/README.md)。

## 用户故事

- [多台设备共享规则，各自绑定出口](use-case/share-rules-across-devices.md)
- [同一出口与规则集在不同引擎上使用不同实现](use-case/engine-specific-implementations.md)
- [接入机场节点、中转与设备隧道](use-case/define-proxies.md)

## 验收

公开构造器的正反例由单元测试与类型契约测试覆盖；规范化结果的稳定性由生成结果比对覆盖，见[测试架构](../../engineering/testing/README.md)。使用方验收用真实的多设备配置仓库执行，见同一页。
