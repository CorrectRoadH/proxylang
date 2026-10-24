# 秘密值声明

## 入口和范围

0.7.0 导出 secrets({ values?, env?, validation? }, environment?)，返回读取秘密的函数。values 是名字到非空字符串的只读记录，env 是允许同名读取环境变量的名字数组，validation 是验证模式替代值记录。environment 是可选测试注入的只读环境对象，默认捕获 process.env 对象引用，构造时不枚举或读取它。

BuildDefinition 使用 secrets?: (token: Secret, context: BuildContext) => string | undefined 替代 resolveSecret。不保留旧字段别名。自定义函数仍支持外部存储；SDK 秘密读取函数 的第二个 context 参数可省略，默认 production，允许直接传给 render。runBuild 显式传入冻结的 validation 上下文。checkBuild 不执行任何秘密函数。

本轮不改变底层 Secret token、Program CLI 默认环境读取、render 函数签名和既有生产构建默认环境读取。未给 BuildDefinition.secrets 的验证构建报 VALIDATION_SECRETS_REQUIRED，替代旧错误码。公开接口不引入 `Resolver` 命名。

## 声明校验

构造器先用 inspectDefinition 检查输入图，拒绝 getter、循环、非数据与图预算超限，再验证已知字段。名字符合现有 Secret 名字语法，最长128字符。values/env/validation 各最多2000项，字符串非空且最多65536字符，全部固定值与验证值累计最多1048576字符。

values 和 env 名字不得重叠，env 不允许重复。validation 的名字必须在 values 或 env 中声明，不引入新读取来源。未知顶层字段和非法声明只抛 INVALID_SECRETS_DEFINITION，不泄漏键、值或原异常。经过校验后快照声明数据，后续输入修改不改变配置。不克隆注入的 environment，也不将它放入图扫描。

## 读取和生命周期

只读取实际被产物引用的 token。验证模式优先返回显式 validation 值，未声明替代值时沿用生产来源。生产模式绝不使用 validation 值。values 命中返回固定值，env 命中才从捕获的环境对象查同名自有属性 descriptor；不得读取继承属性或触发 accessor，非法 accessor 抛受控 SECRET_RESOLUTION_FAILED。未知名字返回 undefined，不扫描任意 process.env。

环境变量缺失或空值由内部 secretReader 产生 SECRET_MISSING；runBuild 的嵌套读取边界沿用既有 SECRET_RESOLUTION_FAILED 对外结果，直接 render 仍返回 SECRET_MISSING。构造器自身不跨构建缓存环境值；每批构建沿用 secretReader，第一次实际引用读取一次，同名 token 同批只读一次，不同构建重新读取。错误、诊断、check/CLI JSON 不包含明文或完整声明。

## 消费与验收

proxy/secrets.ts 保留现有固定值表，导出 profileSecrets = secrets({ values, env: [SURGE_TOKEN], validation: { SURGE_TOKEN: 原验证占位值 } })。删除原 resolveSecret/profileSecretResolver 分支；根配置直接 secrets: profileSecrets。使用现有秘密快照，禁止在日志或交接中输出值。

回归覆盖输入快照、getter/cycle/未知键/长度预算拒绝、重复/重叠/未知验证名字、环境自有属性、validation 优先且不读取环境、生产不读取验证值、未引用变量零读、构造/check 零环境读取、同批缓存和跨批更新。真实 runBuild 与 CLI 验证命令行为及失败保留产物。四设备构建字节不变，临时 tgz 消费及公开包验收分别执行。

## 评审范围

需要独立审查的是新的环境读取白名单和验证替代边界，以及公共 callback 字段破坏性迁移。构建事务、秘密批次缓存与发布所有权均保持既有实现。此页与 domain-sources.md 共同评审后实现，0.7.0 作为同一 npm SDK/CLI 包交付。

## 审查收敛

独立 GPT-6.1 Sol 静态审查未发现秘密边界阻塞。P3 文档迁移纳入 publish-generation、project-config、CLI 和消费方 SDK 构建入口，统一 secrets 字段并链接本页。实际构建与发布仍须按上述验收执行。
