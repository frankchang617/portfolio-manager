# 投资组合管理系统 — 任务交接文档

**更新日期**：2026-05-18（第十五次，持仓页合并 + 总资产横幅加入期权数据）  
**技术栈**：React 18 + Vite + Tailwind CSS v3 + Recharts  
**运行地址**：http://localhost:5173（`npm run dev` 启动）

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
- `src/components/Modal.jsx` 第 35 行：modal 容器用 `bg-white`
- `src/components/modals/OptionsModal.jsx` 第 240 行：自有 modal 容器
- `src/components/modals/StockModal.jsx` 第 307 行：自有 modal 容器
- `src/components/modals/ImportModal.jsx` 第 309 行
- `src/components/modals/StrategyModal.jsx` 第 302 行
- `src/components/OptionsPositions.jsx` 第 28、95 行：inline modal
- `src/components/CalendarPicker.jsx` 第 129、149 行：输入框+下拉
- 各 modal 内的 `input` 元素用 `bg-white`（非 `.input` class）
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

## 本次已完成的功能

### 持仓页合并 + 总资产横幅加入期权数据（本次）
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

1. **（优先）** 修复深色模式剩余问题（见上方"已确认问题点"）
2. 期权年化报酬率可考虑加入「排序方式」下拉（按年化报酬率排序）
3. **Feature 12**：Supabase 云端同步（需用户提供 URL + anon key）

---

## 关键文件路径

| 文件 | 用途 |
|------|------|
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
