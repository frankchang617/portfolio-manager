# 投资组合管理系统 — 任务交接文档

**更新日期**：2026-05-30（第三十四次，日历改逐日市值法 + 修 YTD 高估）  
**技术栈**：React 18 + Vite + Tailwind CSS v3 + Recharts + Supabase  
**运行地址**：http://localhost:5173（本地）/ https://frankchang617.github.io/portfolio-manager/（公网）

---

## 最新状态（2026-05-30，第三十四次）✅

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

## 历史状态（2026-05-29，第三十三次）✅

### 走势图最后一天数据骤降修复

**问题**：走势图最后一天（今天）总资产从 ~$44K 骤降到 ~$24K，与卡片 $48.19K 不符。

**根因**：`historicalAssetData` useMemo 把今天也纳入 Yahoo Finance 历史价格范围（`date <= todayStr`）。Yahoo Finance 历史 API 对今天只有**部分股票**有数据（尚未收盘），导致只计算了部分持仓。

**修复（`src/components/Dashboard.jsx`）**：
1. 历史数据范围改为 `date <= yesterdayStr`（排除今天）
2. 今天单独用 **Finnhub 实时价格**（`prices[sym]?.price`）计算，追加为最后一个数据点
3. `useMemo` 依赖数组新增 `prices`

**效果**：走势图末尾点与卡片总资产口径一致（都用 Finnhub 实时价格）。

---

## 历史状态（2026-05-29，第三十二次）✅

### 走势图移除期权内在价值调整

**问题背景**：用户发现走势图末尾总资产 ≠ 跨组合总资产卡片，排查出三个原因：
1. 价格来源不同（Yahoo Finance 历史 vs Finnhub 实时）
2. 走势图对期权计算了内在价值（买方加、卖方减），卡片 `totalValue` 不含此项
3. 日期不同（走势图末尾是上一交易日，卡片是今日实时）

**修改**：删除 `historicalAssetData` useMemo 中期权内在价值调整的整段代码（原 Dashboard.jsx ~497-510 行），走势图仅保留：股票市值 + `cashAtDate`（含期权现金流逆推）。

**决策**：期权不作为资产/负债计入走势图，与卡片口径一致（股票 + 现金）。

---

## 历史状态（2026-05-29，第三十次）✅

### 总览资产走势图：从最早交易记录日期开始绘制（commit `db8defb`）

**改动（`src/components/Dashboard.jsx`）**：

新增两个模块级辅助函数：
- `positionAtDate(stock, targetDate)`：重放交易记录，返回指定日期的持仓数量
- `cashAtDate(portfolio, dateStr)`：从当前 `portfolio.cash` 倒推，逆向还原历史日期的现金余额（undo 之后的买入/卖出）

新增组件内 state 与 effect：
- `histPrices` state + `fetchedSymbols` ref + useEffect，对所有非聚合组合的股票批量拉取 Yahoo Finance 5 年历史价格（与 DailyPnLCalendar 共享同一 localStorage 缓存 `yf_hist_v1`）

新增 `historicalAssetData` useMemo：
- 找出所有组合中最早的交易日期作为起点
- 遍历 histPrices 中所有有数据的交易日
- 每天总资产 = Σ 股票(持仓数 × 当日收盘价) + Σ 组合(历史现金)
- 过滤掉 totalValue = 0 的天

更新 `snapshotData` useMemo：
- 优先用 `historicalAssetData`；未加载完成时 fallback 到原 `state.dailySnapshots`

图表空状态：
- 加载中：「加载历史价格数据中…」(animate-pulse)
- 无数据：「暂无足够数据显示走势图」

---

## 历史状态（2026-05-29，第二十九次）✅

### 日历格子区分股票/期权已实现盈亏（commit `8e68995`，已推送）

**改动**：
- `dailyData` 新增 `stockRealized`、`optionRealized` 字段（`realized` 保留为两者之和）
- 格子显示：同一天同时有股票和期权已实现盈亏时，分两行显示「股 ±$X」/ 「期 ±$X」；只有一种时维持原样
- Hover tooltip：同样区分「股票已实现」/ 「期权已实现」标签，只有一种时自动识别标签名称

---

## 历史状态（2026-05-29，第二十八次）✅

### 日历盈亏页面全面重构（commit `eebeaac`，已推送）

#### 核心逻辑修正

| 项目 | 修改前（错误） | 修改后（正确） |
|------|-------------|-------------|
| 每日格子数值 | `unrealized[d]`（从买入成本算起的累计浮盈） | `unrealized[d] - unrealized[d-1]`（当天实际盈亏变动） |
| 今日格子 | 累计浮盈 | `实时浮盈 - 昨日收盘浮盘` |
| 月度未实现 | 月末快照绝对值 | `月末浮盈 - 月初浮盈`（月内净变动） |

#### 新增汇总卡片（6 张，2 行）

**第一行 — 全时段：**
- 总已实现盈亏（历史所有 realized 汇总）
- 总未实现盈亏（当前持仓实时浮盈）
- 总盈亏 = 总已实现 + 总未实现

**第二行 — 年初至今：**
- 年初至今已实现
- 年初至今未实现（当前持仓实时浮盈）
- 年初至今总盈亏 = 前两者之和

#### 技术实现要点

**`getUnrealizedAtDate(portfolios, histPrices, dateStr)`**（新辅助函数）
- 替代旧的 `calcUnrealizedAtDate`
- 返回 `null`（无价格数据，如周末/假日）或数值（有数据）
- 通过 `hasData` flag 区分「真正的 0」vs「无数据」

**`calendarDays` useMemo 重构**
- 内部 cache `{}` 避免对同一 dateStr 重复调用 `getUnrealizedAtDate`
- `getPrevSnapshot(dateStr)`：向前最多找 7 天，返回最近有数据的快照值
- 每日 `dailyUnrealizedChange = snapshot[d] - prevSnapshot[d]`
- 今日特殊处理：`currentUnrealizedPnL - prevSnapshot`（用实时价格）

**依赖顺序调整**
- `currentUnrealizedPnL` useMemo 移至 `calendarDays` 之前，因为 calendarDays 需要在今日分支中引用它

**月度未实现改为月度变动**
- 月末：从该月最后一天倒推，找到最后有价格数据的日期
- 月初：从当月 1 日前推最多 10 天，找到上月最后交易日快照
- 月度变动 = 月末快照 - 月初快照

**月度胜率改进**
- 原来只统计有 realized 交易的天数
- 现在统计所有 `dailyPnL（realized + unrealized变动）≠ 0` 的天数

---

## 已完成的功能（第二十七次，commit `c229141`）

- 顶部卡片：「{year}年已实现」→「年初至今未实现盈亏」
- 月度卡片：「月末未实现」→「月度未实现」，新增「月度总盈亏」
- `getPnlDisplay`：改为返回 realized + unrealized 之和（非优先取一个）

---

## 已完成的功能（第二十六次，commit `e64e946` / `98e26fb` / `6f7509d`）

- **IRR 年化收益**（Dashboard.jsx）：Newton-Raphson MWRR，替代 CAGR 快照方案
- **Yahoo Finance 历史价格 API**（src/utils/api.js）：`fetchHistoricalPrices`，CORS 代理 + localStorage 24h 缓存
- **历史价格接入日历**（DailyPnLCalendar.jsx）：positionAtDate 重放交易，calcUnrealizedAtDate 汇总

---

## 已完成的功能（第二十四次，commit `96b6cda` / `41be541`）

- 修复：打开网站 ~60s 后才显示价格（HYDRATE reducer 清空 prices 问题）

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
