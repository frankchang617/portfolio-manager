import { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { useChartColors } from '../hooks/useDarkMode'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
  AreaChart, Area, CartesianGrid,
} from 'recharts'
import { usePortfolio } from '../contexts/PortfolioContext'
import { fmt, getPnLClass } from '../utils/formatters'
import { calculateOptionMetrics } from '../utils/blackScholes'

// ── Performance statistics helpers ──────────────────────────────────────────
function calcAnnualizedReturn(snapshots) {
  if (!snapshots || snapshots.length < 2) return null
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  if (!first.totalValue || first.totalValue <= 0) return null
  const days = (new Date(last.date) - new Date(first.date)) / 86400000
  if (days < 1) return null
  return (Math.pow(last.totalValue / first.totalValue, 365 / days) - 1) * 100
}

function calcMaxDrawdown(snapshots) {
  if (!snapshots || snapshots.length < 2) return null
  let peak = -Infinity
  let maxDD = 0
  for (const s of snapshots) {
    if (s.totalValue > peak) peak = s.totalValue
    if (peak > 0) {
      const dd = (peak - s.totalValue) / peak
      if (dd > maxDD) maxDD = dd
    }
  }
  return maxDD * 100
}

// ── Per-portfolio metric calculator ─────────────────────────────────────────
function calcPortfolioMetrics(portfolio, prices, riskFreeRate = 0.05) {
  const stocks = portfolio.stocks ?? []
  const options = portfolio.options ?? []

  const enriched = stocks.map(s => {
    const q = prices[s.symbol.toUpperCase()]
    const price = q?.price ?? null
    const prevClose = q?.previousClose ?? null
    const marketValue = price != null ? price * s.shares : s.avgCost * s.shares
    const paperPnL = price != null ? (price - s.avgCost) * s.shares : 0
    const todayPnL = price != null && prevClose != null ? (price - prevClose) * s.shares : 0
    const costBasis = s.avgCost * s.shares
    return { marketValue, paperPnL, todayPnL, costBasis }
  })

  const totalStockValue = enriched.reduce((s, r) => s + r.marketValue, 0)
  const cash = portfolio.cash ?? 0
  const stockUnrealizedPnL = enriched.reduce((s, r) => s + r.paperPnL, 0)
  const costBasis = enriched.reduce((s, r) => s + r.costBasis, 0)

  // Option unrealized P&L (open positions, Black-Scholes estimate)
  const openOptions = options.filter(o => o.status === 'open')
  const closedOptions = options.filter(o => o.status === 'closed')
  const openOptionsCount = openOptions.length

  const optionUnrealizedPnL = openOptions.reduce((sum, o) => {
    const underlyingPrice = prices[o.symbol.toUpperCase()]?.price
    if (!underlyingPrice) return sum
    const contracts = Math.abs(o.contracts ?? 1)
    const direction = o.direction || (o.contracts > 0 ? 'buy' : 'sell')
    const m = calculateOptionMetrics(
      { ...o, contracts: direction === 'buy' ? contracts : -contracts },
      underlyingPrice, riskFreeRate
    )
    return sum + (isNaN(m.unrealizedPnL) ? 0 : m.unrealizedPnL) - (o.commission ?? 0)
  }, 0)

  const unrealizedPnL = stockUnrealizedPnL + optionUnrealizedPnL
  const unrealizedPct = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0

  const stockRealizedPnL = stocks.reduce((s, stock) => s + (stock.stockRealizedPnL ?? 0), 0)
  const optionRealizedPnL = closedOptions.reduce((s, o) => s + (o.realizedPnL ?? 0), 0)
  const realizedPnL = stockRealizedPnL + optionRealizedPnL

  const totalValue = totalStockValue + cash
  const totalPnL = unrealizedPnL + realizedPnL
  const totalPnLPct = costBasis > 0 ? (totalPnL / costBasis) * 100 : 0
  const todayPnL = enriched.reduce((s, r) => s + r.todayPnL, 0)
  const todayPct = totalStockValue > 0 ? (todayPnL / totalStockValue) * 100 : 0
  const holdingsCount = stocks.filter(s => s.shares > 0).length

  return {
    totalValue, totalStockValue, cash,
    stockUnrealizedPnL, optionUnrealizedPnL, unrealizedPnL, unrealizedPct,
    stockRealizedPnL, optionRealizedPnL, realizedPnL,
    totalPnL, totalPnLPct,
    todayPnL, todayPct,
    holdingsCount, openOptionsCount, costBasis,
  }
}

