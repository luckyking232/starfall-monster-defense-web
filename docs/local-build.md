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
- 正式 ZIP 应从审查过的版本标签生成，单独标记下载。测试过本机与 Pages 不等于 TapTap WebView 通过，上传与提审不自动执行。
