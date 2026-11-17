# 用案例保护路由意图

作者调整了规则顺序或引入新的远程规则集，希望确认关键服务仍然走预期的出口，并且以后每次发布都自动确认。

## 起始状态

- 构建定义可以通过 `proxylang check`。

## 步骤

1. 用 `proxylang explain --profile <key> --request '<json>'` 查看一个请求当前首条命中哪条路由。{#explain}
2. 结果为 `indeterminate` 时，按 `needs` 在请求里补充规则集假设、`ip` 或 `asn`，再运行一次。{#add-assumption}
3. 把请求、假设和期望出口写进 Profile 的 `cases`；多台设备共用的案例写成以出口为参数的函数。{#write-case}
4. 运行 `proxylang check`。{#check}

## 结果

| 情况 | 结果 |
| --- | --- |
| 首条命中的出口与 `expect` 相同 | 案例通过 |
| 规则改动让请求先命中了别的路由 | 案例失败，显示实际出口、命中的路由序号与源码位置；`build` 不发布 |
| 案例经过一个没有假设的规则集 | 案例失败，`needs` 指出规则集 id |
| `expect` 引用的分组没有列在这份 Profile 中 | `UNLISTED_EXIT` |

## 完成判据

关键意图都写成了案例，`proxylang check` 全部通过；故意把一条相关路由挪到后面，check 会失败并指向这条路由。
