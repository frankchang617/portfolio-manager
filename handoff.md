# 投资组合管理系统 — 任务交接文档

**更新日期**：2026-05-29（第二十六次，规划并实施 IRR 年化收益 + 日历P&L汇总 + Yahoo Finance 历史价格）  
**技术栈**：React 18 + Vite + Tailwind CSS v3 + Recharts + Supabase  
**运行地址**：http://localhost:5173（本地）/ https://frankchang617.github.io/portfolio-manager/（公网）

---

## 当前进行中（2026-05-29，第二十六次）

### 三项并行开发：IRR年化收益 + 日历P&L汇总 + Yahoo Finance 历史价格

#### 背景分析
用户已上传完整交易记录（每笔含 date、action、price、shares、commission），
当前年化收益依赖 dailySnapshots（每次刷新价格才存一条），新组合快照太少导致显示 `—`。

#### 方案决策

**1. 年化收益 → IRR（内部收益率）替换 CAGR**
- 文件：`src/components/Dashboard.jsx` → `calcAnnualizedReturn` 改为 `calcIRR`
- 每笔买入 = 负现金流，每笔卖出 = 正现金流，今日市值 = 最终流入
- Newton-Raphson 迭代解日利率 → 年化：`(1+r)^365 - 1`
- 优势：不依赖快照，第一笔交易后即可算出

**2. 日历盈亏汇总 → 月度/年度/年初至今已实现盈亏**
- 文件：`src/components/DailyPnLCalendar.jsx`
- 数据来源：股票 sell transactions `realizedPnL` + 期权 closeDate `realizedPnL`
- 新增页面顶部汇总栏：本月已实现、本年已实现、年初至今（YTD）

**3. 历史每日收盘价 → Yahoo Finance 免费 API**
- 端点：`https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5y`
- 支持美股（AAPL）、港股（0700.HK）、新加坡（D05.SI）
- 缓存到 localStorage，避免重复请求
- 用于：日历历史格子的未实现盈亏（按持仓状态重算）

#### 已完成
- [x] 读取 DailyPnLCalendar.jsx 和 PortfolioContext.jsx 数据结构
- [x] Dashboard.jsx：IRR 算法替换 snapshot-based CAGR
- [x] DailyPnLCalendar.jsx：新增年度/YTD 已实现盈亏汇总卡片
- [x] src/utils/api.js：新增 fetchHistoricalPrices（Yahoo Finance + localStorage 24h 缓存）

#### 待做（下一步）
- [ ] DailyPnLCalendar 接入历史价格，历史格子显示当日未实现盈亏（需先重放交易记录算出当日持仓）

---

### 关键实现细节

#### IRR（`src/components/Dashboard.jsx`）
- 新增 `solveIRR(flows)` — Newton-Raphson，最多 300 次迭代
- 新增 `calcPortfolioIRR(portfolio, prices)` — 从 transactions 收集现金流：
  - 买入 = `-(price × shares + commission)`
  - 卖出 = `+(price × shares − commission)`
  - initialShares > 0 时：当作第一笔交易前一天的买入
  - 今日市值（含 cash）= 终值现金流入
- `PortfolioCard` 改接 `prices` prop，调用 `calcPortfolioIRR` 取代快照 CAGR

#### 年度/YTD 汇总（`src/components/DailyPnLCalendar.jsx`）
- `yearlySummary`：当前查看年份所有 `dailyData[date].realized` 之和
- `ytdSummary`：当年 1 月 1 日 → 今天的 realized 之和
- 日历页面顶部新增 2 张卡片：「{year} 年已实现盈亏」和「年初至今（YTD）已实现盈亏」

#### Yahoo Finance API（`src/utils/api.js`）
- `fetchHistoricalPrices(symbol, range='5y')`
- CORS 代理：`https://corsproxy.io/?{encoded_url}`
- 支持格式：US=`AAPL`，HK=`0700.HK`，SG=`D05.SI`，TW=`2330.TW`
- 缓存：localStorage key `yf_hist_v1`，24 小时 TTL
- 返回 `{ 'YYYY-MM-DD': closePrice }` 字典

---

## 本次已完成的功能（2026-05-29，第二十五次）

### 修复：总览组合卡片年化收益显示天文数字

**问题**：致富证券等组合卡片中「年化收益」显示 `+237918430674848384.50%`，数值完全失真。

