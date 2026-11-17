# 中立验收场景

| Case ID | User Problem | Fixed Input | Acceptance Result |
| --- | --- | --- | --- |
| C1 | 自动择优出口跨平台 | 相同两节点，自动择优，无平台参数 | Surge 选 Smart，sing-box/Mihomo 选 URLTest；记录要求与实际实现 |
| C2 | 要求固定探测地址 | URLTest 加显式 URL、间隔与容差 | 支持者精确编码；不能编码者报错，不换成 Smart |
| C3 | 保留已有配置 | 仅 implementations 的现有输入 | 选择、错误与输出保持原样 |
| C4 | 参数不可忽略 | auto 带未知字段；或指定不属于 auto 家族的实现 | schema 或能力检查报错，整批无产物 |
| C5 | 成员存在限制 | 自动算法包含嵌套组，目标 Surge | 保留 Smart 成员限制，明确失败 |
| C6 | explain 不模拟运行状态 | 规则命中自动策略，但没有实时探测数据 | 返回策略 ID，不推测最终节点 |
| C7 | 未支持的实现 | Stash 4.2.1 的 auto | 首个切片明确报 GROUP_UNSUPPORTED，不自动改成 select |
| C8 | 平台局部扩展 | 只给 Surge 的 Smart 专属字段 | 首个切片未定义调优参数，报 INVALID_SCHEMA；后续字段须另立版本与编码契约 |
