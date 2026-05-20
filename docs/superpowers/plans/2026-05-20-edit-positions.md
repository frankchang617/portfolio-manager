# 持仓编辑增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增三项功能：①持仓表格「盈亏%」重命名为「账面盈亏%」并加入「总盈亏」「总盈亏%」两列；②编辑模式下可修改股票代码；③行内编辑已有交易记录（A1 展开表单方案）。

**Architecture:** 数据层在 `PortfolioContext.jsx` 新增 `UPDATE_STOCK_TRANSACTION` action，复用已有 `calcPosition` 函数重算持仓；UI 层分别改造 `StockPositions.jsx`（新列）和 `StockModal.jsx`（编辑股票代码 + 行内编辑交易记录）。三个任务相互独立，可分别验证。

**Tech Stack:** React 18, Vite, Tailwind CSS, lucide-react

---

## 文件变更总览

| 文件 | 类型 | 变更说明 |
|---|---|---|
| `src/contexts/PortfolioContext.jsx` | 修改 | 新增 `UPDATE_STOCK_TRANSACTION` case |
| `src/components/StockPositions.jsx` | 修改 | 新增 `totalPnL`/`totalPnLPct` 计算，重命名列，增加两列 |
| `src/components/modals/StockModal.jsx` | 修改 | 编辑股票代码 UI + 行内编辑交易记录 UI |

---

## Task 1：新增 UPDATE_STOCK_TRANSACTION reducer action

**Files:**
- Modify: `src/contexts/PortfolioContext.jsx`（在 `DELETE_STOCK_TRANSACTION` case 之后添加）

- [ ] **Step 1：在 `DELETE_STOCK_TRANSACTION` case 末尾的 `}` 后插入新 case**

找到文件中 `case 'CLEAR_STOCK_TRANSACTIONS':` 这一行，在它上方插入：

```js
case 'UPDATE_STOCK_TRANSACTION': {
  const { portfolioId, stockId, transactionId, updates } = action
  return { ...state, portfolios: state.portfolios.map(p => {
    if (p.id !== portfolioId) return p
    const stocks = p.stocks.map(s => {
      if (s.id !== stockId) return s
      const transactions = (s.transactions || []).map(t =>
        t.id !== transactionId ? t : { ...t, ...updates }
      )
      const pos = calcPosition(s.initialShares ?? 0, s.initialAvgCost ?? 0, transactions)
      return { ...s, transactions, shares: pos.shares, avgCost: pos.avgCost, stockRealizedPnL: pos.realizedPnL }
    })
    const portfolioRpnl = stocks.reduce((sum, s) => sum + (s.stockRealizedPnL || 0), 0)
    return { ...p, stocks, realizedPnL: portfolioRpnl }
  })}
}
```

- [ ] **Step 2：在浏览器控制台手动验证 action 格式（可选）**

打开 `http://localhost:5173`，在控制台执行：
```js
// 验证 dispatch 不报错（需在 React DevTools 或组件内部）
// 通过后续 Task 3 的 UI 操作来验证
```

- [ ] **Step 3：Commit**

```bash
git add src/contexts/PortfolioContext.jsx
git commit -m "feat: add UPDATE_STOCK_TRANSACTION reducer action"
```

---

## Task 2：持仓表格新增「总盈亏」「总盈亏%」列，重命名「账面盈亏%」

**Files:**
- Modify: `src/components/StockPositions.jsx`

### Step 1：在 `rows` useMemo 中添加 `totalPnL` / `totalPnLPct` 计算

- [ ] 找到文件第 159 行附近的 `return { ...s, price, prevClose, ...` 这一行，在它之前（即 `realizedPct` 计算之后）添加：

```js
const totalPnL = isCleared
  ? stockRealizedPnL
  : (paperPnL != null ? paperPnL + stockRealizedPnL : null)
const totalPnLPct = isCleared
  ? realizedPct
  : (totalPnL != null && costBasis !== 0 ? (totalPnL / costBasis) * 100 : null)
```

然后将 `return` 语句中加入这两个字段：

