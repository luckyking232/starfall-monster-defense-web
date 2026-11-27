# 参与开发

从 [工程说明](docs/development.md) 配置 Node.js，构建后从活动主页开始测试。提交时说明修改了哪个窗口、关卡或技能，给出可重复的操作和结果。

涉及原作移植的修改，请指出对应的 Lua 模块、FGUI 组件或素材标识。战斗表现应与原版资源和时序互相核对。新功能请覆盖实际入口；存档改动要验证已有进度与多档隔离。

发布前运行输入校验、单测和浏览器回归，并检查生成的静态包可在子目录下直接运行。

功能分支向 `test` 提交 PR。GitHub Pages 部署合入后的候选，`play/version.json` 标识提交和文件树。正式域 fallstar.online 由 EdgeOne 从 `main` 构建。Pages 测试档独立，网页设置的存档页可导出旧版 Pages 存档，也能把备份导入到新槽。

维护者在测试站用本次提交完成手机方向、战斗、音效和存档验收后，在该 SHA 设置 `test-device-acceptance` 成功状态，将实测机型与结果写入晋级 PR。使用 `gh api repos/luckyking232/starfall-monster-defense-web/statuses/<已测SHA> -f state=success -f context=test-device-acceptance -f description='<设备与验收结果>'`。从 test 向 main 提交普通合并 PR。晋级检查比对 Pages 指纹、合并树和验收记录。正式域再核对版本、开局与已有存档。回退时可先在 EdgeOne 恢复已验收部署，再将还原提交经过 test 和同样的晋级流程。
