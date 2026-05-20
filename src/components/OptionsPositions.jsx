import { useState, useMemo } from 'react'
import { Plus, AlertTriangle, Search, ChevronDown, ChevronRight, Trash2, TrendingUp, TrendingDown, Edit2, Layers, FlaskConical, GitBranch, Info } from 'lucide-react'
import { usePortfolio } from '../contexts/PortfolioContext'
import { calculateOptionMetrics, daysToExpiry } from '../utils/blackScholes'
import { fmt, getPnLClass } from '../utils/formatters'
import OptionsModal from './modals/OptionsModal'
import StrategyModal, { STRATEGY_CONFIGS, STRATEGY_TYPE_LABELS } from './modals/StrategyModal'
import CalendarPicker from './CalendarPicker'

// ── Close Position Mini-Modal ─────────────────────────────────────────────────
function CloseModal({ option, onClose, onConfirm }) {
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [commission, setCommission] = useState('')

  const contracts = Math.abs(option.contracts ?? 1)
  const direction = option.direction || (option.contracts > 0 ? 'buy' : 'sell')
  const premium = option.avgPremium ?? 0

  const gross = price && !isNaN(+price)
    ? direction === 'buy'
      ? (+price - premium) * contracts * 100
      : (premium - +price) * contracts * 100
    : null

  const closeCommission = commission && !isNaN(+commission) ? +commission : 0
  const pnl = gross != null ? gross - closeCommission : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-modal border border-claude-border p-6 fade-in">
        <h3 className="text-lg font-bold text-claude-text mb-1">平仓</h3>
        <p className="text-sm text-claude-muted mb-5">
          {option.symbol} {option.optionType === 'call' ? 'Call' : 'Put'} ${option.strike} · {option.expiration}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-claude-text mb-1.5">平仓价格（每股）</label>
            <input className="w-full px-3 py-2.5 border border-claude-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              type="number" step="0.01" min="0" value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="输入平仓价格" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-claude-text mb-1.5">平仓日期</label>
            <CalendarPicker value={date} onChange={setDate} />
          </div>
          <div>
            <label className="block text-sm font-medium text-claude-text mb-1.5">
              平仓手续费（可选）
            </label>
            <input className="w-full px-3 py-2.5 border border-claude-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              type="number" step="0.01" min="0" value={commission}
              onChange={e => setCommission(e.target.value)}
              placeholder="0.00" />
          </div>

          {pnl !== null && (
            <div className={`p-3 rounded-xl text-sm font-medium ${pnl >= 0 ? 'bg-green-50 text-profit' : 'bg-red-50 text-loss'}`}>
              <div>预计已实现盈亏：{fmt.pnl(pnl)}</div>
              {closeCommission > 0 && (
                <div className="text-xs mt-0.5 opacity-70">含平仓手续费 −{fmt.currency(closeCommission)}</div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-claude-border rounded-xl text-sm font-medium text-claude-muted hover:bg-gray-50 transition-colors">
            取消
          </button>
          <button
            onClick={() => { if (price && +price >= 0) onConfirm(+price, date, closeCommission) }}
            disabled={!price || isNaN(+price)}
            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
            确认平仓
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Exercise Modal ────────────────────────────────────────────────────────────
function ExerciseModal({ option, onClose, onConfirm }) {
  const [underlyingPrice, setUnderlyingPrice] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  const contracts = Math.abs(option.contracts ?? 1)
  const direction = option.direction || 'buy'
  const premium = option.avgPremium ?? 0
  const strike = option.strike
  const isCall = option.optionType === 'call'

  const intrinsic = underlyingPrice && !isNaN(+underlyingPrice)
    ? Math.max(0, isCall ? +underlyingPrice - strike : strike - +underlyingPrice)
    : null

  const pnl = intrinsic != null
    ? (direction === 'buy'
        ? (intrinsic - premium) * contracts * 100
        : (premium - intrinsic) * contracts * 100) - (option.commission ?? 0)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-modal border border-claude-border p-6 fade-in">
        <h3 className="text-lg font-bold text-claude-text mb-1">行权 / 被行权</h3>
        <p className="text-sm text-claude-muted mb-5">
          {option.symbol} {isCall ? 'Call' : 'Put'} ${strike} · {option.expiration}
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-claude-text mb-1.5">行权时标的现价（用于计算内在价值）</label>
            <input className="w-full px-3 py-2.5 border border-claude-border rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              type="number" step="0.01" min="0" value={underlyingPrice}
              onChange={e => setUnderlyingPrice(e.target.value)}
              placeholder={`当前标的价格`} autoFocus />
            {intrinsic != null && (
              <p className="text-xs text-claude-muted mt-1">
                期权内在价值：{fmt.currency(intrinsic)}/股 = {fmt.currency(intrinsic * contracts * 100)} 合计
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-claude-text mb-1.5">行权日期</label>
            <CalendarPicker value={date} onChange={setDate} />
          </div>
          {pnl !== null && (
            <div className={`p-3 rounded-xl text-sm font-medium ${pnl >= 0 ? 'bg-green-50 text-profit' : 'bg-red-50 text-loss'}`}>
              行权已实现盈亏：{fmt.pnl(pnl)}
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-claude-border rounded-xl text-sm font-medium text-claude-muted hover:bg-gray-50 transition-colors">
            取消
          </button>
          <button
            onClick={() => { if (intrinsic != null) onConfirm(intrinsic, date) }}
            disabled={intrinsic == null}
            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
            确认行权
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Filter dropdown ──────────────────────────────────────────────────────────
function FilterSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const label = options.find(o => o.value === value)?.label || options[0].label
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-claude-border rounded-lg bg-white text-sm text-claude-text hover:border-gray-400 transition-colors">
        {label} <ChevronDown size={13} className="text-claude-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-40 bg-white rounded-xl border border-claude-border shadow-card-hover py-1 min-w-[120px] fade-in">
            {options.map(o => (
              <button key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${value === o.value ? 'text-blue-600 font-medium bg-blue-50' : 'text-claude-text hover:bg-gray-50'}`}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function OptionsPositions() {
  const { activePortfolio, state, dispatch, refreshPrices } = usePortfolio()
  const [addModal, setAddModal] = useState({ open: false, edit: null })
  const [showStrategyModal, setShowStrategyModal] = useState(false)
  const [closeTarget, setCloseTarget] = useState(null)
  const [exerciseTarget, setExerciseTarget] = useState(null)
  const [showGreeks, setShowGreeks] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [sortBy, setSortBy] = useState('default')
  const [expandedStrategies, setExpandedStrategies] = useState(new Set())

  const prices = state.prices
  const r = state.settings.riskFreeRate
  const isAggregate = activePortfolio?.isAggregate ?? false

  // Source options: merge from all sub-portfolios when aggregate
  const sourceOptions = useMemo(() => {
    if (!activePortfolio) return []
    if (isAggregate) {
      return state.portfolios
        .filter(p => !p.isAggregate)
        .flatMap(p => p.options ?? [])
    }
    return activePortfolio.options
  }, [activePortfolio, isAggregate, state.portfolios])

  // Enrich options with market data
  const enriched = useMemo(() => {
    if (!activePortfolio) return []
    return sourceOptions.map(o => {
      const status = o.status || 'open'
      const q = prices[o.symbol.toUpperCase()]
      const underlyingPrice = q?.price ?? null
      const dte = daysToExpiry(o.expiration)
      const contracts = Math.abs(o.contracts ?? 1)
      const direction = o.direction || (o.contracts > 0 ? 'buy' : 'sell')
      const premium = o.avgPremium ?? o.premium ?? 0
      const totalCost = premium * contracts * 100

      const commission = o.commission ?? 0
      let unrealizedPnL = null, theoreticalPrice = null
      if (status === 'open' && underlyingPrice) {
        const m = calculateOptionMetrics(
          { ...o, contracts: direction === 'buy' ? contracts : -contracts },
          underlyingPrice, r
        )
        theoreticalPrice = m.theoreticalPrice
        unrealizedPnL = m.unrealizedPnL - commission
      }

      const realizedPnL = status === 'closed' && o.realizedPnL != null
        ? o.realizedPnL
        : null
      const displayPnL = status === 'closed' ? realizedPnL : unrealizedPnL
      const displayPnLPct = displayPnL != null && totalCost > 0 ? (displayPnL / totalCost) * 100 : null

      const tradeDateMs = o.tradeDate ? new Date(o.tradeDate).getTime() : null
      const closeDateMs = status === 'closed' && o.closeDate ? new Date(o.closeDate).getTime() : null
      const daysHeld = tradeDateMs ? Math.max(1, Math.round(((closeDateMs ?? Date.now()) - tradeDateMs) / 86400000)) : null

      let annualizedReturn = null
      if (displayPnL != null && daysHeld != null) {
        if (direction === 'buy' && totalCost > 0) {
          annualizedReturn = (displayPnL / totalCost) * (365 / daysHeld)
        } else if (direction === 'sell') {
          const collateral = o.strike * contracts * 100
          if (collateral > 0) annualizedReturn = (displayPnL / collateral) * (365 / daysHeld)
        }
      }

      return { ...o, status, direction, contracts, premium, totalCost, underlyingPrice, dte, theoreticalPrice, unrealizedPnL, realizedPnL, displayPnL, displayPnLPct, dailyChange: q?.change ?? null, dailyChangePct: q?.changePercent ?? null, daysHeld, annualizedReturn }
    })
  }, [activePortfolio, prices, r])

  // Summary
  const summary = useMemo(() => {
    const open = enriched.filter(o => o.status === 'open').length
    const closed = enriched.filter(o => o.status === 'closed').length
    const realizedPnL = enriched.filter(o => o.status === 'closed').reduce((s, o) => s + (o.realizedPnL ?? 0), 0)
    return { open, closed, realizedPnL }
  }, [enriched])

  // Portfolio Greeks (open positions with underlying price available)
  const portfolioGreeks = useMemo(() => {
    const open = enriched.filter(o => o.status === 'open' && o.underlyingPrice)
    if (open.length === 0) return null
    return open.reduce((acc, o) => {
      const m = calculateOptionMetrics(
        { ...o, contracts: o.direction === 'buy' ? o.contracts : -o.contracts },
        o.underlyingPrice, r
      )
      return {
        delta: acc.delta + m.totalDelta,
        gamma: acc.gamma + m.gamma * o.contracts * 100,
        theta: acc.theta + m.theta,
        vega: acc.vega + m.vega,
      }
    }, { delta: 0, gamma: 0, theta: 0, vega: 0 })
  }, [enriched, r])

  // Expiry warnings: within 7 days (but not already expired)
  const expiringSoon = enriched.filter(o => o.status === 'open' && o.dte > 0 && o.dte <= 7)
  // Already expired but still open
  const expired = enriched.filter(o => o.status === 'open' && o.dte <= 0)

  // Filters
  const filtered = useMemo(() => {
    let list = enriched
    if (search) list = list.filter(o => o.symbol.toLowerCase().includes(search.toLowerCase()))
    if (filterStatus !== 'all') list = list.filter(o => o.status === filterStatus)
    if (filterType !== 'all') list = list.filter(o => o.optionType === filterType)

    if (sortBy === 'dte') list = [...list].sort((a, b) => a.dte - b.dte)
    else if (sortBy === 'pnl') list = [...list].sort((a, b) => (b.displayPnL ?? 0) - (a.displayPnL ?? 0))
    else if (sortBy === 'strike') list = [...list].sort((a, b) => a.strike - b.strike)
    else if (sortBy === 'cost') list = [...list].sort((a, b) => b.totalCost - a.totalCost)

    return list
  }, [enriched, search, filterStatus, filterType, sortBy])

  // Group filtered options into strategy groups + standalone
  const { strategyGroups, standalone } = useMemo(() => {
    const groups = {}
    const solo = []
    for (const o of filtered) {
      if (o.strategyId) {
        if (!groups[o.strategyId]) groups[o.strategyId] = []
        groups[o.strategyId].push(o)
      } else {
        solo.push(o)
      }
    }
    const strategyGroups = Object.entries(groups).map(([strategyId, legs]) => {
      const strategyMeta = (activePortfolio?.strategies ?? []).find(s => s.id === strategyId)
      const netPnL = legs.reduce((sum, l) => sum + (l.displayPnL ?? 0), 0)
      const allClosed = legs.every(l => l.status === 'closed')
      const netDelta = legs.reduce((sum, l) => {
        if (l.status !== 'open' || !l.underlyingPrice) return sum
        const m = calculateOptionMetrics(
          { ...l, contracts: l.direction === 'buy' ? l.contracts : -l.contracts },
          l.underlyingPrice, r
        )
        return sum + m.totalDelta
      }, 0)
      return { strategyId, legs, strategyMeta, netPnL, allClosed, netDelta }
    })
    return { strategyGroups, standalone: solo }
  }, [filtered, activePortfolio, r])

  const toggleStrategy = (id) => {
    setExpandedStrategies(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleDeleteStrategy = (strategyId) => {
    if (!confirm('确定删除整个策略组合及所有关联腿？')) return
    dispatch({ type: 'DELETE_STRATEGY', portfolioId: activePortfolio.id, strategyId })
  }

  const handleClosePosition = (closePrice, closeDate, closeCommission) => {
    dispatch({
      type: 'CLOSE_OPTIONS_POSITION',
      portfolioId: activePortfolio.id,
      optionId: closeTarget.id,
      closePrice,
      closeDate,
      closeCommission,
    })
    setCloseTarget(null)
  }

  const handleExpireWorthless = (o) => {
    if (!confirm(`确认「${o.symbol} ${o.optionType === 'call' ? 'Call' : 'Put'} $${o.strike}」到期作废？该操作将记录已实现盈亏并关闭持仓。`)) return
    dispatch({
      type: 'CLOSE_OPTIONS_POSITION',
      portfolioId: activePortfolio.id,
      optionId: o.id,
      closePrice: 0,
      closeDate: o.expiration,
    })
  }

  const handleExercise = (closePrice, closeDate) => {
    dispatch({
      type: 'CLOSE_OPTIONS_POSITION',
      portfolioId: activePortfolio.id,
      optionId: exerciseTarget.id,
      closePrice,
      closeDate,
    })
    setExerciseTarget(null)
  }

  const handleDelete = (o) => {
    if (!confirm(`确定删除这条期权记录？`)) return
    dispatch({ type: 'DELETE_OPTION', portfolioId: activePortfolio.id, optionId: o.id })
  }

  if (!activePortfolio) return null

  return (
    <div className="space-y-5">
      {/* ── Aggregate read-only banner ── */}
      {isAggregate && (
        <div className="flex items-center gap-2.5 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
          <Layers size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-700">
            总投资组合为只读视图，期权数据由各子组合自动汇总，如需操作请切换到对应子组合。
          </p>
        </div>
      )}

      {/* ── Expired options (requires action) ── */}
      {!isAggregate && expired.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-red-200">
            <AlertTriangle size={15} className="text-red-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-red-700">
              {expired.length} 个期权合约已到期，请选择处理方式
            </p>
          </div>
          <div className="divide-y divide-red-100">
            {expired.map(o => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="font-bold text-sm text-claude-text mr-2">{o.symbol}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium mr-1.5 ${o.optionType === 'call' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {o.optionType === 'call' ? 'Call' : 'Put'}
                  </span>
                  <span className="text-sm text-claude-muted">${o.strike} · 到期 {o.expiration}</span>
                  <span className="text-xs text-claude-muted ml-2">
                    {o.direction === 'buy' ? '买入' : '卖出'} {o.contracts} 张 @ {fmt.currency(o.premium)}
                  </span>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleExpireWorthless(o)}
                    className="px-3 py-1.5 text-xs font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-100 transition-colors">
                    到期归零
                  </button>
                  <button
                    onClick={() => setExerciseTarget(o)}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    行权
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Expiry warning (1–7 days) ── */}
      {expiringSoon.length > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium bg-orange-50 border border-orange-200 text-orange-700">
          <AlertTriangle size={15} />
          有 {expiringSoon.length} 个期权合约将在 7 天内到期，请注意处理。
        </div>
      )}

      {/* ── 3 summary cards ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-sm text-claude-muted mb-3">持仓期权</p>
          <p className="text-3xl font-bold text-claude-text">{summary.open}</p>
          <p className="text-xs text-claude-muted mt-1">个开仓合约</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-claude-muted mb-3">已平仓期权</p>
          <p className="text-3xl font-bold text-claude-text">{summary.closed}</p>
          <p className="text-xs text-claude-muted mt-1">个已结束合约</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-claude-muted mb-3">已实现盈亏</p>
          <p className={`text-3xl font-bold ${getPnLClass(summary.realizedPnL)}`}>
            {fmt.pnl(summary.realizedPnL)}
          </p>
          <p className="text-xs text-claude-muted mt-1">已平仓期权盈亏合计</p>
        </div>
      </div>

      {/* ── Portfolio Greeks summary ── */}
      {portfolioGreeks && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FlaskConical size={14} className="text-claude-muted" />
              <span className="text-sm font-semibold text-claude-text">持仓希腊字母汇总</span>
              <span className="text-xs text-claude-muted">（仅开仓且有行情的合约）</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Delta', value: fmt.greek(portfolioGreeks.delta, 2), desc: '价格敏感度（×股价变动）' },
              { label: 'Gamma', value: fmt.greek(portfolioGreeks.gamma, 4), desc: 'Delta 变化率' },
              { label: 'Theta', value: fmt.pnl(portfolioGreeks.theta), desc: '每日时间价值衰减', pnl: portfolioGreeks.theta },
              { label: 'Vega', value: fmt.pnl(portfolioGreeks.vega), desc: '每1%波动率变化盈亏', pnl: portfolioGreeks.vega },
            ].map(g => (
              <div key={g.label} className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-claude-muted mb-1">{g.label}</p>
                <p className={`text-lg font-bold font-mono ${g.pnl != null ? getPnLClass(g.pnl) : 'text-claude-text'}`}>{g.value}</p>
                <p className="text-xs text-claude-subtle mt-0.5">{g.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="card p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <p className="text-xs text-claude-muted mb-1">标的代码</p>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-claude-subtle" />
              <input className="pl-8 pr-3 py-1.5 border border-claude-border rounded-lg text-sm bg-white w-32 focus:outline-none focus:border-blue-500"
                placeholder="搜索..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <p className="text-xs text-claude-muted mb-1">状态</p>
            <FilterSelect value={filterStatus} onChange={setFilterStatus} options={[
              { value: 'all', label: '全部状态' },
              { value: 'open', label: '持仓中' },
              { value: 'closed', label: '已平仓' },
            ]} />
          </div>
          <div>
            <p className="text-xs text-claude-muted mb-1">期权类型</p>
            <FilterSelect value={filterType} onChange={setFilterType} options={[
              { value: 'all', label: '全部类型' },
              { value: 'call', label: 'Call' },
              { value: 'put', label: 'Put' },
            ]} />
          </div>
          <div>
            <p className="text-xs text-claude-muted mb-1">排序方式</p>
            <FilterSelect value={sortBy} onChange={setSortBy} options={[
              { value: 'default', label: '默认顺序' },
              { value: 'dte', label: '到期日↑' },
              { value: 'pnl', label: '盈亏↓' },
              { value: 'strike', label: '行权价↑' },
              { value: 'cost', label: '总成本↓' },
            ]} />
          </div>
          <div className="ml-auto text-xs text-claude-muted self-end pb-1">
            显示 {filtered.length} / {enriched.length} 条
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-claude-border">
          <h3 className="font-semibold text-claude-text">期权持仓列表</h3>
          {!isAggregate && (
            <div className="flex items-center gap-2">
              <button className="btn-secondary" onClick={() => setShowStrategyModal(true)}>
                <GitBranch size={14} />新建策略
              </button>
              <button className="btn-primary" onClick={() => setAddModal({ open: true, edit: null })}>
                <Plus size={14} />添加期权
              </button>
            </div>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-claude-muted">
            <p className="text-base font-medium mb-2">暂无期权记录</p>
            <p className="text-sm mb-4">点击「添加期权」添加单腿期权，或「新建策略」添加多腿组合</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-claude-border bg-gray-50/50">
                  {['标的','类型','方向','行权价','到期日','合约数','权利金','标的现价','今日涨跌','总成本','盈亏','年化报酬率','持仓天数','剩余天数','状态',...(!isAggregate ? ['操作'] : [])].map(h => (
                    <th key={h} className={`text-xs font-semibold text-claude-subtle uppercase tracking-wide py-3 px-3 ${h === '标的' ? 'text-left' : 'text-right'} ${['类型','方向','状态','操作'].includes(h) ? 'text-center' : ''}`}>
                      {h === '年化报酬率' ? (
                        <span className="flex items-center justify-end gap-1 cursor-help group relative"
                          title="买方：盈亏÷权利金成本×365÷持仓天数；卖方：盈亏÷行权价保证金×365÷持仓天数">
                          {h}<Info size={10} className="text-claude-subtle/70" />
                        </span>
                      ) : h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* ── 策略组 ── */}
                {strategyGroups.map(({ strategyId, legs, strategyMeta, netPnL, allClosed, netDelta }) => {
                  const expanded = expandedStrategies.has(strategyId)
                  const cfg = STRATEGY_CONFIGS[strategyMeta?.type]
                  const colCount = isAggregate ? 12 : 13
                  return [
                    /* 策略 header 行 */
                    <tr key={`strat-${strategyId}`}
                      className="border-b border-claude-border/60 bg-gray-50/80 cursor-pointer hover:bg-gray-100/60 transition-colors"
                      onClick={() => toggleStrategy(strategyId)}>
                      <td className="py-3 px-3" colSpan={4}>
                        <div className="flex items-center gap-2">
                          {expanded
                            ? <ChevronDown size={14} className="text-claude-muted flex-shrink-0" />
                            : <ChevronRight size={14} className="text-claude-muted flex-shrink-0" />}
                          <GitBranch size={13} style={{ color: cfg?.color ?? '#6b6b6b' }} className="flex-shrink-0" />
                          <span className="text-sm font-semibold text-claude-text truncate">
                            {strategyMeta?.name ?? '策略组合'}
                          </span>
                          {cfg && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                              style={{ backgroundColor: `${cfg.color}18`, color: cfg.color }}>
                              {cfg.name}
                            </span>
                          )}
                          <span className="text-xs text-claude-muted flex-shrink-0">{legs.length} 条腿</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right text-xs text-claude-muted" colSpan={2}>
                        Delta {netDelta !== 0 ? netDelta.toFixed(2) : '—'}
                      </td>
                      <td className="py-3 px-3" colSpan={4} />
                      <td className="py-3 px-3 text-right">
                        <span className={`text-sm font-bold font-mono ${getPnLClass(netPnL)}`}>
                          {fmt.pnl(netPnL)}
                        </span>
                      </td>
                      <td className="py-3 px-3" />
                      <td className="py-3 px-3" />
                      <td className="py-3 px-3" />
                      <td className="py-3 px-3 text-center">
                        <span className={`badge text-xs ${allClosed ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-600'}`}>
                          {allClosed ? '已平仓' : '持仓'}
                        </span>
                      </td>
                      {!isAggregate && (
                        <td className="py-3 px-3 text-right">
                          <button onClick={e => { e.stopPropagation(); handleDeleteStrategy(strategyId) }}
                            className="p-1.5 rounded-lg text-claude-subtle hover:text-loss hover:bg-red-50 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>,
                    /* 展开后显示各腿 */
                    ...(!expanded ? [] : legs.map(o => {
                      const isClosed = o.status === 'closed'
                      return (
                        <tr key={o.id} className="border-b border-claude-border/30 hover:bg-blue-50/20 transition-colors">
                          <td className="py-3 px-3 pl-10">
                            <span className="text-sm font-medium text-claude-text">{o.symbol}</span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className={`badge ${o.optionType === 'call' ? 'badge-call' : 'badge-put'}`}>
                              {o.optionType === 'call' ? 'Call' : 'Put'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className={`badge ${o.direction === 'buy' ? 'badge-long' : 'badge-short'}`}>
                              {o.direction === 'buy' ? '买入' : '卖出'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right text-sm font-mono">${o.strike.toFixed(2)}</td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className={`text-sm ${!isClosed && o.dte <= 7 ? 'text-orange-500 font-semibold' : 'text-claude-text'}`}>
                                {o.expiration.replace(/-/g, '/')}
                              </span>
                              {!isClosed && o.dte <= 7 && (
                                <span className="text-xs text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full font-medium">
                                  ⏱{o.dte}天
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right text-sm font-mono">{o.contracts}</td>
                          <td className="py-3 px-3 text-right text-sm font-mono">{fmt.currency(o.premium)}</td>
                          <td className="py-3 px-3 text-right text-sm font-mono">
                            {o.underlyingPrice ? fmt.currency(o.underlyingPrice) : <span className="text-claude-subtle">—</span>}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {o.dailyChangePct != null ? (
                              <div className="flex items-center justify-end gap-1">
                                {o.dailyChangePct >= 0 ? <TrendingUp size={11} className="text-profit" /> : <TrendingDown size={11} className="text-loss" />}
                                <span className={`text-xs font-medium ${o.dailyChangePct >= 0 ? 'text-profit' : 'text-loss'}`}>
                                  {fmt.pctChange(o.dailyChangePct)}
                                </span>
                              </div>
                            ) : <span className="text-claude-subtle text-sm">—</span>}
                          </td>
                          <td className="py-3 px-3 text-right text-sm font-mono">{fmt.currency(o.totalCost)}</td>
                          <td className="py-3 px-3 text-right">
                            {o.displayPnL != null ? (
                              <div>
                                <p className={`text-sm font-semibold font-mono ${getPnLClass(o.displayPnL)}`}>{fmt.pnl(o.displayPnL)}</p>
                                {o.displayPnLPct != null && (
                                  <p className={`text-xs ${getPnLClass(o.displayPnLPct)}`}>{fmt.pctChange(o.displayPnLPct)}</p>
                                )}
                              </div>
                            ) : <span className="text-claude-subtle text-sm">—</span>}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {o.annualizedReturn != null ? (
                              <div title={o.direction === 'buy' ? `基于权利金成本 / 持仓${o.daysHeld}天` : `基于行权价保证金 / 持仓${o.daysHeld}天`}>
                                <p className={`text-sm font-semibold font-mono ${getPnLClass(o.annualizedReturn)}`}>
                                  {(o.annualizedReturn >= 0 ? '+' : '') + (o.annualizedReturn * 100).toFixed(1)}%
                                </p>
                                <p className="text-xs text-claude-subtle">{o.direction === 'buy' ? '权利金基准' : '保证金基准'}</p>
                              </div>
                            ) : <span className="text-claude-subtle text-sm">—</span>}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {o.daysHeld != null
                              ? <span className="text-sm font-mono text-claude-text">{o.daysHeld}天</span>
                              : <span className="text-claude-subtle text-sm">—</span>}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {!isClosed
                              ? <span className={`text-sm font-mono ${o.dte <= 0 ? 'text-red-500 font-semibold' : o.dte <= 7 ? 'text-orange-500 font-semibold' : 'text-claude-text'}`}>
                                  {o.dte <= 0 ? '已到期' : `${o.dte}天`}
                                </span>
                              : <span className="text-claude-subtle text-sm">—</span>}
                          </td>
                          <td className="py-3 px-3 text-center">
                            {isClosed
                              ? <span className="badge bg-gray-100 text-gray-500 text-xs">已平仓</span>
                              : <span className="badge bg-blue-50 text-blue-600 text-xs">持仓</span>}
                          </td>
                          {!isAggregate && (
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {!isClosed && (
                                  <button onClick={() => setCloseTarget(o)}
                                    className="text-xs text-claude-muted border border-claude-border hover:border-gray-400 hover:text-claude-text px-2.5 py-1 rounded-lg transition-colors">
                                    平仓
                                  </button>
                                )}
                                <button onClick={() => setAddModal({ open: true, edit: o })}
                                  className="p-1.5 rounded-lg text-claude-subtle hover:text-blue-600 hover:bg-blue-50 transition-colors">
                                  <Edit2 size={13} />
                                </button>
                                <button onClick={() => handleDelete(o)}
                                  className="p-1.5 rounded-lg text-claude-subtle hover:text-loss hover:bg-red-50 transition-colors">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })),
                  ]
                })}

                {/* ── 独立单腿期权 ── */}
                {standalone.map(o => {
                  const isClosed = o.status === 'closed'
                  return (
                    <tr key={o.id} className="border-b border-claude-border/40 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3.5 px-3">
                        {isAggregate ? (
                          <span className="font-bold text-sm text-claude-text">{o.symbol}</span>
                        ) : (
                          <button onClick={() => setAddModal({ open: true, edit: o })}
                            className="font-bold text-blue-600 hover:text-blue-700 hover:underline text-sm">
                            {o.symbol}
                          </button>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span className={`badge ${o.optionType === 'call' ? 'badge-call' : 'badge-put'}`}>
                          {o.optionType === 'call' ? 'Call' : 'Put'}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span className={`badge ${o.direction === 'buy' ? 'badge-long' : 'badge-short'}`}>
                          {o.direction === 'buy' ? '买入' : '卖出'}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-right text-sm font-mono">${o.strike.toFixed(2)}</td>
                      <td className="py-3.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className={`text-sm ${!isClosed && o.dte <= 7 ? 'text-orange-500 font-semibold' : 'text-claude-text'}`}>
                            {o.expiration.replace(/-/g, '/')}
                          </span>
                          {!isClosed && o.dte <= 7 && (
                            <span className="flex items-center gap-0.5 text-xs text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full font-medium">
                              ⏱{o.dte}天后
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right text-sm font-mono">{o.contracts}</td>
                      <td className="py-3.5 px-3 text-right text-sm font-mono">{fmt.currency(o.premium)}</td>
                      <td className="py-3.5 px-3 text-right text-sm font-mono">
                        {o.underlyingPrice ? fmt.currency(o.underlyingPrice) : <span className="text-claude-subtle">—</span>}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {o.dailyChangePct != null ? (
                          <div className="flex items-center justify-end gap-1">
                            {o.dailyChangePct >= 0 ? <TrendingUp size={11} className="text-profit" /> : <TrendingDown size={11} className="text-loss" />}
                            <span className={`text-xs font-medium ${o.dailyChangePct >= 0 ? 'text-profit' : 'text-loss'}`}>
                              {fmt.pctChange(o.dailyChangePct)}
                            </span>
                          </div>
                        ) : <span className="text-claude-subtle text-sm">—</span>}
                      </td>
                      <td className="py-3.5 px-3 text-right text-sm font-mono">{fmt.currency(o.totalCost)}</td>
                      <td className="py-3.5 px-3 text-right">
                        {o.displayPnL != null ? (
                          <div>
                            <p className={`text-sm font-semibold font-mono ${getPnLClass(o.displayPnL)}`}>
                              {fmt.pnl(o.displayPnL)}
                            </p>
                            {o.displayPnLPct != null && (
                              <p className={`text-xs ${getPnLClass(o.displayPnLPct)}`}>
                                {fmt.pctChange(o.displayPnLPct)}
                              </p>
                            )}
                          </div>
                        ) : <span className="text-claude-subtle text-sm">—</span>}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {o.annualizedReturn != null ? (
                          <div title={o.direction === 'buy' ? `基于权利金成本 / 持仓${o.daysHeld}天` : `基于行权价保证金 / 持仓${o.daysHeld}天`}>
                            <p className={`text-sm font-semibold font-mono ${getPnLClass(o.annualizedReturn)}`}>
                              {(o.annualizedReturn >= 0 ? '+' : '') + (o.annualizedReturn * 100).toFixed(1)}%
                            </p>
                            <p className="text-xs text-claude-subtle">{o.direction === 'buy' ? '权利金基准' : '保证金基准'}</p>
                          </div>
                        ) : <span className="text-claude-subtle text-sm">—</span>}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {o.daysHeld != null
                          ? <span className="text-sm font-mono text-claude-text">{o.daysHeld}天</span>
                          : <span className="text-claude-subtle text-sm">—</span>}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {!isClosed
                          ? <span className={`text-sm font-mono ${o.dte <= 0 ? 'text-red-500 font-semibold' : o.dte <= 7 ? 'text-orange-500 font-semibold' : 'text-claude-text'}`}>
                              {o.dte <= 0 ? '已到期' : `${o.dte}天`}
                            </span>
                          : <span className="text-claude-subtle text-sm">—</span>}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        {isClosed
                          ? <span className="badge bg-gray-100 text-gray-500 text-xs">已平仓</span>
                          : <span className="badge bg-blue-50 text-blue-600 text-xs">持仓</span>}
                      </td>
                      {!isAggregate && (
                        <td className="py-3.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!isClosed && (
                              <button onClick={() => setCloseTarget(o)}
                                className="text-xs text-claude-muted border border-claude-border hover:border-gray-400 hover:text-claude-text px-2.5 py-1 rounded-lg transition-colors">
                                平仓
                              </button>
                            )}
                            <button onClick={() => setAddModal({ open: true, edit: o })}
                              className="p-1.5 rounded-lg text-claude-subtle hover:text-blue-600 hover:bg-blue-50 transition-colors">
                              <Edit2 size={13} />
                            </button>
                            <button onClick={() => handleDelete(o)}
                              className="p-1.5 rounded-lg text-claude-subtle hover:text-loss hover:bg-red-50 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <p className="text-xs text-claude-subtle text-center py-3 border-t border-claude-border">
            * 未实现盈亏基于标的股票当前价格估算，非期权合约市价
          </p>
        )}
      </div>

      {/* Modals */}
      {showStrategyModal && <StrategyModal onClose={() => setShowStrategyModal(false)} />}
      <OptionsModal
        isOpen={addModal.open}
        onClose={() => setAddModal({ open: false, edit: null })}
        editOption={addModal.edit}
      />
      {closeTarget && (
        <CloseModal
          option={closeTarget}
          onClose={() => setCloseTarget(null)}
          onConfirm={handleClosePosition}
        />
      )}
      {exerciseTarget && (
        <ExerciseModal
          option={exerciseTarget}
          onClose={() => setExerciseTarget(null)}
          onConfirm={handleExercise}
        />
      )}
    </div>
  )
}
