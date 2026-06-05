# 投资组合管理系统 — 任务交接文档

**更新日期**：2026-06-05（第四十七次，持仓明细新增「成本持仓」列）  
**技术栈**：React 18 + Vite + Tailwind CSS v3 + Recharts + Supabase  
**运行地址**：http://localhost:5173（本地）/ https://frankchang617.github.io/portfolio-manager/（公网）

---

## 最新状态（2026-06-05，第四十七次）✅

### 持仓明细表新增「成本持仓」列

**改动文件**：`src/components/StockPositions.jsx`

**需求**：在持仓管理明细中加入一列「成本持仓」= 平均成本 × 股数。

**实现**：
- 列位置：表头与单元格均插入在「平均成本」与「持仓价值」之间
- 数值直接复用行计算中已存在的 `s.costBasis`（= `s.avgCost * s.shares`），未新增计算逻辑
- 现金汇总行的占位 `colSpan` 由 5 → 6（成本持仓属于「持仓价值」之前的占位列）
- 排序栏新增「成本持仓」按钮（`field: 'costBasis'`），可升降序排序
- 聚合视图（总投资组合）下自动用各子组合汇总成本显示

**验证**：`npx vite build` 通过。

---

## 最新状态（2026-05-31，第四十六次）✅

### 修复 TOS F 组合卡片「股票收益」百分比虚高

**改动文件**：`src/components/Dashboard.jsx`（`PortfolioCard` 组件，第 562 行）

**根因**：含期权的组合卡片（如 TOS F）Row 2「股票收益」显示 `stockTotalPct`：
- 分子 = `stockUnrealizedPnL + stockRealizedPnL`（当前浮盈 + **历史所有**已实现）
- 分母 = `costBasis`（**仅当前持仓**成本）
- TOS F 因大量期权策略产生了可观的股票已实现盈亏，分母相对极小，百分比虚高数倍

**修复**：改为显示 `unrealizedPct = stockUnrealizedPnL / costBasis`

| | 旧 | 新 |
|---|---|---|
| 分子 | `unrealized + realized`（跨历史） | `unrealized`（仅当前持仓） |
| 分母 | `costBasis`（当前持仓） | `costBasis`（当前持仓） |
| 口径 | 不一致，虚高 | 一致，与其他纯股票组合等效 |

**一致性**：其他纯股票组合（无大量卖出）的 `stockTotalPct ≈ unrealizedPct`（因 realized ≈ 0），改后 TOS F 与其口径统一。已实现股票盈亏已在卡片上方「已实现盈亏」格展示，信息无丢失。

---

## 最新状态（2026-05-31，第四十五次）✅

### 修复总览 TOS F 总金额 & 股票收益率两处 bug（commit 待推送）

**改动文件**：`src/components/Dashboard.jsx`

**Bug 1 — 总金额与持仓管理不一致**

| | 算法 |
|---|---|
| StockPositions `totalAssets` | `totalStockValue + cash + optionUnrealizedPnL` |
| Dashboard `totalValue`（旧） | `totalStockValue + cash`（漏掉期权浮盈/亏） |
| Dashboard `totalValue`（新） | `totalStockValue + cash + optionUnrealizedPnL` ✅ |

**Bug 2 — 未实现收益率分子错误**

`unrealizedPct` 旧算法：`(stockUnrealizedPnL + optionUnrealizedPnL) / stockCostBasis`  
→ 分子含期权，分母只是股票成本，对期权账户（如 TOS F）严重失真

`unrealizedPct` 新算法：`stockUnrealizedPnL / stockCostBasis`  
→ 纯股票浮盈率，与 StockPositions 口径一致

同步修 `totals` useMemo 的跨组合 `unrealizedPct`。

---

## 历史状态（2026-05-31，第四十三次）✅

### 总览金额改精确显示（commit `5a0cc1b`）

**改动**：`src/components/Dashboard.jsx` 中所有展示用 `fmt.large` → `fmt.currency`
- 跨组合总资产、股票持仓总值卡片
- 组合卡片总资产头部
- 走势图 tooltip 总资产
- 股票收益率 PerfCard detail（持仓成本）

**保留缩写**：图表 Y 轴刻度 `yTickFmt` 仍用 K/M（轴标签空间有限）

---

### 日历盈亏导航栏移位（commit `6a04725`）