// ── Metric card ──────────────────────────────────────────────────────────────
function MetricCard({ emoji, label, value, sub, pnl, highlight, breakdown }) {
  const valueClass = pnl > 0 ? 'text-profit' : pnl < 0 ? 'text-loss' : 'text-claude-text'
  const subClass   = pnl > 0 ? 'text-profit' : pnl < 0 ? 'text-loss' : 'text-claude-muted'
  return (
    <div
      className={`rounded-2xl p-5 border flex-shrink-0 ${highlight ? 'bg-gray-100 border-gray-200' : 'bg-white border-claude-border'}`}
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)', minWidth: '158px' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{emoji}</span>
        <p className="text-xs text-claude-muted font-medium truncate">{label}</p>
      </div>
      <p className={`text-xl font-bold leading-tight ${valueClass}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 font-medium ${subClass}`}>{sub}</p>}
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

// ── Portfolio card (grid item) ───────────────────────────────────────────────
function PortfolioCard({ portfolio, metrics, snapshots, isActive, onSelect }) {
  const annualizedReturn = calcAnnualizedReturn(snapshots)
  const maxDrawdown = calcMaxDrawdown(snapshots)
  const hasPerf = annualizedReturn !== null || maxDrawdown !== null

  return (
    <div
      onClick={onSelect}
      className={`bg-white rounded-2xl border p-5 cursor-pointer transition-all hover:shadow-md ${
        isActive ? 'border-blue-400 ring-1 ring-blue-200' : 'border-claude-border hover:border-gray-300'
      }`}
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0 flex-1 pr-2">
          <p className="text-xs text-claude-muted font-medium mb-0.5 truncate">{portfolio.name}</p>
          <p className="text-2xl font-bold text-claude-text">{fmt.large(metrics.totalValue)}</p>
        </div>
        <div className={`text-right flex-shrink-0 ${metrics.todayPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
          <div className="flex items-center gap-1 justify-end">
            {metrics.todayPnL >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            <span className="text-sm font-semibold font-mono">{fmt.pnl(metrics.todayPnL)}</span>
          </div>
          <p className="text-xs mt-0.5">{fmt.pctChange(metrics.todayPct)} 今日</p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className="text-xs text-claude-muted mb-0.5">未实现盈亏</p>
          <p className={`text-sm font-semibold font-mono ${getPnLClass(metrics.unrealizedPnL)}`}>
            {fmt.pnl(metrics.unrealizedPnL)}
          </p>
          <p className={`text-xs ${getPnLClass(metrics.unrealizedPct)}`}>{fmt.pctChange(metrics.unrealizedPct)}</p>
          {metrics.openOptionsCount > 0 && (
            <p className="text-[10px] text-claude-subtle mt-0.5 font-mono">
              期权 {fmt.pnl(metrics.optionUnrealizedPnL)}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-claude-muted mb-0.5">已实现盈亏</p>
          <p className={`text-sm font-semibold font-mono ${getPnLClass(metrics.realizedPnL)}`}>
            {fmt.pnl(metrics.realizedPnL)}
          </p>
          {metrics.optionRealizedPnL !== 0 && (
            <p className="text-[10px] text-claude-subtle mt-0.5 font-mono">
              期权 {fmt.pnl(metrics.optionRealizedPnL)}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-claude-muted mb-0.5">股票持仓</p>
          <p className="text-sm font-medium text-claude-text">
            {metrics.holdingsCount} 支
            {metrics.openOptionsCount > 0 && (
              <span className="text-claude-subtle text-xs ml-1">· 期权 {metrics.openOptionsCount} 个</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs text-claude-muted mb-0.5">现金余额</p>
          <p className="text-sm font-medium text-claude-text font-mono">{fmt.currency(metrics.cash)}</p>
        </div>
      </div>

      {/* Performance metrics — visible once 2+ daily snapshots exist */}
      {hasPerf && (
        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-x-4">
          <div>
            <p className="text-xs text-claude-muted mb-0.5">年化收益</p>
            <p className={`text-sm font-semibold font-mono ${annualizedReturn == null ? 'text-claude-muted' : annualizedReturn >= 0 ? 'text-profit' : 'text-loss'}`}>
              {annualizedReturn != null ? fmt.pctChange(annualizedReturn) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-claude-muted mb-0.5">最大回撤</p>
            <p className={`text-sm font-semibold font-mono ${maxDrawdown == null || maxDrawdown === 0 ? 'text-claude-muted' : 'text-loss'}`}>
              {maxDrawdown != null ? (maxDrawdown > 0 ? `-${maxDrawdown.toFixed(1)}%` : '0.0%') : '—'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Chart tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-xl border border-claude-border p-3 shadow-lg">
      <p className="text-xs font-semibold text-claude-text mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 mb-1 last:mb-0">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.fill }} />
          <span className="text-xs text-claude-muted">{p.name}:</span>
          <span className={`text-xs font-medium ${p.value >= 0 ? 'text-profit' : 'text-loss'}`}>
            {fmt.pnl(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

const yTickFmt = (v) => {
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

// ── Snapshot chart tooltip ───────────────────────────────────────────────────
function SnapshotTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-white rounded-xl border border-claude-border p-3 shadow-lg text-xs">
      <p className="font-semibold text-claude-text mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-claude-muted">总资产</span>
          <span className="font-medium text-claude-text">{fmt.large(d?.totalValue)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-claude-muted">总盈亏</span>
          <span className={`font-medium ${(d?.totalPnL ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>{fmt.pnl(d?.totalPnL)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function Dashboard({ setActiveTab }) {
  const { state, dispatch } = usePortfolio()
  const prices = state.prices
  const [timeRange, setTimeRange] = useState('30')
  const cc = useChartColors()

  const riskFreeRate = state.settings.riskFreeRate

  const allMetrics = useMemo(() => (
    state.portfolios
      .filter(p => !p.isAggregate)
      .map(p => ({ portfolio: p, metrics: calcPortfolioMetrics(p, prices, riskFreeRate) }))
  ), [state.portfolios, prices, riskFreeRate])

  const totals = useMemo(() => {
    const agg = allMetrics.reduce((acc, { metrics: m }) => ({
      totalValue:           acc.totalValue + m.totalValue,
      totalStockValue:      acc.totalStockValue + m.totalStockValue,
      cash:                 acc.cash + m.cash,
      stockUnrealizedPnL:   acc.stockUnrealizedPnL + m.stockUnrealizedPnL,
      optionUnrealizedPnL:  acc.optionUnrealizedPnL + m.optionUnrealizedPnL,
      unrealizedPnL:        acc.unrealizedPnL + m.unrealizedPnL,
      stockRealizedPnL:     acc.stockRealizedPnL + m.stockRealizedPnL,
      optionRealizedPnL:    acc.optionRealizedPnL + m.optionRealizedPnL,
      realizedPnL:          acc.realizedPnL + m.realizedPnL,
      totalPnL:             acc.totalPnL + m.totalPnL,
      todayPnL:             acc.todayPnL + m.todayPnL,
      holdingsCount:        acc.holdingsCount + m.holdingsCount,
      openOptionsCount:     acc.openOptionsCount + m.openOptionsCount,
      costBasis:            acc.costBasis + m.costBasis,
    }), { totalValue: 0, totalStockValue: 0, cash: 0, stockUnrealizedPnL: 0, optionUnrealizedPnL: 0, unrealizedPnL: 0, stockRealizedPnL: 0, optionRealizedPnL: 0, realizedPnL: 0, totalPnL: 0, todayPnL: 0, holdingsCount: 0, openOptionsCount: 0, costBasis: 0 })

    return {
      ...agg,
      unrealizedPct: agg.costBasis > 0 ? (agg.unrealizedPnL / agg.costBasis) * 100 : 0,
      totalPnLPct:   agg.costBasis > 0 ? (agg.totalPnL / agg.costBasis) * 100 : 0,
      todayPct:      agg.totalStockValue > 0 ? (agg.todayPnL / agg.totalStockValue) * 100 : 0,
    }
  }, [allMetrics])

  const snapshotData = useMemo(() => {
    const all = state.dailySnapshots ?? []
    let cutoffStr = null
    if (timeRange === 'ytd') {
      cutoffStr = `${new Date().getFullYear()}-01-01`
    } else if (timeRange !== 'all') {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - parseInt(timeRange))
      cutoffStr = cutoff.toISOString().split('T')[0]
    }
    const filtered = cutoffStr ? all.filter(s => s.date >= cutoffStr) : all
    // Use year label when range spans more than 90 days
    const spanDays = filtered.length > 1
      ? (new Date(filtered.at(-1).date) - new Date(filtered[0].date)) / 86400000
      : 0
    return filtered.map(s => ({
      ...s,
      label: new Date(s.date + 'T00:00:00').toLocaleDateString('en-US',
        spanDays > 90
          ? { month: 'short', day: 'numeric', year: '2-digit' }
          : { month: 'short', day: 'numeric' }
      ),
    }))
  }, [state.dailySnapshots, timeRange])

  const chartData = useMemo(() => (
    allMetrics.map(({ portfolio, metrics }) => ({
      name:     portfolio.name,
      '未实现盈亏': parseFloat(metrics.unrealizedPnL.toFixed(2)),
      '已实现盈亏': parseFloat(metrics.realizedPnL.toFixed(2)),
      '今日盈亏':  parseFloat(metrics.todayPnL.toFixed(2)),
    }))
  ), [allMetrics])

  const pnlCls = v => v > 0 ? 'text-profit' : v < 0 ? 'text-loss' : 'text-claude-muted'
  const hasOptUnrealized = totals.optionUnrealizedPnL !== 0
  const hasOptRealized   = totals.optionRealizedPnL   !== 0
  const hasAnyOption     = hasOptUnrealized || hasOptRealized
  const realizedPct      = totals.costBasis > 0 ? (totals.realizedPnL / totals.costBasis) * 100 : 0

  const metricCards = [
    { emoji: '🌐', label: '跨组合总资产', value: fmt.large(totals.totalValue), highlight: true },
    { emoji: '📈', label: '股票持仓总值', value: fmt.large(totals.totalStockValue) },
    { emoji: '💵', label: '总现金',       value: fmt.currency(totals.cash) },
    {
      emoji: '📊', label: '未实现盈亏',
      value: fmt.pnl(totals.unrealizedPnL),
      sub: fmt.pctChange(totals.unrealizedPct),
      pnl: totals.unrealizedPnL,
      breakdown: hasOptUnrealized ? [
        { label: '股票', value: fmt.pnl(totals.stockUnrealizedPnL), cls: pnlCls(totals.stockUnrealizedPnL) },
        { label: '期权', value: fmt.pnl(totals.optionUnrealizedPnL), cls: pnlCls(totals.optionUnrealizedPnL) },
      ] : null,
    },
    {
      emoji: '✅', label: '已实现盈亏',
      value: fmt.pnl(totals.realizedPnL),
      sub: fmt.pctChange(realizedPct),
      pnl: totals.realizedPnL,
      breakdown: hasOptRealized ? [
        { label: '股票', value: fmt.pnl(totals.stockRealizedPnL), cls: pnlCls(totals.stockRealizedPnL) },
        { label: '期权', value: fmt.pnl(totals.optionRealizedPnL), cls: pnlCls(totals.optionRealizedPnL) },
      ] : null,
    },
    {
      emoji: '🎯', label: '总盈亏',
      value: fmt.pnl(totals.totalPnL),
      sub: fmt.pctChange(totals.totalPnLPct),
      pnl: totals.totalPnL,
      breakdown: hasAnyOption ? [
        { label: '股票', value: fmt.pnl(totals.stockUnrealizedPnL + totals.stockRealizedPnL), cls: pnlCls(totals.stockUnrealizedPnL + totals.stockRealizedPnL) },
        { label: '期权', value: fmt.pnl(totals.optionUnrealizedPnL + totals.optionRealizedPnL), cls: pnlCls(totals.optionUnrealizedPnL + totals.optionRealizedPnL) },
      ] : null,
    },
    { emoji: '☀️', label: '今日盈亏', value: fmt.pnl(totals.todayPnL), sub: fmt.pctChange(totals.todayPct), pnl: totals.todayPnL },
  ]

  return (
    <div className="space-y-6">

      {/* ── 8 cross-portfolio metric cards ── */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {metricCards.map((c, i) => <MetricCard key={i} {...c} />)}
      </div>

      {/* ── Daily snapshot area chart ── */}
      <div className="bg-white rounded-2xl border border-claude-border p-5"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-claude-text">资产走势</h2>
          <div className="flex gap-1 flex-wrap justify-end">
            {[['7','7天'],['30','30天'],['90','90天'],['ytd','年初至今'],['180','近半年'],['365','近一年'],['all','全部']].map(([v, label]) => (
              <button key={v} onClick={() => setTimeRange(v)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  timeRange === v ? 'bg-blue-600 text-white' : 'text-claude-muted hover:bg-gray-100'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {snapshotData.length < 2 ? (
          <div className="h-40 flex items-center justify-center text-claude-muted text-sm">
            价格刷新后开始记录，积累 2 天以上数据后显示走势图
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={snapshotData}>
              <defs>
                <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false}
                tickFormatter={yTickFmt} width={72} />
              <Tooltip content={<SnapshotTooltip />} />
              <Area type="monotone" dataKey="totalValue" stroke="#3b82f6" strokeWidth={2}
                fill="url(#valueGrad)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Portfolio P&L comparison chart ── */}
      <div className="bg-white rounded-2xl border border-claude-border p-5"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h2 className="text-base font-semibold text-claude-text mb-4">组合盈亏对比</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barGap={4} barCategoryGap="30%">
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: cc.axisText }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false}
              tickFormatter={yTickFmt} width={72} />
            <ReferenceLine y={0} stroke={cc.grid} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
            <Bar dataKey="未实现盈亏" fill="#3b82f6" />
            <Bar dataKey="已实现盈亏" fill="#10b981" />
            <Bar dataKey="今日盈亏"   fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Portfolio card grid (3 per row) ── */}
      <div>
        <h2 className="text-base font-semibold text-claude-text mb-3">投资组合</h2>
        <div className="grid grid-cols-3 gap-4">
          {allMetrics.map(({ portfolio, metrics }) => (
            <PortfolioCard
              key={portfolio.id}
              portfolio={portfolio}
              metrics={metrics}
              snapshots={state.portfolioSnapshots?.[portfolio.id]}
              isActive={portfolio.id === state.activePortfolioId}
              onSelect={() => {
                dispatch({ type: 'SELECT_PORTFOLIO', id: portfolio.id })
                setActiveTab?.('stocks')
              }}
            />
          ))}
        </div>
      </div>

    </div>
  )
}
