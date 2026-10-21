# 首期实现：先让规则好组合，再编译到客户端

本文补充 [Feature 目录](feature/README.md) 的 SDK 参数与转换约束。历史审查通过 `concord memory recall initial-contract --json` 查询。

## 用户实际在写什么

使用 TypeScript SDK，普通 import、数组和函数负责组织文件。规则是有稳定 id、when 条件和 then 动作的值。条件独立于动作，可以复用；规则块保留作者顺序，不自动按域名或类型排序。所有判别字段使用 type。

SDK 提供 rule、block、policy、use、sequence，以及 match.domain/domainSuffix/ipCidr/sourceIp/port/sourcePort/network/all/any/not。sequence 仅展开数组；block 包含有名字的规则序列和可选 when，when 与每个后代条件做 AND；不改变后代顺序。空 block、空 all/any、非法端口、非法域名/CIDR、重复实例或展开后的规则 id 都是错误。

policy 声明 id、exits 和规则序列，作为可复用模板。模板中只能通过 slot 动作引用声明的出口，另可 direct/reject，不能直接引用具体节点。use 给模板一个实例 id 和完整 bindings，值为 route/direct/reject，嵌套 use 的绑定还可引用外层 slot。多余、缺失和未声明 slot 均报错。模板内部 block/use 可嵌套，递归引用和过深输入拒绝。不同实例有独立名字空间；来源路径保留模板与实例名。

顶层平台程序有 engine、nodes、groups、routing、fallback。fallback 只允许在程序顶层，规则块中不能自带默认动作。route 终结本次规则选择；拨号失败不得重新匹配下一规则。explain 只解释静态条件及逻辑出口，不模拟探活、DNS、代理连接或组的运行时选择。

## 条件与元数据

domain 精确匹配，domainSuffix 匹配根域及点分隔子域；采用小写 ASCII 域名，拒绝通配符、Unicode 和尾点输入，作者需先显式规范化。ipCidr 支持 IPv4/IPv6，只使用请求已有目的 IP，不触发 DNS；sourceIp 是源 CIDR；端口支持闭区间。缺失字段使对应原子条件为 false；not 是普通布尔取反，因此会使此 false 变 true。文档与 explain 明示这个语义；需要字段存在的策略应提供明确前提，不将未观测字段伪装为已观测值。

共享策略的前提是输入具有与声明一致的路由元数据。不自动嗅探，不将 Surge extended-matching 混入普通域名匹配。首期不支持 extended-matching、MAC、进程、远程规则集、DNS 策略或原生非终结动作，输入未知字段一律错误。未来逐项扩展，不能原样透传。

## 节点和平台程序

节点支持静态 Trojan、AnyTLS、HTTP，拥有稳定 id、单独展示 label、server/port、secret 引用、可选 TLS serverName、地区 region、供应商 provider、标签 tags、可选 via 拨号依赖。selectNodes 按元数据返回 id 列表，空组错误；所有可选路径与 via 构成有向图，检查缺失引用、循环及协议能力。展示 label 首期不写入原生节点名，发出可省略展示 warning；原生使用稳定 ID，避免重命名破坏引用。

groups 支持 select 和 urltest；sing-box 与 Mihomo 后端实现组级 urltest 参数，Stash 当前只支持 select。strategy 用同一个 id 与 members 声明各引擎算法，详见[策略实现契约](feature/target-compilation/use-case/strategy-implementations.md)。

旧 type: smart 保留为可识别但 unsupported 的能力；新 strategy 的 Surge 分支通过 surge.smart() 明确声明节点评分机制，sing-box 分支可显式选择 group.urltest。两者不是自动转换，也不保证运行时行为等价。

组只含节点或组引用，direct/reject 用规则动作表达；首期不模拟可切换的直连/拒绝组。

默认 select 为第一成员，原生序列顺序固定；运行时选择状态不跨目标同步。

urltest 只接受 id/members/url/intervalSeconds/toleranceMs，url 必填 HTTP(S) 且禁止认证信息，intervalSeconds 默认 180，toleranceMs 默认 50。sing-box 的 idle_timeout 固定 30m，interrupt_exist_connections 固定 false；全部显式编码。Mihomo 使用原生 url/interval/tolerance 参数，不承诺相同切换时机。

其他选项拒绝。

HTTP 节点及经它拨号的路径仅 TCP；AnyTLS 首期也保守仅允许 TCP 路由；Trojan 支持 TCP/UDP。

编译器按规则条件保守计算可能网络集，网络条件不能证明仅 TCP 时，通往 TCP-only 路径的 route 拒绝。

fallback 也覆盖 TCP/UDP，不允许偷偷降为直连。

首期默认 fragment：生成节点、组和规则，外部组合方负责入口及 DNS。

fragment 报告必须列出元数据和运行前提，不能称为完整网关。

可选 standalone 显式代理配置：必须指定 loopback listener 端口以及一个字面 IP 的 UDP `resolver`。

Surge 输出 HTTP listener 与 dns-server；sing-box 输出 mixed inbound、版本适用 DNS server、默认 domain `resolver`。Mihomo 输出 loopback mixed-port 与内部 DNS；Stash 暂不支持 standalone。

仅用于本机显式代理，不开放 LAN 或自动接管路由；ZimaCube TUN、tailscaled、IPv6、防火墙及故障切换是后续独立部署契约。

standalone 的 `resolver` 查询固定通过独立 direct 出口发送，不经过业务 fallback。