```js
return { ...s, price, prevClose, marketValue, costBasis, perSharePnL, paperPnL, pnlPct,
  todayChange, todayChangePct, allocation, stockRealizedPnL, realizedPct, isCleared,
  totalPnL, totalPnLPct }
```

### Step 2：排序栏重命名 + 添加两个新排序按钮

- [ ] 找到排序栏数组（约第 274 行），将 `{ field: 'pnlPct', label: '盈亏 %' }` 改为：

```js
{ field: 'pnlPct',      label: '账面盈亏%' },
{ field: 'totalPnL',    label: '总盈亏' },
{ field: 'totalPnLPct', label: '总盈亏%' },
```

### Step 3：表头重命名 + 添加两列

- [ ] 找到第 319 行 `['代码','价格',...,'盈亏 %','占比 %',...]` 数组，改为：

```js
['代码','价格','今日涨跌','数量','平均成本','持仓价值','每股盈亏','账面盈亏','已实现盈亏','账面盈亏%','总盈亏','总盈亏%','占比 %', ...(!isAggregate ? ['操作'] : [])]
```

### Step 4：在表格 tbody 中「盈亏 %」单元格后插入两列新单元格

- [ ] 找到 `{/* 盈亏 % */}` 注释所在的 `<td>`（约第 396 行），将注释改为 `{/* 账面盈亏% */}`，然后在其后插入：

```jsx
{/* 总盈亏 */}
<td className={`py-3.5 px-4 text-right text-sm font-mono font-semibold ${getPnLClass(s.totalPnL)}`}>
  {s.totalPnL != null ? fmt.pnl(s.totalPnL) : '—'}
</td>
{/* 总盈亏% */}
<td className={`py-3.5 px-4 text-right text-sm font-medium ${getPnLClass(s.totalPnLPct)}`}>
  {s.totalPnLPct != null ? fmt.pctChange(s.totalPnLPct) : '—'}
</td>
```

### Step 5：验证

- [ ] 浏览器打开 `http://localhost:5173`，进入持仓管理页面，确认：
  - 表头显示「账面盈亏%」（原「盈亏 %」）
  - 出现「总盈亏」「总盈亏%」两列
  - 排序栏出现对应三个按钮，点击后表格正确排序
  - 有已实现盈亏的股票，「总盈亏」= 账面盈亏 + 已实现盈亏

- [ ] **Commit**

```bash
git add src/components/StockPositions.jsx
git commit -m "feat: add total PnL columns and rename unrealized PnL% in positions table"
```

---

## Task 3：编辑模式下可修改股票代码

**Files:**
- Modify: `src/components/modals/StockModal.jsx`

### Step 1：添加 import

- [ ] 在文件顶部 import 行中，确认 `lucide-react` 已引入 `Pencil` 和 `Check`；若无则添加：

```js
import { X, TrendingUp, TrendingDown, Upload, Trash2, AlertTriangle,
  ChevronUp, ChevronDown, Download, Pencil, Check } from 'lucide-react'
```

### Step 2：新增 state

- [ ] 在 `const [isDragging, setIsDragging] = useState(false)` 附近添加三个新 state：

```js
const [editingSymbol, setEditingSymbol] = useState(false)
const [symbolDraft, setSymbolDraft] = useState('')
const [nameDraft, setNameDraft] = useState('')
const symbolEditRef = useRef(null)
const symbolComposingEditRef = useRef(false)
const [symbolEditError, setSymbolEditError] = useState('')
```

### Step 3：在 useEffect 的 isOpen 重置逻辑中加入新 state 重置

- [ ] 找到 `useEffect(() => { if (isOpen) { setTab(...)` 的那段，在重置块末尾加：

```js
setEditingSymbol(false); setSymbolDraft(''); setNameDraft(''); setSymbolEditError('')
```

### Step 4：添加保存股票代码的 handler

- [ ] 在 `handleDeleteStock` 函数之后添加：

```js
const handleSaveSymbol = () => {
  const sym = symbolDraft.trim().toUpperCase()
  if (!sym) return setSymbolEditError('股票代码不能为空')
  dispatch({
    type: 'UPDATE_STOCK',
    portfolioId: activePortfolio.id,
    stockId: editStock.id,
    updates: { symbol: sym, name: nameDraft.trim() || sym },
  })
  setEditingSymbol(false)
  setSymbolEditError('')
}
```

