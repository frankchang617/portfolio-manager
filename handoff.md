# 投资组合管理系统 — 任务交接文档

**更新日期**：2026-05-29（第二十七次，日历盈亏展示逻辑重构）  
**技术栈**：React 18 + Vite + Tailwind CSS v3 + Recharts + Supabase  
**运行地址**：http://localhost:5173（本地）/ https://frankchang617.github.io/portfolio-manager/（公网）

---

## 当前进行中（2026-05-29，第二十七次）

### 日历盈亏展示逻辑重构（进行中，约完成 60%）

#### 用户需求
1. 顶部两张汇总卡片：去掉「{year}年已实现盈亏」→ 改为「年初至今未实现盈亏」（当前持仓实时浮盈）
2. 月度卡片：「月末未实现盈亏」→「月度未实现盈亏」，新增「月度总盈亏」= 未实现 + 已实现
3. 每日格子：显示值改为 `未实现盈亏（当日收盘快照）+ 已实现盈亏` 之和，不再 priority 取一个
4. Hover tooltip：展示未实现 + 已实现分项 + 合计

#### 已完成的改动（`src/components/DailyPnLCalendar.jsx`）
- [x] 移除 `yearlySummary`，新增 `currentUnrealizedPnL` useMemo（用 state.prices 实时价格计算当前持仓浮盈）
- [x] 新增 `monthlyTotalPnL` useMemo（monthlyUnrealizedPnL + totalRealized）
- [x] `getPnlDisplay(data, histUnrealized)` 重构：返回 `{ pnl: realized+unrealized, isRealized, realized, unrealized }`，不再 priority 取一个
- [x] `getCellBg(totalPnl, isRealized)` 重构：有已实现 → 绿/红，仅未实现 → 蓝色调

#### 待完成的改动（`src/components/DailyPnLCalendar.jsx`）
- [ ] 更新顶部卡片 JSX：左卡改为「年初至今未实现盈亏」用 `currentUnrealizedPnL`
- [ ] 更新月度卡片 JSX：重命名 + 新增月度总盈亏卡片 + 调整 grid-cols
- [ ] 更新日历格子渲染：`getCellBg(pnl, isRealized)` 签名变化，需更新调用处；移除旧的 histUnrealized 蓝色 bg 单独计算
- [ ] 更新 hover tooltip：显示 realized + unrealized 分项 + 合计
- [ ] commit + push

#### 关键设计决策
- `currentUnrealizedPnL` = 当前持仓实时浮盈（非年初至今变动量），用 state.prices
- 每日格子的「每日未实现」= 该日收盘的持仓浮盈快照（histPrices），是累计值而非单日变动
- `monthlyTotalPnL` 在 monthlyUnrealizedPnL 为 null（无历史价格）时 fallback 到纯已实现

---

## 本次已完成的功能（2026-05-29，第二十六次）

### 三项并行开发：IRR年化收益 + 日历P&L汇总 + Yahoo Finance 历史价格

#### 完成状态
- [x] Dashboard.jsx：IRR 算法替换 snapshot-based CAGR
- [x] DailyPnLCalendar.jsx：新增年度/YTD 已实现盈亏汇总卡片
- [x] src/utils/api.js：新增 fetchHistoricalPrices（Yahoo Finance + localStorage 24h 缓存）
- [x] DailyPnLCalendar 接入 Yahoo Finance 历史价格
  - `positionAtDate`：重放交易记录，返回某日的 {shares, avgCost}
  - `calcUnrealizedAtDate`：汇总各组合当日未实现盈亏
  - 蓝色调背景显示历史持仓未实现盈亏

#### 提交记录
- `6f7509d`：fix astronomical annualized return
- `98e26fb`：IRR + year/YTD P&L summary + Yahoo Finance API
- `e64e946`：historical prices integration into DailyPnLCalendar

---

## 关键实现细节

### IRR（`src/components/Dashboard.jsx`）
- `solveIRR(flows)` — Newton-Raphson，最多 300 次迭代
- `calcPortfolioIRR(portfolio, prices)` — 从 transactions 收集现金流
- initialShares > 0 → 当作第一笔交易前一天的买入

### Yahoo Finance API（`src/utils/api.js`）
- `fetchHistoricalPrices(symbol, range='5y')`
- CORS 代理：`https://corsproxy.io/?{encoded_url}`
- 支持格式：US=`AAPL`，HK=`0700.HK`
- 缓存：localStorage key `yf_hist_v1`，24 小时 TTL
- 返回 `{ 'YYYY-MM-DD': closePrice }`

---

## 本次已完成的功能（2026-05-24，第二十三/二十四次）

### 彻底修复：打开网站后需等 ~60 秒才能看到最新数据

- 根本原因：HYDRATE reducer 中 `prices: {}` 清空了刚拿到的价格
- 修复：去掉该行 + 新增 `justHydratedRef` 在 HYDRATE 后立即 refreshPrices
- commit `41be541` + `96b6cda`

---

## 历史已完成功能（精简）

- 今日未实现盈亏计算修复（2026-05-21）
- GitHub Pages 部署（2026-05-21）
- Supabase 云端数据同步（2026-05-21）
- 深色模式（bg-white 修复、颜色变量）
- 期权持仓：年化报酬率、持仓天数、平仓手续费、编辑功能
- 持仓管理：股票+期权合并页、今日盈亏列、CSV导入重构
- StockPositions 横幅含期权数据

---

## 当前未完成任务

1. **（当前进行中）** 完成日历盈亏展示重构的剩余 JSX 改动（见上方"待完成"列表）
2. IBKR Web API 集成（讨论中，低优先级）

---

## 关键文件路径

| 文件 | 用途 |
|------|------|
| `src/components/DailyPnLCalendar.jsx` | 日历盈亏（当前正在修改） |
| `src/components/Dashboard.jsx` | 总览 + IRR 年化收益 |
| `src/utils/api.js` | Finnhub + Yahoo Finance 历史价格 |
| `src/lib/supabase.js` | Supabase 客户端 |
| `src/contexts/PortfolioContext.jsx` | 状态管理（Supabase 同步） |
| `src/index.css` | CSS 变量主题 |

---

## 注意事项

1. **PostCSS 无 nesting 插件**：index.css 所有 `.dark` 覆盖必须平铺写法
2. **corsproxy.io CORS 代理**：Yahoo Finance 历史价格需要此代理，公网 GitHub Pages 也依赖它
3. **历史未实现盈亏是累计快照，非单日变动**：显示的是「该日持仓总浮盈」而非「当天涨了多少」
