# 网页小游戏产品重建实施计划

> 审核稿 · 2026-11-25。本文提出产品工程、运行边界和交付方案。施工以审核后的范围为准。

**目标** 搭起一套能完整发布的横屏网页小游戏工程。玩家第一次进来就能开始、看懂自动战斗和升级选择、打到结算，再从选关进入下一局。

**架构** 同仓库新建独立产品入口。应用状态机管页面、输入与会话，战斗核心管规则和结果，画面与声音消费战斗输出。GitHub Pages 预览和 TapTap 游戏工具箱使用同一次构建的静态文件。

**技术路线** 首选 TypeScript、Vite、Phaser 和 HTML/CSS。TypeScript 规则核心可以脱离浏览器回放，Phaser 处理战场的场景、资源和绘制，HTML 控件承担入口、选关和弹层。Vite 产出可挂载到子目录的静态文件。引擎版本及构建目标以 TapTap 容器探针结果确认。

**实施边界** 本稿的内容实施面向自有设计及自有或获授权的资源。《星落》魔物抵御战的 Lua、配置、素材和录像提供机制研究与现状核查参考。该作品的一比一移植超出本稿的实施范围。

## 1. 从哪里重建

基线为 `06b533b87956b06eae05de8bc33766f8b00e21f1`。现有仓库已经有源码入口、连续画面模块、存档逻辑、包体检查和候选构建。入口仍调用旧实验目录里的会话和表现，构建仍把部分新模块映射回旧路径。实测能通过诊断控件完成首关并保存进度，第二关出现动态画面中断和 HUD 缺项，小横屏的选卡确认控件也曾被裁切。 [现有入口](../../../src/app/game.mjs) · [运行时与迁移记录](../../architecture/product-runtime.md)

选择在同一仓库的独立工作树建设 `apps/game/`。旧 Alpha 和现行候选按基线 SHA、固定制品与运行记录供对照。新构建从 `apps/game/index.html` 出发，使用独立入口、锁定工具链和审核通过的内容输入。 [现有开发与发布入口](../../local-build.md)

| 已有成果 | 在新工程中的用途 |
| --- | --- |
| 触控防误触、同一局画面保留、异步帧隔离、存档恢复用例 | 提取可复用的测试场景。移入实现时逐项核对来源、依赖和行为。 |
| 旧试验台的逐帧验证与关卡表现分支 | 用来定位旧工程在哪些过渡和能力上出过问题。产品验收从玩家入口开始。 |
| ZIP 预检与文件摘要检查 | 复用已有检查器与制品校验方式，接入新入口的文件列表和部署路径。 |

## 2. 已对齐的产品要求

- **范围** 小游戏开始页、选关、自动战斗、局内升级、暂停与退出、结算、通关与解锁。活动任务、奖励领取和兑换属于外围活动。
- **打开** 手机从点进 TapTap 工具起即为横屏，包括加载第一帧。每次重新打开都先到开始页，点「开始」进选关。
- **对局** 选关后自然开战。战斗自动运行，玩家在升级等决策节点介入。升级时保留当前战场，确认后继续同一局。
- **退出与恢复** 主动退出完成、确认胜负结算，两条路径都回到选关。页面仍存活时离开立即暂停。回来后的交互暂按手动点「继续」恢复。网页关闭或被系统回收后，下一次按开始页流程重开。
- **存档** 当前设备的同一入口读取已结算的通关进度。局中状态只在当前会话内存在。TapTap 与 Pages 各自保留本地进度。
- **首局可懂** 第一次接触玩法的人能自己选关开战、理解自动战斗、完成首次升级、看出选择的效果并找到重试入口。提示跟随开战、升级、结算等已有节点。
- **交付** TapTap 游戏工具箱面向玩家，GitHub Pages 用于开发预览。首次对外版本覆盖完整的已审定可玩内容。代表性关卡用于内部验证共用框架。

### 玩家路径

