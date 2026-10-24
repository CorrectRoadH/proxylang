---
format: concord.document/v1
id: provider-nodes
title: 将 provider 节点接入原生配置
createdAt: 2026-10-22T08:27:47.907Z
kind: use-case
feature: docs/feature/target-compilation/README.md
---

# 将 provider 节点接入原生配置

作为已有代理配置的维护者，我希望由 TypeScript 组合节点并交给 SDK 编码，保留原生名称、节点顺序、协议参数和拨号链，逐步替换 Shell 渲染器。

## 行为与边界

构造器继续返回类型化纯数据；不可变 builder 提供链式声明，最终 build 为节点数据。via 指定稳定 ID，不隐式注册依赖，也不把调用顺序当作拨号路径。

节点片段提供独立 compile/render 入口。compile 不读取秘密，检查完整输入、精确目标、名称唯一性及内部引用。render 通过秘密解析函数产生逐节点 entries，消费方按 ID 分文件。名字由显式映射指定，label 保持元数据。

片段可声明由完整原生配置拥有的外部代理或组；外部符号不生成占位节点。成功结果携带待验证依赖，不能作为完整图无环、外部资源存在或运行时网络可用的证明。

消费方拥有 provider 默认值和覆盖规则、include 展开、完整图验证及活动目录切换。全部节点和策略成功后才发布整批产物，失败保留旧配置。诊断不包含秘密字段值，manifest 仅保留无秘密声明。

API、目标范围、字段边界及验证责任见[节点片段与链式声明](../../../engineering/proxy-node-fragments/README.md)。

## 验收

通过正式 SDK 入口验证链式分叉、域名节点、中文原生名称、节点顺序、外部引用、重复名称与内部环。秘密只在 render 阶段读取，失败编译不得读取秘密；编码异常使用固定代码。

消费端用旧配置基线检查协议、地址、端口及全部参数；字段顺序差异单独解释，不忽略新增或遗漏选项。原生离线检查与实际连接验证分别报告。

代理只承载连接参数及配置身份，应用在协议对象外维护业务分类；完整边界见[代理业务信息](../business-data.md)。