**根本原因**（`src/components/Dashboard.jsx` → `calcAnnualizedReturn`）：

年化收益使用 CAGR 公式：`(终值/初值)^(365/days) - 1`

当快照数据时间跨度极短（如仅 1–2 天）时，指数 `365/days` 会达到 365 甚至更高，将任何微小涨幅放大成天文数字。

**修复（commit 即将提交）**：

```js
// 修复前
if (days < 1) return null
return (Math.pow(last.totalValue / first.totalValue, 365 / days) - 1) * 100

// 修复后
if (days < 30) return null  // 不足30天数据，年化无意义
const result = (Math.pow(last.totalValue / first.totalValue, 365 / days) - 1) * 100
if (!isFinite(result) || Math.abs(result) > 9999) return null  // 超过9999%视为异常
return result
```

两道防护：
1. **`days < 30` → null**：不足 30 天的快照，年化计算无统计意义，显示 `—`
2. **`Math.abs(result) > 9999` → null**：兜底防浮点溢出，避免天文数字渗出

---

## 本次已完成的功能（2026-05-24，第二十三/二十四次）

### 彻底修复：打开网站后需等 ~60 秒才能看到最新数据

#### 根本原因（`src/contexts/PortfolioContext.jsx`）

**时序问题全链路**：
```
T=0:  挂载 → refreshPrices() 立即触发（Finnhub 开始请求）
T=2:  Finnhub 返回 → SET_PRICES → prices 有数据 ✅
T=3:  Supabase 返回 → HYDRATE 派发
      └─ ❌ reducer 第 554 行: prices: {} 把刚拿到的价格全部清空！
T=3+: refreshPrices useCallback 因 portfolios 变化而重建
      timer effect 重置 60s 计时器，但没有立即调用 refreshPrices()
T=63: 60 秒后定时器才触发 → 价格终于出现
```

另外用户反映**刷新按钮没有反应**：因为 GitHub Pages 首次加载时 localStorage 为空，
`state.portfolios = [samplePortfolio]`（仅聚合组合，无子组合），
`refreshPrices()` 第一行 `subPortfolios.length === 0` 直接 return，
Supabase HYDRATE 完成前点击刷新全部无效。

#### 修复一（commit `41be541`）

新增 `justHydratedRef = useRef(false)`，HYDRATE 完成后立即调用 `refreshPrices()`：
```js
// cloudLoad effect 中
justHydratedRef.current = true
dispatch({ type: 'HYDRATE', payload: cloudData })

// 新增 effect
useEffect(() => {
  if (justHydratedRef.current) {
    justHydratedRef.current = false
    refreshPrices()
  }
}, [state.portfolios, refreshPrices])
```

#### 修复二（commit `96b6cda`）— 更根本的修复

直接去掉 HYDRATE reducer 中的 `prices: {}`：

```js
// 修复前
return { ...state, ...saved, portfolios, ..., prices: {}, isLoading: false }

// 修复后
return { ...state, ...saved, portfolios, ..., isLoading: false }
// （保留 state.prices，prices 本来就不存云端/localStorage，...saved 不带 prices）
```

**修复后时序**：
```
T=0:  挂载 → refreshPrices() → Finnhub 请求
T=2:  Finnhub 返回 → prices 有数据 ✅
T=3:  HYDRATE → prices 保留（不清空）✅ + justHydratedRef effect 再发一次请求（新 symbol 用）
T=4:  第二次 Finnhub 返回 → prices 更新 ✅
```

两个 commit 双保险，彻底消除 ~60 秒等待。

---

## 本次已完成的功能（2026-05-21，第二十二次）

### 1. 日历盈亏 — 今日未实现盈亏计算修复

**问题**：今日格子显示的是「当日涨跌幅盈亏」`(price - previousClose) × shares`，而不是真正的「未实现盈亏」`(price - avgCost) × shares`。

**修复（`src/components/DailyPnLCalendar.jsx`）**：
- 计算公式改为 `(q.price - s.avgCost) * s.shares`
- 去除对 `q.previousClose` 的依赖（之前若 previousClose 为 null 会跳过该股票）
- 悬停提示标签从「当日市值变动」改为「未实现盈亏」
- `useMemo` 依赖数组补充 `state.prices`（之前遗漏）

### 2. 图表分析 — 持仓分配明细溢出修复

