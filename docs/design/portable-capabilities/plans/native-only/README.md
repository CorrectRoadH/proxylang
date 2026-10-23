# 仅保留原生算法分支

## Problem

保留当前 strategy 的 implementations-only 模型，所有算法都由作者逐平台选择。

## Core Mental Model

平台分支是行为真源；共享仅限 ID、成员和规则引用。无需默认算法映射，但作者必须在每个配置中重复表达自动选择意图。

## Scope

无公共 algorithm 字段；只增加更多 group 或平台构造器。不解决用户要求的算法通用化。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-no-silent-weakening) | satisfied | 作者明确选择每个分支 | 现有 strategy 契约 |
| [L2](../../LIMITS.md#l2-compile-only) | satisfied | 保持当前编译边界 | src/strategies.ts |
| [L3](../../LIMITS.md#l3-compatibility) | satisfied | 无模型变化 | 当前输入模式 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-portable-intent) | not-satisfied | 仍须逐 engine 声明自动选择 | C1 不满足用户诉求 |
| [G2](../../GOALS.md#g2-explicit-ownership) | partial | 规则和资源明确，算法公共归属没有解决 | 现有文档仍称 Smart 专属算法 |
| [G3](../../GOALS.md#g3-incremental-delivery) | satisfied | 不改变旧契约 | 当前实现与测试可保留 |
