import { useMemo } from 'react'
import { useChartColors } from '../hooks/useDarkMode'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Legend,
} from 'recharts'
import { usePortfolio } from '../contexts/PortfolioContext'
import { calculateOptionMetrics } from '../utils/blackScholes'
import { fmt, getPnLClass } from '../utils/formatters'

const COLORS = ['#da7756', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1']

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null
  const d = payload[0]
  return (
    <div className="bg-white rounded-xl border border-claude-border shadow-card-hover px-4 py-3 text-sm">
      <p className="font-semibold text-claude-text mb-1">{d.name}</p>
      <p className="text-claude-muted">{fmt.currency(d.value)} <span className="text-claude-subtle">({d.payload.pct?.toFixed(1)}%)</span></p>
    </div>
  )
}

const PnLTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-white rounded-xl border border-claude-border shadow-card-hover px-4 py-3 text-sm">
      <p className="font-semibold text-claude-text mb-2">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {fmt.pnl(p.value)}
        </p>
      ))}
    </div>
  )
}

export default function Charts() {
  const { activePortfolio, state } = usePortfolio()
  const prices = state.prices
  const r = state.settings.riskFreeRate
  const isAggregate = activePortfolio?.isAggregate ?? false
  const cc = useChartColors()

  const sourceStocks = useMemo(() => {
    if (!activePortfolio) return []
    if (isAggregate) return state.portfolios.filter(p => !p.isAggregate).flatMap(p => p.stocks ?? [])
    return activePortfolio.stocks
  }, [activePortfolio, isAggregate, state.portfolios])

  const sourceOptions = useMemo(() => {
    if (!activePortfolio) return []
    if (isAggregate) return state.portfolios.filter(p => !p.isAggregate).flatMap(p => p.options ?? [])
    return activePortfolio.options
  }, [activePortfolio, isAggregate, state.portfolios])

  const allocationData = useMemo(() => {
    const bySymbol = {}
    for (const s of sourceStocks) {
      if (s.shares <= 0) continue
      const q = prices[s.symbol.toUpperCase()]
      const price = q?.price ?? s.avgCost
      const val = price * s.shares
      if (val <= 0) continue
      bySymbol[s.symbol] = (bySymbol[s.symbol] ?? 0) + val
    }
    const data = Object.entries(bySymbol).map(([name, value]) => ({ name, value }))
    const total = data.reduce((sum, d) => sum + d.value, 0)
    const sorted = data
      .map(d => ({ ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)
    const n = sorted.length
    return sorted.map((d, i) => ({
      ...d,
      color: n <= COLORS.length ? COLORS[i] : `hsl(${Math.round(i * 360 / n)}, 60%, 52%)`,
    }))
  }, [sourceStocks, prices])

  const pnlData = useMemo(() => {
    const bySymbol = {}
    for (const s of sourceStocks) {
      if (s.shares <= 0) continue
      const q = prices[s.symbol.toUpperCase()]
      const currentPrice = q?.price ?? s.avgCost
      const prevClose = q?.previousClose ?? s.avgCost
      if (!bySymbol[s.symbol]) bySymbol[s.symbol] = { 未实现盈亏: 0, 当日盈亏: 0 }
      bySymbol[s.symbol].未实现盈亏 += (currentPrice - s.avgCost) * s.shares
      bySymbol[s.symbol].当日盈亏 += (currentPrice - prevClose) * s.shares
    }
    return Object.entries(bySymbol)
      .map(([name, v]) => ({
        name,
        未实现盈亏: parseFloat(v.未实现盈亏.toFixed(2)),
        当日盈亏:   parseFloat(v.当日盈亏.toFixed(2)),
      }))
      .sort((a, b) => Math.abs(b.未实现盈亏) - Math.abs(a.未实现盈亏))
  }, [sourceStocks, prices])

  const greeksData = useMemo(() => {
    const openOptions = sourceOptions.filter(o => o.status === 'open')
    if (openOptions.length === 0) return []
    return openOptions.map(o => {
      const q = prices[o.symbol.toUpperCase()]
      const underlyingPrice = q?.price
      if (!underlyingPrice) return null
      const contracts = Math.abs(o.contracts ?? 1)
      const direction = o.direction || (o.contracts > 0 ? 'buy' : 'sell')
      const m = calculateOptionMetrics(
        { ...o, contracts: direction === 'buy' ? contracts : -contracts },
        underlyingPrice, r
      )
      return {
        name: `${o.symbol} ${o.strike}${o.optionType === 'call' ? 'C' : 'P'}`,
        Delta: parseFloat(m.totalDelta.toFixed(3)),
        Theta: parseFloat(m.theta.toFixed(2)),
        '未实现盈亏': parseFloat((m.unrealizedPnL - (o.commission ?? 0)).toFixed(2)),
      }
    }).filter(Boolean)
  }, [sourceOptions, prices, r])

  // Closed options P&L chart
  const closedOptionsPnL = useMemo(() => {
    const closed = sourceOptions.filter(o => o.status === 'closed' && o.realizedPnL != null)
    if (closed.length === 0) return []
    return closed
      .map(o => ({
        name: `${o.symbol} ${o.strike}${o.optionType === 'call' ? 'C' : 'P'}`,
        已实现盈亏: parseFloat((o.realizedPnL ?? 0).toFixed(2)),
      }))
      .sort((a, b) => a.已实现盈亏 - b.已实现盈亏)
  }, [sourceOptions])

  // Options expiration timeline (open positions grouped by expiry month)
  const expiryData = useMemo(() => {
    const open = sourceOptions.filter(o => o.status === 'open')
    if (open.length === 0) return []
    const byMonth = {}
    for (const o of open) {
      const monthKey = o.expiration.slice(0, 7) // YYYY-MM
      if (!byMonth[monthKey]) byMonth[monthKey] = { call: 0, put: 0 }
      if (o.optionType === 'call') byMonth[monthKey].call += Math.abs(o.contracts ?? 1)
      else byMonth[monthKey].put += Math.abs(o.contracts ?? 1)
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        name: new Date(month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        Call: v.call,
        Put: v.put,
      }))
  }, [sourceOptions])

  if (!activePortfolio) return null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Allocation Pie */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-claude-muted mb-6 uppercase tracking-wide">持仓分配</h3>
          {allocationData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={allocationData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {allocationData.map((d, i) => (
                    <Cell key={i} fill={d.color} strokeWidth={0} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-claude-muted text-sm">
              暂无股票持仓数据
            </div>
          )}
        </div>

        {/* Allocation details */}
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-claude-muted mb-4 uppercase tracking-wide">持仓明细</h3>
          {allocationData.length > 0 ? (
            <div className="space-y-3 overflow-y-auto max-h-[260px] pr-1">
              {allocationData.map((d) => (
                <div key={d.name} className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: d.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-claude-text">{d.name}</span>
                      <span className="text-sm font-semibold text-claude-text">{fmt.currency(d.value)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-claude-bg rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{ width: `${d.pct}%`, backgroundColor: d.color }}
                        />
                      </div>
                      <span className="text-xs text-claude-muted w-10 text-right">{d.pct.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-claude-muted text-sm">暂无数据</div>
          )}
        </div>
      </div>

      {/* P&L Bar Chart */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-claude-muted mb-6 uppercase tracking-wide">各持仓盈亏对比</h3>
        {pnlData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={pnlData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: cc.axis }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'K' : v}`} />
              <Tooltip content={<PnLTooltip />} />
              <Legend />
              <Bar dataKey="未实现盈亏" fill="#da7756" radius={[4, 4, 0, 0]}
                label={{ position: 'top', fontSize: 10, fill: cc.axis,
                  formatter: (v) => v > 0 ? `+${(v/1000).toFixed(1)}K` : `${(v/1000).toFixed(1)}K` }}
              />
              <Bar dataKey="当日盈亏" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-64 flex items-center justify-center text-claude-muted text-sm">暂无数据</div>
        )}
      </div>

      {/* Options Greeks Chart */}
      {greeksData.length > 0 && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-claude-muted mb-6 uppercase tracking-wide">期权 Delta 分布</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={greeksData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false} />
              <Tooltip content={<PnLTooltip />} />
              <Legend />
              <Bar dataKey="Delta" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="未实现盈亏" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Expiration timeline */}
      {expiryData.length > 0 && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-claude-muted mb-6 uppercase tracking-wide">期权到期分布（合约数）</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={expiryData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: cc.axis }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v, name) => [`${v} 张`, name]} />
              <Legend />
              <Bar dataKey="Call" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Put" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Closed options P&L */}
      {closedOptionsPnL.length > 0 && (
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-claude-muted mb-6 uppercase tracking-wide">已平仓期权盈亏明细</h3>
          <ResponsiveContainer width="100%" height={Math.max(220, closedOptionsPnL.length * 40)}>
            <BarChart data={closedOptionsPnL} layout="vertical" margin={{ top: 0, right: 60, left: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false}
                tickFormatter={v => `${v >= 0 ? '+' : ''}${v >= 1000 || v <= -1000 ? `$${(v/1000).toFixed(1)}K` : `$${v}`}`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: cc.axisText }} axisLine={false} tickLine={false} width={100} />
              <ReferenceLine x={0} stroke={cc.grid} />
              <Tooltip formatter={(v) => [fmt.pnl(v), '已实现盈亏']} />
              <Bar dataKey="已实现盈亏" radius={[0, 4, 4, 0]}
                label={{ position: 'right', fontSize: 10, fill: cc.axisText, formatter: v => fmt.pnl(v) }}
                fill="#10b981"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
