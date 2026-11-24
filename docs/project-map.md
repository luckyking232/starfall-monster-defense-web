# 模块地图

这个目录解释「去哪改」，不是按研究时间列文件。以下内部路径以 `packages/replica-runtime/` 为基准；不会为了换名字而让已验收的版本失效。

| 任务 | 先看哪里 | 怎么验证 |
| --- | --- | --- |
| 选关触控、拖动、点击 | 仓库根下的 `packages/ui/input/`；游戏画面接线见 `qualified-game/revisions/r6/cloud-temporary-20108-cpu/ui.mjs` | 选中、误触取消、横向拖动，独立和真机分开报告 |
| 出怪、升级、暂停、结算 | `qualified-game/revisions/r6/{client.mjs,worker.js,site/session.mjs}`，前端活动状态在 `activity-flow/` | 帧号、结算项、弹窗代次与按键去重 |
| 地图、角色、HUD、特效 | `stage-renderer/`、`stage*-cpu-canvas/` 和 `presentation-clock/`；入口协调由 `qualified-game/revisions/r6/cloud-temporary-20108-cpu/site-layer.mjs` 连接 | 比较同一运行的画面和输入；缺原粒子或声效时单列 |
| 存档与部署子路径 | `taptap-portable/progress/` 和 `taptap-portable/runtime-core.js` | 确认结算才存档；刷新恢复；子路径和版本隔离 |
| 重建 Alpha、部署、打 TapTap 包 | `taptap-portable/{plan.py,wip-release.py}` 组织运行时；仓库根的 `scripts/`、`release/` 负责开发启动、部署和 ZIP | 对比成员 SHA；开战、选技和结算；真机另验 |

## 如何看待旧名字

运行时有些目录源自早期验证，虽然叫 `cloud-*` 或 `*-probe`，仍被现行 Alpha 的装配清单引用，不能用名称判定是否废弃。Alpha 外层已收在 `packages/replica-runtime/`；内部的 URL、签名配方与校验文件保持字节稳定。组件变化优先通过明确的接口和测试加入，只有已证明不在装配和使用链中、替代方案已清楚的实现才归档。[归档规则](history.md)