**问题**：选择「总投资组合」时，持仓股票数量多，右侧「持仓明细」列表高度无限增长，与饼图左卡片产生上下布局错乱。

**修复（`src/components/Charts.jsx`）**：
- 明细列表容器加入 `max-h-[260px] overflow-y-auto pr-1`，限制高度与左侧饼图一致，超出部分可滚动

### 3. 已提交并推送

- commit `2702240`：`fix: correct today unrealized P&L and fix allocation layout overflow`
- 已 push 到 `main`，GitHub Actions 自动触发重新部署 GitHub Pages

---

## 当前未完成任务

### IBKR Web API 集成（进行中讨论）

**背景**：用户希望用 IBKR Client Portal REST API 替代或补充 Finnhub 作为行情数据源。

**当前数据源**：`src/utils/api.js` → `fetchQuotes(symbols)` → Finnhub API（`VITE_FINNHUB_KEY`）

**IBKR Client Portal API 特点**：
- 本地运行 IBKR Gateway，提供 `https://localhost:5000` REST 接口
- 使用自签名证书（浏览器需手动信任）
- 只能在本地运行时访问，GitHub Pages 公网版无法使用

**待确认方向**：
- 双数据源（本地用 IBKR，公网用 Finnhub）？还是纯本地使用 IBKR？
- 是否同时同步持仓/交易历史？

**相关文件**：
- `src/utils/api.js`：行情获取核心，替换/扩展此文件
- `src/contexts/PortfolioContext.jsx`：`refreshPrices()` 调用 `fetchQuotes`

### Superpowers 插件（已安装，未完全激活）

- 插件版本：v5.1.0，路径：`~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/`
- 提供 skills：`brainstorming`、`writing-plans`、`executing-plans`、`systematic-debugging` 等
- **当前问题**：skills 未出现在 session 可用列表，需新开 session 后才能自动激活

---

## 本次已完成的功能（2026-05-21，第二十一次）

### 1. GitHub Pages 部署

