# 本地构建、验收和发布

## 1. 重建并启动发布基线

在仓库根目录运行（Python 3.11+，不用 npm）：

```sh
python -B scripts/dev.py
```

Windows 可用 `py -3 -B scripts/dev.py`。终端打印的地址默认是 `http://127.0.0.1:8000/play/`，只监听本机。用 Ctrl+C 停止。存档按网址及目录隔离；换端口或浏览器不共享。

命令只取 [Alpha Release](https://github.com/luckyking232/starfall-monster-defense-web/releases/tag/v0.1.0-alpha.1) 的 **source-inputs** 素材附件，比较公开的 [输入锁](../release/inputs.lock.json)，组合代码和素材并核对每个文件。另一个 ZIP 是直接游玩的产物，不是可重建输入。

已有输入包可以离线使用：

```sh
python -B scripts/dev.py --overlay MonsterDefense-source-inputs-v0.1.0-alpha.1.zip
python -B scripts/dev.py --overlay MonsterDefense-source-inputs-v0.1.0-alpha.1.zip --verify-only
```

基线启动器验证发布版本，不是可改完任意固定文件即热重载的开发服务器。改动校验范围里的代码需要新版本记录；独立开发表格见[模块地图](project-map.md)。

## 2. 构建产物并检查

从同一份已核验构建直接打包（不启动服务器、不上传）：

```sh
python -B scripts/dev.py --package MonsterDefense.zip
```

如需长期保留一个可读的完整工作树，把它生成在独立新目录：

```sh
python -B scripts/setup_local_replica.py --overlay MonsterDefense-source-inputs-v0.1.0-alpha.1.zip --output ../monster-defense-local
cd ../monster-defense-local
python -B taptap-portable/wip-release.py
```

默认只在内存重建并报告指纹；明确要生成文件时使用 `--write`（不覆盖现有 ZIP，需要足够空间）。Alpha 校验见 [成品锁](../release/alpha.1.json)。压缩程序版本不同，先比较包内成员摘要，而不是盲改指纹。

## 3. 发布流程

- Pages 取审核过的固定 Alpha ZIP，校验后只把唯一外层目录的内容挂到 `/play/`；Git 仓库本身不做网页根目录。
- TapTap 游戏工具箱按 [指定 Skill v1.0.0](https://3rd-tool-h5-al.tapimg.com/temp/taptap-game-tool-upload-1_0_0.zip) 出包：≤300 MiB、唯一外层目录、直属 `index.html`、静态同包相对读取。在仓库根可用 `python scripts/check_zip.py 路径.zip` 查看结构与静态引用。
- Actions 的 **Build pinned TapTap Alpha ZIP** 可从干净 checkout 打当前版本并提供可下载制品，不依赖预先存在的 dist 目录。正式 ZIP 届时用审核过的新版本标签生成，单独标记下载。测试过本机与 Pages 不等于 TapTap WebView 通过，上传与提审不自动执行。

## 修改自有界面并在本机预览

默认启动用来复现已发布的 Alpha，必须和发行摘要一致。要试做显示或交互改动，先查看可预览的**自有**模块：

```sh
python -B scripts/dev.py --list-editable
```

例如，把 `packages/replica-runtime/offline-shell/private.css` 复制为仓库外的 `../preview.css`，修改后运行：

```sh
python -B scripts/dev.py --edit "offline-shell/private.css=../preview.css"
```

有已下载资源 ZIP 时可加 `--overlay MonsterDefense-source-inputs-v0.1.0-alpha.1.zip` 以离线重跑。同一命令可以多次传入 `--edit`；等终端打印地址后访问 `http://127.0.0.1:8000/dev-play/`。Windows 可把 `python` 换成 `py -3`。每次编辑后停掉并重启本机服务，不会自动热更新。建议把候选改动写成 PR 前先在这条路径验收。

该模式从已验证的基线出发，仅覆盖清单明列的自有显示、HUD、指针或样式源文件。固定规则 Worker、原始 Lua/资源、正式完整性清单和保存逻辑不可覆盖。修改后的界面、运行入口和路由摘要只存在内存，以「本机开发预览，不可发布」标记，仅监听回环地址；存档与普通 `/play/` 分开。该模式不能和 `--package` 或 `--verify-only` 同时使用，上传前路径检查也会拒绝这个开发标记。超出覆盖范围的更改应先用模块测试验收，再按发布流程生成新配方，而不是改掉现有 Alpha 的固定摘要。
