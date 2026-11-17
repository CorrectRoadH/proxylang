# 接入节点、中转与设备隧道

## 用户目标

配置作者希望用协议类型维护节点，复用业务筛选，并让每台设备把流量交给自己的中转或隧道。

## 起始状态

已声明秘密集合和精确目标。节点地址使用示例数据时取 example.com、192.0.2.0/24 或 2001:db8::/32；生产来源由使用方独立维护。

## 完整路径

以下为预期写法。

1. 用协议构造器声明节点与秘密引用，设置 id 和可选 name；业务分类在外层记录中维护。 {#define}
2. 用普通数组筛选记录并取原节点对象，创建 relay 分组。需要换中转时，通过函数参数传入 relay 对象，再创建 `.via(relay).build()` 的节点。 {#chain}
3. 把节点、分组和设备专属隧道列入同一 Profile，路由和 fallback 引用这些对象。 {#register}
4. 在构建定义中登记 Profile 与秘密集合，运行 check；缺失资源、重复 id、依赖环和目标不支持选项均报诊断。通过后运行验证构建，审阅原生结构。 {#check}

```ts
const relay = proxy.trojan({
  id: "relay", server: "192.0.2.10", port: 443, password: secrets.TEST_PASSWORD,
});
const exit = proxy.builder(proxy.http({
  id: "exit", server: "192.0.2.20", port: 8080, password: secrets.TEST_PASSWORD,
})).name("Edge").via(relay).build();
const relayGroup = defineProxyGroup({ id: "relay-group", algorithm: group.select(), members: [relay] });
```

## 结果与边界

对象引用保留身份和成员顺序，不隐式收集依赖。资源图包括 members 和 via，跨类型环同样失败；TCP-only 沿路径传播。隧道和 endpoint 按目标分别构造，endpoint 不能作为成员或 via。

builder 的分叉互不修改；未 build 的对象拒绝作为节点。秘密只在检查通过后的构建批次读取，错误不输出值。运行方拥有 endpoint 身份及状态目录，SDK 不注册网络身份。细节见[节点](../library/proxies.md)与[Surge 隧道](../library/surge.md)。
