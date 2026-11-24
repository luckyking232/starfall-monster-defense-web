# 魔物抵御战 Web 复刻

非官方项目，与《星落》官方无关。这里是该复刻项目的公开开发仓库，不是另一个游戏。当前公开的是发布工具与开发流程，**可玩的复刻版还没有公开**。待确认许可的原版 Lua、图片、音频和私有预检包不进入本仓库、Pages 或 Actions 产物。

## 开发与验收

1. 为一个具体问题建分支，提交改动后开 PR。说明复现步骤、测试版本、改动覆盖面和测试结果。未经复核的视觉效果不能写成已还原。
2. CI 做可复现的打包工具和 ZIP 结构测试。绿色表示这些检查通过，不代表游戏、移动端或 TapTap 已验收。
3. 合并至 `main` 后，Pages 发布项目进度页。只有经过独立审核的实际静态游戏构建才可以替换它。
4. 正式版本使用审核通过的 Git 标签及同一份静态构建。TapTap Release 资产是显式打包的 ZIP，不是 GitHub 自动生成的 Source code ZIP；Pages 使用该包唯一外层目录的内容。先在随机深层路径跑 Worker/WASM、开战、触屏、结算和刷新后进度，再做平台验收。本仓库不会自动向 TapTap 上传或提审。

## TapTap 游戏工具箱包

按 [游戏工具上传检查 Skill v1.0.0](https://3rd-tool-h5-al.tapimg.com/temp/taptap-game-tool-upload-1_0_0.zip)：ZIP ≤ 300 MiB，仅一个外层目录，且 `index.html` 直属该目录；内容应当是可以按相对路径加载的静态网页。不把其他 TapTap H5 或 PC 制品规范混入。

```sh
python -m unittest discover -s tests
node --test tests/chooser-gesture.test.mjs
python scripts/check_zip.py path/to/game.zip
python scripts/package_zip.py --build dist-formal --manifest release/manifest.json --out MonsterDefense.zip
```

打包脚本默认阻断：必须有逐个文件的 SHA-256、字节数、来源和公开许可记录，经审核后才能提交 `release/manifest.json`。静态预检通过不等于手机 WebView 或平台审核通过。

MIT 仅适用于本仓库原创代码和文档，不为《星落》或其他第三方内容授予任何权利。

`web/input/chooser-gesture.mjs` 是复刻用的公开选关输入模块，负责缩放坐标、区分横向拖动和点击、取消过期输入。它不含原版素材或脚本，不改变关卡解锁规则，也不是完整可玩的构建。
