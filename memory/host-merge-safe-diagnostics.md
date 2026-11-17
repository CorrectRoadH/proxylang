---
relations:
  - role: supports
    target: docs/feature/build/cli.md
---
# 跨模块加载的安全错误投影

TypeScript 加载器可能创建多个 SDK 模块实例，跨实例 instanceof 不能可靠分类错误。CLI 可检查 own data descriptor，仅投影白名单代码和受限路径字段；不能读取 getter、回显异常 message 或把此分类视为错误来源认证。

可信内部的秘密失败原因应保存在私有身份表，外部异常上的同名属性不能冒充内部来源。错误分类和脱敏需独立测试，不能仅凭构造器错误类型证明 CLI 输出安全。

DNS 条目与原生 Host 合并时，跨入口重复 pattern 与原生 glob 的交叠是不同问题。前者可按忽略大小写的精确身份拒绝，后者保留客户端顺序；把两者混为同一种去重会改变原生行为。
