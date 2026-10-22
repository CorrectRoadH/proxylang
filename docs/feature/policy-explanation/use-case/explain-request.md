---
format: concord.document/v1
id: explain-request
title: 说明请求为何使用某个出口
createdAt: 2026-10-21T10:12:48.879Z
kind: use-case
feature: docs/feature/policy-explanation/README.md
---

# 说明请求为何使用某个出口

## 用户目标

作为修改路由规则的作者，我希望看到一个请求经过哪些条件、为何命中哪条规则，以定位组合顺序和守卫问题。

## 行为与边界

用户指定目标与已观测请求元数据。解释按顺序返回每条已检查规则的条件结果，命中即终止；没有命中时返回程序默认动作。非法请求或未知目标拒绝。

## 验收条件

域名后缀不误匹配相似尾串，IPv4 与 IPv6 不混淆。缺失端口导致端口原子条件为 false，取反为 true。来源可追溯至模板和实例；不产生网络请求或读取密码。

原生外部条件的内容未知，条件结果可为 null。若可能影响首命中，SDK 抛 StaticRuleSetUnknownError，CLI 返回 STATIC_RULESET_UNKNOWN 且退出1；不猜测默认动作。三值逻辑只说明给定元数据下的静态结论，不验证原生 DNS 或资源加载副作用。
