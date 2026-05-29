import { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Trophy, AlertTriangle } from 'lucide-react'
import { usePortfolio } from '../contexts/PortfolioContext'
import { fmt, getPnLClass } from '../utils/formatters'
import { fetchHistoricalPrices } from '../utils/api'

// Replay transactions up to (and including) targetDate for a single stock.
// Returns { shares, avgCost } at that date.
function positionAtDate(stock, targetDate) {
  let shares = stock.initialShares ?? 0
  let totalCost = (stock.initialShares ?? 0) * (stock.initialAvgCost ?? 0)
  const txns = (stock.transactions ?? [])
    .filter(t => t.date && t.date <= targetDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  for (const t of txns) {
    if (t.action === 'buy') {
      totalCost += t.price * t.shares + (t.commission ?? 0)
      shares += t.shares
    } else if (t.action === 'sell' && shares > 0) {
      totalCost = (totalCost / shares) * (shares - t.shares)
      shares -= t.shares
    }
  }
  return { shares, avgCost: shares > 0 ? totalCost / shares : 0 }
}

// Compute total unrealized P&L across portfolios at a given date using histPrices.
function calcUnrealizedAtDate(portfolios, histPrices, dateStr) {
  let total = 0
  for (const p of portfolios) {
    for (const stock of p.stocks ?? []) {
      const sym = stock.symbol.toUpperCase()
      const price = histPrices[sym]?.[dateStr]
      if (!price) continue
      const { shares, avgCost } = positionAtDate(stock, dateStr)
      if (shares > 0) total += (price - avgCost) * shares
    }
  }
  return total
}

const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function compactPnL(val) {
  if (val == null || isNaN(val)) return ''
  const sign = val >= 0 ? '+' : ''
  const abs = Math.abs(val)
  if (abs >= 1000) return `${sign}${val >= 0 ? '' : '-'}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export default function DailyPnLCalendar() {
  const { state, activePortfolio } = usePortfolio()
  const isAggregate = activePortfolio?.isAggregate === true
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [hoveredDate, setHoveredDate] = useState(null)
  const [histPrices, setHistPrices] = useState({})   // { SYMBOL: { 'YYYY-MM-DD': price } }
  const [histLoading, setHistLoading] = useState(false)
  const fetchedSymbols = useRef(new Set())

  const portfoliosToProcess = useMemo(() => {
    if (isAggregate) return state.portfolios.filter(p => !p.isAggregate)
    return activePortfolio ? [activePortfolio] : []
  }, [isAggregate, activePortfolio, state.portfolios])

  // Fetch historical prices for any new symbol we haven't loaded yet
  useEffect(() => {
    const symbols = []
    for (const p of portfoliosToProcess) {
      for (const s of p.stocks ?? []) {
        const sym = s.symbol.toUpperCase()
        if (!fetchedSymbols.current.has(sym)) symbols.push(sym)
      }
    }
    if (symbols.length === 0) return
    setHistLoading(true)
    Promise.allSettled(symbols.map(sym => fetchHistoricalPrices(sym, '5y').then(data => ({ sym, data }))))
      .then(results => {
        const updates = {}
        for (const r of results) {
          if (r.status === 'fulfilled') {
            fetchedSymbols.current.add(r.value.sym)
            updates[r.value.sym] = r.value.data
          }
        }
        setHistPrices(prev => ({ ...prev, ...updates }))
      })
      .finally(() => setHistLoading(false))
  }, [portfoliosToProcess])

  const availableYears = useMemo(() => {
    const years = new Set([today.getFullYear()])
    if (isAggregate) {
      for (const s of (state.dailySnapshots ?? [])) {
        years.add(parseInt(s.date.slice(0, 4)))
      }
    }
    for (const p of portfoliosToProcess) {
      for (const s of (p.stocks ?? [])) {
        for (const t of (s.transactions ?? [])) {
          if (t.date) years.add(parseInt(t.date.slice(0, 4)))
        }
      }
      for (const o of (p.options ?? [])) {
        if (o.tradeDate) years.add(parseInt(o.tradeDate.slice(0, 4)))
        if (o.closeDate) years.add(parseInt(o.closeDate.slice(0, 4)))
      }
    }
    return [...years].sort((a, b) => b - a)
  }, [portfoliosToProcess, isAggregate, state.dailySnapshots, today])

  // Build daily P&L map: date => { realized, todayPnL }
  const dailyData = useMemo(() => {
    const map = {}

    // 历史 todayPnL 来自全局快照（仅聚合视图，快照无法拆分到子组合）
    if (isAggregate) {
      for (const s of (state.dailySnapshots ?? [])) {
        if (!map[s.date]) map[s.date] = { realized: 0, todayPnL: 0 }
        map[s.date].todayPnL = s.todayPnL ?? 0
      }
    }

    for (const p of portfoliosToProcess) {
      for (const s of (p.stocks ?? [])) {
        for (const t of (s.transactions ?? [])) {
          if (t.action === 'sell' && t.date && t.realizedPnL != null) {
            if (!map[t.date]) map[t.date] = { realized: 0, todayPnL: 0 }
            map[t.date].realized += t.realizedPnL
          }
        }
      }
      for (const o of (p.options ?? [])) {
        if (o.status === 'closed' && o.closeDate && o.realizedPnL != null) {
          if (!map[o.closeDate]) map[o.closeDate] = { realized: 0, todayPnL: 0 }
          map[o.closeDate].realized += o.realizedPnL
        }
      }
    }

    // 今日格：从实时价格计算未实现盈亏（当前价格 - 持仓成本）
    const todayKey = new Date().toISOString().split('T')[0]
    let liveTodayPnL = 0
    for (const p of portfoliosToProcess) {
      for (const s of (p.stocks ?? [])) {
        if (s.shares <= 0) continue
        const q = state.prices[s.symbol.toUpperCase()]
        if (q?.price != null) {
          liveTodayPnL += (q.price - s.avgCost) * s.shares
        }
      }
    }
    if (liveTodayPnL !== 0) {
      if (!map[todayKey]) map[todayKey] = { realized: 0, todayPnL: 0 }
      map[todayKey].todayPnL = liveTodayPnL
    }

    return map
  }, [portfoliosToProcess, isAggregate, state.dailySnapshots, state.prices])

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const startDow = firstDay.getDay()
    const days = []
    for (let i = 0; i < startDow; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      // Historical unrealized: only for past days (not today, not future)
      const histUnrealized = dateStr < todayStr
        ? calcUnrealizedAtDate(portfoliosToProcess, histPrices, dateStr)
        : null
      days.push({ day: d, dateStr, data: dailyData[dateStr] || null, histUnrealized })
    }
    return days
  }, [year, month, dailyData, portfoliosToProcess, histPrices, todayStr])

  // Month-end unrealized P&L:
  //   1. Find the last calendar day of the viewed month that has historical price data
  //   2. Fall back to aggregate snapshots if hist data isn't loaded yet
  const monthlyUnrealizedPnL = useMemo(() => {
    const mm = String(month + 1).padStart(2, '0')
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    // Walk backwards to find last day with hist data
    for (let d = daysInMonth; d >= 1; d--) {
      const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`
      if (dateStr > todayStr) continue
      const val = calcUnrealizedAtDate(portfoliosToProcess, histPrices, dateStr)
      // Only return if at least one stock had a price on that day
      const hasPrices = portfoliosToProcess.some(p =>
        p.stocks.some(s => histPrices[s.symbol.toUpperCase()]?.[dateStr] != null)
      )
      if (hasPrices) return val
    }
    // Fallback: aggregate snapshots
    if (!isAggregate) return null
    const prefix = `${year}-${mm}`
    const snaps = (state.dailySnapshots ?? []).filter(s => s.date.startsWith(prefix))
    if (snaps.length === 0) return null
    return snaps[snaps.length - 1].unrealizedPnL ?? null
  }, [portfoliosToProcess, histPrices, year, month, todayStr, isAggregate, state.dailySnapshots])

  // Yearly realized P&L for the currently viewed year
  const yearlySummary = useMemo(() => {
    const prefix = `${year}-`
    return Object.entries(dailyData)
      .filter(([d]) => d.startsWith(prefix))
      .reduce((sum, [, v]) => sum + (v.realized ?? 0), 0)
  }, [dailyData, year])

  // YTD realized P&L: Jan 1 of current real year → today
  const ytdSummary = useMemo(() => {
    const curYear = new Date().getFullYear()
    const prefix = `${curYear}-`
    return Object.entries(dailyData)
      .filter(([d]) => d.startsWith(prefix) && d <= todayStr)
      .reduce((sum, [, v]) => sum + (v.realized ?? 0), 0)
  }, [dailyData, todayStr])

  const monthlySummary = useMemo(() => {
    let totalRealized = 0
    let totalTodayPnL = 0
    let winDays = 0
    let lossDays = 0
    let bestDay = null
    let worstDay = null

    for (const dayObj of calendarDays) {
      if (!dayObj?.data) continue
      const { realized, todayPnL } = dayObj.data
      totalTodayPnL += todayPnL

      if (realized !== 0) {
        totalRealized += realized
        if (realized > 0) winDays++
        else lossDays++
        if (bestDay === null || realized > bestDay.value) bestDay = { dateStr: dayObj.dateStr, value: realized, day: dayObj.day }
        if (worstDay === null || realized < worstDay.value) worstDay = { dateStr: dayObj.dateStr, value: realized, day: dayObj.day }
      }
    }

    const tradingDays = winDays + lossDays
    const winRate = tradingDays > 0 ? Math.round((winDays / tradingDays) * 100) : null

    // 只有存在亏损日才显示最差交易日
    const displayWorstDay = lossDays > 0 ? worstDay : null

    return { totalRealized, totalTodayPnL, winDays, lossDays, winRate, bestDay, worstDay: displayWorstDay, tradingDays }
  }, [calendarDays])

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // Map pnl magnitude to background color
  function getCellBg(data) {
    if (!data) return null
    const pnl = data.realized !== 0 ? data.realized : data.todayPnL
    if (pnl === 0) return null
    const abs = Math.abs(pnl)
    const intensity = Math.min(abs / 2000, 1)
    const alpha = Math.round((0.12 + intensity * 0.55) * 255).toString(16).padStart(2, '0')
    return pnl > 0 ? `#16a34a${alpha}` : `#dc2626${alpha}`
  }

  function getPnlDisplay(data, histUnrealized) {
    if (data?.realized !== 0 && data?.realized != null) return { pnl: data.realized, isRealized: true }
    if (histUnrealized != null && histUnrealized !== 0) return { pnl: histUnrealized, isRealized: false }
    if (data?.todayPnL !== 0 && data?.todayPnL != null) return { pnl: data.todayPnL, isRealized: false }
    return { pnl: null, isRealized: false }
  }

  const hoveredData = hoveredDate ? dailyData[hoveredDate] : null

  return (
    <div className="space-y-5">

      {/* Navigation bar */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button onClick={prevMonth}
              className="p-2 rounded-xl hover:bg-gray-100 transition-colors text-claude-muted hover:text-claude-text">
              <ChevronLeft size={17} />
            </button>
            <h2 className="text-xl font-bold text-claude-text min-w-[140px] text-center">
              {year}年&nbsp;{MONTHS[month]}
            </h2>
            <button onClick={nextMonth}
              className="p-2 rounded-xl hover:bg-gray-100 transition-colors text-claude-muted hover:text-claude-text">
              <ChevronRight size={17} />
            </button>
          </div>

          {/* Year selector */}
          <div className="flex items-center gap-1">
            {availableYears.map(y => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                  year === y
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-claude-muted hover:bg-gray-100 hover:text-claude-text'
                }`}>
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Month tabs */}
        <div className="flex gap-1 flex-wrap">
          {MONTHS.map((m, i) => (
            <button key={i} onClick={() => setMonth(i)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                month === i
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-claude-muted hover:bg-gray-100 hover:text-claude-text'
              }`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Yearly / YTD summary bar */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-claude-muted font-medium mb-1">{year} 年已实现盈亏</p>
            <p className={`text-2xl font-bold ${getPnLClass(yearlySummary)}`}>
              {yearlySummary !== 0 ? fmt.pnl(yearlySummary) : '—'}
            </p>
          </div>
          <span className="text-3xl opacity-20">📅</span>
        </div>
        <div className="card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-claude-muted font-medium mb-1">年初至今（YTD）已实现盈亏</p>
            <p className={`text-2xl font-bold ${getPnLClass(ytdSummary)}`}>
              {ytdSummary !== 0 ? fmt.pnl(ytdSummary) : '—'}
            </p>
            <p className="text-xs text-claude-muted mt-1">{new Date().getFullYear()} 年 1 月 1 日至今</p>
          </div>
          <span className="text-3xl opacity-20">📈</span>
        </div>
      </div>

      {/* Monthly summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2 font-medium">月度已实现盈亏</p>
          <p className={`text-2xl font-bold ${getPnLClass(monthlySummary.totalRealized)}`}>
            {monthlySummary.totalRealized !== 0 ? fmt.pnl(monthlySummary.totalRealized) : '—'}
          </p>
          <p className="text-xs text-claude-muted mt-1">{monthlySummary.tradingDays} 个交易日</p>
        </div>

        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2 font-medium">月末未实现盈亏</p>
          {histLoading && monthlyUnrealizedPnL == null ? (
            <p className="text-sm text-claude-muted animate-pulse">加载历史价格中…</p>
          ) : (
            <>
              <p className={`text-2xl font-bold ${getPnLClass(monthlyUnrealizedPnL)}`}>
                {monthlyUnrealizedPnL != null ? fmt.pnl(monthlyUnrealizedPnL) : '—'}
              </p>
              <p className="text-xs text-claude-muted mt-1">
                {monthlyUnrealizedPnL != null ? '月末最后交易日收盘价' : '暂无历史价格'}
              </p>
            </>
          )}
        </div>

        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2 font-medium">胜率</p>
          <p className="text-2xl font-bold text-claude-text">
            {monthlySummary.winRate !== null ? `${monthlySummary.winRate}%` : '—'}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-medium" style={{ color: '#16a34a' }}>{monthlySummary.winDays} 盈</span>
            <span className="text-xs text-claude-subtle">·</span>
            <span className="text-xs font-medium" style={{ color: '#dc2626' }}>{monthlySummary.lossDays} 亏</span>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy size={13} style={{ color: '#16a34a' }} />
            <p className="text-xs text-claude-muted font-medium">最佳交易日</p>
          </div>
          {monthlySummary.bestDay ? (
            <>
              <p className="text-2xl font-bold" style={{ color: '#16a34a' }}>
                {fmt.pnl(monthlySummary.bestDay.value)}
              </p>
              <p className="text-xs text-claude-muted mt-1">{month + 1}月{monthlySummary.bestDay.day}日</p>
            </>
          ) : (
            <p className="text-2xl font-bold text-claude-subtle">—</p>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle size={13} style={{ color: '#dc2626' }} />
            <p className="text-xs text-claude-muted font-medium">最差交易日</p>
          </div>
          {monthlySummary.worstDay ? (
            <>
              <p className="text-2xl font-bold" style={{ color: '#dc2626' }}>
                {fmt.pnl(monthlySummary.worstDay.value)}
              </p>
              <p className="text-xs text-claude-muted mt-1">{month + 1}月{monthlySummary.worstDay.day}日</p>
            </>
          ) : (
            <p className="text-2xl font-bold text-claude-subtle">—</p>
          )}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="card p-5">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-3">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={`text-center text-xs font-semibold py-2 ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-claude-subtle'
            }`}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1.5">
          {calendarDays.map((dayObj, i) => {
            if (!dayObj) return <div key={`pad-${i}`} />

            const { day, dateStr, data, histUnrealized } = dayObj
            const { pnl, isRealized } = getPnlDisplay(data, histUnrealized)
            const bg = getCellBg(data) ?? (
              histUnrealized != null && histUnrealized !== 0
                ? (() => {
                    const abs = Math.abs(histUnrealized)
                    const intensity = Math.min(abs / 5000, 1)
                    const alpha = Math.round((0.06 + intensity * 0.22) * 255).toString(16).padStart(2, '0')
                    return histUnrealized > 0 ? `#3b82f6${alpha}` : `#ef4444${alpha}`
                  })()
                : null
            )
            const isToday = dateStr === todayStr
            const isFuture = dateStr > todayStr
            const dow = new Date(dateStr + 'T00:00:00').getDay()

            return (
              <div
                key={dateStr}
                onMouseEnter={() => setHoveredDate(dateStr)}
                onMouseLeave={() => setHoveredDate(null)}
                className={`relative rounded-xl flex flex-col items-center justify-center py-2 px-1 min-h-[64px] transition-all duration-150 cursor-default
                  ${isToday ? 'ring-2 ring-blue-500 ring-offset-1' : ''}
                  ${isFuture ? 'opacity-30' : ''}
                  ${!data ? 'hover:bg-gray-50' : 'hover:brightness-95'}
                `}
                style={{
                  backgroundColor: bg || undefined,
                }}
              >
                <span className={`text-sm font-semibold leading-none mb-1 ${
                  isToday
                    ? 'text-blue-600'
                    : dow === 0
                    ? 'text-red-500'
                    : dow === 6
                    ? 'text-blue-500'
                    : data && pnl !== null
                    ? pnl > 0 ? 'profit-text' : 'loss-text'
                    : 'text-claude-text'
                }`}>
                  {day}
                </span>

                {pnl !== null && (
                  <span className={`text-[11px] font-bold leading-tight ${
                    pnl > 0 ? 'profit-text' : 'loss-text'
                  }`}>
                    {compactPnL(pnl)}
                  </span>
                )}

                {/* Dot for market-only days (no realized, but has todayPnL) */}
                {data && !isRealized && pnl !== null && (
                  <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                    pnl > 0 ? 'bg-green-500/60' : 'bg-red-500/60'
                  }`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Hover detail */}
        {hoveredDate && (hoveredData || calendarDays.find(d => d?.dateStr === hoveredDate)?.histUnrealized != null) && (
          <div className="mt-4 pt-4 border-t border-claude-border">
            <div className="flex items-center gap-6 flex-wrap">
              <span className="text-sm font-medium text-claude-text">
                {new Date(hoveredDate + 'T00:00:00').toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
              {hoveredData?.realized !== 0 && hoveredData?.realized != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-claude-muted">已实现盈亏</span>
                  <span className={`text-sm font-bold font-mono ${hoveredData.realized >= 0 ? 'profit-text' : 'loss-text'}`}>
                    {fmt.pnl(hoveredData.realized)}
                  </span>
                </div>
              )}
              {(() => {
                const dayObj = calendarDays.find(d => d?.dateStr === hoveredDate)
                const hu = dayObj?.histUnrealized
                if (hu != null && hu !== 0) return (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-claude-muted">持仓未实现盈亏</span>
                    <span className={`text-sm font-bold font-mono ${hu >= 0 ? 'text-blue-500' : 'text-loss'}`}>
                      {fmt.pnl(hu)}
                    </span>
                  </div>
                )
                if (hoveredData?.todayPnL !== 0 && hoveredData?.todayPnL != null) return (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-claude-muted">未实现盈亏</span>
                    <span className={`text-sm font-bold font-mono ${hoveredData.todayPnL >= 0 ? 'profit-text' : 'loss-text'}`}>
                      {fmt.pnl(hoveredData.todayPnL)}
                    </span>
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-5 mt-4 pt-4 border-t border-claude-border flex-wrap">
          <span className="text-xs text-claude-muted font-medium">图例：</span>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-lg" style={{ backgroundColor: '#16a34a55' }} />
            <span className="text-xs text-claude-muted">已实现盈利</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-lg" style={{ backgroundColor: '#dc262655' }} />
            <span className="text-xs text-claude-muted">已实现亏损</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-lg" style={{ backgroundColor: '#3b82f622' }} />
            <span className="text-xs text-claude-muted">历史持仓未实现盈亏（盈）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-lg" style={{ backgroundColor: '#ef444422' }} />
            <span className="text-xs text-claude-muted">历史持仓未实现盈亏（亏）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500/60" />
            <span className="text-xs text-claude-muted">仅有市值变动数据</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full ring-2 ring-blue-500" />
            <span className="text-xs text-claude-muted">今天</span>
          </div>
        </div>
      </div>

    </div>
  )
}
