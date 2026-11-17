# 构建 API

## `defineBuild`

```ts
defineBuild(input: {
  outDir?: string;
  profiles: Readonly<Record<string, Profile>>;
  secrets?: Secrets;   // defineSecrets 的返回值
}): BuildDefinition
```

- 拒绝未知字段与访问器，冻结并返回构建定义。`outDir` 必须是非空、无首尾空白、不含 NUL 的路径，相对路径按 CLI 的调用目录解析。
- `profiles` 至少 1 个、最多 16 个，键匹配 `^[a-z0-9][a-z0-9-]*$`，也就是产物的文件名。
- Profile 引用的秘密都必须属于 `secrets`，否则 check 报 `SECRET_UNDECLARED`。省略 `secrets` 时，任何秘密引用都报这个错误。
- 读取不到秘密值时，`build` 以 `SECRET_MISSING` 失败并给出秘密名，不给出值。
- 输入不合法时抛出 `ProfileDefinitionError("INVALID_BUILD_DEFINITION")`。

## `checkBuild`

```ts
checkBuild(definition: BuildDefinition): CheckResult
```

```ts
type CheckResult = {
  ok: boolean;
  code: "CHECKED" | "CHECK_FAILED" | "CASE_FAILED";
  outputDirectoryChecked: boolean;
  profiles: readonly {
    key: string;
    target: Target;
    ok: boolean;
    diagnostics: readonly Diagnostic[];
    selections: readonly Selection[];
  }[];
  cases: readonly (CaseResult & { profile: string })[];
};

type Selection =
  | { kind: "algorithm"; group: string; algorithm: "surge-smart" | "urltest"; parameters?: object }
  | { kind: "ruleSet"; ruleSet: string; branch: "surge" | "singBox" | "mihomo"; nativeName: string }
  | { kind: "name"; resource: string; nativeName: string };
```

`definition` 不是 `defineBuild` 的结果时抛出 `ProfileDefinitionError("INVALID_BUILD_DEFINITION")`。纯函数：不读秘密、不写文件。`outputDirectoryChecked` 表示是否已对照 `outDir` 检查 endpoint 状态目录；没有 `outDir` 时为 false。`Diagnostic` 的结构与诊断码见[目标与原生输出](../targets/README.md#诊断)，`CaseResult` 见[路由案例 API](../routing-cases/library.md#check-结果中的案例)。

## `runBuild`

```ts
runBuild(definition: BuildDefinition, options?: { validation?: boolean }): Promise<BuildResult>
```

```ts
type BuildResult = {
  published: boolean;
  exitCode: 0 | 1 | 2;
  code: string;
  check: CheckResult;
  active?: string;   // published 为 true 时，活动目录 out 的绝对路径
  hint?: string;     // 需要人工恢复时的说明
};
```

先执行与 `checkBuild` 相同的检查，失败时 `published: false`、`exitCode: 1`，不读秘密。检查通过后读取秘密、渲染全部 Profile，再按[批次发布](architecture.md)写入。没有 `outDir` 时返回 `OUTPUT_DIRECTORY_REQUIRED`。