~~~mermaid
flowchart TD
    A["打开工具或网页"] --> B["加载"] --> C["开始页"]
    C -->|点击开始| D["选关并读取本地进度"]
    D -->|选择已解锁关卡| E["准备战场"] --> F["自动战斗"]
    F -->|达到升级条件| G["冻结对局并展示选项"]
    G -->|确认一次选择| F
    F -->|暂停或进入后台| H["保留这局并暂停"]
    G -->|进入后台| H
    H -->|点击继续| I["恢复离开时的界面"]
    I --> F
    I --> G
    F -->|主动退出并确认| D
    H -->|主动退出并确认| D
    F -->|产生胜负或结束结果| J["保留最后战场并展示结算"]
    J -->|确认并按结果保存| D
~~~

强退和页面回收会结束当前网页会话。重新打开走「加载 → 开始页 → 选关」，读取此前已落盘的通关进度。胜利确认后保存一次并解锁相应关卡。失败或放弃回到选关时，按此前的通关记录显示解锁状态。

## 3. 产品架构

| 路径 | 职责 |
| --- | --- |
| `apps/game/index.html`、`apps/game/vite.config.ts` | 唯一静态入口和相对构建基址。 |
| `apps/game/src/app/` | 启动、应用状态机、当前会话和页面切换。 |
| `apps/game/src/battle/` | 纯 TypeScript 战斗核心、规则时钟、输入验证和结果生成。实际规则来自经确认的自有设计。 |
| `apps/game/src/content/` | 内容清单和加载校验。每关声明场景、敌群、解锁条件、结束类型以及所需资源。 |
| `apps/game/src/presentation/`、`apps/game/src/ui/` | 战场、HUD、动画和声音，以及开始页、选关、暂停、升级与结算界面。 |
| `apps/game/src/platform/` | 浏览器生命周期、横屏和可用区域、本地存储。 |
| `apps/game/tests/` | 规则回放、会话与存档、完整浏览器路径、嵌套部署及交付验证。 |

### 状态归属与接口

- **应用状态机** 唯一持有当前页面和对局的身份。把开战、暂停、继续、确认选择、退出及确认结算路由到当前场景。关卡加载失败时提供「重试」和「返回选关」。
- **战斗核心** 接收已验证的关卡内容和种子，以固定步推进，输出状态快照与有序事件。战斗时钟独立于绘制帧率。倍速由会话调整每秒推进的模拟步数，升级选择、后台暂停和退出确认期间停止推进。
- **表现与音频** 画面只保留最新可用的位置快照。命中、实体移除、升级与结算按事件序列处理。晚到的加载或绘制先核对当前对局身份。暂停、选卡、结算保留本局画面。声音由一个管理器接收，随会话暂停或释放。
- **进度** 以稳定的应用命名空间和关卡 ID 存储已完成标记，并带 schema 版本。每关使用独立的幂等标记，避免两个标签页分别通关时互相覆盖。单项记录损坏时保住其他已验证记录。写入被拒时给出反馈，允许重试或以本次会话进度回到选关。

接口草图如下。坐标为关卡的逻辑坐标，UI 将其映射到实际可用区域。

~~~ts
type RunId = string;
type LevelId = string;
type ChoiceId = string;

interface BattleSnapshot {
  runId: RunId;
  levelId: LevelId;
  tick: number;
  phase: "running" | "choosing" | "finished";
  defense: { current: number; max: number };
  wave: { number: number; total?: number };
  actors: readonly { id: string; visualId: string; x: number; y: number }[];
  choice?: { id: ChoiceId; options: readonly string[] };
  result?: { id: string; outcome: "win" | "loss" | "ended" };
}

interface BattleEvent {
  runId: RunId;
  sequence: number;
  kind: "spawn" | "hit" | "remove" | "choice" | "finish";
  entityId?: string;
  effectId?: string;
}

interface BattleUpdate {
  snapshot: Readonly<BattleSnapshot>;
  events: readonly BattleEvent[];
}

interface BattleSession {
  start(run: RunId, level: LevelId, seed: number): BattleUpdate;
  advance(steps: number): BattleUpdate;
  confirmChoice(choice: ChoiceId, option: string): BattleUpdate;
  dispose(): void;
}

interface ProgressStore {
  read(): ReadonlySet<LevelId>;
  commitClear(level: LevelId): { saved: boolean };
}
~~~