**新顺序**：汇总面板（总览 / YTD / 月度）→ **年月选择栏** → 股票日历 → 期权日历

---

## 历史状态（2026-05-31，第四十一次）✅

### 日历盈亏界面整体压缩（commit `2feb92b`）

**改动文件**：`src/components/DailyPnLCalendar.jsx`

| 位置 | 改前 | 改后 |
|------|------|------|
| 整体间距 | `space-y-5` | `space-y-3` |
| 各卡片内边距 | `p-5` | `p-3` / `p-4` |
| 导航按钮 | `px-3 py-1.5 text-sm` | `px-2 py-1 text-xs` |
| 导航标题 | `text-xl` | `text-base` |
| 汇总卡片主数字 | `text-2xl` / `text-xl` | `text-xl` / `text-lg` |
| 汇总卡片副标签 | `text-xs mb-1 mt-1` | `text-[11px] mb-0.5 mt-0.5` |
| 汇总卡片分栏间距 | `px-5 pr-5 pl-5` | `px-4 pr-4 pl-4` |
| CalendarGrid 格子 | `min-h-[64px] gap-1.5 py-2` | `min-h-[52px] gap-1 py-1.5` |
| CalendarGrid 图例 | `gap-5 mt-4 pt-4` | `gap-3 mt-2 pt-2` |
| CalendarGrid 图例色块 | `w-4 h-4` | `w-3 h-3` |

---

## 历史状态（2026-05-31，第四十次）✅

### 修复日历盈亏白屏 bug（commit `2fd5205`）

**根因**：`CalendarGrid` 是模块级函数，但 `getCellBg` 定义在 `DailyPnLCalendar` 主组件内部，运行时抛 `ReferenceError`，点开日历页面立即白屏。

**修复**：将 `getCellBg` 从主组件内部提升至模块顶层（`CalendarGrid` 定义之前），删除主组件内的重复定义。

---

## 历史状态（2026-05-31，第三十九次）✅

### 日历盈亏拆成股票/期权两个独立日历图

**改动文件**：`src/components/DailyPnLCalendar.jsx`

**新增 `CalendarGrid` 子组件**（在 `export default` 之前）：
- Props：`title` / `calendarDays` / `getCell` / `monthlyPnL` / `loading` / `todayStr` / `dotLegend`
- `getCell(dayObj)` 返回 `{ pnl, lines:[{text,cls}], dot, hoverItems:[{label,value}] }`
- 自带独立 `hoveredDate` state，互不干扰
- 包含 hover 详情行 + 图例行，复用 `getCellBg` / `compactPnL`

**主组件改动**：
- 移除旧 `[hoveredDate, setHoveredDate]` state（已移入 CalendarGrid）
- 新增 `monthlyStockPnL` useMemo：汇总当月所有 `stockDailyPnL`（逐日市值法之和）
- 新增 `monthlyOptionPnL` useMemo：汇总当月所有 `optionRealized`
- 新增 `hasOptions`：检查当前处理的组合是否含期权
- 新增 `stockGetCell` / `optionGetCell` 函数：分别提取股票和期权每日 P&L
- 旧单一日历卡片替换为两个 `CalendarGrid` 实例

**显示逻辑**：
- 股票日历：始终显示；每格展示 `stockDailyPnL`；琥珀点 = 当日有股票落袋
- 期权日历：仅当 `hasOptions` 为 true 时显示；只有实际有期权平仓的日期才有颜色/数值

**月度汇总卡片（页面顶部三张）保持不变**，继续显示股票+期权合计。

**验证**：`npx vite build` 通过。

---

## 历史状态（2026-05-31，第三十八次）✅

### 股票/期权盈亏分离显示，修复总收益率虚高问题

**背景**：`totalPnLPct = (未实现+已实现) / costBasis` 中，分母 `costBasis` 只含当前持股成本，但分子包含期权历史已实现盈亏和股票历史卖出盈亏，造成期权为主的组合（如 TOS F）收益率虚高。

**改动文件**：`src/components/Dashboard.jsx`

**`calcPortfolioMetrics` 新增三个返回字段**：
- `stockTotalPnL = stockUnrealizedPnL + stockRealizedPnL`
- `stockTotalPct = stockTotalPnL / costBasis`（分子分母口径一致，有意义的百分比）
- `optionTotalPnL = optionUnrealizedPnL + optionRealizedPnL`（仅展示金额，无成本基准）

