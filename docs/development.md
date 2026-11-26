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

在游戏目录执行 `npm run check:inputs` 核对资源摘要。修改 TypeScript 后可运行 `npm run dev`；首次使用或修改 Worker 后执行 `npm run build` 生成浏览器使用的 Worker。

```sh
npm run typecheck
npm run test:inputs
npm run test:unit
npm run build
npx playwright install chromium
npx playwright test
```

Windows 默认使用本机 Microsoft Edge，Linux 使用 Playwright Chromium，也可设置 `CHROME_PATH` 指向可执行文件路径。设 `STARFALL_PLAYER_RUN=1` 可运行完整首关的浏览器验收；`STARFALL_FULL_MATRIX=1` 启用延时较长的 21 关原规则单测。开发者持有对应版本的原始包体和解包资料时，可通过 `STARFALL_RESEARCH_DIR` 指定目录，执行 `npm run test:content` 复验来源。

GitHub Actions 校验输入、运行测试并从当前提交构建。Pages 在 `/play/` 提供游戏。构建成功后可运行 `python scripts/package_release.py --build apps/game/dist --out MonsterDefense-v1.0.0.zip` 生成可在静态服务器上使用的离线包。