选卡面板携带当前对局和选择请求的身份。重复确认或旧面板响应保持当前状态，结算确认提交一次。前台恢复时重新建立时钟基线，点击继续后从暂停点推进。首版从主线程开始测量。实测出现模拟更新和渲染抢占帧预算时，再用同一战斗接口评估 Worker，并重测实际 TapTap 容器。

开始页只加载入口所需资源，关卡资源在选关后加载。战场按逻辑坐标在可用区域内等比缩放。HUD 和弹层按视口与设备安全区域排版，小横屏上保持选项和主操作可见。加载完成时若页面在后台，等玩家回到前台并继续才启动战斗时钟。

### 同一产物的两种使用方式

~~~text
源码及审核通过的内容输入
              ↓
   apps/game/dist/index.html
   apps/game/dist/assets/…
           ↙           ↘
Pages /preview/       TapTap ZIP
                       tool/
                         index.html
                         assets/…
~~~

Vite 以 `base: "./"` 构建，场景切换在同一入口内完成。构建验收包含非根路径上的动态模块、字体、图片、音频与数据。工具箱 v1.0.0 快照要求 ZIP 的唯一外层目录直属 `index.html`，快照大小上限为 300 MiB。上传时以实际页面和容器结果为准。 [Vite 相对基址](https://vite.dev/guide/build.html#relative-base) · [工具箱 ZIP 与自测说明](../../local-build.md#3-发布流程)

## 4. 实施顺序

以下命令从实施工作树的仓库根运行。新模块的 npm 脚本由第 1 项建立。复用的 Python 检查在 Windows 以 `py -3 -B` 执行，在 Linux CI 以 `python3 -B` 执行。

### 1. 验证真实宿主，建立独立构建入口

**文件** `apps/game/index.html`、`apps/game/package.json`、`apps/game/package-lock.json`、`apps/game/tsconfig.json`、`apps/game/vite.config.ts`、`apps/game/src/app/bootstrap.ts`、`apps/game/tests/entry.spec.ts`。

- [ ] 以基线 SHA 建独立工作树，建立一份最小自有横屏页面。从加载状态切到开始页，再由开始按钮进入带可点击卡片的区域。探针覆盖绘制、触控、点击后播放声音，以及关闭重开后读取本地数据。
- [ ] 在 Windows 桌面和嵌套路径上检查实际构建。把探针目录封入一层 ZIP，用现有 `scripts/check_zip.py` 预检。从 Android 和 iOS TapTap 自测入口打开，从手机竖拿点开工具开始录屏，检查第一帧方向、可用区域、点击与声音。
- [ ] 根据探针决定引擎版本、依赖锁和构建目标。TapTap 宿主能否在工具打开时设置横屏是本项结论。若容器只能在首帧之后改变方向，提交实测证据和可达到的入口表现供审核，首帧横屏验收保持未通过。

~~~powershell
npm --prefix apps/game ci
npm --prefix apps/game run typecheck
npm --prefix apps/game run build
npm --prefix apps/game run test:e2e -- tests/entry.spec.ts
~~~

**交付证据** 独立构建目录、桌面测试结果、TapTap 探针 ZIP 摘要、Android 和 iOS 的首帧录屏与容器版本。实际上传和共享按你对平台操作的授权办理。

### 2. 实现应用状态机与通关存档

**文件** `apps/game/src/app/flow.ts`、`apps/game/src/platform/visibility.ts`、`apps/game/src/platform/progress.ts`、`apps/game/tests/flow.test.ts`、`apps/game/tests/progress.test.ts`。本项使用自制会话夹具交付可点通的状态机。

- [ ] 先写状态用例。首次加载必达开始页，点击开始才到选关。退出取消保留当局，退出确认返回选关。前台手动继续恢复到离开时的界面。胜利确认、失败确认和强退分别有独立断言。
- [ ] 实现上述转移和幂等进度标记。固定复现两标签页分开通关、损坏单条记录、存储被拒、重复确认、同一入口重开。关闭页面测试重新从开始页进，选关读取已结算进度。
- [ ] 在开始页和选关实点一遍，验证锁定关卡无法误入。预览和 TapTap 各用自己的存储。选关相同入口的目录 URL 与 `index.html` 归到同一产品命名空间。

~~~powershell
npm --prefix apps/game run test:unit -- tests/flow.test.ts tests/progress.test.ts
~~~

**交付证据** 上述状态分支各有通过用例。页面重开和保存失败的画面行为有浏览器断言。

### 3. 实现可独立验证的自动战斗与内容加载

**文件** `apps/game/src/battle/session.ts`、`apps/game/src/battle/clock.ts`、`apps/game/src/content/catalog.ts`、`apps/game/tests/battle.test.ts`、`apps/game/tests/catalog.test.ts` 和自制测试场景。

- [ ] 用自制场景固定入场、自动推进、需要选择、选择应用、完局的状态断言。种子、内容版本和输入序列相同时对比关键快照及结果。重复选择、过期选择和不同对局 ID 分别有独立断言。
- [ ] 将规则推进和资源加载分开。校验关卡 ID 唯一、解锁关系可达、依赖资源存在、结束类型能解析。普通关和循环模式通过内容表选择自己的结束判定。
- [ ] 接上应用会话。关卡加载完成自然开战，升级挂起模拟，继续推进同一局。用不同的绘制间隔重放同一批输入，关键快照和结果一致。

~~~powershell
npm --prefix apps/game run test:unit -- tests/battle.test.ts tests/catalog.test.ts
~~~

**交付证据** 不启动界面也可自动验证开局、选择和结果。第二个自制验证关走同一套会话接口。

### 4. 做出第一局完整的玩家体验

**文件** `apps/game/src/presentation/battle-view.ts`、`apps/game/src/presentation/audio.ts`、`apps/game/src/ui/level-screen.ts`、`apps/game/src/ui/overlays.ts`、`apps/game/src/ui/layout.css`、`apps/game/tests/playthrough.spec.ts`、`.github/workflows/pages.yml`。

- [ ] 用一套自有内容把开始页、选关、自动开战、升级选择、结果和解锁串起来。用轻量提示讲清防守目标、首次选择以及退出后如何重试。
- [ ] 将弹层与绘制解耦。每次点击有明确反馈，升级和结算保留战场。声音在正常触控或鼠标手势后启动，切后台后保持安静，继续时按当前会话恢复。
- [ ] 实点桌面与相当于 `844×390` 的小横屏。让第一次接触玩法的人自己完成首次选卡，观察他能否说明选项的作用，再确认能正常回选关。录下误触、裁切或看不清的具体位置。
- [ ] 验证一次完整胜利、一次失败和一次主动退出。包含双击确认、卡片打开时切后台、快速重试和刷新后读取进度。
- [ ] 首局跑通后，把经确认可公开的开发候选挂到 Pages 的 `/preview/`，从预览链接实点同一批流程。之后每个开发候选可用同一地址复验。

~~~powershell
npm --prefix apps/game run build
npm --prefix apps/game run test:e2e -- tests/playthrough.spec.ts
~~~

**交付证据** 从最终构建实点完成一局，选关页可见已通关标记和下一关解锁。失败与退出也能回到选关。新手看懂程度有实际观察记录。

### 5. 扩到完整内容并验证共用能力

**文件** `apps/game/src/content/release-catalog.json`、`apps/game/src/content/asset-provenance.json`、`apps/game/tests/catalog-coverage.test.ts`、`apps/game/tests/dense-wave.spec.ts`。全量接入以前，以审定的自有规则、资源和首发内容清单作为输入。

- [ ] 用第二个关卡验证更换地图、敌群和节奏的成本。关卡文件使用共用的开战、模拟、提示、选卡和结算路径。新增一种能力时先写共用能力测试，再从关卡引用。
- [ ] 逐项比对首发清单和实际加载结果。各关都有进入、结束和返回路径。正常胜负、循环模式、低耐久、密集来敌和多效果叠加分别有场景记录。
- [ ] 在第一项选定的真实设备上测首屏耗时、最密集波次的帧耗时与卡片确认反馈。记录设备、容器、构建号和场景。基于实际测量审核性能预算，再处理数据指出的瓶颈。

~~~powershell
npm --prefix apps/game run test:unit -- tests/catalog-coverage.test.ts
npm --prefix apps/game run test:e2e -- tests/dense-wave.spec.ts
~~~

**交付证据** 关卡清单逐项有结果，共用机制覆盖和最密波次的真机记录可复查。对外首发须满足本项和最终交付验收。

### 6. 打通同构建预览和 TapTap 首发验收

**文件** `scripts/package_zip.py`、`scripts/check_zip.py`、`tests/test_packaging.py`、`.github/workflows/pages.yml`、`.github/workflows/web-game-candidate.yml`、`README.md`。

- [ ] 给打包脚本加显式目录名参数。用现有测试锁定旧调用的默认结构。新构建生成逐文件长度、SHA-256 和来源清单，按现有清单协议审核。用 ZIP 检查器确认唯一外层目录、直属 `index.html` 和相对路径，逐文件验证与同次构建字节一致。
- [ ] 网页候选 CI 从干净检出安装锁定依赖，构建一次，依次执行类型、规则、浏览器与包体检查，上传带提交号的 `dist` 和 ZIP。Pages 的 `/preview/` 取同一候选的 `dist`，记录站点部署与 ZIP 对应的提交号和摘要。
- [ ] 在 TapTap 电脑端工具页、Android 和 iOS 自测入口分别检查选关、完整一局、后台恢复、结算、重载与资源加载。Android 和 iOS 另录制冷启动首帧，确认从进入工具起就是横屏。验收通过后按工具箱当前页面提交已经测过的 ZIP，并在 README 标明新产品的入口、运行和打包步骤。

~~~powershell
py -3 -B -m unittest discover -s tests -p test_packaging.py
npm --prefix apps/game run test:unit
npm --prefix apps/game run test:e2e
~~~

下面是打包命令。`reviewed-files.json` 是本项生成的审核清单，`artifacts` 为同次构建已经建立的输出目录。

~~~powershell
py -3 -B scripts/package_zip.py --build apps/game/dist --manifest artifacts/reviewed-files.json --wrapper tool --out artifacts/tool.zip
py -3 -B scripts/check_zip.py artifacts/tool.zip
Get-FileHash artifacts/tool.zip -Algorithm SHA256
~~~

**交付证据** 静态预检返回 `STATIC_PREFLIGHT_ONLY`。另有 Pages 子路径实测、TapTap 三端自测记录及 ZIP 摘要。提交审核和上线状态分别按平台回读。

## 5. 审核与最终验收

| 验收项 | 通过条件 | 实施项 |
| --- | --- | --- |
| 横屏与入口 | 手机从工具入口冷启动，录屏第一可见加载画面即为横屏。结束加载后经开始页进入选关。 | 1、2、6 |
| 自动对局与升级 | 点击已解锁关卡自然开战，首次选择清楚可用，确认后从原局继续。小横屏能同时看到选项和确认控件。 | 3、4 |
| 生命周期 | 切走立即暂停，回前台等手动继续。退出确认回选关，系统回收后重开到开始页。 | 2、4、6 |
| 结算与存档 | 胜利产生一次可重载的本地进度。失败和退出路径返回选关。存储拒绝有可理解的反馈。 | 2、4 |
| 内容完成度 | 审定清单里的关卡和模式均能从正常入口实测。共用结构可承载不同场景及高密度表现。 | 3、5 |
| 发布产物 | 一个构建供 Pages 和 `tool/index.html` 包体使用。三端按同一版本验收。 | 1、4、6 |

请审核这几项拟定决策。

1. 同仓库建立独立产品入口，TypeScript + Vite + Phaser 为首选路线，以 TapTap 容器探针结果确认。
2. 回前台后等玩家点「继续」。通关记录在胜利结算确认时写入，写入异常可反馈并重试。
3. 开发预览按小步验收推进，第一次面向玩家的交付按完整内容清单和真机结果验收。
4. 本稿的实施内容来源为自有设计与自有或可公开使用的资源。已有工作作为分析和验证参考。
