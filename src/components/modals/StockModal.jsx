import { useState, useEffect, useRef } from 'react'
import { X, TrendingUp, TrendingDown, Upload, Trash2, AlertTriangle, ChevronUp, ChevronDown, Download, Pencil, Check } from 'lucide-react'
import { usePortfolio } from '../../contexts/PortfolioContext'
import { fmt, getPnLClass } from '../../utils/formatters'
import { fetchCompanyProfile } from '../../utils/api'
import CalendarPicker from '../CalendarPicker'

// ── Spinner Number Input ─────────────────────────────────────────────────────
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

// ── CSV parser ───────────────────────────────────────────────────────────────
// Returns { rows, rowErrors, fatalError }
// rows: valid parsed rows
// rowErrors: [{ line, raw, reasons[] }] for invalid rows
// fatalError: string if the file itself is unparseable
function parseCSV(text) {
  const allLines = text.trim().split('\n')
  const lines = allLines.filter(l => l.trim())
  if (lines.length < 2) return { rows: [], rowErrors: [], fatalError: '文件为空或缺少数据行' }

  const headerCols = lines[0].toLowerCase().split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  const hasSymbolCol = headerCols.some(h => ['symbol', 'ticker', 'stock', 'code'].includes(h))
  const minCols = hasSymbolCol ? 5 : 4

  const rows = []
  const rowErrors = []

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    const cols = raw.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const lineNum = i + 1  // 1-based, header = line 1
    const reasons = []

    // Column count check
    if (cols.length < minCols) {
      rowErrors.push({ line: lineNum, raw, reasons: [`列数不足（期望 ${minCols} 列，实际 ${cols.length} 列）`] })
      continue
    }

    let date, action, sharesRaw, priceRaw
    if (hasSymbolCol) {
      ;[date, action, , sharesRaw, priceRaw] = cols
    } else {
      ;[date, action, sharesRaw, priceRaw] = cols
    }

    // Date validation
    if (!date) {
      reasons.push('日期为空')
    } else if (!/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(date)) {
      reasons.push(`日期格式错误「${date}」，应为 YYYY-MM-DD`)
    } else {
      const d = new Date(date)
      if (isNaN(d.getTime())) reasons.push(`日期无效「${date}」`)
    }

    // Action validation
    const actLower = (action || '').toLowerCase()
    const isBuy = actLower.includes('buy') || action.includes('买')
    const isSell = actLower.includes('sell') || action.includes('卖')
    if (!isBuy && !isSell) reasons.push(`操作类型无法识别「${action}」，应为 buy 或 sell`)

    // Shares validation
    const shares = parseFloat(sharesRaw)
    if (!sharesRaw) reasons.push('数量为空')
    else if (isNaN(shares)) reasons.push(`数量不是数字「${sharesRaw}」`)
    else if (shares <= 0) reasons.push(`数量必须大于 0（当前：${shares}）`)

    // Price validation
    const price = parseFloat(priceRaw)
    if (!priceRaw) reasons.push('价格为空')
    else if (isNaN(price)) reasons.push(`价格不是数字「${priceRaw}」`)
    else if (price <= 0) reasons.push(`价格必须大于 0（当前：${price}）`)

    if (reasons.length > 0) {
      rowErrors.push({ line: lineNum, raw, reasons })
    } else {
      rows.push({ date, action: isBuy ? 'buy' : 'sell', shares, price })
    }
  }

  return { rows, rowErrors, fatalError: null }
}