- **仓库**：`github.com/frankchang617/portfolio-manager`（public）
- **访问地址**：`frankchang617.github.io/portfolio-manager/`
- **`vite.config.js`**：新增 `base: '/portfolio-manager/'`
- **`.github/workflows/deploy.yml`**：push to main 自动触发 build → deploy
  - Node 20 + npm ci + vite build → `actions/deploy-pages@v4`
  - 三个 Secrets 通过 GitHub repo Settings 配置：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_FINNHUB_KEY`
- **已提交关键文件**：`src/lib/supabase.js`、`package.json`（含 `@supabase/supabase-js`）、`src/contexts/PortfolioContext.jsx`（之前均未提交到 git）

### 2. Supabase 同步竞态 Bug 修复

**根本原因**：GitHub Pages 首次加载时 localStorage 为空，初始化空状态后，state 变化的 `useEffect` 在 1.5s 内把空状态写入 Supabase，**覆盖了真实数据**。

**修复（`src/contexts/PortfolioContext.jsx`）**：

新增 `hasRealData(data)` 函数：
```js
function hasRealData(data) {
  if (!data?.portfolios?.length) return false
  return data.portfolios.some(p => !p.isAggregate && ((p.stocks?.length ?? 0) > 0 || (p.options?.length ?? 0) > 0))
}
```

新增 `cloudLoadDoneRef`（`useRef(false)`）：
- **云端加载完成前**，state 变化的 useEffect 不写云端（`if (!cloudLoadDoneRef.current) return`）
- **云端有真实数据** → HYDRATE（云端胜出）
- **云端无真实数据但本地有** → `cloudSave(localData)`（本地推云端）
- **两者都无真实数据** → HYDRATE 云端结构（保持一致）
- `.finally()` 中设置 `cloudLoadDoneRef.current = true`，此后 state 变化才允许写云端

### 3. 深色模式 bg-white 修复

将以下组件的 `bg-white` 从 Tailwind class 改为 `style={{ background: 'var(--claude-card)' }}`（CSS 变量更可靠）：

| 文件 | 位置 |
|------|------|
| `src/components/Modal.jsx` | 通用 modal 容器 |
| `src/components/modals/StockModal.jsx` | 股票 modal 容器 |
| `src/components/modals/OptionsModal.jsx` | 期权 modal 容器 |
| `src/components/modals/ImportModal.jsx` | 导入 modal 容器 |
| `src/components/modals/StrategyModal.jsx` | 策略 modal 容器 |
| `src/components/CalendarPicker.jsx` | 日期输入框 + 日历面板 |
| `src/components/OptionsPositions.jsx` | 平仓/行权 modal；input 改用 `.input` class |
| `src/components/Header.jsx` | 组合切换下拉菜单 |

### 4. 深色模式日历文字颜色修复

**`src/components/DailyPnLCalendar.jsx`**：
- 日期数字：`text-green-900` / `text-red-900` → `profit-text` / `loss-text`
- 盈亏金额：`text-green-800` / `text-red-800` → `profit-text` / `loss-text`
（`profit-text`/`loss-text` 已有 `.dark` 覆盖规则）

---

## 当前未完成任务

### 下一步：期权年化报酬率排序功能
在 `src/components/OptionsPositions.jsx` 的「排序方式」下拉中新增「年化报酬率」选项。

### 深色模式残留问题（次优先）
部分 `bg-white` 尚未处理（Header 的间隔下拉、Charts tooltip、StockPositions 卡片、Dashboard 卡片）。可在深色模式下逐一测试发现。

---

## 本次已完成的功能（2026-05-21，第二十次）

### Supabase 云端数据同步

**背景**：用户发现通过 PWA（macOS WebKit）打开应用时数据为空，原因是 Chrome localStorage 与 WebKit localStorage 完全隔离；同时希望手机也能访问同一份数据。

#### 新增文件

**`.env.local`**（已加入 `.gitignore` 的 `*.local` 规则，不会提交）：
```
VITE_SUPABASE_URL=https://edcuuglmzjimavhjaptp.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...（anon key）
```

**`src/lib/supabase.js`**：
- `supabase` — createClient 实例
- `cloudLoad()` — 从 `portfolio_state` 表拉取 `id='default'` 行的 `data` 字段（`.maybeSingle()`，无行时返回 null）
- `cloudSave(snapshot)` — upsert 同一行

#### Supabase 数据库

- 项目 ID：`edcuuglmzjimavhjaptp`，Region：ap-northeast-1（Tokyo）
- 表：`portfolio_state`（字段：`id text PK`, `data jsonb`, `updated_at timestamptz`）
- 无 RLS（个人应用，anon key 可直接读写）

#### `src/contexts/PortfolioContext.jsx` 修改

**新增 import**：`cloudLoad`, `cloudSave` from `../lib/supabase`

**新增 reducer case `HYDRATE`**：
- 接收云端 data payload，执行与 `loadInitialState` 相同的迁移逻辑（aggregate portfolio 清空 stocks/cash、期权 commission 迁移、sell 交易 realizedPnL 迁移）
- 替换整个 state（保留 prices: {}, isLoading: false）

**`PortfolioProvider` 新增逻辑**：
- `syncTimerRef`：用于防抖云端保存的 timer ref
- 首次挂载 `useEffect`：调用 `cloudLoad()`
  - 云端有数据（portfolios.length > 0）→ dispatch `HYDRATE` 覆盖本地状态
  - 云端为空 → 将当前 localStorage 数据上传（首次迁移）
- 状态变化 `useEffect`：保留原有 `saveState(state)` 立即写 localStorage；新增 1500ms 防抖后 `cloudSave(snapshot)` 写云端

**同步策略**：
- 读：优先云端，fallback localStorage（云端请求失败时静默报错）
- 写：localStorage 即时 + Supabase 1.5s 防抖（避免每次击键都发请求）

---

## 当前未完成任务（最高优先级）

### 深色模式仍存在的问题（用户持续反馈）
用户报告：切换深色模式后，**背景部分区域仍为白色、黑色字体未自动变色**。

#### 已确认的具体问题点：

**问题1：日历格子文字颜色（DailyPnLCalendar.jsx 第 310-328 行）**
- `text-green-900` / `text-red-900`（日期数字）：深色模式下几乎不可见（深绿/深红色）
- `text-green-800` / `text-red-800`（盈亏金额）：同上
- **index.css 缺少这些颜色的 `.dark` 覆盖**（目前只覆盖到 `text-green-700`、`text-red-700`）
- **修复方案**：在 index.css 加入 `.dark .text-green-800/900` 和 `.dark .text-red-800/900`
  **或** 将这些类替换为 `profit-text` / `loss-text`（已有深色覆盖）

**问题2：白色背景（原因未完全确认）**
所有含 `bg-white` 的组件理论上应被 `.dark .bg-white { background-color: var(--claude-card) !important; }` 覆盖，但用户反映仍有白色区域。
候选问题文件：
- `src/components/modals/OptionsModal.jsx` 第 244 行：自有 modal 容器
- `src/components/modals/ImportModal.jsx` 第 309 行
- `src/components/modals/StrategyModal.jsx` 第 302 行
- `src/components/OptionsPositions.jsx` 第 32、111 行：inline modal；第 41、54、119 行：input 元素
- `src/components/CalendarPicker.jsx` 第 129、149 行：输入框+下拉
- **修复方案**：将所有 `bg-white` 改为 inline `style={{ background: 'var(--claude-card)' }}`，或将 input 改用 `.input` class

#### 备选诊断方法（在浏览器控制台执行）：
```js
// 检查 .dark 是否已加到 html
document.documentElement.classList.contains('dark')

