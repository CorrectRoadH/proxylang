# 为设备检查并生成原生配置

作者新增了一台 iPad，想确认这份 Profile 在 Surge iOS 5.21.0 上能生成，并看清自动选择分组和规则集最终用了哪种实现。

## 起始状态

- 构建定义里已经加入这台设备的 Profile。

## 步骤

1. 运行 `proxylang check`。{#check}
2. 阅读输出中这份 Profile 的诊断和 `selections`。{#read-result}
3. 根据诊断修正 Profile，重复第 1 步直到通过。{#fix}
4. 运行 `proxylang build`，在输出目录的 `out/` 中打开这台设备的 `.conf`。{#build}

## 结果

| 情况 | 看到的结果 |
| --- | --- |
| Profile 合法 | 这份 Profile 显示通过，列出每个 `group.auto()` 与规则集的选择 |
| 路由用了 `match.processName` | `CONDITION_UNSUPPORTED`，带路由序号与源码位置 |
| 节点使用 vless | `PROTOCOL_UNSUPPORTED`，带节点 id |
| 版本写成 `5.20.0` | `TARGET_UNSUPPORTED` |
| 多个问题同时存在 | 一次运行列出全部问题 |

## 完成判据

check 通过，build 生成的 `.conf` 中，规则顺序与 Profile 路由一致，分组和节点显示的是各自的 `name`。