// ── Main Modal ───────────────────────────────────────────────────────────────
export default function StockModal({ isOpen, onClose, editStock = null }) {
  const { dispatch, activePortfolio, state } = usePortfolio()
  const [tab, setTab] = useState('transactions')   // 'transactions' | 'new' | 'csv'
  const [form, setForm] = useState({ action: 'buy', date: new Date().toISOString().split('T')[0], shares: '', price: '', commission: '' })
  const [csvError, setCsvError] = useState('')
  const [csvPreview, setCsvPreview] = useState([])
  const [csvRowErrors, setCsvRowErrors] = useState([])
  const [addError, setAddError] = useState('')
  // Add-stock mode (no editStock)
  const [newSymbol, setNewSymbol] = useState('')
  const [newName, setNewName] = useState('')
  const [newNote, setNewNote] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [nameLookupState, setNameLookupState] = useState('idle') // 'idle' | 'loading' | 'found' | 'notfound'
  const nameLookupTimer = useRef(null)
  const [editingSymbol, setEditingSymbol] = useState(false)
  const [symbolDraft, setSymbolDraft] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [symbolEditError, setSymbolEditError] = useState('')
  const [editingTxId, setEditingTxId] = useState(null)
  const [editForm, setEditForm] = useState({ action: 'buy', date: '', shares: '', price: '', commission: '' })
  const [editError, setEditError] = useState('')
  const fileRef = useRef(null)
  const symbolInputRef = useRef(null)
  const symbolComposingRef = useRef(false)
  const symbolEditRef = useRef(null)
  const symbolComposingEditRef = useRef(false)

  useEffect(() => {
    if (isOpen) {
      setTab(editStock ? 'transactions' : 'new')
      setForm({ action: 'buy', date: new Date().toISOString().split('T')[0], shares: '', price: '', commission: '' })
      setCsvError(''); setCsvPreview([]); setCsvRowErrors([]); setAddError('')
      setNewSymbol(''); setNewName(''); setNewNote(''); setNameLookupState('idle')
      // Reset uncontrolled symbol input DOM value
      if (symbolInputRef.current) symbolInputRef.current.value = ''
      setEditingSymbol(false); setSymbolDraft(''); setNameDraft(''); setSymbolEditError('')
      setEditingTxId(null); setEditForm({ action: 'buy', date: '', shares: '', price: '', commission: '' }); setEditError('')
    }
  }, [isOpen, editStock])

  // key-close
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

  if (!isOpen) return null

  const prices = state.prices
  const q = editStock ? prices[editStock.symbol.toUpperCase()] : null
  const currentPrice = q?.price ?? null
  const marketValue = currentPrice != null ? currentPrice * (editStock?.shares ?? 0) : null
  const unrealizedPnL = currentPrice != null ? (currentPrice - (editStock?.avgCost ?? 0)) * (editStock?.shares ?? 0) : null
  const unrealizedPct = unrealizedPnL != null && editStock?.avgCost ? (unrealizedPnL / (editStock.avgCost * editStock.shares)) * 100 : null

  const transactions = editStock?.transactions ?? []
  const buyTotal = transactions.filter(t => t.action === 'buy').reduce((s, t) => s + t.price * t.shares, 0)
  const sellTotal = transactions.filter(t => t.action === 'sell').reduce((s, t) => s + t.price * t.shares, 0)

  // ── Add transaction ──────────────────────────────────────────────────────
  const handleAddTransaction = () => {
    setAddError('')
    const shares = parseFloat(form.shares)
    const price = parseFloat(form.price)
    if (!form.date) return setAddError('请选择交易日期')
    if (!shares || shares <= 0) return setAddError('请输入有效数量')
    if (!price || price <= 0) return setAddError('请输入有效价格')

    dispatch({
      type: 'ADD_STOCK_TRANSACTION',
      portfolioId: activePortfolio.id,
      stockId: editStock.id,
      transaction: { action: form.action, date: form.date, shares, price, commission: parseFloat(form.commission) || 0, total: price * shares },
    })
    setForm(f => ({ ...f, shares: '', price: '', commission: '' }))
    setTab('transactions')
  }

  // ── Add new stock (with first transaction) ───────────────────────────────
  const handleAddStock = () => {
    setAddError('')
    const sym = newSymbol.trim().toUpperCase()
    if (!sym) return setAddError('请输入股票代码')
    const shares = parseFloat(form.shares)
    const price = parseFloat(form.price)
    if (!form.date) return setAddError('请选择交易日期')
    if (!shares || shares <= 0) return setAddError('请输入有效数量')
    if (!price || price <= 0) return setAddError('请输入有效价格')

    // Create stock then add first transaction
    const stockId = `${Date.now()}_${Math.random().toString(36).slice(2,9)}`
    dispatch({
      type: 'ADD_STOCK',
      portfolioId: activePortfolio.id,
      stock: {
        id: stockId, symbol: sym, name: newName.trim() || sym,
        shares: form.action === 'buy' ? shares : 0,
        avgCost: form.action === 'buy' ? price : 0,
        note: newNote.trim(),
        initialShares: 0, initialAvgCost: 0, stockRealizedPnL: 0,
        transactions: [{ id: `${Date.now()}_init`, action: form.action, date: form.date, shares, price, commission: parseFloat(form.commission) || 0, total: price * shares }],
      },
    })
    onClose()
  }

  // ── CSV import ───────────────────────────────────────────────────────────
  const readCSVFile = (file) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const { rows, rowErrors, fatalError } = parseCSV(ev.target.result)
      setCsvError(fatalError || '')
      setCsvPreview(rows)
      setCsvRowErrors(rowErrors)
    }
    reader.readAsText(file)
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) readCSVFile(file)
  }

  const handleCSVImport = () => {
    if (!csvPreview.length) return

    if (editStock) {
      csvPreview.forEach(t => {
        dispatch({
          type: 'ADD_STOCK_TRANSACTION',
          portfolioId: activePortfolio.id,
          stockId: editStock.id,
          transaction: { action: t.action, date: t.date, shares: t.shares, price: t.price, commission: 0, total: t.price * t.shares },
        })
      })
      setCsvPreview([]); setCsvError(''); setCsvRowErrors([])
      if (fileRef.current) fileRef.current.value = ''
      setTab('transactions')
    } else {
      // Add stock mode: need a symbol first
      const sym = newSymbol.trim().toUpperCase()
      if (!sym) { setCsvError('请先在上方填写股票代码'); return }
      const stockId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      dispatch({
        type: 'ADD_STOCK',
        portfolioId: activePortfolio.id,
        stock: {
          id: stockId, symbol: sym, name: newName.trim() || sym,
          shares: 0, avgCost: 0, note: newNote.trim(),
          initialShares: 0, initialAvgCost: 0, stockRealizedPnL: 0,
          transactions: [],
        },
      })
      csvPreview.forEach(t => {
        dispatch({
          type: 'ADD_STOCK_TRANSACTION',
          portfolioId: activePortfolio.id,
          stockId,
          transaction: { action: t.action, date: t.date, shares: t.shares, price: t.price, commission: 0, total: t.price * t.shares },
        })
      })
      onClose()
    }
  }

  const handleDelete = (txId) => {
    dispatch({ type: 'DELETE_STOCK_TRANSACTION', portfolioId: activePortfolio.id, stockId: editStock.id, transactionId: txId })
  }

  const handleClearAll = () => {
    if (!confirm(`确定清空 ${editStock.symbol} 的所有交易记录？持仓将重置为初始状态。`)) return
    dispatch({ type: 'CLEAR_STOCK_TRANSACTIONS', portfolioId: activePortfolio.id, stockId: editStock.id })
  }

  const handleDeleteStock = () => {
    if (!confirm(`确定删除 ${editStock.symbol} 全部持仓？`)) return
    dispatch({ type: 'DELETE_STOCK', portfolioId: activePortfolio.id, stockId: editStock.id })
    onClose()
  }

  const triggerNameLookup = (sym) => {
    clearTimeout(nameLookupTimer.current)
    if (!sym || sym.length < 1) { setNameLookupState('idle'); return }
    setNameLookupState('loading')
    nameLookupTimer.current = setTimeout(async () => {
      const profile = await fetchCompanyProfile(sym)
      if (profile) {
        setNewName(prev => prev || profile.name)
        setNameLookupState('found')
      } else {
        setNameLookupState('notfound')
      }
    }, 800)
  }

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

  const downloadTemplate = () => {
    const sym = (editStock?.symbol || newSymbol.trim().toUpperCase() || 'AAPL')
    const rows = [
      'date,action,symbol,shares,price',
      `2024-01-15,buy,${sym},100,185.50`,
      `2024-03-20,buy,${sym},50,171.25`,
      `2024-06-10,sell,${sym},30,195.80`,
    ]
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `stock_transactions_template.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const title = editStock ? editStock.symbol : '添加股票'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-3xl w-full max-w-2xl shadow-modal border border-claude-border fade-in"
        style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 flex-shrink-0">
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
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-claude-bg text-claude-muted hover:text-claude-text transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* ── Info cards (edit mode only) ── */}
        {editStock && (
          <div className="px-6 pb-4 flex-shrink-0">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-2xl p-4">
                <div className="flex items-center gap-1.5 text-xs text-claude-muted mb-2">
                  <span>$</span><span>平均成本</span>
                </div>
                <p className="text-xl font-bold text-claude-text">{fmt.currency(editStock.avgCost)}</p>
              </div>
              <div className="bg-gray-50 rounded-2xl p-4">
                <div className="flex items-center gap-1.5 text-xs text-claude-muted mb-2">
                  <span>#</span><span>持仓市值</span>
                </div>
                <p className="text-xl font-bold text-claude-text">
                  {marketValue != null ? fmt.currency(marketValue) : '—'}
                </p>
              </div>
              <div className={`rounded-2xl p-4 ${unrealizedPnL != null && unrealizedPnL >= 0 ? 'bg-green-50' : unrealizedPnL != null ? 'bg-red-50' : 'bg-gray-50'}`}>
                <div className="flex items-center gap-1.5 text-xs text-claude-muted mb-2">
                  {unrealizedPnL != null && unrealizedPnL >= 0
                    ? <TrendingUp size={12} className="text-profit" />
                    : <TrendingDown size={12} className="text-loss" />}
                  <span>账面盈亏</span>
                </div>
                <p className={`text-xl font-bold ${getPnLClass(unrealizedPnL)}`}>
                  {unrealizedPnL != null ? fmt.pnl(unrealizedPnL) : '—'}
                </p>
                {unrealizedPct != null && (
                  <p className={`text-sm mt-0.5 font-medium ${getPnLClass(unrealizedPct)}`}>
                    {fmt.pctChange(unrealizedPct)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── New stock: symbol/name inputs ── */}
        {!editStock && (
          <div className="px-6 pb-2 flex-shrink-0 grid grid-cols-2 gap-3">
            <div>
              <label className="label">股票代码 *</label>
              <input
                ref={symbolInputRef}
                className="input"
                onCompositionStart={() => { symbolComposingRef.current = true }}
                onCompositionEnd={e => {
                  symbolComposingRef.current = false
                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, '')
                  e.target.value = val
                  setNewSymbol(val)
                  triggerNameLookup(val)
                }}
                onChange={e => {
                  if (symbolComposingRef.current) return
                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, '')
                  e.target.value = val
                  setNewSymbol(val)
                  triggerNameLookup(val)
                }}
                placeholder="如 AAPL"
                autoFocus
              />
            </div>
            <div>
              <label className="label">
                公司名称（可选）
                {nameLookupState === 'loading' && <span className="ml-2 text-claude-subtle text-xs">查询中…</span>}
                {nameLookupState === 'found' && <span className="ml-2 text-profit text-xs">✓ 已自动填写</span>}
                {nameLookupState === 'notfound' && <span className="ml-2 text-claude-subtle text-xs">未找到，可手动填写</span>}
              </label>
              <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="输入代码后自动填写" />
            </div>
          </div>
        )}

        {/* ── Tab bar ── */}
        <div className="px-6 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2 bg-gray-100 rounded-2xl p-1.5">
            {editStock && (
              <button onClick={() => setTab('transactions')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'transactions' ? 'bg-white shadow-sm text-claude-text' : 'text-claude-muted hover:text-claude-text'}`}>
                <span>💲</span>交易记录
                {transactions.length > 0 && (
                  <span className="bg-claude-orange text-white text-xs px-1.5 py-0.5 rounded-full">{transactions.length}</span>
                )}
              </button>
            )}
            <button onClick={() => setTab('new')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'new' ? 'bg-white shadow-sm text-claude-text' : 'text-claude-muted hover:text-claude-text'}`}>
              <span>+</span>{editStock ? '新增交易' : '交易详情'}
            </button>
            <button onClick={() => setTab('csv')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'csv' ? 'bg-white shadow-sm text-claude-text' : 'text-claude-muted hover:text-claude-text'}`}>
              <Upload size={13} />导入 CSV
            </button>
          </div>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="overflow-y-auto flex-1 px-6 pb-6">

          {/* ── 交易记录 tab ── */}
          {tab === 'transactions' && editStock && (
            <div>
              {/* Summary row */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-claude-muted">🗂 {transactions.length} 笔记录</span>
                  <span className="text-profit font-medium">↗ 买入 {fmt.currency(buyTotal)}</span>
                  <span className="text-loss font-medium">↘ 卖出 {fmt.currency(sellTotal)}</span>
                </div>
                {transactions.length > 0 && (
                  <button onClick={handleClearAll}
                    className="flex items-center gap-1.5 text-xs text-loss border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-xl transition-colors">
                    <AlertTriangle size={12} />清空全部
                  </button>
                )}
              </div>

              {transactions.length === 0 ? (
                <div className="text-center py-10 text-claude-muted">
                  <p className="text-sm">暂无交易记录</p>
                  <button onClick={() => setTab('new')} className="mt-3 text-claude-orange text-sm hover:underline">
                    + 添加第一笔交易
                  </button>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-claude-border">
                      <th className="text-xs text-claude-subtle font-semibold text-left py-2 pr-4">日期</th>
                      <th className="text-xs text-claude-subtle font-semibold text-left py-2 pr-4">类型</th>
                      <th className="text-xs text-claude-subtle font-semibold text-right py-2 pr-4">数量</th>
                      <th className="text-xs text-claude-subtle font-semibold text-right py-2 pr-4">价格</th>
                      <th className="text-xs text-claude-subtle font-semibold text-right py-2 pr-4">总额</th>
                      <th className="text-xs text-claude-subtle font-semibold text-right py-2">手续费</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
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
                      })}
                  </tbody>
                </table>
              )}

              {/* Delete stock button */}
              <div className="mt-6 pt-4 border-t border-claude-border flex justify-between">
                <button onClick={handleDeleteStock} className="text-sm text-loss hover:bg-red-50 px-4 py-2 rounded-xl transition-colors">
                  删除整个持仓
                </button>
              </div>
            </div>
          )}

          {/* ── 新增交易 / 添加股票 tab ── */}
          {tab === 'new' && (
            <div className="space-y-5">
              {/* Type + Date row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">交易类型</label>
                  <select className="select" value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))}>
                    <option value="buy">买入 ↗</option>
                    <option value="sell">卖出 ↘</option>
                  </select>
                </div>
                <div>
                  <label className="label">交易日期</label>
                  <CalendarPicker value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
                </div>
              </div>

              {/* Shares + Price + Commission row */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">交易数量</label>
                  <SpinnerInput value={form.shares} onChange={v => setForm(f => ({ ...f, shares: v }))}
                    step={1} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">交易价格</label>
                  <SpinnerInput value={form.price} onChange={v => setForm(f => ({ ...f, price: v }))}
                    prefix="$" step={0.01} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">手续费（可选）</label>
                  <SpinnerInput value={form.commission} onChange={v => setForm(f => ({ ...f, commission: v }))}
                    prefix="$" step={0.01} placeholder="0.00" />
                </div>
              </div>

              {/* Preview */}
              {form.shares && form.price && parseFloat(form.shares) > 0 && parseFloat(form.price) > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-claude-muted">交易总额</span>
                    <span className={`font-semibold ${form.action === 'buy' ? 'text-profit' : 'text-loss'}`}>
                      {form.action === 'buy' ? '+' : '-'}{fmt.currency(parseFloat(form.shares) * parseFloat(form.price))}
                    </span>
                  </div>
                  {parseFloat(form.commission) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-claude-muted">手续费</span>
                      <span className="font-medium text-loss">-{fmt.currency(parseFloat(form.commission))}</span>
                    </div>
                  )}
                  {editStock && form.action === 'buy' && (
                    <div className="flex justify-between">
                      <span className="text-claude-muted">新均价（含手续费）</span>
                      <span className="font-medium text-claude-text">
                        {fmt.currency(
                          (editStock.shares * editStock.avgCost + parseFloat(form.shares) * parseFloat(form.price) + (parseFloat(form.commission) || 0))
                          / (editStock.shares + parseFloat(form.shares))
                        )}
                      </span>
                    </div>
                  )}
                  {editStock && form.action === 'sell' && (
                    <div className="flex justify-between">
                      <span className="text-claude-muted">预计已实现盈亏</span>
                      <span className={`font-medium ${((parseFloat(form.price) - editStock.avgCost) * parseFloat(form.shares) - (parseFloat(form.commission) || 0)) >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {fmt.pnl((parseFloat(form.price) - editStock.avgCost) * parseFloat(form.shares) - (parseFloat(form.commission) || 0))}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Portfolio selector (for context) */}
              <div>
                <label className="label">投资组合（可选）</label>
                <select className="select" defaultValue={activePortfolio?.id}>
                  {state.portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              {/* Note (add mode) */}
              {!editStock && (
                <div>
                  <label className="label">备注（可选）</label>
                  <input className="input" value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="可选" />
                </div>
              )}

              {addError && <p className="text-sm text-loss bg-red-50 px-3 py-2 rounded-lg">{addError}</p>}

              {/* Buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={editStock ? handleAddTransaction : handleAddStock}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-2xl transition-colors text-sm"
                >
                  确认添加
                </button>
                <button onClick={() => editStock ? setTab('transactions') : onClose()}
                  className="px-6 py-3 border border-claude-border rounded-2xl text-sm font-medium text-claude-muted hover:text-claude-text hover:bg-claude-bg transition-colors">
                  取消
                </button>
              </div>
            </div>
          )}

          {/* ── CSV 导入 tab ── */}
          {tab === 'csv' && (
            <div className="space-y-4">
              <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-700">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold">CSV 格式要求：</p>
                  <button onClick={downloadTemplate}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-xs">
                    <Download size={11} />下载模板
                  </button>
                </div>
                <p>第一行为表头，统一 5 列格式：</p>
                <code className="block bg-white rounded-lg p-2 mt-2 font-mono text-blue-800 leading-5">
                  date,action,symbol,shares,price<br/>
                  2024-01-15,buy,AAPL,100,185.50<br/>
                  2024-06-10,sell,AAPL,30,195.80
                </code>
                <p className="mt-1.5">action 填 <strong>buy</strong>（买入）或 <strong>sell</strong>（卖出），日期格式 YYYY-MM-DD</p>
              </div>

              <div
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-colors ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-claude-border'}`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => {
                  e.preventDefault()
                  setIsDragging(false)
                  const file = e.dataTransfer.files[0]
                  if (file) readCSVFile(file)
                }}
              >
                <Upload size={24} className={`mx-auto mb-3 ${isDragging ? 'text-blue-400' : 'text-claude-muted'}`} />
                <p className="text-sm text-claude-muted mb-3">拖拽 CSV 文件到此处，或点击选择</p>
                <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileChange} className="hidden" />
                <button onClick={() => fileRef.current?.click()} className="btn-secondary mx-auto">
                  选择文件
                </button>
              </div>

              {csvError && (
                <p className="text-sm text-loss bg-red-50 px-3 py-2 rounded-lg">{csvError}</p>
              )}

              {(csvPreview.length > 0 || csvRowErrors.length > 0) && (
                <div className="space-y-3">
                  {/* Summary */}
                  <div className="flex items-center gap-2 text-sm">
                    {csvPreview.length > 0 && (
                      <span className="px-2.5 py-1 bg-green-100 text-green-700 rounded-lg font-medium">
                        ✓ {csvPreview.length} 条有效
                      </span>
                    )}
                    {csvRowErrors.length > 0 && (
                      <span className="px-2.5 py-1 bg-red-100 text-red-600 rounded-lg font-medium">
                        ✕ {csvRowErrors.length} 条有错误
                      </span>
                    )}
                  </div>

                  {/* Valid rows preview */}
                  {csvPreview.length > 0 && (
                    <div className="border border-claude-border rounded-xl overflow-hidden">
                      <div className="max-h-36 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              {['日期','类型','数量','价格'].map(h => (
                                <th key={h} className="text-left text-xs text-claude-subtle px-3 py-2">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {csvPreview.map((r, i) => (
                              <tr key={i} className="border-t border-claude-border/50">
                                <td className="px-3 py-1.5 text-claude-muted font-mono text-xs">{r.date}</td>
                                <td className="px-3 py-1.5">
                                  <span className={`badge ${r.action === 'buy' ? 'badge-long' : 'badge-short'}`}>
                                    {r.action === 'buy' ? '买入' : '卖出'}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-xs">{r.shares}</td>
                                <td className="px-3 py-1.5 font-mono text-xs">{fmt.currency(r.price)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Row errors */}
                  {csvRowErrors.length > 0 && (
                    <div className="border border-red-200 rounded-xl overflow-hidden">
                      <div className="bg-red-50 px-3 py-2 border-b border-red-200">
                        <p className="text-xs font-semibold text-red-700">错误详情（跳过这些行）</p>
                      </div>
                      <div className="max-h-44 overflow-y-auto divide-y divide-red-100">
                        {csvRowErrors.map((e, i) => (
                          <div key={i} className="px-3 py-2.5">
                            <div className="flex items-start gap-2">
                              <span className="text-xs font-mono text-red-400 flex-shrink-0 mt-0.5">第 {e.line} 行</span>
                              <div className="min-w-0">
                                <p className="text-xs font-mono text-claude-muted truncate mb-1">{e.raw}</p>
                                {e.reasons.map((r, j) => (
                                  <p key={j} className="text-xs text-red-600">· {r}</p>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {csvPreview.length > 0 && (
                    <button onClick={handleCSVImport}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-2xl transition-colors text-sm">
                      导入 {csvPreview.length} 条有效交易{csvRowErrors.length > 0 ? `（跳过 ${csvRowErrors.length} 条错误）` : ''}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
