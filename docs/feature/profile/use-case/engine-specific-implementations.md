# 同一出口与规则集在不同引擎上使用不同实现

作者的设备里有 Surge，也有 sing-box 或 Mihomo。自动选择的出口在 Surge 上应该用 Smart，在 sing-box 与 Mihomo 上用 URLTest；远程规则集在两个客户端上的地址和格式也不同。作者希望规则只写一遍，差异只在声明处出现一次。

## 起始状态

- 共享分组函数已经存在，至少一台 Surge 设备和一台 sing-box 设备引用它。

## 步骤

1. 自动选择的分组写 `algorithm: group.auto()`；某个分组必须固定用 Surge Smart 时，写 `surge.smart()`，并只在 Surge 设备上使用它。{#declare-algorithm}
2. 远程规则集用 `ruleSet({ id, surge: {...}, singBox: {...} })` 声明一次，路由引用这个对象。{#declare-rule-set}
3. 运行 `proxylang check`。{#check}

## 结果

| 情况 | check 结果 |
| --- | --- |
| `group.auto()` 用在 Surge 6.10.0 | 通过，`selections` 记录 `surge-smart` |
| `group.auto()` 用在 sing-box 1.14.4 | 通过，`selections` 记录 `urltest` 与默认参数 |
| `surge.smart()` 用在 sing-box 目标 | `ALGORITHM_ENGINE_MISMATCH` |
| `surge.smart()` 的成员里有分组 | `SMART_MEMBER_NOT_NODE` |
| 规则集只写了 `surge` 分支，被 sing-box Profile 引用 | `RULESET_SOURCE_MISSING`，指出规则集 id 与路由位置 |
| 规则集两个分支都写了 | 通过，`selections` 记录每个引擎使用的来源 |
| `group.auto()` 用在 Stash | `GROUP_ALGORITHM_UNSUPPORTED`，改用 `group.select()` |

## 完成判据

Surge 与 sing-box 设备的路由数量和顺序相同，差异只来自声明里写明的引擎分支。作者不需要另外维护对照表，也不需要写测试检查两份配置是否一致。
