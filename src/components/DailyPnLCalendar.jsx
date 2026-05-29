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

// Unrealized P&L at dateStr using histPrices.
// Returns null when no open position has price data for that date (weekends, holidays, not yet held).
function getUnrealizedAtDate(portfolios, histPrices, dateStr) {
  let total = 0
  let hasData = false
  for (const p of portfolios) {
    for (const stock of p.stocks ?? []) {
      const sym = stock.symbol.toUpperCase()
      const price = histPrices[sym]?.[dateStr]
      if (!price) continue
      const { shares, avgCost } = positionAtDate(stock, dateStr)
      if (shares > 0) {
        hasData = true
        total += (price - avgCost) * shares
      }
    }
  }
  return hasData ? total : null
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

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export default function DailyPnLCalendar() {
  const { state, activePortfolio } = usePortfolio()
  const isAggregate = activePortfolio?.isAggregate === true
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [hoveredDate, setHoveredDate] = useState(null)
  const [histPrices, setHistPrices] = useState({})
  const [histLoading, setHistLoading] = useState(false)
  const fetchedSymbols = useRef(new Set())

  const portfoliosToProcess = useMemo(() => {
    if (isAggregate) return state.portfolios.filter(p => !p.isAggregate)
    return activePortfolio ? [activePortfolio] : []
  }, [isAggregate, activePortfolio, state.portfolios])

  // Fetch historical prices for any new symbol
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

  // Realized P&L map: date => { realized, todayPnL }
  const dailyData = useMemo(() => {
    const map = {}

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

    return map
  }, [portfoliosToProcess, isAggregate, state.dailySnapshots])

  // Live unrealized P&L for current holdings (real-time prices).
  // Defined before calendarDays so it can be used for today's daily change.
  const currentUnrealizedPnL = useMemo(() => {
    let total = 0
    for (const p of portfoliosToProcess) {
      for (const s of p.stocks ?? []) {
        if (s.shares <= 0) continue
        const q = state.prices[s.symbol.toUpperCase()]
        if (q?.price != null) total += (q.price - s.avgCost) * s.shares
      }
    }
    return total
  }, [portfoliosToProcess, state.prices])

  // Calendar days with daily unrealized CHANGE (not cumulative snapshot).
  // Daily change = unrealized[d] - unrealized[previous trading day].
  // For today: currentUnrealizedPnL - unrealized[yesterday].
  const calendarDays = useMemo(() => {
    const mm = String(month + 1).padStart(2, '0')
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const startDow = new Date(year, month, 1).getDay()

    // Cache getUnrealizedAtDate calls to avoid redundant computation
    const cache = {}
    const getUnrealized = (dateStr) => {
      if (dateStr > todayStr) return null
      if (!(dateStr in cache)) {
        cache[dateStr] = getUnrealizedAtDate(portfoliosToProcess, histPrices, dateStr)
      }
      return cache[dateStr]
    }

    // Find the most recent trading day before dateStr that has price data
    const getPrevSnapshot = (dateStr) => {
      for (let back = 1; back <= 7; back++) {
        const s = offsetDate(dateStr, -back)
        if (s > todayStr) continue
        const val = getUnrealized(s)
        if (val != null) return val
      }
      return null
    }

    const days = []
    for (let i = 0; i < startDow; i++) days.push(null)

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`
      let dailyUnrealizedChange = null

      if (dateStr < todayStr) {
        const snapshot = getUnrealized(dateStr)
        if (snapshot != null) {
          const prev = getPrevSnapshot(dateStr)
          // prev == null means first trading day ever; treat prior as 0
          dailyUnrealizedChange = snapshot - (prev ?? 0)
        }
      } else if (dateStr === todayStr) {
        // Use live prices vs last historical close
        const prev = getPrevSnapshot(todayStr)
        if (prev != null) {
          dailyUnrealizedChange = currentUnrealizedPnL - prev
        } else if (currentUnrealizedPnL !== 0) {
          // No prior history yet; show live cumulative as baseline
          dailyUnrealizedChange = currentUnrealizedPnL
        }
      }

      days.push({ day: d, dateStr, data: dailyData[dateStr] || null, dailyUnrealizedChange })
    }
    return days
  }, [year, month, dailyData, portfoliosToProcess, histPrices, todayStr, currentUnrealizedPnL])

  // Monthly unrealized P&L = CHANGE during the month (end-of-month snapshot - start-of-month snapshot).
  const monthlyUnrealizedPnL = useMemo(() => {
    const mm = String(month + 1).padStart(2, '0')
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // End-of-month: last trading day with data (use live prices if current month)
    let endUnrealized = null
    for (let d = daysInMonth; d >= 1; d--) {
      const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`
      if (dateStr > todayStr) continue
      if (dateStr === todayStr) { endUnrealized = currentUnrealizedPnL; break }
      const val = getUnrealizedAtDate(portfoliosToProcess, histPrices, dateStr)
      if (val != null) { endUnrealized = val; break }
    }
    if (endUnrealized == null) return null

    // Start-of-month: last trading day of previous month (look back up to 10 days)
    let startUnrealized = 0  // default: no prior position = 0
    for (let back = 1; back <= 10; back++) {
      const dateStr = offsetDate(`${year}-${mm}-01`, -back)
      if (dateStr > todayStr) continue
      const val = getUnrealizedAtDate(portfoliosToProcess, histPrices, dateStr)
      if (val != null) { startUnrealized = val; break }
    }

    return endUnrealized - startUnrealized
  }, [portfoliosToProcess, histPrices, year, month, todayStr, currentUnrealizedPnL])

  // All-time realized P&L (sum across every date in dailyData)
  const totalRealizedPnL = useMemo(() => {
    return Object.values(dailyData).reduce((sum, v) => sum + (v.realized ?? 0), 0)
  }, [dailyData])

  // YTD realized P&L: Jan 1 of current real year → today
  const ytdSummary = useMemo(() => {
    const curYear = new Date().getFullYear()
    const prefix = `${curYear}-`
    return Object.entries(dailyData)
      .filter(([d]) => d.startsWith(prefix) && d <= todayStr)
      .reduce((sum, [, v]) => sum + (v.realized ?? 0), 0)
  }, [dailyData, todayStr])

  // YTD total = YTD realized + current unrealized
  const ytdTotalPnL = useMemo(() => ytdSummary + currentUnrealizedPnL, [ytdSummary, currentUnrealizedPnL])

  // All-time total P&L
  const totalPnL = useMemo(() => totalRealizedPnL + currentUnrealizedPnL, [totalRealizedPnL, currentUnrealizedPnL])

  // Monthly summary: iterate calendarDays using total daily P&L
  const monthlySummary = useMemo(() => {
    let totalRealized = 0
    let winDays = 0
    let lossDays = 0
    let bestDay = null
    let worstDay = null

    for (const dayObj of calendarDays) {
      if (!dayObj) continue
      const realized = dayObj.data?.realized ?? 0
      const unrealized = dayObj.dailyUnrealizedChange ?? 0
      const dayPnl = realized + unrealized

      if (realized !== 0) totalRealized += realized
      if (dayPnl === 0) continue

      if (dayPnl > 0) winDays++
      else lossDays++
      if (bestDay === null || dayPnl > bestDay.value) bestDay = { dateStr: dayObj.dateStr, value: dayPnl, day: dayObj.day }
      if (worstDay === null || dayPnl < worstDay.value) worstDay = { dateStr: dayObj.dateStr, value: dayPnl, day: dayObj.day }
    }

    const tradingDays = winDays + lossDays
    const winRate = tradingDays > 0 ? Math.round((winDays / tradingDays) * 100) : null
    const displayWorstDay = lossDays > 0 ? worstDay : null

    return { totalRealized, winDays, lossDays, winRate, bestDay, worstDay: displayWorstDay, tradingDays }
  }, [calendarDays])

  // Monthly total P&L = monthly unrealized change + monthly realized
  const monthlyTotalPnL = useMemo(() => {
    if (monthlyUnrealizedPnL == null) return monthlySummary.totalRealized || null
    return monthlyUnrealizedPnL + monthlySummary.totalRealized
  }, [monthlyUnrealizedPnL, monthlySummary.totalRealized])

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // Background color: realized days = green/red; unrealized-only = blue tint
  function getCellBg(totalPnl, isRealized) {
    if (totalPnl == null || totalPnl === 0) return null
    const abs = Math.abs(totalPnl)
    const intensity = Math.min(abs / 2000, 1)
    if (isRealized) {
      const alpha = Math.round((0.12 + intensity * 0.55) * 255).toString(16).padStart(2, '0')
      return totalPnl > 0 ? `#16a34a${alpha}` : `#dc2626${alpha}`
    }
    const alpha = Math.round((0.06 + intensity * 0.22) * 255).toString(16).padStart(2, '0')
    return totalPnl > 0 ? `#3b82f6${alpha}` : `#ef4444${alpha}`
  }

  // Daily display: realized + daily unrealized change
  function getPnlDisplay(data, dailyUnrealizedChange) {
    const realized = data?.realized ?? 0
    const unrealized = dailyUnrealizedChange ?? 0
    const total = realized + unrealized
    const hasData = realized !== 0 || unrealized !== 0
    return { pnl: hasData ? total : null, isRealized: realized !== 0, realized, unrealized }
  }

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

      {/* All-time summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-claude-muted font-medium mb-1">总已实现盈亏</p>
          <p className={`text-2xl font-bold ${getPnLClass(totalRealizedPnL)}`}>
            {totalRealizedPnL !== 0 ? fmt.pnl(totalRealizedPnL) : '—'}
          </p>
          <p className="text-xs text-claude-muted mt-1">历史全部已实现</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-claude-muted font-medium mb-1">总未实现盈亏</p>
          <p className={`text-2xl font-bold ${getPnLClass(currentUnrealizedPnL)}`}>
            {currentUnrealizedPnL !== 0 ? fmt.pnl(currentUnrealizedPnL) : '—'}
          </p>
          <p className="text-xs text-claude-muted mt-1">当前持仓实时浮盈</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-claude-muted font-medium mb-1">总盈亏</p>
          <p className={`text-2xl font-bold ${getPnLClass(totalPnL)}`}>
            {totalPnL !== 0 ? fmt.pnl(totalPnL) : '—'}
          </p>
          <p className="text-xs text-claude-muted mt-1">已实现 + 未实现</p>
        </div>
      </div>

      {/* YTD summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-claude-muted font-medium mb-1">年初至今已实现</p>
          <p className={`text-2xl font-bold ${getPnLClass(ytdSummary)}`}>
            {ytdSummary !== 0 ? fmt.pnl(ytdSummary) : '—'}
          </p>
          <p className="text-xs text-claude-muted mt-1">{new Date().getFullYear()} 年 1 月 1 日起</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-claude-muted font-medium mb-1">年初至今未实现</p>
          <p className={`text-2xl font-bold ${getPnLClass(currentUnrealizedPnL)}`}>
            {currentUnrealizedPnL !== 0 ? fmt.pnl(currentUnrealizedPnL) : '—'}
          </p>
          <p className="text-xs text-claude-muted mt-1">当前持仓实时浮盈</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-claude-muted font-medium mb-1">年初至今总盈亏</p>
          <p className={`text-2xl font-bold ${getPnLClass(ytdTotalPnL)}`}>
            {ytdTotalPnL !== 0 ? fmt.pnl(ytdTotalPnL) : '—'}
          </p>
          <p className="text-xs text-claude-muted mt-1">YTD 已实现 + 当前未实现</p>
        </div>
      </div>

      {/* Monthly summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2 font-medium">月度已实现盈亏</p>
          <p className={`text-2xl font-bold ${getPnLClass(monthlySummary.totalRealized)}`}>
            {monthlySummary.totalRealized !== 0 ? fmt.pnl(monthlySummary.totalRealized) : '—'}
          </p>
          <p className="text-xs text-claude-muted mt-1">{monthlySummary.tradingDays} 个有数据日</p>
        </div>

        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2 font-medium">月度未实现变动</p>
          {histLoading && monthlyUnrealizedPnL == null ? (
            <p className="text-sm text-claude-muted animate-pulse">加载历史价格中…</p>
          ) : (
            <>
              <p className={`text-2xl font-bold ${getPnLClass(monthlyUnrealizedPnL)}`}>
                {monthlyUnrealizedPnL != null ? fmt.pnl(monthlyUnrealizedPnL) : '—'}
              </p>
              <p className="text-xs text-claude-muted mt-1">
                {monthlyUnrealizedPnL != null ? '月末 − 月初浮盈' : '暂无历史价格'}
              </p>
            </>
          )}
        </div>

        <div className="card p-4">
          <p className="text-xs text-claude-muted mb-2 font-medium">月度总盈亏</p>
          {histLoading && monthlyTotalPnL == null ? (
            <p className="text-sm text-claude-muted animate-pulse">加载中…</p>
          ) : (
            <>
              <p className={`text-2xl font-bold ${getPnLClass(monthlyTotalPnL)}`}>
                {monthlyTotalPnL != null ? fmt.pnl(monthlyTotalPnL) : '—'}
              </p>
              <p className="text-xs text-claude-muted mt-1">未实现变动 + 已实现</p>
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
        <div className="grid grid-cols-7 mb-3">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={`text-center text-xs font-semibold py-2 ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-claude-subtle'
            }`}>
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {calendarDays.map((dayObj, i) => {
            if (!dayObj) return <div key={`pad-${i}`} />

            const { day, dateStr, data, dailyUnrealizedChange } = dayObj
            const { pnl, isRealized, realized, unrealized } = getPnlDisplay(data, dailyUnrealizedChange)
            const bg = getCellBg(pnl, isRealized)
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
                  ${pnl == null ? 'hover:bg-gray-50' : 'hover:brightness-95'}
                `}
                style={{ backgroundColor: bg || undefined }}
              >
                <span className={`text-sm font-semibold leading-none mb-1 ${
                  isToday ? 'text-blue-600'
                  : dow === 0 ? 'text-red-500'
                  : dow === 6 ? 'text-blue-500'
                  : pnl !== null ? (pnl > 0 ? 'profit-text' : 'loss-text')
                  : 'text-claude-text'
                }`}>
                  {day}
                </span>

                {pnl !== null && (
                  <span className={`text-[11px] font-bold leading-tight ${pnl > 0 ? 'profit-text' : 'loss-text'}`}>
                    {compactPnL(pnl)}
                  </span>
                )}

                {/* Dot = unrealized-only (no realized trade that day) */}
                {!isRealized && pnl !== null && (
                  <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                    pnl > 0 ? 'bg-blue-400/70' : 'bg-red-400/70'
                  }`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Hover detail */}
        {hoveredDate && (() => {
          const dayObj = calendarDays.find(d => d?.dateStr === hoveredDate)
          if (!dayObj) return null
          const { pnl, isRealized, realized, unrealized } = getPnlDisplay(dayObj.data, dayObj.dailyUnrealizedChange)
          if (pnl == null) return null
          const showBoth = realized !== 0 && unrealized !== 0
          return (
            <div className="mt-4 pt-4 border-t border-claude-border">
              <div className="flex items-center gap-6 flex-wrap">
                <span className="text-sm font-medium text-claude-text">
                  {new Date(hoveredDate + 'T00:00:00').toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
                {unrealized !== 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-claude-muted">未实现变动</span>
                    <span className={`text-sm font-bold font-mono ${unrealized >= 0 ? 'text-blue-500' : 'loss-text'}`}>
                      {fmt.pnl(unrealized)}
                    </span>
                  </div>
                )}
                {realized !== 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-claude-muted">已实现盈亏</span>
                    <span className={`text-sm font-bold font-mono ${realized >= 0 ? 'profit-text' : 'loss-text'}`}>
                      {fmt.pnl(realized)}
                    </span>
                  </div>
                )}
                {showBoth && (
                  <div className="flex items-center gap-1.5 pl-3 border-l border-claude-border">
                    <span className="text-xs text-claude-muted">当日合计</span>
                    <span className={`text-sm font-bold font-mono ${pnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                      {fmt.pnl(pnl)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Legend */}
        <div className="flex items-center gap-5 mt-4 pt-4 border-t border-claude-border flex-wrap">
          <span className="text-xs text-claude-muted font-medium">图例：</span>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-lg" style={{ backgroundColor: '#16a34a55' }} />
            <span className="text-xs text-claude-muted">当日盈利（含已实现）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-lg" style={{ backgroundColor: '#dc262655' }} />
            <span className="text-xs text-claude-muted">当日亏损（含已实现）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-lg" style={{ backgroundColor: '#3b82f622' }} />
            <span className="text-xs text-claude-muted">仅浮盈变动（盈）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-lg" style={{ backgroundColor: '#ef444422' }} />
            <span className="text-xs text-claude-muted">仅浮亏变动（亏）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400/70" />
            <span className="text-xs text-claude-muted">仅未实现变动</span>
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
