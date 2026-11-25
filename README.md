# 魔物抵御战 Web

《星落》小游戏的非官方网页复刻，欢迎共同开发。当前 Alpha 能试玩，不是 1:1 完工版，也未在 TapTap 上架。

**[在线试玩](https://luckyking232.github.io/starfall-monster-defense-web/play/index.html)** · **[下载同版 ZIP](https://github.com/luckyking232/starfall-monster-defense-web/releases/tag/v0.1.0-alpha.1)** · **[贡献指南](CONTRIBUTING.md)**

## 潮汐前哨开发预览

`apps/game` 是独立的新产品入口。当前开发候选包含灯塔湾、断潮礁和外海巡防三个自制验证场景，可体验自动防守、波次间升级、结算和本地解锁。 [GitHub Pages 开发预览](https://luckyking232.github.io/starfall-monster-defense-web/preview/)

本地需要 Node.js 22.12+。

```sh
npm --prefix apps/game ci
npm --prefix apps/game run dev
```

独立候选使用相对资源路径，同一次构建提供 Pages 预览和 `tool/index.html` 格式的 TapTap ZIP。Pages 候选有独立的构建、浏览器测试和包体检查。 [实施计划](docs/superpowers/plans/2026-11-25-web-product-rebuild.md) · [候选工作流](.github/workflows/web-game-candidate.yml)

TapTap 的冷启动首帧方向、容器行为和可发布内容清单由真机及平台自测验收。

## 本地启动

克隆后运行（Python 3.11+）：

```sh
python -B scripts/dev.py
```

Windows 也可用 `py -3 -B scripts/dev.py`。命令从 GitHub 下载并校验约 21 MB 的固定版本资源，在临时目录重建 Alpha，并打印本机试玩地址。不会改 Git 工作树，不要求安装《星落》。已有资源 ZIP、离线验证与打包方式见 [本地构建](docs/local-build.md)。

## 从哪开始改

修改界面、HUD 或交互时，可以用本机开发预览运行候选代码，不影响已发布版本。先运行 `python -B scripts/dev.py --list-editable`，再看[预览步骤](docs/local-build.md#修改自有界面并在本机预览)。

| 目录 | 用途 |
| --- | --- |
| [apps/pages](apps/pages) | 公开入口页，不是游戏引擎 |
| [packages/ui](packages/ui) | 可以独立开发和测试的浏览器交互模块 |
| [packages/replica-runtime](packages/replica-runtime/README.md) | 规则、渲染、游戏界面和固定版本构建；见[模块地图](docs/project-map.md) |
| [scripts](scripts) · [tests](tests) | 启动、打包、验收工具和独立测试 |
| [release](release) · [docs](docs) | 版本与资源锁定、测试和发布说明 |

目前还缺原版弹道、部分画面与音频、手机 TapTap WebView 验收。玩法、画面和平台分别验收，不以通过其中一项代表全部完成。

MIT 只覆盖项目原创代码与文档。游戏原始素材和第三方依赖保留各自许可，见 Release 附件的版权说明。