### Step 5：替换 Header 中的标题区域

- [ ] 找到 `{/* ── Header ── */}` 下方的 `<div className="flex items-start justify-between...">` 内的标题部分：

原代码（约第 311-318 行）：
```jsx
<div className="flex items-center gap-3">
  <h2 className="text-2xl font-bold text-claude-text">{title}</h2>
  {editStock && (
    <span className="px-3 py-1 bg-gray-100 text-claude-muted text-sm rounded-full font-medium">
      持仓 {editStock.shares} 股
    </span>
  )}
</div>
```

替换为：
```jsx
<div className="flex items-center gap-3 flex-wrap">
  {editStock && editingSymbol ? (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        ref={symbolEditRef}
        value={symbolDraft}
        onCompositionStart={() => { symbolComposingEditRef.current = true }}
        onCompositionEnd={e => {
          symbolComposingEditRef.current = false
          const val = e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, '')
          setSymbolDraft(val)
        }}
        onChange={e => {
          if (symbolComposingEditRef.current) return
          const val = e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, '')
          setSymbolDraft(val)
        }}
        className="text-xl font-bold border-b-2 border-claude-orange bg-transparent outline-none w-28 text-claude-text"
        placeholder={editStock.symbol}
        autoFocus
      />
      <input
        value={nameDraft}
        onChange={e => setNameDraft(e.target.value)}
        className="text-sm text-claude-muted border-b border-claude-border bg-transparent outline-none w-36"
        placeholder={editStock.name || '公司名称（可选）'}
      />
      <button onClick={handleSaveSymbol}
        className="p-1.5 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors">
        <Check size={14} />
      </button>
      <button onClick={() => { setEditingSymbol(false); setSymbolEditError('') }}
        className="p-1.5 rounded-lg hover:bg-gray-100 text-claude-muted transition-colors">
        <X size={14} />
      </button>
      {symbolEditError && (
        <span className="text-xs text-loss">{symbolEditError}</span>
      )}
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <h2 className="text-2xl font-bold text-claude-text">{title}</h2>
      {editStock && (
        <button
          onClick={() => { setSymbolDraft(editStock.symbol); setNameDraft(editStock.name || ''); setEditingSymbol(true) }}
          className="p-1 rounded-lg hover:bg-gray-100 text-claude-subtle hover:text-claude-muted transition-colors">
          <Pencil size={14} />
        </button>
      )}
      {editStock && (
        <span className="px-3 py-1 bg-gray-100 text-claude-muted text-sm rounded-full font-medium">
          持仓 {editStock.shares} 股
        </span>
      )}
    </div>
  )}
</div>
```

### Step 6：验证

- [ ] 在浏览器打开持仓详情弹窗，确认：
  - 股票代码旁有 ✏️ 图标
  - 点击后出现代码输入框 + 名称输入框 + ✓ / ✕ 按钮
  - 修改代码后点击 ✓，弹窗标题和持仓列表均更新
  - 代码为空时点击 ✓，显示错误提示不关闭编辑态

- [ ] **Commit**

```bash
git add src/components/modals/StockModal.jsx
git commit -m "feat: allow editing stock symbol from position modal header"
```

---

## Task 4：行内编辑交易记录（A1 展开表单）

**Files:**
- Modify: `src/components/modals/StockModal.jsx`

### Step 1：新增 state

- [ ] 在 Task 3 新增的 state 之后继续添加：

```js
const [editingTxId, setEditingTxId] = useState(null)
const [editForm, setEditForm] = useState({ action: 'buy', date: '', shares: '', price: '', commission: '' })
const [editError, setEditError] = useState('')
```

### Step 2：在 isOpen useEffect 重置块中加入新 state 重置

- [ ] 在上一步添加的重置行之后再加：

```js
setEditingTxId(null)
setEditForm({ action: 'buy', date: '', shares: '', price: '', commission: '' })
setEditError('')
```

### Step 3：添加编辑交易记录的 handlers

- [ ] 在 `handleSaveSymbol` 之后添加：

