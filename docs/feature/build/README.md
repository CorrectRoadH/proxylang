# 构建与发布

给维护设备配置仓库的作者，以及调用 proxylang 的 CI。作者在 `proxylang.config.ts` 中导出一个[构建定义](../../concepts.md#build-definition)，列出全部设备的 Profile、输出目录和秘密集合；`proxylang check` 检查它，`proxylang build` 为每台设备生成一个原生配置文件，并整批切换[产物](../../concepts.md#artifact)。

## 上手

```ts
// proxylang.config.ts
import { defineBuild } from "proxylang";
import { deviceProfiles } from "./proxy/devices.js";
import { secrets } from "./proxy/secrets.js";

export default defineBuild({
  outDir: "proxy",
  profiles: deviceProfiles,   // { phone: Profile, laptop: Profile, gateway: Profile }
  secrets,                    // defineSecrets 的返回值
});
```

```sh
npx proxylang check          # 检查全部 Profile 与案例，不读秘密，不写文件
npx proxylang build          # 读取秘密，生成 proxy/out/<key>.conf 或 <key>.json
```

`build` 成功后，`proxy/out/` 指向这一批文件，例如 `proxy/out/phone.conf` 与 `proxy/out/gateway.json`。部署这些文件由使用方负责，例如由 CI 上传到对象存储，供客户端按托管配置地址更新。

## 规则

- 构建定义的 `profiles` 是“文件名 → Profile”的对象。键就是产物文件名，匹配 `^[a-z0-9][a-z0-9-]*$`；扩展名由引擎决定。
- `check` 与 `build` 检查同样的内容：全部 Profile 的诊断、全部路由案例，以及 sing-box endpoint 状态目录与输出目录是否重叠。`build` 只在这些检查全部通过后才读取秘密（[t-13](../../taste.md#t-13)）。
- 一次构建是一个批次。所有 Profile 都渲染成功后，新的一批文件才成为 `out`；切换之前的任何失败都让 `out` 保持上一批。切换之后只有两种例外：清理旧批次失败（新批次已生效，`PUBLISHED_CLEANUP_FAILED`），以及切换过程中断需要人工恢复（`PUBLISH_RECOVERY_REQUIRED`），见 [architecture](architecture.md)。
- `build --validation` 用于没有生产秘密的验证构建：每个被引用的秘密都使用它的 `validation` 值，缺少时报错，不回退到生产来源。它仍然写出产物，产物中不含真实凭据。

命令参数、输出与退出码见 [CLI](cli.md)；`defineBuild` 等函数见 [library](library.md)，`defineSecrets` 见 [Profile 编写 API](../profile/library/README.md#秘密)；配置文件的加载规则见[项目配置](format/project-config.md)；批次发布的实现与恢复见 [architecture](architecture.md)。

## 用户故事

- [生成并发布全部设备的配置](use-case/publish-device-configs.md)

## 验收

CLI 的参数、输出和退出码由 CLI 集成测试覆盖；批次发布的原子性与失败恢复由带故障注入的发布测试覆盖；安装后的包由隔离安装验收覆盖。见[测试架构](../../engineering/testing/README.md)。