// 检查 CSS 变量是否生效
getComputedStyle(document.documentElement).getPropertyValue('--claude-card')
// 应返回 #1c1c1e（深色模式）
```

---

## 本次已完成的功能（2026-05-21，第十九次）

### 持仓管理 + 总览横幅盈亏卡片加入期权分项

**需求**：未实现盈亏、已实现盈亏、总盈亏三张卡片的数值要合并计入期权，并在卡片内底部显示「股票/期权」分行 breakdown。

#### `src/components/StockPositions.jsx`

**MetricCard 组件**：新增 `breakdown` prop，有内容时在主值/百分比下方渲染 `border-t` 分隔线 + 逐行显示（label + 彩色金额）。

**combined 计算**（在 `cards` 数组之前）：
- `combinedUnrealized = metrics.unrealizedPnL + optionMetrics.unrealizedPnL`
- `combinedRealized   = metrics.realizedPnL   + optionMetrics.realizedPnL`
- `combinedTotal      = combinedUnrealized + combinedRealized`
- 三者百分比均以 `metrics.totalCost`（股票成本基准）为分母
- `metrics` useMemo 新增 `totalCost` 导出

**breakdown 显示条件**：
- 未实现盈亏：`hasOpenOptions`（有开仓期权）
- 已实现盈亏：`hasClosedOptions`（有已平仓期权）
- 总盈亏：`hasAnyOptions`（两者之一）

**NaN 守卫**：`calculateOptionMetrics` 在无法计算 BS 时可能返回 NaN，改为 `isNaN(m.unrealizedPnL) ? 0 : m.unrealizedPnL`，避免主值显示 `—`。

#### `src/components/Dashboard.jsx`

**MetricCard 组件**：同样新增 `breakdown` prop，渲染逻辑与 StockPositions 保持一致（`border-t` + 两行分项）。

**metricCards 数组修正**：
- `未实现盈亏`：从 `stockUnrealizedPnL`（仅股票）改为 `unrealizedPnL`（股票+期权合并），分项条件 `hasOptUnrealized`
- `已实现盈亏`：`sub` 从内联字符串「股 · 期」改为百分比 `realizedPnL / costBasis`；分项条件 `hasOptRealized`
- `总盈亏`：分项条件 `hasAnyOption`；股票分项 = `stockUnrealized + stockRealized`，期权分项 = `optionUnrealized + optionRealized`

**NaN 守卫**：同 StockPositions，`calcPortfolioMetrics` 中加 `isNaN` 检查。

---

## 历史已完成功能（2026-05-21，第十八次）

### 持仓表新增「今日盈亏」列

**`src/components/StockPositions.jsx`**：
- `enriched` useMemo 新增 `todayPnL` 字段：`todayChange * s.shares`，已清仓持仓为 `null`
- 表头新增「今日盈亏」列，位于「今日涨跌」和「数量」之间
- 对应 `<td>` 用 `getPnLClass` 绿涨红跌、`fmt.pnl` 格式化；无数据显示 `—`
- 排序选项新增「今日盈亏」
- 现金余额行的 `colSpan` 从 4 修正为 5（新增一列导致需要跨更多格）
- 聚合组合下股票代码文字颜色改为 `text-blue-600`（原为默认 `text-claude-text`）

### CSV 解析器重构（基于列名索引）

**`src/components/modals/StockModal.jsx` → `parseCSV`**：
- **旧方式**：按位置取列（第 0/1/2/3/4 列），中英文混搭表头无法应对列序变化
- **新方式**：用 `findCol(aliases)` 查找每列的真实索引，支持中英文别名
  - 日期：`date` / `日期`
  - 操作：`action` / `操作`
  - 股票代码：`symbol` / `ticker` / `stock` / `code` / `股票代码` / `代码`
  - 数量：`shares` / `quantity` / `qty` / `股数` / `数量`
  - 价格：`price` / `价格`
  - 手续费：`commission` / `手续费` / `fee`
- 必填列（日期/操作/数量/价格）缺失时返回 `fatalError`
- 解析结果新增 `symbol`、`commission` 字段透传给调用方

**下载模板**：列序改为「日期,股票代码,操作,股数,价格」（中文表头），与新解析器对齐

---

## 历史已完成功能（2026-05-20，第十七次）

### 编辑交易行对齐 + 股票代码保存修复

**根本原因 1（对齐）**：编辑模式下用 `<td colSpan={7}>` + flex div，不遵循表格列宽，导致内容无法与表头对齐。
**修复**：`StockModal.jsx` 将编辑行拆成两个 `<tr>`（用 `<Fragment>` 包裹）：
- 第一行：独立 `<td>` 对应每列，显示日期/类型/数量/价格/总额/手续费/「编辑」标签，与表头精确对齐
- 第二行：`<td colSpan={7}>` 展开编辑表单（全宽），背景改为 `bg-blue-50/30`（原为 `bg-white`）

**根本原因 2（代码不保存）**：`StockPositions.jsx` 的 `modal.edit` 是打开时的快照，`UPDATE_STOCK` dispatch 后 store 更新但 prop 仍是旧对象，导致标题不刷新。
**修复**：`StockPositions.jsx` 改为从当前 portfolio.stocks 派生 live 对象传入 StockModal：
```jsx
editStock={modal.edit
  ? (activePortfolio?.stocks ?? []).find(s => s.id === modal.edit.id) ?? modal.edit
  : null}