```js
const handleStartEditTx = (tx) => {
  setEditingTxId(tx.id)
  setEditError('')
  setEditForm({
    action: tx.action,
    date: tx.date,
    shares: String(tx.shares),
    price: String(tx.price),
    commission: String(tx.commission ?? 0),
  })
}

const handleCancelEditTx = () => {
  setEditingTxId(null)
  setEditError('')
  setEditForm({ action: 'buy', date: '', shares: '', price: '', commission: '' })
}

const handleSaveEditTx = () => {
  setEditError('')
  const shares = parseFloat(editForm.shares)
  const price = parseFloat(editForm.price)
  if (!editForm.date) return setEditError('请选择交易日期')
  if (!shares || shares <= 0) return setEditError('请输入有效数量')
  if (!price || price <= 0) return setEditError('请输入有效价格')
  dispatch({
    type: 'UPDATE_STOCK_TRANSACTION',
    portfolioId: activePortfolio.id,
    stockId: editStock.id,
    transactionId: editingTxId,
    updates: {
      action: editForm.action,
      date: editForm.date,
      shares,
      price,
      commission: parseFloat(editForm.commission) || 0,
      total: price * shares,
    },
  })
  handleCancelEditTx()
}
```

### Step 4：更新 Escape 键处理，支持关闭编辑态

- [ ] 找到现有的 `useEffect(() => { const handler = e => { if (e.key === 'Escape') onClose() }` 这段，替换为：

```js
useEffect(() => {
  const handler = e => {
    if (e.key === 'Escape') {
      if (editingTxId) { handleCancelEditTx(); return }
      if (editingSymbol) { setEditingSymbol(false); setSymbolEditError(''); return }
      onClose()
    }
  }
  if (isOpen) window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [isOpen, onClose, editingTxId, editingSymbol])
```

### Step 5：替换交易记录列表的 `<tbody>` 渲染

- [ ] 找到 `{tab === 'transactions' && editStock && (` 里面的 `<tbody>` 内容，将 `{[...transactions].sort(...).map(t => (...))}` 替换为以下代码：

