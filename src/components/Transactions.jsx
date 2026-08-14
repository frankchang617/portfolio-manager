import { useState, useMemo } from 'react'
import { TrendingUp, TrendingDown, Layers, Download, Upload, CalendarDays, X, Pencil, Search, Plus } from 'lucide-react'
import { usePortfolio } from '../contexts/PortfolioContext'
import { fmt, getPnLClass } from '../utils/formatters'
import ImportModal from './modals/ImportModal'
import AddTransactionModal from './modals/AddTransactionModal'
import CalendarPicker from './CalendarPicker'

function exportCSV(rows, filename) {
  const headers = ['日期', '类型', '操作', '标的', '详情', '数量', '成交价', '金额', '手续费', '已实现盈亏', '组合']
  const lines = [headers.join(',')]
  for (const t of rows) {
    const ACTION_TEXT = { buy: '股票买入', sell: '股票卖出', buy_open: '期权买入开', sell_open: '期权卖出开', close: '期权平仓' }
    lines.push([
      t.date,
      t.type === 'stock' ? '股票' : '期权',
      ACTION_TEXT[t.action] ?? t.action,
      t.symbol,
      `"${t.name}"`,
      t.quantity,
      t.price?.toFixed(2) ?? '',
      t.total?.toFixed(2) ?? '',
      t.commission?.toFixed(2) ?? '0',
      t.realizedPnL?.toFixed(2) ?? '',
      t.portfolioName ?? '',
    ].join(','))
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Transaction Edit Modal (stock only) ──────────────────────────────────────
function TransactionEditModal({ transaction, onClose, onSave }) {
  const [form, setForm] = useState({
    action: transaction.action,
    date: transaction.date,
    shares: String(transaction.quantity),
    price: String(transaction.price),
    commission: String(transaction.commission ?? 0),
  })
  const [error, setError] = useState('')

  const handleSave = () => {
    const shares = parseFloat(form.shares)
    const price = parseFloat(form.price)
    if (!form.date) return setError('请选择交易日期')
    if (!shares || shares <= 0) return setError('请输入有效数量')
    if (!price || price <= 0) return setError('请输入有效价格')
    onSave({
      action: form.action,
      date: form.date,
      shares,
      price,
      commission: parseFloat(form.commission) || 0,
      total: price * shares,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-2xl w-full max-w-md shadow-modal border border-claude-border p-6 fade-in"
        style={{ background: 'var(--claude-card)' }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-claude-text">编辑股票交易</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-claude-muted hover:text-claude-text transition-colors">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-claude-muted mb-5">
          <span className="font-bold text-claude-text">{transaction.symbol}</span> · {transaction.name}
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-claude-text mb-1.5">交易类型</label>
              <select className="select" value={form.action}
                onChange={e => setForm(f => ({ ...f, action: e.target.value }))}>
                <option value="buy">买入 ↗</option>
                <option value="sell">卖出 ↘</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-claude-text mb-1.5">交易日期</label>
              <CalendarPicker value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} warnFuture />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-claude-text mb-1.5">数量（股）</label>
              <input className="input" type="number" step="1" min="0" value={form.shares}
                onChange={e => setForm(f => ({ ...f, shares: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-claude-text mb-1.5">价格</label>
              <input className="input" type="number" step="0.01" min="0" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-claude-text mb-1.5">手续费</label>
              <input className="input" type="number" step="0.01" min="0" value={form.commission}
                onChange={e => setForm(f => ({ ...f, commission: e.target.value }))} placeholder="0.00" />
            </div>
          </div>

          {parseFloat(form.shares) > 0 && parseFloat(form.price) > 0 && (
            <div className="bg-gray-50 rounded-xl p-4 text-sm flex justify-between">
              <span className="text-claude-muted">交易总额</span>
              <span className={`font-semibold ${form.action === 'buy' ? 'text-loss' : 'text-profit'}`}>
                {form.action === 'buy' ? '-' : '+'}{fmt.currency(parseFloat(form.shares) * parseFloat(form.price))}
              </span>
            </div>
          )}

          {error && <p className="text-sm text-loss bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-claude-border rounded-xl text-sm font-medium text-claude-muted hover:bg-gray-50 transition-colors">
              取消
            </button>
            <button onClick={handleSave}
              className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors">
              保存修改
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Transactions() {
  const { activePortfolio, state, dispatch } = usePortfolio()
  const [filter, setFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [symbolQuery, setSymbolQuery] = useState('')
  const [editTarget, setEditTarget] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const isAggregate = activePortfolio?.isAggregate ?? false

  const subPortfolios = useMemo(() => (
    isAggregate
      ? state.portfolios.filter(p => !p.isAggregate)
      : (activePortfolio ? [activePortfolio] : [])
  ), [isAggregate, activePortfolio, state.portfolios])

  // Build unified transaction list from real data sources
  const allTransactions = useMemo(() => {
    const result = []

    for (const p of subPortfolios) {
      // Stock transactions
      for (const stock of (p.stocks ?? [])) {
        for (const t of (stock.transactions ?? [])) {
          result.push({
            id: t.id,
            date: t.date,
            type: 'stock',
            action: t.action,
            symbol: stock.symbol,
            name: stock.name || stock.symbol,
            quantity: t.shares,
            price: t.price,
            commission: t.commission ?? 0,
            total: t.price * t.shares,
            realizedPnL: t.action === 'sell' && t.realizedPnL != null ? t.realizedPnL : null,
            portfolioName: isAggregate ? p.name : null,
            portfolioId: p.id,
            stockId: stock.id,
            transactionId: t.id,
          })
        }
      }

      // Closed options
      for (const o of (p.options ?? [])) {
        // Opening trade
        result.push({
          id: o.id + '_open',
          date: o.tradeDate,
          type: 'option',
          action: o.direction === 'buy' ? 'buy_open' : 'sell_open',
          symbol: o.symbol,
          name: `${o.strike}${o.optionType === 'call' ? 'C' : 'P'} 到期 ${o.expiration}`,
          quantity: o.contracts,
          price: o.avgPremium,
          commission: o.commission ?? 0,
          total: o.avgPremium * o.contracts * 100,
          realizedPnL: null,
          portfolioName: isAggregate ? p.name : null,
        })
        // Closing trade (if closed)
        if (o.status === 'closed' && o.closeDate) {
          result.push({
            id: o.id + '_close',
            date: o.closeDate,
            type: 'option',
            action: 'close',
            symbol: o.symbol,
            name: `${o.strike}${o.optionType === 'call' ? 'C' : 'P'} 到期 ${o.expiration}`,
            quantity: o.contracts,
            price: o.closePrice,
            commission: 0,
            total: (o.closePrice ?? 0) * o.contracts * 100,
            realizedPnL: o.realizedPnL ?? 0,
            portfolioName: isAggregate ? p.name : null,
          })
        }
      }
    }

    return result.sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [subPortfolios, isAggregate])

  const filtered = useMemo(() => {
    let list = filter === 'all' ? allTransactions : allTransactions.filter(t => t.type === filter)
    if (dateFrom) list = list.filter(t => t.date >= dateFrom)
    if (dateTo) list = list.filter(t => t.date <= dateTo)
    if (symbolQuery.trim()) {
      const q = symbolQuery.trim().toUpperCase()
      list = list.filter(t => (t.symbol || '').toUpperCase().includes(q))
    }
    return list
  }, [allTransactions, filter, dateFrom, dateTo, symbolQuery])

  const summary = useMemo(() => {
    const totalStockRealizedPnL = subPortfolios
      .flatMap(p => p.stocks ?? [])
      .reduce((s, stock) => s + (stock.stockRealizedPnL ?? 0), 0)
    const totalOptionRealizedPnL = subPortfolios
      .flatMap(p => p.options ?? [])
      .filter(o => o.status === 'closed')
      .reduce((s, o) => s + (o.realizedPnL ?? 0), 0)
    const totalCommission = allTransactions.reduce((s, t) => s + (t.commission ?? 0), 0)
    return {
      totalRealizedPnL: totalStockRealizedPnL + totalOptionRealizedPnL,
      totalStockRealizedPnL,
      totalOptionRealizedPnL,
      totalCommission,
      count: allTransactions.length,
    }
  }, [subPortfolios, allTransactions])

  const handleSaveTransaction = (updates) => {
    dispatch({
      type: 'UPDATE_STOCK_TRANSACTION',
      portfolioId: editTarget.portfolioId,
      stockId: editTarget.stockId,
      transactionId: editTarget.transactionId,
      updates,
    })
    setEditTarget(null)
  }

  if (!activePortfolio) return null

  const ACTION_LABEL = {
    buy:       { text: '股票买入', cls: 'bg-green-100 text-green-700' },
    sell:      { text: '股票卖出', cls: 'bg-red-100 text-red-600' },
    buy_open:  { text: '期权买入开', cls: 'bg-blue-100 text-blue-700' },
    sell_open: { text: '期权卖出开', cls: 'bg-purple-100 text-purple-700' },
    close:     { text: '期权平仓',  cls: 'bg-gray-100 text-gray-600' },
  }

  return (
    <div className="space-y-5">
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showAdd && <AddTransactionModal onClose={() => setShowAdd(false)} />}
      {editTarget && (
        <TransactionEditModal
          transaction={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleSaveTransaction}
        />
      )}

      {isAggregate && (
        <div className="flex items-center gap-2.5 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
          <Layers size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-700">汇总所有子组合的交易记录</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2">总记录数</p>
          <p className="text-2xl font-bold text-claude-text">{summary.count}</p>
          <p className="text-xs text-claude-muted mt-1">笔交易</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2">已实现盈亏合计</p>
          <p className={`text-2xl font-bold ${getPnLClass(summary.totalRealizedPnL)}`}>
            {fmt.pnl(summary.totalRealizedPnL)}
          </p>
          <p className="text-xs text-claude-muted mt-1">股+期权</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2">股票已实现盈亏</p>
          <p className={`text-2xl font-bold ${getPnLClass(summary.totalStockRealizedPnL)}`}>
            {fmt.pnl(summary.totalStockRealizedPnL)}
          </p>
          <div className="flex items-center gap-1 mt-1">
            {summary.totalStockRealizedPnL >= 0
              ? <TrendingUp size={11} className="text-profit" />
              : <TrendingDown size={11} className="text-loss" />}
          </div>
        </div>
        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2">总手续费</p>
          <p className="text-2xl font-bold text-claude-text">{fmt.currency(summary.totalCommission)}</p>
          <p className="text-xs text-claude-muted mt-1">已扣除</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card p-4 space-y-3">
        {/* Type tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: 'all',    label: `全部（${allTransactions.length}）` },
            { key: 'stock',  label: `股票（${allTransactions.filter(t => t.type === 'stock').length}）` },
            { key: 'option', label: `期权（${allTransactions.filter(t => t.type === 'option').length}）` },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${
                filter === f.key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-claude-muted border-claude-border hover:text-claude-text'
              }`}>
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-claude-muted">显示 {filtered.length} 条</span>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
              <Plus size={13} />新增交易
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-claude-border rounded-lg text-sm text-claude-text hover:bg-gray-50 transition-colors">
              <Upload size={13} />导入 CSV
            </button>
            <button
              onClick={() => exportCSV(filtered, `交易记录_${new Date().toISOString().split('T')[0]}.csv`)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-claude-border rounded-lg text-sm text-claude-text hover:bg-gray-50 transition-colors">
              <Download size={13} />导出 CSV
            </button>
          </div>
        </div>
        {/* Symbol search + Date range */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-claude-muted">
            <Search size={13} />
            <span>股票代码</span>
          </div>
          <input
            className="input w-44"
            value={symbolQuery}
            onChange={e => setSymbolQuery(e.target.value)}
            placeholder="输入代码筛选，如 TSM"
          />
          {symbolQuery && (
            <button onClick={() => setSymbolQuery('')}
              className="flex items-center gap-1 text-xs text-claude-muted hover:text-claude-text transition-colors">
              <X size={12} />清除
            </button>
          )}
        </div>
        {/* Date range */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-claude-muted">
            <CalendarDays size={13} />
            <span>日期范围</span>
          </div>
          <div className="w-36">
            <CalendarPicker value={dateFrom} onChange={setDateFrom} placeholder="开始日期" />
          </div>
          <span className="text-claude-subtle text-sm">—</span>
          <div className="w-36">
            <CalendarPicker value={dateTo} onChange={setDateTo} placeholder="结束日期" />
          </div>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }}
              className="flex items-center gap-1 text-xs text-claude-muted hover:text-claude-text transition-colors">
              <X size={12} />清除
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-claude-muted">
            <p className="text-base font-medium mb-2">暂无交易记录</p>
            <p className="text-sm">在股票持仓中添加买卖记录，或在期权持仓中平仓后自动生成</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-claude-border bg-gray-50/50">
                  {['日期', '类型', '标的', '详情', '数量', '成交价', '金额', '手续费', '已实现盈亏', ...(isAggregate ? ['组合'] : []), '操作'].map(h => (
                    <th key={h} className={`text-xs font-semibold text-claude-subtle uppercase tracking-wide py-3 px-4 whitespace-nowrap ${h === '日期' || h === '类型' || h === '标的' || h === '组合' ? 'text-left' : 'text-right'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const act = ACTION_LABEL[t.action] ?? { text: t.action, cls: 'bg-gray-100 text-gray-500' }
                  return (
                    <tr key={t.id} className="border-b border-claude-border/40 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4 text-sm text-claude-muted whitespace-nowrap">
                        {new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${act.cls}`}>{act.text}</span>
                      </td>
                      <td className="py-3 px-4 font-bold text-sm text-claude-text">{t.symbol}</td>
                      <td className="py-3 px-4 text-sm text-claude-muted max-w-[160px] truncate">{t.name}</td>
                      <td className="py-3 px-4 text-right text-sm font-mono">
                        {t.type === 'option' ? `${t.quantity} 张` : `${t.quantity} 股`}
                      </td>
                      <td className="py-3 px-4 text-right text-sm font-mono">{fmt.currency(t.price ?? 0)}</td>
                      <td className={`py-3 px-4 text-right text-sm font-mono font-medium ${t.action === 'buy' || t.action === 'buy_open' ? 'text-loss' : 'text-profit'}`}>
                        {t.action === 'buy' || t.action === 'buy_open' ? '-' : '+'}{fmt.currency(t.total)}
                      </td>
                      <td className="py-3 px-4 text-right text-sm font-mono text-claude-muted">
                        {t.commission > 0 ? fmt.currency(t.commission) : <span className="text-claude-subtle">—</span>}
                      </td>
                      <td className={`py-3 px-4 text-right text-sm font-mono font-semibold ${getPnLClass(t.realizedPnL)}`}>
                        {t.realizedPnL != null ? fmt.pnl(t.realizedPnL) : <span className="text-claude-subtle">—</span>}
                      </td>
                      {isAggregate && (
                        <td className="py-3 px-4 text-left text-xs text-claude-muted whitespace-nowrap">{t.portfolioName}</td>
                      )}
                      <td className="py-3 px-4 text-right">
                        {t.type === 'stock' ? (
                          <button onClick={() => setEditTarget(t)}
                            className="p-1.5 rounded-lg text-claude-subtle hover:text-blue-600 hover:bg-blue-50 transition-colors">
                            <Pencil size={13} />
                          </button>
                        ) : (
                          <span className="text-claude-subtle text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
