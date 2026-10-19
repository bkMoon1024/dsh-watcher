中文 · [English](./README.en.md)

# Watcher

[![ci](https://github.com/daha1216/dsh-watcher/actions/workflows/ci.yml/badge.svg)](https://github.com/daha1216/dsh-watcher/actions/workflows/ci.yml)

## 安装

### DSH Studio 桌面 App（推荐）

打开 **设置 → 插件 → 添加插件**，在“包名或地址”中输入：

```text
github:daha1216/dsh-watcher#v0.6.3
```

桌面端插件管理器负责 Desktop profile 和内置包管理器。本发布已提交 `lib/`；普通使用不需要 clone、构建或安装 DSHX。若应用提示刷新或重新打开，请按提示完成。

### Web CLI

```sh
dsh plugin --profile web add github:daha1216/dsh-watcher#v0.6.3
```

这条官方 CLI 命令只写入 `web` profile，不能修改 Desktop App 的 profile。对于已经运行的 Web Host，请重新打开该 Host 一次，再刷新网页。

需要 DeepSeek Harness **0.1.7-rc.2**（`@deepseek-ai/dsh@0.1.7-rc.2`）。peer 范围 `>=0.1.7-rc.1 <0.1.8 || ^0.2.0-rc.1`：0.1.7-rc.1、0.1.7-rc.2 和 **0.2.0-rc.x** 都能装，开发与测试仍以 0.1.7-rc.2 为准。Node `^22.19.0` 或 `>=24`。

DeepSeek Harness Web 的只读插件。点会话标题栏里的眼睛，把 Session 收成一张能折叠的工作路径：这轮走了几步、跑了几次、花了多久；再展开某一步看并行分支、工具结果，或一条默认折着的推理记录。

它不往对话里塞消息，不编隐藏思维链，也不替代官方 Trajectory。

![从逐项切到归类：两次改 package.json 收成 ×2](docs/screenshots/switch-mode.gif)

![三轮都收着，留下阶段数、执行数和 tok/s](docs/screenshots/collapsed-turns.png)

![第三轮展开：并行步骤还在原来的 Step 里](docs/screenshots/overview.png)

![步骤 2：glob 和 grep 两项并行](docs/screenshots/parallel.png)

![归类：修改 package.json ×2，展开仍是步骤 5 和 6](docs/screenshots/grouped.png)

> 截图取自 0.6.2。0.6.3 起面板改为命令栏布局、检视器为覆盖式抽屉；未发布的视觉重整又统一了 token 与原生控件，画面差距更大，截图待补。

归类只叠能证明相同的调用。两条不同的 bash 不会被捏在一起。模型阶段只显示供应商已经写进 Session 的可见 reasoning；没有记录就写未记录。

已经 clone 过的目录也可以（开发/本地测试）：

```sh
git clone https://github.com/daha1216/dsh-watcher.git
dsh plugin --profile web add ./dsh-watcher
```

同样需要 pnpm，然后重新打开该 Web Host 并刷新页面。

```sh
dsh plugin --profile web remove dsh-watcher
```

官方 CLI 只管理 `web` profile；Desktop App 请使用上面的应用内“添加插件”入口。

设置页和会话 HUD 的 Token 总数旁有 **估算费用**（不是「总价值」）。按模型的输入 / 输出 / 缓存桶对照 `pricing/models.yaml` 计价；缺行显示 **未知**，不会当成 $0。部分已知时主数字只显示已标价金额，未标价写在脚注。这是估算，不是账单。默认表含 DeepSeek、MiniMax、OpenAI、Anthropic、Gemini、Grok、GLM、Qwen 主流行，不联网。设置里打开的是当前生效价格表；保存只把改动过的行写入 `localStorage` 键 `dsh-watcher:pricing-override:v1`。欢迎对默认表提 PR。

交互约定在 [DESIGN.md](./DESIGN.md)。MIT。

## 本次更新（未发布）

- **结构与视觉重整，行为不变。** `Watcher.tsx` 从 2029 行降到 758 行；`Insights.tsx`（2142 行）拆成会话 HUD、设置页、检视器、概览、模型阶段、分析模块与六个 `insights-sections/` 文件。样式模块从三个变成五个，其中一个只放共享词表。契约测试固定的图标、文案与接线字符串保持原样。
- **一套语义变量。** 所有样式模块改读 `src/client/ui/tokens.module.css` 的 `--ui-*` 别名层：十六进制色值归零，不再直接引用 `--dsw-static-*`，也不再保留 `var(--dsw-*, 回退值)` 写法。别名层作为 class 挂在每个客户端根元素上（跨文件 `composes` 在插件的 css-modules 构建里不生效），主题 token 仍靠继承下传。
- **能用宿主控件就用宿主控件。** 设置页的保存 / 刷新与数值上限改用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button` 与 `Input`；组织 / 深度、统计范围、模型、时间范围四个开关换成新增的 `ui/SegmentedToggle`，视觉配方照抄宿主分段控件。它是有标签的 `role="group"` 切换按钮组，而不是宿主的 `SegmentedControl`：这些开关只改变同一内容的呈现方式，没有可供 `aria-controls` 指向的面板。
- **深度回到一个宿主阴影加一条描边。** 去掉顶部高光、接触 / 主 / 环境三层阴影与图表装饰光晕；悬停改用宿主填充和焦点环，不再用 `filter: brightness()` 与卡片上浮。
- **可访问性与可读性。** HUD 的洞察卡与会话表格行原本是可点击的 `div`、键盘不可达，现在是真正的按钮；说明性小字抬到宿主 11px 下限，小控件命中区扩大到 24px；热力图准星改为焦点环描边。
- **设置页不再在渲染路径里重算统计。** 聚合、分布与会话表格每次扫描只算一次，只有扫描结果或时间范围变化时才重算。
- **扫描失败不再伪装成空账本。** 失败会直接说明；首次扫描与「确实没有数据」区分开；被截断或跳过的会话在脚注里点名。
- **清掉死样式。** 删除历史提示、会话计时等无人使用的样式块与约 30 个无引用类；拖拽 / 缩放 / 边界钳制逻辑移到 `panel-geometry.ts` 的 `usePanelGeometry`，组件只负责渲染。

- **面板拆成两个真正的 tab。** 顶栏的「工作路径 / 会话统计」用宿主 `SegmentedControl` 实现，并补齐 `*-panel` 面板。统计原先压在路径上方、共用同一个滚动区：HUD 一大，每次操作路径都要为它付渲染成本，路径也没法独占滚动位置。
- **路径工具栏。** 新增搜索框（标题 / 工具 / 阶段）、「全部 / 异常 / 等待」状态筛选，以及逐页往回翻的「载入更早」（`loadOlderPage`），「载入全部历史」保留为更重的次选动作。筛选时只保留命中项所在阶段并自动展开；搜不到时给出空态说明，而不是留一条空轨道。
- **检视器不再重复执行路径。** 保留头部、指标与「结果 / 输入 / 原始」三个 tab，新增记录步进器：「上一条 / 下一条」加 `记录 K/M` 位置，并接上方向键；切换记录不必退回路径。详情 tab 也补上了 `id` / `aria-controls` / `tabpanel` 语义。
- **Esc 分层。** 有记录打开时只关详情并把焦点还给路径；没有记录时才关面板。详情打开时方向键在记录间移动，输入框与可编辑区域内不拦截。
- **宽面板分栏。** 面板被拖宽到 980px 以上时，详情停靠在路径右侧而不是盖住它；更窄时仍是覆盖式抽屉。阈值用 `ResizeObserver` 量面板本身，而不是视口媒体查询——面板可以被拖得比窗口断点更宽。
- **设置页分成四个 tab。** 「概览 / 趋势 / 会话 / 偏好」各管一段，时间范围控件在「偏好」页隐藏（那里不适用）；下钻改为覆盖在页面上的对话框（背景遮罩、Esc 关闭、焦点还给打开它的卡片），不再往页面中间插块把下文推下去。
- **会话账单。** 加搜索框与「显示更多会话」分页（每次 10 行），标题行保留排序控件，副标题补上总数。
- **面板筛选与 tab 是组件状态**，切会话时随面板其余状态一起重置；`locateEvidence` 会先切回「工作路径」并清空筛选，再滚动到失败记录。
- **修掉一处真实缺陷。** `Watcher.module.css` 里未读按钮与折叠开关的 `:focus-visible` 规则丢失了声明块（声明被 `.railViewport` 吞掉），这些控件一直没有可见焦点环；规则已恢复，新增的步进器与返回按钮也一并纳入。
- **清掉死样式。** 检视器不再渲染执行列表后，删除 14 个无引用类（`.executionSection`、`.executionList`、`.stepBlock`、`.occurrence*` 等）；契约测试改为断言耗时真正渲染的位置（`.overviewStepSignals`、`.overviewOccurrenceDuration`）。

## 上次更新（0.6.3）

- **面板换成实心仪表盘。** 去掉毛玻璃：不透明底色、1px 描边、顶部高光与分层阴影；图表 tooltip 和计时卡统一到同一套表面变量。
- **顶栏改成两行命令栏。** 上行是状态行（圆点、状态、实时动作、跟随），下行是下沉的控制行（计数与历史加载、归类/深度切换）。轮次改成章节式排版；检视器从挤压列改成覆盖式右侧抽屉，展开时工作路径不再回流，面板宽度也不变。
- **阶段行压成单行。** 从 80–100px 的两行头压到 34px 一行（标记、箭头、标题与徽章、右对齐的步骤/执行/耗时），完整措辞保留在 aria-label；行底加 2px 时长占比条，一眼看出时间花在哪。同样的面板高度大约能多放 2.5 倍的行。
- **设置页与 HUD 统一视觉。** 四个等宽指标块、带语义色的洞察卡、去 emoji 的下钻面板，硬编码色值全部换成 dsw token 与 `color-mix`。
- **折叠内容不再占 DOM。** 收起的分支按需渲染，空闲面板不再每秒遍历历史子树；一轮里只有正在执行的阶段订阅 1Hz 时钟。
- **更快、更省内存。** 同一次折叠在真实 3,409 事件会话上快 37%（35.4ms → 22.1ms）且输出逐字节一致；面板关闭时不再折叠；长期驻留的合并结果与诊断集合都有上限。
- **兼容与工程化。** peer 范围放宽到 `>=0.1.7-rc.1 <0.1.8 || ^0.2.0-rc.1`；补上 typecheck / build / test 的 GitHub Actions。

## 0.6.1

- 在官方 DeepSeek Harness **0.1.7-rc.2** 上核对通过。`@deepseek-ai/dsh-*` 的 peer 仍是 `>=0.1.7-rc.1 <0.1.8`，安装期接受 `0.1.7-rc.1` 和 `0.1.7-rc.2`，不接受 `0.1.7-alpha.*`。
- 图标仍是 `IconChevronRightOutlineRegular`、`IconRefreshOutlineRegular`、`IconCheckOutlineRegular`、`IconCopyOutlineRegular`。rc.2 同样没有带尺寸后缀的旧导出。

## 0.6.0

- 对齐官方 DeepSeek Harness **0.1.7-rc.1**。`@deepseek-ai/dsh-*` 的 peer 改为 `>=0.1.7-rc.1 <0.1.8`，安装期接受 `0.1.7-rc.1`，不接受 `0.1.7-alpha.*`。
- 图标改为 `IconChevronRightOutlineRegular`、`IconRefreshOutlineRegular`、`IconCheckOutlineRegular`、`IconCopyOutlineRegular`。rc.1 删掉了带尺寸后缀的旧导出，没有别名。

## 0.5.0

- **面板能拖大。** 右边缘、下边缘和右下角把手都能拖；位置全程不动，最小只能缩回打开时的默认尺寸，不会小到放不下内容。
- **HUD 可折叠成一行。** 范围切换旁多了一个 `▾`，收起只留顶栏统计，选择会被记住。
- **"定位现场"真的到现场。** 现在会选中告警对应的具体失败步骤、直接打开检视器，而不是只滚到轮次标题。
- **连续失败不再刷屏。** 同一条失败链更新同一张卡片，标题带上 `第 N 轮`。

外加一串 0.4.5 的修复：检视器返回不再抢跟随、首次选范围不重复扫会话、投影状态不再存一份自身视图、计时面板文案改为"终端以外的工具"。

历史版本见 [CHANGELOG.md](./CHANGELOG.md)。

## 从源码构建

日常安装不用这一步。改 TypeScript 后用 **pnpm** 重建已提交的 `lib/`：

```sh
pnpm install
pnpm test
node scripts/link-harness-dependencies.mjs /path/to/harness
pnpm build
```

`pnpm build` 需要能解析 `@deepseek-ai/dsh-*` peer 的本机 Harness 检出。装插件不要走这条路径。

冷会话的 Chat 数据尚未到达时，Watcher 显示等待提示，数据到达后再挂载面板。
