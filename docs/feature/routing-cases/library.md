# 路由案例 API

## `RouteRequest`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `network` | `"tcp" \| "udp"` | 省略时为 `"tcp"` |
| `domain` | `string` | 连接时已知的目标域名，小写 ASCII |
| `sniffedDomain` | `string` | 客户端嗅探得到的有效域名 |
| `ip` | `string` | 连接建立时已知的目标 IP |
| `resolvedIp` | `string` | 客户端解析 `domain` 后用于 IP 规则的地址 |
| `asn` | `number` | 当前已知 IP 所属的 ASN |
| `port` | `number` | 目标端口 |
| `sourceIp` | `string` | 来源 IP |
| `sourcePort` | `number` | 来源端口 |
| `processName` | `string` | 发起连接的进程名 |
| `macAddress` | `string` | 来源设备的 MAC 地址 |

各字段的读取方式见[求值规则](README.md#求值规则)。未知字段与不合法的值使请求无效，错误码为 `INVALID_REQUEST`，并给出字段路径。同时给出 `ip` 与 `resolvedIp` 也是 `INVALID_REQUEST`。

## `Assumptions`

规则集的内容不在 proxylang 里，求值经过规则集时需要假设它是否命中。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hit` | `readonly RuleSet[]` | 假设命中的规则集，写 `ruleSet` 返回的对象或 `surge.ruleSets.*` 常量 |
| `miss` | `readonly RuleSet[]` | 假设不命中的规则集 |

同一个规则集同时出现在 `hit` 与 `miss` 中时，`INVALID_ASSUMPTIONS`。规则集按对象身份识别；其它约束见[假设](README.md#假设)。CLI 的请求 JSON 用 `"ruleSets": { "<id>": true | false }` 表达同样的假设，Surge 内置规则集的 id 是 `surge:lan` 与 `surge:system`。

## `RouteCase`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 案例名，在一份 Profile 内唯一 |
| `request` | `RouteRequest` | |
| `assume` | `Assumptions` | 可选 |
| `expect` | `Exit` | 期望的出口对象，必须列在这份 Profile 中，或者是 `outbound.*` 常量 |

Profile 的 `cases` 接受 `RouteCase` 的嵌套数组。案例名重复是 `CASE_NAME_DUPLICATE`；`expect` 引用的对象没有列在 Profile 中是 `UNLISTED_EXIT`。

## `explainProfile`

```ts
explainProfile(profile: Profile, request: RouteRequest, assume?: Assumptions): ExplainResult
```

```ts
type ExplainResult =
  | { ok: true; explanation: Explanation }
  | { ok: false; diagnostics: readonly Diagnostic[] };

type Explanation = {
  outcome: "matched" | "fallback" | "indeterminate";
  exit?: string;          // matched 与 fallback 时存在；内置出口为 "DIRECT"、"REJECT" 等
  route?: { index: number; origin?: Origin };  // matched 时存在
  needs?:                 // indeterminate 时存在，说明缺少的信息
    | { kind: "ruleSet"; id: string }
    | { kind: "dns" }
    | { kind: "asn" };
  trace: readonly { index: number; matched: boolean | null; origin?: Origin }[];
};
```

- `trace` 按顺序列出求值过的路由，直到首条命中或第一个结果未知的路由为止。`index` 是作者路由序号。
- Profile 在规范化阶段有 error 时，返回 `ok: false` 与诊断，不求值。
- 请求无效时抛出 `ProfileDefinitionError("INVALID_REQUEST")`。
- 不读取秘密，不访问网络。

## check 结果中的案例

`checkBuild` 与 `runBuild` 的结果包含 `cases` 数组，每份 Profile 的每个案例一项：

```ts
{ name: string; profile: string; ok: boolean;
  outcome: Explanation["outcome"] | "skipped";
  expected: string; actual?: string; needs?: Explanation["needs"]; route?: Explanation["route"] }
```

- Profile 在规范化或目标检查中有 error 时，它的案例不求值，`outcome` 为 `"skipped"`，`ok` 为 false。
- 任何 Profile 有 error 时，`checkBuild` 的 `code` 为 `CHECK_FAILED`；没有 Profile error 但有案例失败时为 `CASE_FAILED`。两种情况下 `runBuild` 都不读秘密、不写文件。