```

---

## 历史已完成功能（2026-05-20，第十六次与更早）

### 持仓编辑增强
- **`src/contexts/PortfolioContext.jsx`**：新增 `UPDATE_STOCK_TRANSACTION` action，更新指定交易记录后调用 `calcPosition` 重算持仓
- **`src/components/StockPositions.jsx`**：`盈亏 %` 改名 `账面盈亏%`；新增 `总盈亏`（账面+已实现）和 `总盈亏%` 两列；排序栏同步
- **`src/components/modals/StockModal.jsx`**：
  - 编辑模式标题旁加 ✏️，点击可内联修改股票代码和公司名称（`UPDATE_STOCK` action）
  - 交易记录每行 hover 显示 ✏️/🗑️，点击 ✏️ 展开 A1 宽松表单（类型/日期/数量/价格/手续费），保存后均价自动重算
  - 添加股票时，输入代码 800ms 后自动查询 Finnhub profile2，将公司名称填入名称字段

### 自动填写公司名称
- **`src/utils/api.js`**：新增 `fetchCompanyProfile(symbol)` 函数
- **`src/components/modals/StockModal.jsx`**：股票代码输入框 onChange 触发防抖查询，标签旁显示「查询中…」/「✓ 已自动填写」/「未找到」状态；仅在用户未手动填写时才覆盖名称字段

### 关键决策
- 行内编辑采用 A1「展开表单」方案（用户确认，相比弹层/切换 Tab 更直观）
- 总盈亏% 分母：持仓中用 `costBasis`，已清仓用 `totalBuyValue`
- 自动填写仅在 `prev || profile.name` 逻辑下生效，不覆盖用户手动输入

---

## 历史已完成功能

### 持仓页合并 + 总资产横幅加入期权数据（上次）
- **`src/components/StockPositions.jsx`**：
  - 顶部新增「💼 投资组合总资产」横幅，计算逻辑：`总资产 = 股票市值 + 现金余额 + 期权未实现盈亏`
  - 横幅右侧显示「股票持仓」「现金余额」「期权未实现盈亏（N 个）」三列及各自占比；有已实现期权盈亏时额外显示第四列
  - 期权未实现盈亏：对所有 open 状态期权用 `calculateOptionMetrics` 计算，聚合组合汇总全部子组合
  - 页面底部 `<OptionsPositions />` 直接内嵌，股票持仓与期权持仓合并为单页
- **`src/components/Sidebar.jsx`**：删除「期权持仓」导航项，「股票持仓」改名「持仓管理」
- **`src/App.jsx`**：删除 `options` case 及 `OptionsPositions` import

### 日历盈亏按组合过滤（上次）
- **`src/components/DailyPnLCalendar.jsx`**：
  - **根本原因**：`isAggregate = activePortfolio?.isAggregate ?? true`，子组合的 `isAggregate` 为 `undefined`，`??` 默认值 `true` 导致始终走聚合路径
  - **修复**：改为 `=== true` 严格判断
  - 聚合组合：遍历全部子组合 + 全局快照（行为不变）
  - 子组合：只遍历该组合的 stocks/options；`todayPnL` / `monthlyUnrealizedPnL` 对子组合隐藏（全局快照无法拆分）

### 期权编辑功能增强（本次）
- **`src/components/modals/OptionsModal.jsx`**：
  - `EMPTY` 和 editOption 回填新增 `closeCommission` 字段
  - 平仓信息区块新增「平仓手续费」输入框
  - `handleSubmit`：`realizedPnL = tradePnL - openCommission - closeCommission`；`closeCommission` 存入 data
- **`src/components/OptionsPositions.jsx`**：
  - 策略腿行：操作列新增编辑按钮（对开仓/平仓均显示）
  - 独立行：编辑按钮改为始终显示（原先仅已平仓才显示）

### 持仓天数 + 剩余天数列（上次）
- **`src/components/OptionsPositions.jsx`**：
  - 表头新增「持仓天数」「剩余天数」两列，位于「年化报酬率」之后
  - 持仓天数：复用已有 `daysHeld` 字段（开仓中=今日−tradeDate，已平仓=closeDate−tradeDate）；无 tradeDate 显示 `—`
  - 剩余天数：开仓中显示 `dte` 天（≤7天橙色、≤0天红色标注"已到期"）；已平仓显示 `—`
  - 策略组 header 行对应位置补两个空单元格

### 平仓手续费录入（本次）
- **`src/components/OptionsPositions.jsx` → `CloseModal`**：
  - 新增「平仓手续费（可选）」输入框，默认空（即 0）
  - 盈亏预览实时扣减手续费，并在预览块显示「含平仓手续费 −$X.XX」副标题
  - `onConfirm` 回调新增第三个参数 `closeCommission`
- **`handleClosePosition`**：透传 `closeCommission` 到 dispatch
- **`src/contexts/PortfolioContext.jsx` → `CLOSE_OPTIONS_POSITION` reducer**：
  - `realizedPnL = grossPnL − openingCommission − closeCommission`
  - 平仓后将 `closeCommission` 存入该期权记录备查

### 期权持仓年化报酬率列（上次）
- **`src/components/OptionsPositions.jsx`**：
  - `enriched` useMemo 新增 `daysHeld`（实际持仓天数）与 `annualizedReturn`（年化报酬率）字段
  - **买方**（direction = 'buy'）：`(盈亏 / 权利金总成本) × (365 / 持仓天数)`，资金基准为权利金
  - **卖方**（direction = 'sell'）：`(盈亏 / 行权价×张数×100) × (365 / 持仓天数)`，资金基准为行权价保证金
  - 开仓中：持仓天数 = 今日 - tradeDate；已平仓：持仓天数 = closeDate - tradeDate
  - 表格新增「年化报酬率」列，位于「盈亏」之后：显示百分比（绿涨红跌）+ 副标题「权利金基准」/「保证金基准」
  - 表头带 `ℹ` 图标，悬停显示完整公式说明；每格悬停 tooltip 显示具体持仓天数
  - 无 `tradeDate` 时显示 `—`；策略组 header 行对应位置留空

### 投资组合卡片加入期权盈亏（上次）
- **`src/components/Dashboard.jsx` → `PortfolioCard`**：
  - "未实现盈亏"下方：若有期权持仓显示「期权 $X.XX」
  - "已实现盈亏"下方：若 `optionRealizedPnL !== 0` 显示「期权 $X.XX」
  - "股票持仓"行：若有期权持仓显示「· 期权 N 个」

### 深色模式部分修复（本次）
- **`src/components/Sidebar.jsx`**：导航 inactive 颜色从 `#6e6e73` → `var(--claude-muted)`
- **`src/index.css`**：新增 `.dark .profit-text { color: #4ade80 }` / `.dark .loss-text { color: #f87171 }`