**`totals` useMemo** 同步新增 `stockTotalPnL` / `stockTotalPct` / `optionTotalPnL`。

**`PortfolioCard` Row 2 自适应布局**：
- 有期权收益（`optionTotalPnL ≠ 0`）→ 3 列：股票收益% / 期权收益$ / 最大回撤
- 无期权 → 2 列：总收益% / 最大回撤

**顶部 PerfCard**：「总收益率」改为「股票收益率」，detail 附注期权收益金额（若有）。

**关键决策**：期权 P&L 只展示绝对金额，不计算百分比（无有意义的成本基准）；股票百分比使用当前持仓成本作分母，口径清晰。

---

## 历史状态（2026-05-31，第三十七次）✅

### 组合卡片：年化收益 → 今日/本月/年初至今/总收益 + 保留最大回撤

**改动文件**：`src/components/Dashboard.jsx`

**新增 `calcPortfolioPerf(portfolio, histPrices, livePrices)` 模块函数**：
- 单组合版本的逐日市值法，与跨组合 `performanceMetrics` 口径完全一致
- 今日：`getStockDailyPnL([p])` + 今日期权已实现；histPrices 未加载时 fallback 到 Finnhub prevClose
- 本月/YTD：`(当前股票浮盈 − 期初浮盈) + 期间已实现`；% 分母用该组合自己的 `valueAt()` 历史值
- `valueAt(dateStr)` = 按 Yahoo Finance 重建的单组合总资产（股票市值 + `cashAtDate`）
- `realizedIn(from, to)` = 股票 sell + 期权平仓已实现之和

**新增 `portfolioPerfs` useMemo**（依赖 `allMetrics` / `histPrices` / `prices`）：
- 按 `portfolio.id` 索引，为每张组合卡片提供独立计算结果

**更新 `PortfolioCard` 组件**：
- 移除 `calcPortfolioIRR` 调用（年化收益）
- 新增 `perf` prop（来自 `portfolioPerfs[portfolio.id]`）
- 性能区改为两行：
  - 第一行（3列）：今日收益% / 本月收益% / 年初至今%
  - 第二行（2列）：总收益% / 最大回撤（保留）
- 数据未加载时显示 `—`，无加载骨架（整体卡片已有足够的结构）

**验证**：`npx vite build` 通过。

---

## 历史状态（2026-05-31，第三十六次）✅

### 性能卡片改用逐日市值法，与日历口径完全统一

**背景**：总览性能卡片原用「资产快照差值法」，与日历盈亏的逐日市值法口径不同，导致两页数字不一致。

**改动文件**：`src/components/Dashboard.jsx`

**新增模块级辅助函数**（与 DailyPnLCalendar 完全相同逻辑）：
- `offsetDate` / `prevClosePrice` / `closeOnDate` / `getUnrealizedAtDate` / `getStockDailyPnL`

**新增 `realizedMap` useMemo**：按日期汇总已实现盈亏（`{ total, optionRealized }`），供本月/YTD 累加。

**重写 `performanceMetrics` useMemo**（新口径）：
- **今日**：`getStockDailyPnL(today)` + 今日期权已实现；% 分母 = `historicalAssetData` 昨日总资产
- **本月**：`(当前股票浮盈 − 月初浮盈) + 本月已实现`；% 分母 = 上月末总资产
- **年初至今**：`(当前股票浮盈 − 年初浮盈) + 年内已实现`；% 分母 = 上年末总资产
- **总收益率**：保持 `(未实现+已实现) / costBasis`（该口径本身正确）
- histPrices 未加载时：今日 fallback 到 Finnhub todayPnL，本月/YTD 显示加载骨架

**第三十五次（同 session）**：新增 `PerfCard` 组件 + 4 张卡片置于总览顶部。

**关键决策**：月度/YTD「未实现变动」只计股票（无期权逐日价格），期权仅在平仓日计已实现，与日历完全一致。

---

## 历史状态（2026-05-30，第三十四次）✅

### 日历盈亏改用「逐日市值法（Mark-to-Market）」+ 修 YTD 高估

**背景问题**：旧逻辑里卖出当天把整个持有期的已实现盈亏（`t.realizedPnL` = 卖价−成本）一次性记到当天，导致「赚钱的卖出」即使当天股价下跌也显示绿色大赚，无法反映当天真实表现。

