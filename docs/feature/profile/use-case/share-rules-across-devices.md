# 多台设备共享规则，各自绑定出口

作者有一组业务规则，例如 AI 服务走 AI 出口、家里的服务走 Home 出口。手机、笔记本和网关都要用这组规则，但 Home 在手机上是 Tailscale 隧道，在笔记本上是 WireGuard 隧道，在 sing-box 网关上是直连分组。

## 起始状态

- 每台设备的节点与隧道已经声明。

## 步骤

1. 在规则模块中写一个函数，参数是它需要的出口，例如 `(exits: { ai: Exit; home: Exit })`，返回 `defineRoutes` 创建的路由片段。{#write-shared-routes}
2. 写一个按设备生成分组的函数，接收设备自己的隧道，返回包含 `home` 在内的分组对象。{#bind-exits}
3. 每台设备调用 `defineProfile`：`groups` 列出这些分组，`routes` 用这些分组调用共享规则函数；设备例外的路由放在共享片段前后。{#compose-device}
4. 运行 `proxylang check`。{#check}

## 结果

- 每份 Profile 都通过检查，生成的配置中，共享路由的顺序与源码相同，出口指向各自设备的 Home。
- 某台设备调用共享规则时漏传 `home`，TypeScript 在编辑器里报错，check 不会运行到这一步。
- 某台设备传入了一个分组却没有把它列进 `groups`，check 对这份 Profile 报 `UNLISTED_EXIT`，指出路由序号与源码位置；其它设备的检查不受影响，批次失败。
- 需要保持的意图，例如“Home 的服务不能直连”，用[路由案例](../../routing-cases/README.md)断言。

## 完成判据

改一处共享规则，`proxylang build` 后所有设备的产物都包含这条改动；生成结果的 diff 只出现在预期的位置。
