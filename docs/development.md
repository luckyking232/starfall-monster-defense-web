# 开发与验证

游戏工程位于 `apps/game/`。Vite 生成相对路径静态站点，部署在域名根目录或子目录均可。游戏本身不依赖在线战斗或存档服务。

| 目录 | 职责 |
| --- | --- |
| `src/app`、`src/main.ts` | 首屏加载、游戏入口、页面生命周期与时钟 |
| `runtime/ui`、`src/ui` | 原窗口 Lua 宿主、Worker 消息、独立版设置 |
| `src/fgui` | FairyGUI 组件、图集、遮罩、中文排版、拖动和转场 |
| `src/presentation` | 战斗坐标、精灵动画、粒子和材质绘制、音频 |
| `src/platform` | 本地存档、设置和横竖屏输入 |
| `public/assets`、`runtime-input.lock.json` | 已准备的运行资源、来源清单和引擎输入指纹 |
| `scripts`、`tests` | 资源校验、生成器、单测和浏览器回归 |

在游戏目录执行 `npm run check:inputs` 核对资源摘要。运行 `npm run dev` 时会先生成开发用界面 Worker，修改 Worker 后重新启动开发服务器。

```sh
npm run typecheck
npm run test:inputs
npm run test:unit
npm run build
npm run build:qa
npx playwright install chromium
npx playwright test
```

`npm run build` 输出发布用 `dist`，界面 Worker 和原版运行资源按内容指纹存放，可用于 EdgeOne、Pages 和离线 ZIP。`npm run build:qa` 输出 `dist-qa`，带独立规则接口、FGUI 探针、原始开发资料和源码映射，供 Playwright 默认预览。需要更新原图集或字体时，用配有 Pillow、fontTools 和 Brotli 的 Python 运行 `python scripts/prepare_player_media.py`，再提交生成的 WebP、WOFF2 和对应的校验文件。

Windows 默认使用本机 Microsoft Edge，Linux 使用 Playwright Chromium，也可设置 `CHROME_PATH` 指向可执行文件路径。设 `STARFALL_PLAYER_RUN=1` 可运行完整首关的浏览器验收；`STARFALL_FULL_MATRIX=1` 启用延时较长的 21 关原规则单测。开发者持有对应版本的原始包体和解包资料时，可通过 `STARFALL_RESEARCH_DIR` 指定目录，执行 `npm run test:content` 复验来源。

首屏先准备菜单所需的界面、规则和引擎。打开选关后，浏览器在后台准备原过场、战场图像和特效，并下载、解码启用的两条战斗音乐。立即选关时，等待界面会列出尚未就绪的部分。已解码的资源在同一页面的后续对局中复用。音效滑杆从静音到原增益的 10%；音乐使用单独的增益总线。

GitHub Actions 校验输入、运行测试并从当前提交构建。Pages 在 `/play/` 提供游戏。构建成功后可运行 `python scripts/package_release.py --build apps/game/dist --out MonsterDefense-v1.0.1.zip` 生成可在静态服务器上使用的离线包。

## 在线更新与旧标签页

`npm run build` 生成 `asset-inventory.json`，记录当前客户端资源的 SHA-256。测试站发布前从自己的 `/play/` 起点读取清单，EdgeOne 通过 `apps/game/edgeone.json` 从 `fallstar.online` 读取清单。两边都保留前一次部署的指纹 URL，优先复制当前构建中指纹相同的文件，只下载并核对内容已变更的文件。资源与清单缺失、指纹不符或检查期间有另一版上线时，更新准备会报错并停止。EdgeOne 给指纹目录设置长期缓存，清单每次重新检查。GitHub Pages 的缓存响应头由平台提供。

第一次更新从仓库复制已核对的 v1.0.1 原始画面和声音文件，供已经到达活动主页的旧标签继续进关。保留范围为前一次部署。完成更新后，新页面只请求自己的路径。兼容文件会占用线上发布空间，离线 ZIP 按当前资源清单打包。

要在本地复测，先分别构建旧版和新版，在游戏目录指定 `STARFALL_ROLLOUT_NEW_DIST`，并用 `STARFALL_ROLLOUT_LEGACY_DIST`、`STARFALL_ROLLOUT_LEGACY_PAGES_DIST` 或 `STARFALL_ROLLOUT_PREVIOUS_DIST` 指向相应的旧构建，再运行 `npx playwright test hosted-rollout`。测试会在同一 HTTP 地址切换发布目录并通过旧标签进入首战。