**改动文件**：`src/components/DailyPnLCalendar.jsx`

**① 日历格子改逐日市值法**
- 新增模块函数 `prevClose(histPrices, sym, dateStr)`、`closeOn(histPrices, livePrices, sym, dateStr, todayStr)`、`getStockDailyPnL(...)`
- 单日股票盈亏公式（equity-change 形式，可严格对账，全程加总=已实现+未实现）：
  - `持仓(开盘) × (今收 − 昨收)` + `Σ当日买入 × (今收 − 买入价)` + `Σ当日卖出 × (卖出价 − 今收)`
  - 注意卖出项用 `(卖价 − 今收)`，因为开盘持仓已含被卖股票的全日波动
- 今天用实时价 `state.prices`（closeOn 内处理），昨收取最近交易日历史收盘
- `calendarDays` 每天产出 `stockDailyPnL`（替代旧 `dailyUnrealizedChange`）
- 期权无逐日价格 → 仍按平仓日记一次性 `optionRealized`（已说明局限）
- 格子数值 = `stockDailyPnL + optionRealized`；股票+期权同日时两行「股/期」

**② getCellBg/getPnlDisplay 重写**
- `getCellBg(pnl)`：纯按正负绿/红，去掉旧蓝色「仅浮盈」配色
- `getPnlDisplay` 返回 `{ pnl, stockDaily, optionRealized, hadRealizedTrade, realized }`
- 琥珀色圆点 = 当日有平仓（落袋），替代旧「仅未实现」蓝点
- hover 详情新增「当日落袋（已实现）」行，同时保留「股票当日变动」「期权已实现」

**③ 修「年初至今·未实现」高估**
- 旧：YTD 未实现 = `currentUnrealizedPnL`（含跨年持仓往年浮盈，高估，且与总览未实现完全相同）
- 新：`ytdUnrealizedChange = currentUnrealizedPnL − 年初浮盈`（年初浮盈取上年最后交易日 `getUnrealizedAtDate`）
- YTD 卡片标签：「未实现」→「未实现变动 / 较年初浮盈」，「已实现」副标题→「1月1日起落袋」
- 总览·未实现保持 `currentUnrealizedPnL` 不变（全时段累计本就正确）

**保留**：所有「已实现」汇总卡片口径不变（`realizedPnL` = 卖价−成本−手续费，真实落袋）。月度卡片 `已实现 + 未实现变动` 公式不变，恰好 = 当月逐日市值法之和。

**验证**：`npx vite build` 通过。

**关键决策**：日历=「表现口径」（每天真实涨跌），已实现卡片=「会计口径」（落袋），两者并存且互不污染。

---

## 已完成的功能（第二十六次，commit `e64e946` / `98e26fb` / `6f7509d`）

- **IRR 年化收益**（Dashboard.jsx）：Newton-Raphson MWRR，替代 CAGR 快照方案
- **Yahoo Finance 历史价格 API**（src/utils/api.js）：`fetchHistoricalPrices`，CORS 代理 + localStorage 24h 缓存
- **历史价格接入日历**（DailyPnLCalendar.jsx）：positionAtDate 重放交易，calcUnrealizedAtDate 汇总

---

## 关键文件路径

| 文件 | 用途 |
|------|------|
| `src/components/DailyPnLCalendar.jsx` | 日历盈亏（最近大幅修改） |
| `src/components/Dashboard.jsx` | 总览 + IRR 年化收益 |
| `src/utils/api.js` | Finnhub + Yahoo Finance 历史价格 |
| `src/lib/supabase.js` | Supabase 客户端 |
| `src/contexts/PortfolioContext.jsx` | 状态管理（Supabase 同步） |
| `src/index.css` | CSS 变量主题 |

---

## 注意事项

1. **日历每日值是当天变动，不是累计快照**：`unrealized[d] - unrealized[d-1]`
2. **今日用实时价格**：`currentUnrealizedPnL` 需在 `calendarDays` 之前定义
3. **histPrices 只含交易日**：weekends/holidays 无数据 → `getUnrealizedAtDate` 返回 null，向前追溯最多 7 天
4. **corsproxy.io CORS 代理**：Yahoo Finance 历史价格依赖此代理
5. **PostCSS 无 nesting 插件**：index.css 所有 `.dark` 覆盖必须平铺写法

---

## 当前待办

无明确待办。所有用户本次请求均已实现并推送。
