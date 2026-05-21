import { useState, useEffect, useRef } from 'react'
import { X, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { usePortfolio } from '../../contexts/PortfolioContext'
import CalendarPicker from '../CalendarPicker'

// ── Spinner number input ─────────────────────────────────────────────────────
function SpinnerInput({ value, onChange, prefix = '', step = 1, min = 0, placeholder = '0.00' }) {
  const num = parseFloat(value) || 0
  const digits = step < 1 ? 2 : 0
  return (
    <div className="relative">
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-claude-muted text-sm select-none">{prefix}</span>
      )}
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        step={step}
        min={min}
        placeholder={placeholder}
        className={`w-full py-2.5 pr-8 border border-claude-border rounded-xl text-sm bg-white
                    focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500
                    text-claude-text appearance-none ${prefix ? 'pl-7' : 'pl-3'}`}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col">
        <button type="button"
          onClick={() => onChange(String((num + step).toFixed(digits)))}
          className="p-0.5 text-claude-subtle hover:text-claude-muted">
          <ChevronUp size={12} />
        </button>
        <button type="button"
          onClick={() => onChange(String(Math.max(min, num - step).toFixed(digits)))}
          className="p-0.5 text-claude-subtle hover:text-claude-muted">
          <ChevronDown size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Custom select dropdown ───────────────────────────────────────────────────
function CustomSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-3 py-2.5 border rounded-xl bg-white text-sm text-claude-text transition-all
          ${open ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-claude-border hover:border-gray-400'}`}
      >
        <span>{selected?.label}</span>
        <ChevronDown size={14} className={`text-claude-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 w-full bg-white rounded-2xl border border-claude-border overflow-hidden fade-in"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.10)' }}>
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors text-left
                ${opt.value === value
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-claude-text hover:bg-gray-50'}`}
            >
              {opt.label}
              {opt.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Field wrapper ────────────────────────────────────────────────────────────
function F({ label, error, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-claude-text mb-2">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// ── Main Modal ───────────────────────────────────────────────────────────────
const EMPTY = {
  symbol: '',
  tradeDate: new Date().toISOString().split('T')[0],
  optionType: 'call',
  direction: 'buy',
  strike: '',
  expiration: '',
  contracts: '1',
  premium: '',
  commission: '',
  impliedVolatility: '30',
  note: '',
  closePrice: '',
  closeDate: '',
  closeCommission: '',
}

export default function OptionsModal({ isOpen, onClose, editOption = null }) {
  const { dispatch, activePortfolio } = usePortfolio()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const symbolInputRef = useRef(null)
  const symbolComposingRef = useRef(false)

  useEffect(() => {
    if (isOpen) {
      if (symbolInputRef.current) symbolInputRef.current.value = editOption ? editOption.symbol : ''
      if (editOption) {
        setForm({
          symbol: editOption.symbol,
          tradeDate: editOption.tradeDate || new Date().toISOString().split('T')[0],
          optionType: editOption.optionType,
          direction: editOption.direction || (editOption.contracts > 0 ? 'buy' : 'sell'),
          strike: String(editOption.strike),
          expiration: editOption.expiration,
          contracts: String(Math.abs(editOption.contracts ?? 1)),
          premium: String(editOption.avgPremium ?? editOption.premium ?? ''),
          commission: editOption.commission != null ? String(editOption.commission) : '',
          impliedVolatility: String(((editOption.impliedVolatility ?? 0.3) * 100).toFixed(1)),
          note: editOption.note || '',
          closePrice: editOption.closePrice != null ? String(editOption.closePrice) : '',
          closeDate: editOption.closeDate || '',
          closeCommission: editOption.closeCommission != null ? String(editOption.closeCommission) : '',
        })
      } else {
        setForm(EMPTY)
      }
      setErrors({})
    }
  }, [isOpen, editOption])

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    if (isOpen) window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const set = (field) => (val) => setForm(f => ({ ...f, [field]: val }))
  const setE = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const validate = () => {
    const e = {}
    if (!form.symbol.trim()) e.symbol = '请输入标的代码'
    if (!form.tradeDate) e.tradeDate = '请选择交易日期'
    if (!form.strike || isNaN(+form.strike) || +form.strike <= 0) e.strike = '请输入行权价'
    if (!form.expiration) e.expiration = '请选择到期日'
    if (!form.contracts || isNaN(+form.contracts) || +form.contracts <= 0) e.contracts = '请输入合约数量'
    if (!form.premium || isNaN(+form.premium) || +form.premium < 0) e.premium = '请输入权利金'
    if (editOption?.status === 'closed' && form.closePrice !== '' && isNaN(+form.closePrice)) e.closePrice = '请输入有效平仓价格'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    const isClosed = editOption?.status === 'closed'
    const contracts = parseFloat(form.contracts)
    const premium = parseFloat(form.premium)
    const commission = form.commission !== '' ? parseFloat(form.commission) : 0
    const closeCommission = form.closeCommission !== '' ? parseFloat(form.closeCommission) : 0
    const direction = form.direction

    const data = {
      symbol: form.symbol.trim().toUpperCase(),
      tradeDate: form.tradeDate,
      optionType: form.optionType,
      direction,
      strike: parseFloat(form.strike),
      expiration: form.expiration,
      contracts,
      avgPremium: premium,
      commission,
      impliedVolatility: parseFloat(form.impliedVolatility) / 100,
      note: form.note.trim(),
    }

    if (isClosed) {
      const closePrice = form.closePrice !== '' ? parseFloat(form.closePrice) : (editOption.closePrice ?? 0)
      const tradePnL = direction === 'buy'
        ? (closePrice - premium) * contracts * 100
        : (premium - closePrice) * contracts * 100
      Object.assign(data, {
        status: 'closed',
        closePrice,
        closeDate: form.closeDate || editOption.closeDate,
        closeCommission,
        realizedPnL: tradePnL - commission - closeCommission,
        commissionApplied: true,
      })
    } else {
      Object.assign(data, { status: 'open', realizedPnL: null, closePrice: null, closeDate: null, closeCommission: null })
    }

    if (editOption) {
      dispatch({ type: 'UPDATE_OPTION', portfolioId: activePortfolio.id, optionId: editOption.id, updates: data })
    } else {
      dispatch({ type: 'ADD_OPTION', portfolioId: activePortfolio.id, option: data })
    }
    onClose()
  }

  const handleDelete = () => {
    if (!confirm(`确定删除这条期权记录？`)) return
    dispatch({ type: 'DELETE_OPTION', portfolioId: activePortfolio.id, optionId: editOption.id })
    onClose()
  }

  const directionOptions = [
    { value: 'buy', label: '买入（Buy to Open）' },
    { value: 'sell', label: '卖出（Sell to Open）' },
  ]
  const typeOptions = [
    { value: 'call', label: 'Call（看涨）' },
    { value: 'put', label: 'Put（看跌）' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-3xl w-full max-w-xl shadow-modal border border-claude-border fade-in"
        style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--claude-card)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-claude-border flex-shrink-0">
          <h2 className="text-xl font-bold text-claude-text">
            {editOption ? '编辑期权记录' : '添加期权记录'}
          </h2>
          <button onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-100 text-claude-muted hover:text-claude-text transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5">
          <div className="space-y-5">
            {/* Row 1: symbol + tradeDate */}
            <div className="grid grid-cols-2 gap-4">
              <F label="标的股票代码 *" error={errors.symbol}>
                <input
                  ref={symbolInputRef}
                  className={`w-full px-3 py-2.5 border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-claude-text placeholder:text-claude-subtle transition-all
                    ${errors.symbol ? 'border-red-400' : 'border-claude-border'}`}
                  onCompositionStart={() => { symbolComposingRef.current = true }}
                  onCompositionEnd={e => {
                    symbolComposingRef.current = false
                    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, '')
                    e.target.value = val
                    setForm(f => ({ ...f, symbol: val }))
                  }}
                  onChange={e => {
                    if (symbolComposingRef.current) return
                    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, '')
                    e.target.value = val
                    setForm(f => ({ ...f, symbol: val }))
                  }}
                  placeholder="例如 AAPL"
                />
              </F>
              <F label="交易日期 *" error={errors.tradeDate}>
                <CalendarPicker value={form.tradeDate} onChange={set('tradeDate')} />
              </F>
            </div>

            {/* Row 2: optionType + direction */}
            <div className="grid grid-cols-2 gap-4">
              <F label="期权类型 *">
                <CustomSelect value={form.optionType} onChange={set('optionType')} options={typeOptions} />
              </F>
              <F label="操作方向 *">
                <CustomSelect value={form.direction} onChange={set('direction')} options={directionOptions} />
              </F>
            </div>

            {/* Row 3: strike + expiration */}
            <div className="grid grid-cols-2 gap-4">
              <F label="行权价 *" error={errors.strike}>
                <SpinnerInput value={form.strike} onChange={set('strike')} step={0.5} placeholder="例如 150.00" />
              </F>
              <F label="到期日 *" error={errors.expiration}>
                <CalendarPicker value={form.expiration} onChange={set('expiration')} />
              </F>
            </div>

            {/* Row 4: contracts + premium + commission */}
            <div className="grid grid-cols-3 gap-4">
              <F label="合约数量 *" error={errors.contracts}>
                <SpinnerInput value={form.contracts} onChange={set('contracts')} step={1} min={1} placeholder="1" />
              </F>
              <F label="权利金（每股）*" error={errors.premium}>
                <SpinnerInput value={form.premium} onChange={set('premium')} step={0.01} placeholder="例如 2.50" />
              </F>
              <F label="手续费">
                <SpinnerInput value={form.commission} onChange={set('commission')} step={0.01} placeholder="0.00" />
              </F>
            </div>

            {/* Close info (closed options only) */}
            {editOption?.status === 'closed' && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-2xl border border-claude-border">
                <div className="col-span-2 text-xs font-semibold text-claude-muted uppercase tracking-wide">平仓信息</div>
                <F label="平仓价格（每股）" error={errors.closePrice}>
                  <SpinnerInput value={form.closePrice} onChange={set('closePrice')} step={0.01} placeholder="0.00" />
                </F>
                <F label="平仓日期">
                  <CalendarPicker value={form.closeDate} onChange={set('closeDate')} />
                </F>
                <F label="平仓手续费">
                  <SpinnerInput value={form.closeCommission} onChange={set('closeCommission')} step={0.01} placeholder="0.00" />
                </F>
              </div>
            )}

            {/* Note */}
            <F label="备注">
              <textarea
                className="w-full px-3 py-2.5 border border-claude-border rounded-xl text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-claude-text placeholder:text-claude-subtle resize-none transition-all"
                rows={3}
                value={form.note}
                onChange={setE('note')}
                placeholder="可选备注..."
              />
            </F>
          </div>
        </form>

        {/* Footer buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-claude-border flex-shrink-0">
          {editOption ? (
            <button type="button" onClick={handleDelete}
              className="text-sm text-red-500 hover:bg-red-50 px-4 py-2 rounded-xl transition-colors">
              删除记录
            </button>
          ) : <div />}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 border border-claude-border rounded-2xl text-sm font-medium text-claude-muted hover:text-claude-text hover:bg-gray-50 transition-colors">
              取消
            </button>
            <button onClick={handleSubmit}
              className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl transition-colors text-sm">
              {editOption ? '保存' : '添加'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