---

## 已完成的历史功能

### 深色模式基础架构（上次）
- `src/index.css`：`.dark { --claude-*: ... }` CSS 变量覆盖；`.dark .bg-white/gray-* { ... !important }` 平铺规则
- `src/components/Sidebar.jsx`：背景改 `var(--claude-glass)`
- `src/components/Header.jsx`：所有硬编码亮色值改 CSS 变量
- `tailwind.config.js`：`darkMode: 'class'`
- `index.html`：防闪烁内联脚本
- `src/contexts/ThemeContext.jsx`：手动深浅切换 + localStorage 记忆
- `src/hooks/useDarkMode.js` / `useChartColors()`

### 其他历史功能
- 券商 CSV 直接导入（Schwab/IBKR/TD Ameritrade）
- 历史卖出 `realizedPnL` 数据迁移
- 盈亏颜色修复、日历盈亏月末汇总、CSV 模板下载

---

## 下一步计划

1. **（下一步）** 部署到 GitHub Pages（详见下方部署计划）
2. **（优先）** 修复深色模式剩余问题（见上方"已确认问题点"）
3. 期权年化报酬率可考虑加入「排序方式」下拉（按年化报酬率排序）

---

## GitHub Pages 部署计划（待执行）

**目标**：应用托管到公网，手机/任何设备无需本地服务器即可访问，数据通过 Supabase 云端同步。

