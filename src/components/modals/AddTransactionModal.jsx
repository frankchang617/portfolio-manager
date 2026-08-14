import { useState, useMemo, useEffect } from 'react'
import { X, Plus, Trash2, ChevronUp, ChevronDown, Check } from 'lucide-react'
import { usePortfolio } from '../../contexts/PortfolioContext'
import { fmt } from '../../utils/formatters'
import CalendarPicker from '../CalendarPicker'

// ── Spinner Number Input（与 StockModal 同款）───────────────────────────────
function SpinnerInput({ value, onChange, prefix = '', step = 1, min = 0, placeholder = '0.00' }) {
  const num = parseFloat(value) || 0

  return (
    <div className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-claude-muted text-sm select-none">
        {prefix}
      </div>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        step={step}
        min={min}
        placeholder={placeholder}
        className={`w-full py-2.5 pr-8 border border-claude-border rounded-xl text-sm bg-white
                    focus:outline-none focus:ring-2 focus:ring-claude-orange/30 focus:border-claude-orange
                    text-claude-text appearance-none ${prefix ? 'pl-7' : 'pl-3'}`}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col">
        <button type="button" onClick={() => onChange(String((num + step).toFixed(step < 1 ? 2 : 0)))}
          className="p-0.5 text-claude-subtle hover:text-claude-muted">
          <ChevronUp size={12} />
        </button>
        <button type="button" onClick={() => onChange(String(Math.max(min, num - step).toFixed(step < 1 ? 2 : 0)))}
          className="p-0.5 text-claude-subtle hover:text-claude-muted">
          <ChevronDown size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Row factory（多行批量录入）──────────────────────────────────────────────
const genRowId = () => `row_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
const createRow = () => ({
  id: genRowId(),
  action: 'buy',
  date: new Date().toISOString().split('T')[0],
  shares: '',
  price: '',
  commission: '',
})

// ── 新增交易弹窗（交易记录页入口）──────────────────────────────────────────
export default function AddTransactionModal({ onClose }) {
  const { activePortfolio, state, dispatch } = usePortfolio()
  const isAggregate = activePortfolio?.isAggregate ?? false

  const subPortfolios = useMemo(() => state.portfolios.filter(p => !p.isAggregate), [state.portfolios])

  const [portfolioId, setPortfolioId] = useState(() =>
    isAggregate ? (subPortfolios[0]?.id ?? '') : (activePortfolio?.id ?? '')
  )
  const [symbol, setSymbol] = useState('')
  const [rows, setRows] = useState(() => [createRow()])
  const [error, setError] = useState('')

  const targetPortfolio = state.portfolios.find(p => p.id === portfolioId)
  const sym = symbol.trim().toUpperCase()
  const existingStock = useMemo(() => {
    if (!sym || !targetPortfolio) return null
    return (targetPortfolio.stocks ?? []).find(s => s.symbol.toUpperCase() === sym) ?? null
  }, [sym, targetPortfolio])

  // ── Row helpers ─────────────────────────────────────────────────────────
  const updateRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, createRow()])
  const removeRow = (id) => setRows(rs => rs.length > 1 ? rs.filter(r => r.id !== id) : rs)

  const rowError = (r) => {
    const shares = parseFloat(r.shares)
    const price = parseFloat(r.price)
    if (!r.date) return '请选择交易日期'
    if (!shares || shares <= 0) return '请输入有效数量'
    if (!price || price <= 0) return '请输入有效价格'
    return null
  }

  const validateRows = () => {
    for (let i = 0; i < rows.length; i++) {
      const err = rowError(rows[i])
      if (err) return rows.length > 1 ? `第 ${i + 1} 笔：${err}` : err
    }
    return null
  }

  const toTransaction = (r) => {
    const shares = parseFloat(r.shares)
    const price = parseFloat(r.price)
    return {
      action: r.action,
      date: r.date,
      shares,
      price,
      commission: parseFloat(r.commission) || 0,
      total: price * shares,
    }
  }

  const validRows = rows.filter(r => parseFloat(r.shares) > 0 && parseFloat(r.price) > 0)
  const validCount = validRows.length
  const totalBuy = validRows.filter(r => r.action === 'buy').reduce((s, r) => s + parseFloat(r.shares) * parseFloat(r.price), 0)
  const totalSell = validRows.filter(r => r.action === 'sell').reduce((s, r) => s + parseFloat(r.shares) * parseFloat(r.price), 0)

  const handleSubmit = () => {
    if (isAggregate && !portfolioId) return setError('请选择投资组合')
    if (!sym) return setError('请输入股票代码')
    const err = validateRows()
    if (err) return setError(err)

    let stockId
    if (existingStock) {
      stockId = existingStock.id
    } else {
      stockId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      dispatch({
        type: 'ADD_STOCK',
        portfolioId,
        stock: {
          id: stockId, symbol: sym, name: sym, shares: 0, avgCost: 0, note: '',
          initialShares: 0, initialAvgCost: 0, stockRealizedPnL: 0, transactions: [],
        },
      })
    }

    rows.forEach(r => {
      dispatch({ type: 'ADD_STOCK_TRANSACTION', portfolioId, stockId, transaction: toTransaction(r) })
    })
    onClose()
  }

  // Esc 关闭
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-2xl w-full max-w-lg shadow-modal border border-claude-border fade-in flex flex-col max-h-[90vh]"
        style={{ background: 'var(--claude-card)' }}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-claude-border">
          <h3 className="text-lg font-bold text-claude-text">新增交易</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-claude-muted hover:text-claude-text transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {/* 组合选择（仅聚合视图） */}
          {isAggregate && (
            <div>
              <label className="label">投资组合</label>
              <select className="select" value={portfolioId} onChange={e => setPortfolioId(e.target.value)}>
                {subPortfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* 股票代码（自动匹配已有持仓） */}
          <div>
            <label className="label">股票代码</label>
            <input
              className="input"
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder="如 AAPL"
              autoCapitalize="characters"
            />
            {sym && (existingStock
              ? <p className="mt-1.5 flex items-center gap-1 text-xs text-green-600"><Check size={12} /> 已有持仓：{existingStock.name || existingStock.symbol}（当前 {existingStock.shares} 股）</p>
              : <p className="mt-1.5 text-xs text-claude-muted">将新建股票 {sym}</p>
            )}
          </div>

          {/* 交易行列表 */}
          {rows.map((r, i) => (
            <div key={r.id} className="border border-claude-border rounded-2xl p-4 bg-gray-50/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-claude-muted">第 {i + 1} 笔</span>
                {rows.length > 1 && (
                  <button onClick={() => removeRow(r.id)}
                    className="p-1 rounded-lg text-claude-subtle hover:text-loss hover:bg-red-50 transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">交易类型</label>
                  <select className="select" value={r.action} onChange={e => updateRow(r.id, { action: e.target.value })}>
                    <option value="buy">买入 ↗</option>
                    <option value="sell">卖出 ↘</option>
                  </select>
                </div>
                <div>
                  <label className="label">交易日期</label>
                  <CalendarPicker value={r.date} onChange={v => updateRow(r.id, { date: v })} warnFuture />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">数量</label>
                  <SpinnerInput value={r.shares} onChange={v => updateRow(r.id, { shares: v })}
                    step={1} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">价格</label>
                  <SpinnerInput value={r.price} onChange={v => updateRow(r.id, { price: v })}
                    prefix="$" step={0.01} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">手续费（可选）</label>
                  <SpinnerInput value={r.commission} onChange={v => updateRow(r.id, { commission: v })}
                    prefix="$" step={0.01} placeholder="0.00" />
                </div>
              </div>
            </div>
          ))}

          <button onClick={addRow}
            className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-claude-border rounded-2xl text-sm text-claude-muted hover:text-claude-text hover:border-gray-400 hover:bg-gray-50 transition-colors">
            <Plus size={14} />添加一行
          </button>

          {validCount > 0 && (
            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-claude-muted">共 {validCount} 笔</span>
              </div>
              {totalBuy > 0 && (
                <div className="flex justify-between">
                  <span className="text-claude-muted">买入总额</span>
                  <span className="font-semibold text-profit">+{fmt.currency(totalBuy)}</span>
                </div>
              )}
              {totalSell > 0 && (
                <div className="flex justify-between">
                  <span className="text-claude-muted">卖出总额</span>
                  <span className="font-semibold text-loss">-{fmt.currency(totalSell)}</span>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-loss bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-claude-border">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-claude-border rounded-xl text-sm font-medium text-claude-muted hover:bg-gray-50 transition-colors">
            取消
          </button>
          <button onClick={handleSubmit}
            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors">
            确认添加{validCount > 0 ? `（${validCount} 笔）` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