```jsx
{[...transactions]
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .map(t => {
    const isEditing = editingTxId === t.id
    if (isEditing) {
      const previewShares = parseFloat(editForm.shares)
      const previewPrice = parseFloat(editForm.price)
      const previewTotal = previewShares > 0 && previewPrice > 0 ? previewShares * previewPrice : null
      return (
        <tr key={t.id}>
          <td colSpan={7} className="py-0 px-0">
            {/* 蓝色摘要条 */}
            <div className="bg-blue-50 border-l-4 border-blue-400 px-4 py-2.5 flex items-center gap-4 text-sm">
              <span className="text-blue-600 font-semibold text-xs">编辑中</span>
              <span className="text-claude-muted font-mono text-xs">
                {new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium
                ${t.action === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                {t.action === 'buy' ? '↗ 买入' : '↘ 卖出'}
              </span>
              <span className="font-mono text-xs text-claude-muted">{t.shares.toFixed(2)} 股 @ {fmt.currency(t.price)}</span>
            </div>
            {/* 展开的编辑表单 */}
            <div className="bg-white border-l-4 border-blue-400 border-t border-claude-border/50 px-4 py-4">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="label">交易类型</label>
                  <select className="select" value={editForm.action}
                    onChange={e => setEditForm(f => ({ ...f, action: e.target.value }))}>
                    <option value="buy">买入 ↗</option>
                    <option value="sell">卖出 ↘</option>
                  </select>
                </div>
                <div>
                  <label className="label">交易日期</label>
                  <CalendarPicker value={editForm.date} onChange={v => setEditForm(f => ({ ...f, date: v }))} />
                </div>
                <div>
                  <label className="label">数量（股）</label>
                  <SpinnerInput value={editForm.shares} onChange={v => setEditForm(f => ({ ...f, shares: v }))}
                    step={1} placeholder="0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="label">交易价格</label>
                  <SpinnerInput value={editForm.price} onChange={v => setEditForm(f => ({ ...f, price: v }))}
                    prefix="$" step={0.01} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">手续费（可选）</label>
                  <SpinnerInput value={editForm.commission} onChange={v => setEditForm(f => ({ ...f, commission: v }))}
                    prefix="$" step={0.01} placeholder="0.00" />
                </div>
              </div>
              {editError && (
                <p className="text-sm text-loss bg-red-50 px-3 py-2 rounded-lg mb-3">{editError}</p>
              )}
              <div className="flex items-center gap-3">
                <button onClick={handleSaveEditTx}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm">
                  保存修改
                </button>
                <button onClick={handleCancelEditTx}
                  className="px-5 py-2.5 border border-claude-border rounded-xl text-sm font-medium text-claude-muted hover:text-claude-text hover:bg-claude-bg transition-colors">
                  取消
                </button>
                {previewTotal != null && (
                  <span className="ml-auto text-sm text-claude-muted">
                    总额：<strong className={editForm.action === 'buy' ? 'text-profit' : 'text-loss'}>
                      {editForm.action === 'buy' ? '+' : '-'}{fmt.currency(previewTotal)}
                    </strong>
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )
    }
    // 普通行
    return (
      <tr key={t.id} className="border-b border-claude-border/50 hover:bg-gray-50 group">
        <td className="py-3 pr-4 text-sm text-claude-muted">
          {new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </td>
        <td className="py-3 pr-4">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium
            ${t.action === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {t.action === 'buy' ? '↗ 买入' : '↘ 卖出'}
          </span>
        </td>
        <td className="py-3 pr-4 text-sm text-right font-mono">{t.shares.toFixed(2)}</td>
        <td className="py-3 pr-4 text-sm text-right font-mono">{fmt.currency(t.price)}</td>
        <td className={`py-3 pr-4 text-sm text-right font-mono font-semibold ${t.action === 'buy' ? 'text-profit' : 'text-loss'}`}>
          {t.action === 'buy' ? '+' : '-'}{fmt.currency(t.price * t.shares)}
        </td>
        <td className="py-3 text-sm text-right font-mono text-claude-muted">
          {t.commission > 0 ? fmt.currency(t.commission) : <span className="text-claude-subtle">—</span>}
        </td>
        <td className="py-3 pl-2">
          <div className="opacity-0 group-hover:opacity-100 flex gap-1 justify-end transition-opacity">
            <button onClick={() => handleStartEditTx(t)}
              className="p-1.5 rounded-lg hover:bg-blue-50 text-claude-subtle hover:text-blue-600 transition-all">
              <Pencil size={13} />
            </button>
            <button onClick={() => handleDelete(t.id)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-claude-subtle hover:text-loss transition-all">
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>
    )
  })
}
```

### Step 6：验证

- [ ] 在浏览器打开一个有多条交易记录的持仓，确认：
  - 每行 hover 时出现 ✏️ 和 🗑️ 两个图标
  - 点击 ✏️：该行变为蓝色摘要条，下方展开编辑表单，字段已预填
  - 修改任意字段后点击「保存修改」：表单折叠，列表刷新为新值，均价/持仓数随之更新
  - 点击「取消」：表单折叠，数据不变
  - 编辑态下按 Escape：关闭编辑态，不保存
  - 数量/价格为空或 ≤ 0 时点击保存：显示行内错误，不关闭
  - 同时点击另一行的 ✏️：当前编辑态关闭，新行进入编辑态

- [ ] **Commit**

```bash
git add src/components/modals/StockModal.jsx
git commit -m "feat: inline edit existing stock transactions with A1 expand-form UX"
```

---

## Task 5：回归验证

- [ ] 打开持仓页，检查「已清仓」股票的「总盈亏」「总盈亏%」是否与「已实现盈亏」一致
- [ ] 打开任意持仓弹窗，添加一笔新交易后立即编辑它，确认编辑后均价正确
- [ ] 修改股票代码后，确认价格行情仍能正常刷新（新代码会作为新的 symbol 查询）
- [ ] 检查 CSV 导入功能是否仍正常（Task 4 的改动不应影响 CSV tab）
- [ ] 关闭并重新打开弹窗，确认 `editingTxId`、`editingSymbol` 均已重置为初始值