sing-box 1.11 的 legacy DNS 显式 detour 到保留 direct tag，1.12 类型化 DNS 同样显式 detour；后者将默认域名解析器绑定此 DNS tag。

为避免首期承担跨协议的引导解析歧义，所有节点 server 首期只接受 IP 字面量，TLS serverName 独立保留域名；via 链各跳也必须是 IP。

域名节点输入明确报 schema 错误，不静默提前解析。

业务目标域名可由代理远端解析，DIRECT 业务目标用声明 `resolver`；sing-box 1.11 direct 的 domain_strategy 显式 prefer_ipv4，1.12 的 `resolver` strategy 同样 prefer_ipv4。

Surge 使用固定 dns-server，不启用跟随代理模式的 DNS。

fragment 报告列明组/代理的元数据前提、节点 IP 限制及组合方须提供的直接 DNS 解析路径；不生成或暗示任何上游自动嗅探。

## 支持矩阵和转换

Mihomo 与 Stash 的规则能力、测速机制及入口差异见[后端契约](engineering/clash-backends/README.md)，以精确目标能力为准。

内置 provider 目录精确列出 sing-box 1.11.0、1.12.0（Linux/macOS）、Surge 6.10.0（macOS）、Mihomo 1.19.32（Linux/macOS）和 Stash 4.2.1（macOS）。只承诺此目录，不宣称其他版本支持；原生检查状态独立记录。AnyTLS 在目录内 sing-box 1.12.0、Surge、Mihomo 与 Stash 目标可编码，较早目标明确 unsupported；未知版本 error。sing-box DNS 旧版本 address 格式和新版 type/server 格式由独立处理器选择，核心规则保持显式 action 表达。

编译过程：严格运行时 schema → 不可变快照 → 展开规则块与绑定 → 引用/循环/网络能力检查 → 每目标能力决定与规则源映射 → 原生 AST/结构化模板 → 渲染。原子条件和组合逻辑各有固定处理器，首期使用固定有限流水线，不实现开放插件或通用改写搜索。每个规则必须有唯一输出映射；决不做规则排序、去重或不透明压缩。

compile 为纯函数，返回诊断、计划与待渲染目标；任一目标错误不提供可发布整批。explain 对同一展开规则按顺序匹配，返回逐条条件树、首条命中及 fallback，明确标记静态模拟。cases 在 config 中描述请求与预期 rule/action，必须指定程序；断言失败阻止 CLI 发布。案例证明公共语义，不代替内核执行证据。

## Host、CLI 和秘密

Node.js ESM + TypeScript，npm 包与本地 CLI。命令 check 检查所有目标与案例；explain 指定 target 与 JSON 请求；build 编译所有选定目标，输出 generation 及 active.json；targets 列出目录。导出的 config 由 defineConfig 提供类型，CLI 用 tsx 加载可信 TS，不宣称沙箱。加载失败不回显原异常及源码，以免错误消息泄密。

secret 只允许 env token，不在源码或计划存明文；同一批次每 token 仅解析一次。JSON 与 YAML 用结构化值序列化，Surge 参数采取保守编码：不能安全表示的逗号、控制符等秘密拒绝渲染，不截断、不插入新行。日志与计划均只报告固定原因和源路径，不打印值或原生配置。check/explain 不解析秘密。

发布前先完成全部渲染、案例和 warning 提升检查。

host 用输出根目录 mkdir 独占锁，创建 0700 generation 目录和 0600 文件，原子 rename 更新 active.json。

失败移除本次未发布 generation，不改活动指针；锁清理在 finally。

并发 build 拒绝等待；崩溃遗留锁明确报错，不自动抢锁。

首期没有 export、自动旧 generation GC 或自动原生检查命令；旧秘密产物保留策略在 README 明示。

退出码 0 已发布、1 未发布、2 已发布但提交后清理失败。

库 render 不写盘。CLI 不输出秘密产物到 stdout。

## 首期验收

单元/集成测试覆盖：嵌套 block 和守卫、同模板多绑定及嵌套绑定、首命中/顺序、域名边界、缺失字段与 not、IPv4/IPv6、循环/重复/未知字段、错误版本、平台专属组、TCP-only 约束、展示 warning 严格模式。发布与入口测试包含秘密注入、双目标失败不更新指针、竞争锁、CLI 真实 TS 加载与非零案例失败。

提供不含真实凭据的 it-infra 风格例子，复现飞书优先屏蔽、LAN/Home 优先 DEV、Steam 商店与下载分流、端口约束、AI 地区节点筛选、住宅链式节点单独 TCP 策略。不自动导入生产秘密或修改 it-infra；完整生产迁移包括远程规则集、嗅探、DNS 和运行边界，另行推进。

对可获得的 sing-box 两个精确版本执行离线 check；Surge 用本地 6.10.0 离线检查。检查不启动代理服务，历史版本校验不能借用新版结果。正式交付逐项记录已通过和未执行项目。

## 依据

- [Surge 逻辑规则](https://manual.nssurge.com/rules/logical.html)
- [Surge 域名匹配](https://manual.nssurge.com/rules/domain.html)
- [sing-box 路由动作](https://sing-box.sagernet.org/configuration/route/rule_action/)
- [sing-box 版本迁移](https://sing-box.sagernet.org/migration/)
- [sing-box AnyTLS](https://sing-box.sagernet.org/configuration/outbound/anytls/)
