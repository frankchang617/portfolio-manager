import { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Pencil, Plus, Layers } from 'lucide-react'
import { usePortfolio } from '../contexts/PortfolioContext'
import { fmt, getPnLClass } from '../utils/formatters'
import StockModal from './modals/StockModal'
import OptionsPositions from './OptionsPositions'
import { calculateOptionMetrics } from '../utils/blackScholes'

function MetricCard({ emoji, label, value, sub, subClass, breakdown }) {
  return (
    <div className="bg-white rounded-2xl border border-claude-border p-5 flex-shrink-0 min-w-[180px]"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{emoji}</span>
        <p className="text-xs text-claude-muted font-medium">{label}</p>
      </div>
      <p className={`text-xl font-bold leading-tight ${subClass?.includes('profit') ? 'text-profit' : subClass?.includes('loss') ? 'text-loss' : 'text-claude-text'}`}>
        {value}
      </p>
      {sub && <p className={`text-xs mt-1 font-medium ${subClass || 'text-claude-muted'}`}>{sub}</p>}
      {breakdown?.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-claude-border/50 space-y-1">
          {breakdown.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-claude-subtle">{item.label}</span>
              <span className={`text-[11px] font-mono font-medium ${item.cls}`}>{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SortBtn({ field, label, sortBy, sortDir, onClick }) {
  const active = sortBy === field
  return (
    <button
      onClick={() => onClick(field)}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${
        active
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white text-claude-muted border-claude-border hover:text-claude-text'
      }`}
    >
      {label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </button>
  )
}

// Merge stocks from all non-aggregate portfolios by symbol
function mergeStocks(portfolios) {
  const bySymbol = {}
  for (const p of portfolios) {
    if (p.isAggregate) continue
    for (const s of p.stocks) {
      const key = s.symbol.toUpperCase()
      if (!bySymbol[key]) {
        bySymbol[key] = { ...s, id: key, shares: 0, totalCost: 0, stockRealizedPnL: 0 }
      }
      bySymbol[key].shares += s.shares
      bySymbol[key].totalCost += s.avgCost * s.shares
      bySymbol[key].stockRealizedPnL += s.stockRealizedPnL ?? 0
    }
  }
  return Object.values(bySymbol).map(s => ({
    ...s,
    avgCost: s.shares > 0 && s.totalCost > 0 ? s.totalCost / s.shares : 0,
  }))
}

export default function StockPositions() {
  const { activePortfolio, state, dispatch } = usePortfolio()
  const [modal, setModal] = useState({ open: false, edit: null })
  const [sortBy, setSortBy] = useState(null)
  const [sortDir, setSortDir] = useState('desc')

  const prices = state.prices
  const r = state.settings?.riskFreeRate ?? 0.05
  const isAggregate = activePortfolio?.isAggregate ?? false

  const handleSort = (field) => {
    if (sortBy === field) {
      if (sortDir === 'desc') setSortDir('asc')
      else setSortBy(null)
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  // Source stocks: merged from all sub-portfolios if aggregate, else from active portfolio
  const sourceStocks = useMemo(() => {
    if (!activePortfolio) return []
    if (isAggregate) return mergeStocks(state.portfolios)
    return activePortfolio.stocks
  }, [activePortfolio, isAggregate, state.portfolios])

  const sourceCash = useMemo(() => {
    if (!activePortfolio) return 0
    if (isAggregate) return state.portfolios
      .filter(p => !p.isAggregate)
      .reduce((s, p) => s + (p.cash ?? 0), 0)
    return activePortfolio.cash ?? 0
  }, [activePortfolio, isAggregate, state.portfolios])

  const sourceOptions = useMemo(() => {
    if (!activePortfolio) return []
    if (isAggregate) return state.portfolios.filter(p => !p.isAggregate).flatMap(p => p.options ?? [])
    return activePortfolio.options ?? []
  }, [activePortfolio, isAggregate, state.portfolios])

  const optionMetrics = useMemo(() => {
    let unrealizedPnL = 0
    let realizedPnL = 0
    let openCount = 0
    for (const o of sourceOptions) {
      const status = o.status || 'open'
      if (status === 'open') {
        openCount++
        const q = prices[o.symbol?.toUpperCase()]
        if (q?.price) {
          const contracts = Math.abs(o.contracts ?? 1)
          const direction = o.direction || (o.contracts > 0 ? 'buy' : 'sell')
          const commission = o.commission ?? 0
          const m = calculateOptionMetrics(
            { ...o, contracts: direction === 'buy' ? contracts : -contracts },
            q.price, r
          )
          unrealizedPnL += (isNaN(m.unrealizedPnL) ? 0 : m.unrealizedPnL) - commission
        }
      } else {
        realizedPnL += o.realizedPnL ?? 0
      }
    }
    return { unrealizedPnL, realizedPnL, openCount }
  }, [sourceOptions, prices, r])

  const rows = useMemo(() => {
    const activeStocks = sourceStocks.filter(s => s.shares > 0)
    const totalStockValue = activeStocks.reduce((sum, s) => {
      const q = prices[s.symbol.toUpperCase()]
      return sum + (q?.price ?? s.avgCost) * s.shares
    }, 0)

    return sourceStocks.map(s => {
      const q = prices[s.symbol.toUpperCase()]
      const price = q?.price ?? null
      const prevClose = q?.previousClose ?? null
      const isCleared = s.shares === 0
      const marketValue = isCleared ? 0 : (price != null ? price * s.shares : s.avgCost * s.shares)
      const costBasis = s.avgCost * s.shares
      const perSharePnL = price != null ? price - s.avgCost : null
      const stockRealizedPnL = s.stockRealizedPnL ?? 0
      const paperPnL = isCleared
        ? null
        : (price != null ? (price - s.avgCost) * s.shares : null)
      const pnlPct = isCleared
        ? null
        : (paperPnL != null && costBasis !== 0 ? (paperPnL / costBasis) * 100 : null)
      const totalBuyValue = isCleared
        ? (s.transactions || []).filter(t => t.action === 'buy').reduce((sum, t) => sum + t.price * t.shares, 0)
        : 0
      const realizedPct = isCleared && totalBuyValue > 0 ? (stockRealizedPnL / totalBuyValue) * 100 : null
      const todayChange = price != null && prevClose != null ? price - prevClose : null
      const todayChangePct = prevClose != null && prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : null
      const todayPnL = isCleared ? null : (todayChange != null ? todayChange * s.shares : null)
      const allocation = isCleared ? 0 : (totalStockValue > 0 ? (marketValue / totalStockValue) * 100 : 0)
      const totalPnL = isCleared
        ? stockRealizedPnL
        : (paperPnL != null ? paperPnL + stockRealizedPnL : null)
      const totalPnLPct = isCleared
        ? realizedPct
        : (totalPnL != null && costBasis !== 0 ? (totalPnL / costBasis) * 100 : null)

      return { ...s, price, prevClose, marketValue, costBasis, perSharePnL, paperPnL, pnlPct, todayChange, todayChangePct, todayPnL, allocation, stockRealizedPnL, realizedPct, isCleared, totalPnL, totalPnLPct }
    })
  }, [sourceStocks, prices])

  const sorted = useMemo(() => {
    const active = rows.filter(r => !r.isCleared)
    const cleared = rows.filter(r => r.isCleared)
    const sortedActive = sortBy
      ? [...active].sort((a, b) => {
          const av = a[sortBy] ?? 0, bv = b[sortBy] ?? 0
          return sortDir === 'desc' ? bv - av : av - bv
        })
      : active
    return [...sortedActive, ...cleared]
  }, [rows, sortBy, sortDir])

  const metrics = useMemo(() => {
    const active = rows.filter(r => !r.isCleared)
    const totalStockValue = active.reduce((s, r) => s + r.marketValue, 0)
    const cash = sourceCash
    const totalCost = active.reduce((s, r) => s + r.costBasis, 0)
    const unrealizedPnL = active.reduce((s, r) => s + (r.paperPnL ?? 0), 0)
    const unrealizedPct = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0
    const realizedPnL = rows.reduce((s, r) => s + (r.stockRealizedPnL ?? 0), 0)
    const totalPnL = unrealizedPnL + realizedPnL
    const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0
    const todayPnL = active.reduce((s, r) => s + (r.todayChange != null ? r.todayChange * r.shares : 0), 0)
    const todayPct = totalStockValue > 0 ? (todayPnL / totalStockValue) * 100 : 0
    return { totalStockValue, cash, totalCost, unrealizedPnL, unrealizedPct, realizedPnL, totalPnL, totalPnLPct, todayPnL, todayPct }
  }, [rows, sourceCash])

  if (!activePortfolio) return <div className="p-6 text-claude-muted">请先创建投资组合</div>

  const totalAssets = metrics.totalStockValue + metrics.cash + optionMetrics.unrealizedPnL

  const hasOpenOptions  = optionMetrics.openCount > 0
  const hasClosedOptions = optionMetrics.realizedPnL !== 0
  const hasAnyOptions   = hasOpenOptions || hasClosedOptions

  const combinedUnrealized    = metrics.unrealizedPnL + optionMetrics.unrealizedPnL
  const combinedRealized      = metrics.realizedPnL   + optionMetrics.realizedPnL
  const combinedTotal         = combinedUnrealized + combinedRealized
  const combinedUnrealizedPct = metrics.totalCost > 0 ? (combinedUnrealized / metrics.totalCost) * 100 : 0
  const combinedRealizedPct   = metrics.totalCost > 0 ? (combinedRealized   / metrics.totalCost) * 100 : 0
  const combinedTotalPct      = metrics.totalCost > 0 ? (combinedTotal      / metrics.totalCost) * 100 : 0

  const pnlCls = v => v >= 0 ? 'profit-text' : 'loss-text'

  const cards = [
    { emoji: '📈', label: '持仓总值', value: fmt.currency(metrics.totalStockValue) },
    { emoji: '💳', label: '现金余额', value: fmt.currency(metrics.cash) },
    {
      emoji: '📊', label: '未实现盈亏',
      value: fmt.pnl(combinedUnrealized),
      sub: fmt.pctChange(combinedUnrealizedPct),
      subClass: pnlCls(combinedUnrealized),
      breakdown: hasOpenOptions ? [
        { label: '股票', value: fmt.pnl(metrics.unrealizedPnL),        cls: pnlCls(metrics.unrealizedPnL) },
        { label: '期权', value: fmt.pnl(optionMetrics.unrealizedPnL),  cls: pnlCls(optionMetrics.unrealizedPnL) },
      ] : null,
    },
    {
      emoji: '✅', label: '已实现盈亏',
      value: fmt.pnl(combinedRealized),
      sub: fmt.pctChange(combinedRealizedPct),
      subClass: pnlCls(combinedRealized),
      breakdown: hasClosedOptions ? [
        { label: '股票', value: fmt.pnl(metrics.realizedPnL),         cls: pnlCls(metrics.realizedPnL) },
        { label: '期权', value: fmt.pnl(optionMetrics.realizedPnL),   cls: pnlCls(optionMetrics.realizedPnL) },
      ] : null,
    },
    {
      emoji: '🎯', label: '总盈亏',
      value: fmt.pnl(combinedTotal),
      sub: fmt.pctChange(combinedTotalPct),
      subClass: pnlCls(combinedTotal),
      breakdown: hasAnyOptions ? [
        { label: '股票', value: fmt.pnl(metrics.totalPnL),                                         cls: pnlCls(metrics.totalPnL) },
        { label: '期权', value: fmt.pnl(optionMetrics.unrealizedPnL + optionMetrics.realizedPnL),  cls: pnlCls(optionMetrics.unrealizedPnL + optionMetrics.realizedPnL) },
      ] : null,
    },
    { emoji: '☀️', label: '今日盈亏', value: fmt.pnl(metrics.todayPnL), sub: fmt.pctChange(metrics.todayPct), subClass: pnlCls(metrics.todayPnL) },
  ]

  return (
    <div className="space-y-6">

      {/* Total assets banner */}
      <div className="bg-white rounded-2xl border border-claude-border px-6 py-5 flex items-center justify-between flex-wrap gap-4"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div>
          <p className="text-xs text-claude-muted font-medium mb-1">💼 投资组合总资产</p>
          <p className="text-3xl font-bold text-claude-text">{fmt.currency(totalAssets)}</p>
        </div>
        <div className="flex gap-6 text-right flex-wrap">
          <div>
            <p className="text-xs text-claude-muted font-medium mb-1">股票持仓</p>
            <p className="text-sm font-semibold text-claude-text">{fmt.currency(metrics.totalStockValue)}</p>
            {totalAssets > 0 && (
              <p className="text-xs text-claude-subtle">{((metrics.totalStockValue / totalAssets) * 100).toFixed(1)}%</p>
            )}
          </div>
          <div>
            <p className="text-xs text-claude-muted font-medium mb-1">现金余额</p>
            <p className="text-sm font-semibold text-claude-text">{fmt.currency(metrics.cash)}</p>
            {totalAssets > 0 && (
              <p className="text-xs text-claude-subtle">{((metrics.cash / totalAssets) * 100).toFixed(1)}%</p>
            )}
          </div>
          <div>
            <p className="text-xs text-claude-muted font-medium mb-1">
              期权未实现盈亏
              {optionMetrics.openCount > 0 && <span className="ml-1 text-claude-subtle">({optionMetrics.openCount} 个)</span>}
            </p>
            <p className={`text-sm font-semibold ${optionMetrics.unrealizedPnL >= 0 ? 'profit-text' : 'loss-text'}`}>
              {fmt.pnl(optionMetrics.unrealizedPnL)}
            </p>
            {totalAssets !== 0 && optionMetrics.unrealizedPnL !== 0 && (
              <p className="text-xs text-claude-subtle">{((optionMetrics.unrealizedPnL / totalAssets) * 100).toFixed(1)}%</p>
            )}
          </div>
          {optionMetrics.realizedPnL !== 0 && (
            <div>
              <p className="text-xs text-claude-muted font-medium mb-1">期权已实现盈亏</p>
              <p className={`text-sm font-semibold ${optionMetrics.realizedPnL >= 0 ? 'profit-text' : 'loss-text'}`}>
                {fmt.pnl(optionMetrics.realizedPnL)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Aggregate read-only banner */}
      {isAggregate && (
        <div className="flex items-center gap-2.5 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
          <Layers size={15} className="text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-700">
            总投资组合为只读视图，持仓数据由各子组合自动汇总，如需交易请切换到对应子组合。
          </p>
        </div>
      )}

      {/* Metric cards */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {cards.map((c, i) => <MetricCard key={i} {...c} />)}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-claude-border overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>

        {/* Sort bar + Add button */}
        <div className="px-5 pt-5 pb-4 border-b border-claude-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-claude-muted font-medium mr-1">排序方式：</span>
              {[
                { field: 'todayPnL',    label: '今日盈亏' },
                { field: 'pnlPct',      label: '账面盈亏%' },
                { field: 'totalPnL',    label: '总盈亏' },
                { field: 'totalPnLPct', label: '总盈亏%' },
                { field: 'paperPnL',         label: '账面盈亏' },
                { field: 'marketValue',      label: '持仓价值' },
                { field: 'stockRealizedPnL', label: '已实现盈亏' },
                { field: 'allocation',       label: '占比 %' },
              ].map(s => (
                <SortBtn key={s.field} field={s.field} label={s.label}
                  sortBy={sortBy} sortDir={sortDir} onClick={handleSort} />
              ))}
              {sortBy && (
                <button onClick={() => setSortBy(null)}
                  className="px-4 py-1.5 rounded-full text-sm text-claude-muted hover:text-claude-text transition-colors">
                  清除排序
                </button>
              )}
            </div>
            {!isAggregate && (
              <button className="btn-primary flex-shrink-0" onClick={() => setModal({ open: true, edit: null })}>
                <Plus size={14} />添加股票
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        {sorted.length === 0 ? (
          <div className="text-center py-16 text-claude-muted">
            {isAggregate ? (
              <>
                <p className="text-base font-medium mb-2">暂无汇总持仓</p>
                <p className="text-sm">请先在子组合中添加股票</p>
              </>
            ) : (
              <>
                <p className="text-base font-medium mb-2">暂无持仓</p>
                <p className="text-sm">点击「添加股票」开始记录</p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-claude-border bg-gray-50/50">
                  {['代码','价格','今日涨跌','今日盈亏','数量','平均成本','持仓价值','每股盈亏','账面盈亏','已实现盈亏','账面盈亏%','总盈亏','总盈亏%','占比 %', ...(!isAggregate ? ['操作'] : [])].map(h => (
                    <th key={h} className={`text-xs font-semibold text-claude-subtle uppercase tracking-wide py-3 px-4 whitespace-nowrap ${h === '代码' ? 'text-left' : 'text-right'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => (
                  <tr key={s.id} className={`border-b border-claude-border/50 hover:bg-gray-50/60 transition-colors ${s.isCleared ? 'opacity-60' : ''}`}>
                    {/* 代码 */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        {isAggregate ? (
                          <span className="font-bold text-sm text-blue-600">{s.symbol}</span>
                        ) : (
                          <button
                            onClick={() => setModal({ open: true, edit: s })}
                            className="font-bold text-blue-600 hover:text-blue-700 hover:underline text-sm"
                          >
                            {s.symbol}
                          </button>
                        )}
                        {s.isCleared && (
                          <span className="text-xs px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-400 font-medium">已清仓</span>
                        )}
                      </div>
                    </td>
                    {/* 价格 */}
                    <td className="py-3.5 px-4 text-right text-sm font-mono">
                      {s.price != null ? fmt.currency(s.price) : <span className="text-claude-subtle text-xs">—</span>}
                    </td>
                    {/* 今日涨跌 */}
                    <td className="py-3.5 px-4 text-right">
                      {s.todayChange != null ? (
                        <div className="flex items-center justify-end gap-1">
                          {s.todayChange >= 0
                            ? <TrendingUp size={12} className="text-profit flex-shrink-0" />
                            : <TrendingDown size={12} className="text-loss flex-shrink-0" />}
                          <div>
                            <p className={`text-sm font-medium font-mono ${s.todayChange >= 0 ? 'text-profit' : 'text-loss'}`}>
                              {s.todayChange >= 0 ? '+' : ''}{s.todayChange.toFixed(2)}
                            </p>
                            <p className={`text-xs ${s.todayChangePct >= 0 ? 'text-profit' : 'text-loss'}`}>
                              {fmt.pctChange(s.todayChangePct)}
                            </p>
                          </div>
                        </div>
                      ) : <span className="text-claude-subtle text-xs">—</span>}
                    </td>
                    {/* 今日盈亏 */}
                    <td className={`py-3.5 px-4 text-right text-sm font-mono font-semibold ${getPnLClass(s.todayPnL)}`}>
                      {s.todayPnL != null ? fmt.pnl(s.todayPnL) : <span className="text-claude-subtle text-xs">—</span>}
                    </td>
                    {/* 数量 */}
                    <td className="py-3.5 px-4 text-right text-sm font-mono">{s.shares.toFixed(2)}</td>
                    {/* 平均成本 */}
                    <td className="py-3.5 px-4 text-right text-sm font-mono">{fmt.currency(s.avgCost)}</td>
                    {/* 持仓价值 */}
                    <td className="py-3.5 px-4 text-right text-sm font-mono font-medium">{fmt.currency(s.marketValue)}</td>
                    {/* 每股盈亏 */}
                    <td className={`py-3.5 px-4 text-right text-sm font-mono ${getPnLClass(s.perSharePnL)}`}>
                      {s.perSharePnL != null ? fmt.pnl(s.perSharePnL) : '—'}
                    </td>
                    {/* 账面盈亏 */}
                    <td className={`py-3.5 px-4 text-right text-sm font-mono font-semibold ${getPnLClass(s.paperPnL)}`}>
                      {s.paperPnL != null ? fmt.pnl(s.paperPnL) : '—'}
                    </td>
                    {/* 已实现盈亏 */}
                    <td className="py-3.5 px-4 text-right">
                      {s.stockRealizedPnL !== 0 ? (
                        <div>
                          <p className={`text-sm font-mono font-semibold ${getPnLClass(s.stockRealizedPnL)}`}>
                            {fmt.pnl(s.stockRealizedPnL)}
                          </p>
                          {s.realizedPct != null && (
                            <p className={`text-xs ${getPnLClass(s.realizedPct)}`}>{fmt.pctChange(s.realizedPct)}</p>
                          )}
                        </div>
                      ) : <span className="text-claude-subtle text-sm">—</span>}
                    </td>
                    {/* 账面盈亏% */}
                    <td className={`py-3.5 px-4 text-right text-sm font-medium ${getPnLClass(s.pnlPct)}`}>
                      {s.pnlPct != null ? fmt.pctChange(s.pnlPct) : '—'}
                    </td>
                    {/* 总盈亏 */}
                    <td className={`py-3.5 px-4 text-right text-sm font-mono font-semibold ${getPnLClass(s.totalPnL)}`}>
                      {s.totalPnL != null ? fmt.pnl(s.totalPnL) : '—'}
                    </td>
                    {/* 总盈亏% */}
                    <td className={`py-3.5 px-4 text-right text-sm font-medium ${getPnLClass(s.totalPnLPct)}`}>
                      {s.totalPnLPct != null ? fmt.pctChange(s.totalPnLPct) : '—'}
                    </td>
                    {/* 占比 % */}
                    <td className="py-3.5 px-4 text-right text-sm text-claude-muted">
                      {s.allocation.toFixed(2)}%
                    </td>
                    {/* 操作（仅非聚合组合显示） */}
                    {!isAggregate && (
                      <td className="py-3.5 px-4 text-right">
                        <button onClick={() => setModal({ open: true, edit: s })}
                          className="p-1.5 rounded-lg text-claude-subtle hover:text-claude-text hover:bg-gray-100 transition-colors">
                          <Pencil size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}

                {/* Cash row */}
                <tr className="border-t-2 border-claude-border bg-gray-50/40">
                  <td className="py-3.5 px-4">
                    <span className="text-sm font-medium text-claude-muted">现金余额</span>
                  </td>
                  <td colSpan={5} className="py-3.5 px-4 text-right text-claude-subtle text-sm">—</td>
                  <td className="py-3.5 px-4 text-right text-sm font-mono font-semibold text-claude-text">
                    {fmt.currency(sourceCash)}
                  </td>
                  <td colSpan={7} className="py-3.5 px-4 text-right text-claude-subtle text-sm">—</td>
                  {!isAggregate && (
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => {
                          const val = prompt('更新现金余额 ($):', sourceCash)
                          if (val !== null && !isNaN(parseFloat(val))) {
                            dispatch({ type: 'UPDATE_CASH', portfolioId: activePortfolio.id, cash: parseFloat(val) })
                          }
                        }}
                        className="p-1.5 rounded-lg text-claude-subtle hover:text-claude-text hover:bg-gray-100 transition-colors">
                        <Pencil size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!isAggregate && (
        <StockModal
          isOpen={modal.open}
          onClose={() => setModal({ open: false, edit: null })}
          editStock={modal.edit
            ? (activePortfolio?.stocks ?? []).find(s => s.id === modal.edit.id) ?? modal.edit
            : null}
        />
      )}

      {/* Options positions section */}
      <OptionsPositions />
    </div>
  )
}