**步骤：**

1. **`vite.config.js` 加 `base` 配置**：
   ```js
   base: '/仓库名/'   // 例如 base: '/portfolio-manager/'
   ```

2. **创建 `vite.config.js` 中 router 的 hash 模式**（如使用 React Router 需配置，当前无路由可跳过）

3. **创建 GitHub Actions workflow** `.github/workflows/deploy.yml`：
   - 触发：push to main
   - 步骤：checkout → setup node → npm ci → npm run build → 部署 dist/ 到 gh-pages 分支

4. **在 GitHub repo Settings → Secrets 配置三个环境变量**：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_FINNHUB_KEY`

5. **开启 GitHub Pages**：Settings → Pages → Source 选 `gh-pages` 分支

**注意**：`.env.local` 不会提交到 git，需通过 repo secrets 传入 Actions。

---

## 关键文件路径

| 文件 | 用途 |
|------|------|
| `src/lib/supabase.js` | Supabase 客户端 + `cloudLoad` / `cloudSave` |
| `.env.local` | Supabase URL + anon key（不提交 git） |
| `src/index.css` | CSS 变量主题 + `.dark` 覆盖（**缺少 text-green/red-800/900**） |
| `src/components/DailyPnLCalendar.jsx` | 日历（**text-green/red-900 未适配深色**） |
| `src/components/Modal.jsx` | 通用 modal 容器（`bg-white` 待验证） |
| `src/contexts/ThemeContext.jsx` | 主题 Context（dark/toggle/localStorage） |
| `src/components/Dashboard.jsx` | 总览页 + PortfolioCard（含期权盈亏子标签） |
| `src/components/Sidebar.jsx` | 导航栏（已改用 CSS 变量） |
| `src/components/Header.jsx` | 顶部栏 + 主题切换按钮 |
| `tailwind.config.js` | darkMode: 'class' |
| `index.html` | 防闪烁内联脚本 |

---

## 注意事项

1. **ThemeProvider 必须最外层**：位于 PortfolioProvider 外层，否则图表 hook 报错
2. **PostCSS 无 nesting 插件**：index.css 所有 `.dark` 覆盖必须用平铺写法，不可嵌套
3. **Recharts 颜色**：必须通过 `useChartColors()` JS hook 传 prop，CSS 无法覆盖
4. **bg-white 覆盖未完全生效**：`.dark .bg-white` 规则可能在某些场景失效，改用 inline `style={{ background: 'var(--claude-card)' }}` 更可靠
5. **期权盈亏计算**：`unrealizedPnL = 股票 + 期权（BS 估算，需有实时价格）`；`realizedPnL = 股票已实现 + 已平仓期权 realizedPnL`
