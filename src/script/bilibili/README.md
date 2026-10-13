# Bilibili 增强

本分支是老国际版兼容 fork；安装地址、构建方式和功能边界见仓库根目录 README.md。原空降助手以「空降助手（旧）」保留，新空降助手提供 PiliPlus 分类、弹幕提示和基于原播放器资源的跳过能力，不包含 PiliPlus 的 Flutter 界面。

## 参数说明

新增参数：`优化评论区加载` 默认 `#`（关闭），`资料净化` 默认启用，`空降助手（旧）` 默认 `#`。新 `空降助手` 默认启用，支持 11 类片段策略：`auto` / `manual` / `show` / `off`，最短片段时长默认 0 秒。新旧空降助手请选择其一。

| 参数             | 可选值 / 格式               | 默认值 | 说明                                                                     |
| ---------------- | --------------------------- | ------ | ------------------------------------------------------------------------ |
| 动态最常访问     | `auto` / `show` / `hide`    | `auto` | `auto`：仅当列表中存在直播状态时显示；`show`：始终显示；`hide`：始终隐藏 |
| 创作中心         | `0` / `1`                   | `0`    | `0`：隐藏；`1`：显示                                                     |
| 过滤置顶评论广告 | `0` / `1`                   | `1`    | `0`：关闭；`1`：开启                                                     |
| 空降助手         | 配置为 `#` 时关闭           | 开启   | 默认开启；配置为 `#` 时关闭                                              |
| 空降助手策略     | 策略名称                    | DIRECT | 默认直连；建议配置为代理策略（视网络环境而定）                           |
| 日志等级         | `1` / `2` / `3` / `4` / `5` | `4`    | `1`：DEBUG；`2`：INFO；`3`：WARN；`4`：ERROR；`5`：OFF                   |

## 常见问题

- **不显示弹幕**

  先确认原模块关闭、MitM 及可信证书开启、弹幕显示开启；不要用卸载重装排查已经下架的老国际版。播放器资源仍依赖上游 Chronos，自动/点按跳过需要在 iPhone 上验证。

- **是否支持Script Hub？**

  不支持

## 支持的APP

| Surge                                                                                                                  | Loon                                                                                                                                                                                   | Egern                                                                                                                                                                               | QuantumultX | Shadowrocket |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ |
| [模块地址](https://raw.githubusercontent.com/pafekutoburu/Sparkle/refs/heads/master/release/surge/module/bilibili.sgmodule) | [一键安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fkokoryh%2FSparkle%2Frefs%2Fheads%2Fmaster%2Frelease%2Floon%2Fplugin%2Fbilibili.lpx) | [一键安装](https://egernapp.com/modules/new?url=https%3A%2F%2Fraw.githubusercontent.com%2Fkokoryh%2FSparkle%2Frefs%2Fheads%2Fmaster%2Frelease%2Fsurge%2Fmodule%2Fbilibili.sgmodule) | 不支持      | 不支持       |

## 特别鸣谢

- [@app2smile](https://github.com/app2smile/rules)
- [@BiliUniverse](https://github.com/BiliUniverse/Universe)
- [@Maasea](https://github.com/Maasea/sgmodule)

