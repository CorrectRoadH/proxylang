---
format: concord.document/v1
id: surge-profile
title: 构建完整 Surge 配置
createdAt: 2026-10-23T05:33:09.767Z
kind: use-case
feature: docs/feature/target-compilation/README.md
---

# 构建完整 Surge 配置

## 用户目标

调用方以 TypeScript 声明完整 Surge profile，直接获得可装载的配置，不再维护 provider JSON、原生配置片段、include 指令或字符串占位符。编译与渲染保持分离；检查不读取秘密，渲染不访问网络。

## 公共入口

`compileSurgeProfile(input: unknown)` 接受 SurgeProfileInput，返回不可变的 SurgeProfileCompilation（ok、artifactKind=surge-profile、diagnostics、bindings）。

计划私有保存，不能伪造或修改成功结果。

`renderSurgeProfile(compilation, resolveSecret)` 返回 {artifactKind:'surge-profile',content}。

`renderSurgeProfiles(compilations, resolveSecret)` 先确认整批计划有效，再以整批共享的秘密快照渲染，返回输入顺序相同的产物数组；同名秘密每批仅解析一次。



目标仅为 Surge macOS 6.10.0 与 iOS 5.21.0；该入口的目标目录独立于既有通用 Program 和节点片段入口，不扩展其它编译器的支持声明。两平台支持 HTTP/Trojan/AnyTLS/Shadowsocks/VMess 编码，未知协议或参数拒绝。iOS 拒绝 macOS 专属 General、processName 和 macAddress。构建成功不代表目标设备已安装此版本。

## 声明结构

输入包含 target、managed?、general?、hosts?、nodes、tunnels?、groups、rules、fallback、names?。nodes 使用现有 proxy.* 类型，域名不做构建期 DNS；via 引用逻辑 ID。所有节点、隧道、组 ID 和原生名必须唯一。names 只能映射已声明 ID；保留内建名称不能用于声明。

SurgePolicy 是 {ref:string} 或 {builtin:'DIRECT'|'REJECT'|'REJECT-DROP'|'REJECT-NO-DROP'|'REJECT-TINYGIF'}。groups 使用 {id,type:'select'|'smart',members:SurgePolicy[],url?,intervalSeconds?,timeoutSeconds?}。Smart 成员只能为节点/隧道，且不接受 select 测试选项。验证所有资源的完整 via/成员联合图，未知引用、自环、跨节点和组的环、孤立环均拒绝；不把拓扑有效宣称为 UDP 可达证明。

SurgeRule={when:SurgeCondition,then:SurgePolicy}。

SurgeCondition 支持 domain/domainSuffix/ipCidr/ipCidr6/sourceIp/processName/macAddress（value:string）、port/sourcePort（from:number,to?:number）、network（value:'tcp'|'udp'）、all/any（conditions）、not（condition）、ruleSet（format:'rule-set'|'domain-set'，url 或 builtin:LAN|SYSTEM 互斥）。

sourceIp 接受单 IP 和 CIDR。

条件可带 noResolve?:boolean、extendedMatching?:boolean，默认 false；noResolve 仅 IP/ruleSet，extendedMatching 仅域名/ruleSet，其余类型即使显式false也拒绝。

顶层选项编码在动作之后，子条件选项编码在括号内。

最大逻辑嵌套10层。

内建规则集只允许rule-set，同 URL 不能用两种格式。

远程规则集不下载并报告未验证warning。

fallback 单独生成最后的FINAL；不隐式插入 `no-resolve`，不排序规则。



managed={url,query?:Record<string,string|Secret>,intervalSeconds,strict}，URL不得含query、fragment或凭据，query用标准URL编码；秘密只在渲染时取得，不使用生成后字符串替换。

General为严格已知键对象，覆盖本次声明的DNS、日志、VIF、监听、控制接口、skip/bypass/always-real-ip选项；http-api与external-controller-access均为{password:Secret,listen:string}。

枚举、IP/监听、DNS、host-list、URL各按字段类型验证，拒绝未知键及配置注入。

Host={pattern,address?,server?} 至少有一个目标，支持域名/通配域名、IP/别名和system/DNS/加密DNS服务器。



tunnels 支持 {id,type:'tailscale',sectionName,authKey:Secret,hostname,dnsServer?,autoAddMagicDnsRule?,idleKeepalive?} 及 {id,type:'wireguard',sectionName,privateKey:Secret,selfIp,dnsServer?,mtu?,peers:[{publicKey,endpoint,allowedIps,presharedKey?:Secret,persistentKeepalive?}]}。

dnsServer和allowedIps是字符串数组，selfIp是单IPv4地址。

WireGuard public/private/preshared key为32字节base64，endpoint为hostname:port；未知字段拒绝。

SDK生成Proxy行及专属section并验证section名唯一，不管理隧道运行身份或连接。

输出不得丢弃显式字段。



## 失败与安全

输入必须是受预算限制的纯数据，schema严格拒绝未知字段、非法端口/IP/URL、控制字符及原生语法注入。编译诊断只输出固定代码/路径，不插入原输入值。秘密异常、缺失及非法编码统一固定错误；凭据必须通过字段特定校验，不静默改变密码。批次任一编译失败在解析任何秘密前拒绝，任一渲染失败不返回部分产物。

## 验收

脱敏测试覆盖两种精确目标、声明与编译严格性、联合图和规则目标、规则顺序/嵌套选项/10层限制/同URL格式、General/Host约束、两种隧道、共享secret缓存、managed查询编码、异常与注入脱敏、输入突变隔离。原有Program、CLI及其它平台回归必须通过。Mac原生离线解析与iOS实机验证分别记录，不能互相替代。

## 官方依据

- [AnyTLS](https://manual.nssurge.com/policies/anytls.html)
- [Tailscale](https://manual.nssurge.com/policies/tailscale.html)
- [WireGuard](https://manual.nssurge.com/policies/wireguard.html)
- [Smart](https://manual.nssurge.com/policy-groups/smart.html)
- [Process rules](https://manual.nssurge.com/rules/process.html)
- [General](https://manual.nssurge.com/profile/general.html)
