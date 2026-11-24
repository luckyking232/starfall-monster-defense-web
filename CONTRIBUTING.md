# 贡献指南

## 第一次参与

1. 想体验现状，先 [打开 Alpha](https://luckyking232.github.io/starfall-monster-defense-web/play/index.html)；要自己运行，按 [本地构建](docs/local-build.md)。
2. 想改代码，先用[模块地图](docs/project-map.md)定位入口。小任务可从选关触控、弹窗或回退行为开始，独立测试不依赖游戏资源。
3. 没有合适 Issue 时，建一个问题说明浏览器、Alpha 版本、关卡、操作步骤、实际和预期结果。

## 提交与复核

一个改动开一个分支和 PR。PR 说明改动模块、验证命令、结果和没覆盖的情况。区分独立测试、完整 Alpha 构建、浏览器实玩和 TapTap 真机；不要把缺失的素材或效果写成已还原。

```sh
python -B -m unittest discover -s tests
node --test tests/chooser-gesture.test.mjs
python -B scripts/test_public_source.py
```

`main` 要求 PR 和 `public-preflight`；合并后默认清理源分支。未确认许可的新资源、原始账号资料和私人访问链接不要放进 Git。已有随 Alpha 授权发布的资源见 Release 附件；资源更新需更新检查清单、版权说明和版本锁，并单独提交 PR。

`packages/replica-runtime/` 内的已发布素材入口和部分源码由指纹约束。不要为跑通改动而关掉校验：开发新的运行组合时，须显式更新相应记录并重新验收。已经发布的 Alpha 仍由旧版本标签与旧摘要锁定。
