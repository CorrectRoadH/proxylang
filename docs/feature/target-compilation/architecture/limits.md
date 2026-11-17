# 约束

## L1: No silent weakening

用户要求固定 URLTest、固定探测参数或固定轮询机制时不能换成不同机制。不支持的平台、版本、参数或成员种类必须报错；精确目标目录仍有效。

## L2: Compile only

编译不读取秘密、不下载规则或订阅、不测速、不登录隧道、不接管系统网络。原生配置检查不等于流量验收。

## L3: Compatibility

现有 implementations-only 输入、错误条件、成员顺序和产物行为不变。新语法必须是显式选择，不能将旧 surge.smart 自动改成跨平台近似行为。
