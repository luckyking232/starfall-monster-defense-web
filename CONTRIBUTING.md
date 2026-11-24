# 如何参与

提交 PR 比等待完整可玩包更早：可以独立改选关坐标、输入、调度和存档，跑源见证检查的边界测试，或者补打包/平台适配。不要在 PR 或 Issue 上传包体、原版脚本/配置、美术资源、访问令牌或私人下载链接。

## 最快开始

```sh
git clone https://github.com/luckyking232/starfall-monster-defense-web.git
cd starfall-monster-defense-web
python -m unittest discover -s tests
node --test tests/chooser-gesture.test.mjs
python scripts/test_public_source.py
```

要求 Python 3.10+、Node 22+，独立公开测试无需游戏原文件、npm 包或网络。熟悉模块位置见 [源码导览](source/README.md)。源码保留部分历史对照实现，请优先用 R6 入口和测试，不要把旧诊断工具当作用户界面。

## 提交

1. 一个问题一个分支。PR 说明受影响模块、依赖、验证命令与可观察结果。
2. 区分「确实显示」、「规则运行但画面缺失」、「未在目标平台测过」。不要把日志或渲染替代画面当作 1:1 验收。
3. GitHub Actions 预检通过后再合并；新模块需要扩充公开清单和测试。改涉及公开发布的路径、文件来源和许可时，在同一 PR 中说明变更。
4. 后续真机或复盘材料只贡献有权分享的片段；报告遮去用户名、设备标识、授权地址及账号信息。

## 需要完整本地实玩的贡献者

仅用有权使用的原始材料。把本地输入放在 `local-inputs/`（已被 Git 忽略）；当前公版没有可公开的全量输入包，因而不能承诺新克隆一键运行完整游戏。见源码导览中的接口与缺件清单。不要把包体复制进 `source/`，也不要关掉校验或改几个哈希就声称与原版本等价。等经过许可核实的构建输入就绪，再开单独的集成 PR。
