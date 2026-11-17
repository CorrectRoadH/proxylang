# Mihomo Profile 选项

Mihomo 目标固定 1.19.32，支持 macOS 与 Linux。专属字段为 `mihomo: { mode?, listener? }`；mode 省略为 fragment。

| mode | listener | 生成结果 |
| --- | --- | --- |
| `fragment` | 不接受 | 节点、分组、路由与规则 provider；入口和 DNS 由宿主负责 |
| `standalone` | 必填 `{ port, resolver }` | 附加回环 mixed 入口及明确的内部 DNS 配置 |

port 为 1–65535 整数，`resolver` 为 IP DNS 上游。不开放 LAN，不设置外部控制器或系统代理。standalone 入口不是 TUN，系统接管由运行方负责。非空 Profile DNS 规则拒绝，不提供 TUN 或隧道字段。

select、urltest 与 auto 可用；auto 选择 URLTest 并记录 selection。不支持的协议、条件、链式选项及匹配选项报 error。进程 basename 条件在两个平台可用，来源 CIDR 和端口范围可用。`includeSniffed: true` 拒绝。

规则集选择 `mihomo` 分支，更新与去重见[条件](conditions.md#规则集)。原生字段、固定 DNS 设置、urltest 默认参数和名称保留规则见[Mihomo 输出](../../targets/format/mihomo.md)。
