# 网页小游戏产品重建状态

## 当前进度

- 2026-11-25 用户批准执行 [实施计划](docs/superpowers/plans/2026-11-25-web-product-rebuild.md)。
- 实施分支 `web-product-rebuild` 从 `06b533b87956b06eae05de8bc33766f8b00e21f1` 建独立工作树。
- 第 1 项已通过本地构建和桌面、小横屏输入。独立探针包位于 `.local/host-probe/taptap-host-probe.zip`，SHA-256 为 `8d78179bcb18e5cb92fdd52d1431706c847cfca57c0945fce705610cc50158ad`。查看 TapTap 上传页超时，Android 与 iOS 冷启动录屏待取得。
- 第 2、3 项通过 15 项单元测试。第 4、5 项通过 7 项 Edge 测试，覆盖桌面、844×390 与 667×375 横屏、首局胜利、后台保留选择、退出、失败、存档拒绝以及外海两轮巡防。
- 第 6 项已接入候选和 Pages 工作流。本地 `.local/web-game-candidate/tool.zip` 通过静态预检，共 327,629 字节，SHA-256 为 `b000685154a59b365548f82dc5651a6ecaf281c8558149b67a5c52339b46a2ed`。

## 决定

- 采用 TypeScript 规则层、Vite 入口和 Phaser 表现层做首轮探针。首轮用自制关卡场景，按计划接入独立内容。
- 国内 npm 镜像直连已核实可用。GitHub 外网访问使用本机 7897 代理。

## 待验证

- 经 GitHub PR 的 `public-preflight` 和网页候选检查后部署 Pages `/preview/`，核对线上文件与同次候选 ZIP。
- TapTap 自测需验证 Android 和 iOS 的实际首帧方向、存档和性能。TapTap 最终内容清单、完整首发验收和提交仍待完成。
