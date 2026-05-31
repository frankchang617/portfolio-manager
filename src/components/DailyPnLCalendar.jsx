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

// Most recent trading-day close strictly before dateStr (scan back up to 10 days).
function prevClose(histPrices, sym, dateStr) {
  const series = histPrices[sym]
  if (!series) return null
  for (let back = 1; back <= 10; back++) {
    const d = offsetDate(dateStr, -back)
    if (series[d] != null) return series[d]
  }
  return null
}

// Close price on dateStr. For today, use the live price (histPrices excludes today).
function closeOn(histPrices, livePrices, sym, dateStr, todayStr) {
  if (dateStr === todayStr) {
    const p = livePrices[sym]?.price
    if (p != null) return p
  }
  return histPrices[sym]?.[dateStr] ?? null
}

// Mark-to-market daily P&L for stocks on dateStr — only the profit attributable to
// THAT day's price action (not lifetime realized). Reconciles: summing over all days
// = realized + unrealized change. Formula per stock (equity-change form):
//   sharesAtOpen × (close − prevClose)         // overnight holdings (incl. shares sold today)
//   + Σ buys  n × (close − buyPrice)           // bought today
//   + Σ sells n × (sellPrice − close)          // sold today (adjusts the overnight term)
// Returns null when no held/traded symbol has usable price data that day.
function getStockDailyPnL(portfolios, histPrices, livePrices, dateStr, todayStr) {
  let total = 0
  let hasData = false
  const prevDay = offsetDate(dateStr, -1)
  for (const p of portfolios) {
    for (const stock of p.stocks ?? []) {
      const sym = stock.symbol.toUpperCase()
      const cToday = closeOn(histPrices, livePrices, sym, dateStr, todayStr)
      const cPrev = prevClose(histPrices, sym, dateStr)
      const sharesOpen = positionAtDate(stock, prevDay).shares
      const todayTxns = (stock.transactions ?? []).filter(t => t.date === dateStr)

      // Overnight holdings (these include shares that get sold today)
      if (sharesOpen > 0 && cToday != null && cPrev != null) {
        total += sharesOpen * (cToday - cPrev); hasData = true
      }
      for (const t of todayTxns) {
        if (t.action === 'buy' && cToday != null) {
          total += t.shares * (cToday - t.price); hasData = true
        } else if (t.action === 'sell' && cToday != null) {
          total += t.shares * (t.price - cToday); hasData = true
        }
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

// Background color: green/red by daily P&L sign, intensity by magnitude.
function getCellBg(pnl) {
  if (pnl == null || pnl === 0) return null
  const abs = Math.abs(pnl)
  const intensity = Math.min(abs / 2000, 1)
  const alpha = Math.round((0.10 + intensity * 0.5) * 255).toString(16).padStart(2, '0')
  return pnl > 0 ? `#16a34a${alpha}` : `#dc2626${alpha}`
}

// ── Reusable calendar grid ───────────────────────────────────────────────────
// getCell(dayObj) => { pnl, lines:[{text,cls}], dot, hoverItems:[{label,value}] }
function CalendarGrid({ title, calendarDays, getCell, monthlyPnL, loading, todayStr, dotLegend }) {
  const [hoveredDate, setHoveredDate] = useState(null)
  return (
    <div className="card p-4">
      {/* Header: title + monthly total */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-claude-text">{title}</p>
        {loading ? (
          <p className="text-xs text-claude-muted animate-pulse">加载中…</p>
        ) : monthlyPnL != null ? (
          <p className={`text-base font-bold font-mono ${monthlyPnL >= 0 ? 'profit-text' : 'loss-text'}`}>
            {fmt.pnl(monthlyPnL)}
          </p>
        ) : (
          <p className="text-xs text-claude-muted">—</p>
        )}
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={`text-center text-[11px] font-semibold py-1 ${
            i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-claude-subtle'
          }`}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((dayObj, i) => {
          if (!dayObj) return <div key={`pad-${i}`} />
          const { pnl, lines, dot } = getCell(dayObj)
          const bg = getCellBg(pnl)
          const isToday = dayObj.dateStr === todayStr
          const isFuture = dayObj.dateStr > todayStr
          const dow = new Date(dayObj.dateStr + 'T00:00:00').getDay()
          return (
            <div
              key={dayObj.dateStr}
              onMouseEnter={() => setHoveredDate(dayObj.dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
              className={`relative rounded-lg flex flex-col items-center justify-center py-1.5 px-0.5 min-h-[52px] transition-all duration-150 cursor-default
                ${isToday ? 'ring-2 ring-blue-500 ring-offset-1' : ''}
                ${isFuture ? 'opacity-30' : ''}
                ${pnl == null ? 'hover:bg-gray-50' : 'hover:brightness-95'}
              `}
              style={{ backgroundColor: bg || undefined }}
            >
              <span className={`text-xs font-semibold leading-none mb-0.5 ${
                isToday ? 'text-blue-600'
                : dow === 0 ? 'text-red-500'
                : dow === 6 ? 'text-blue-500'
                : pnl !== null ? (pnl > 0 ? 'profit-text' : 'loss-text')
                : 'text-claude-text'
              }`}>{dayObj.day}</span>
              {lines?.map((line, li) => (
                <span key={li} className={`text-[10px] font-bold leading-tight ${line.cls}`}>{line.text}</span>
              ))}
              {dot && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400 ring-1 ring-amber-500/40" />
              )}
            </div>
          )
        })}
      </div>

      {/* Hover detail */}
      {hoveredDate && (() => {
        const dayObj = calendarDays.find(d => d?.dateStr === hoveredDate)
        if (!dayObj) return null
        const { pnl, hoverItems } = getCell(dayObj)
        if (pnl == null || !hoverItems?.length) return null
        return (
          <div className="mt-2 pt-2 border-t border-claude-border">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-xs font-medium text-claude-text">
                {new Date(hoveredDate + 'T00:00:00').toLocaleDateString('zh-CN', {
                  year: 'numeric', month: 'long', day: 'numeric'
                })}
              </span>
              {hoverItems.map((item, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-[11px] text-claude-muted">{item.label}</span>
                  <span className={`text-xs font-bold font-mono ${item.value >= 0 ? 'profit-text' : 'loss-text'}`}>
                    {fmt.pnl(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-claude-border flex-wrap">
        <span className="text-[11px] text-claude-muted font-medium">图例：</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#16a34a55' }} />
          <span className="text-[11px] text-claude-muted">盈利</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: '#dc262655' }} />
          <span className="text-[11px] text-claude-muted">亏损</span>
        </div>
        {dotLegend && (
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ring-1 ring-amber-500/40 inline-block" />
            <span className="text-[11px] text-claude-muted">{dotLegend}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full ring-2 ring-blue-500" />
          <span className="text-[11px] text-claude-muted">今天</span>
        </div>
      </div>
    </div>
  )
}

export default function DailyPnLCalendar() {
  const { state, activePortfolio } = usePortfolio()
  const isAggregate = activePortfolio?.isAggregate === true
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
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

  // Realized P&L map: date => { realized, stockRealized, optionRealized, todayPnL }
  const dailyData = useMemo(() => {
    const map = {}
    const init = (date) => {
      if (!map[date]) map[date] = { realized: 0, stockRealized: 0, optionRealized: 0, todayPnL: 0 }
    }

    if (isAggregate) {
      for (const s of (state.dailySnapshots ?? [])) {
        init(s.date)
        map[s.date].todayPnL = s.todayPnL ?? 0
      }
    }

    for (const p of portfoliosToProcess) {
      for (const s of (p.stocks ?? [])) {
        for (const t of (s.transactions ?? [])) {
          if (t.action === 'sell' && t.date && t.realizedPnL != null) {
            init(t.date)
            map[t.date].realized += t.realizedPnL
            map[t.date].stockRealized += t.realizedPnL
          }
        }
      }
      for (const o of (p.options ?? [])) {
        if (o.status === 'closed' && o.closeDate && o.realizedPnL != null) {
          init(o.closeDate)
          map[o.closeDate].realized += o.realizedPnL
          map[o.closeDate].optionRealized += o.realizedPnL
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

  // Calendar days with mark-to-market daily P&L (stocks).
  // Each day shows only the profit attributable to THAT day's price action,
  // not lifetime realized. Today uses live prices (handled inside getStockDailyPnL).
  const calendarDays = useMemo(() => {
    const mm = String(month + 1).padStart(2, '0')
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const startDow = new Date(year, month, 1).getDay()

    const days = []
    for (let i = 0; i < startDow; i++) days.push(null)

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${mm}-${String(d).padStart(2, '0')}`
      const stockDailyPnL = dateStr > todayStr
        ? null
        : getStockDailyPnL(portfoliosToProcess, histPrices, state.prices, dateStr, todayStr)
      days.push({ day: d, dateStr, data: dailyData[dateStr] || null, stockDailyPnL })
    }
    return days
  }, [year, month, dailyData, portfoliosToProcess, histPrices, state.prices, todayStr])

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

  // YTD unrealized CHANGE = current unrealized − unrealized at start of this year.
  // (Old behavior used full current unrealized, which overstated YTD by including
  //  paper gains accrued on positions held from before this year.)
  const ytdUnrealizedChange = useMemo(() => {
    const curYear = new Date().getFullYear()
    let startUnrealized = 0  // no position before this year → 0
    for (let back = 0; back <= 10; back++) {
      // Dec 31 of previous year, then walk back to last trading day with data
      const d = offsetDate(`${curYear}-01-01`, -1 - back)
      const val = getUnrealizedAtDate(portfoliosToProcess, histPrices, d)
      if (val != null) { startUnrealized = val; break }
    }
    return currentUnrealizedPnL - startUnrealized
  }, [portfoliosToProcess, histPrices, currentUnrealizedPnL])

  // YTD total = YTD realized + YTD unrealized change
  const ytdTotalPnL = useMemo(() => ytdSummary + ytdUnrealizedChange, [ytdSummary, ytdUnrealizedChange])

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
      // Daily performance = stock mark-to-market (already includes stock realized
      // contribution) + option realized lump (no daily option prices available).
      const stockDaily = dayObj.stockDailyPnL ?? 0
      const optionRealized = dayObj.data?.optionRealized ?? 0
      const dayPnl = stockDaily + optionRealized

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

  // Monthly P&L split by type — for individual calendar headers
  const monthlyStockPnL = useMemo(() => {
    let total = 0, hasData = false
    for (const d of calendarDays) {
      if (!d || d.stockDailyPnL == null) continue
      total += d.stockDailyPnL; hasData = true
    }
    return hasData ? total : null
  }, [calendarDays])

  const monthlyOptionPnL = useMemo(() => {
    let total = 0
    for (const d of calendarDays) {
      if (!d?.data) continue
      total += d.data.optionRealized ?? 0
    }
    return total !== 0 ? total : null
  }, [calendarDays])

  const hasOptions = portfoliosToProcess.some(p => (p.options ?? []).length > 0)

  // getCell factories for each calendar type
  const stockGetCell = (dayObj) => {
    const pnl = dayObj.stockDailyPnL
    const stockRealized = dayObj.data?.stockRealized ?? 0
    return {
      pnl,
      lines: pnl != null ? [{ text: compactPnL(pnl), cls: pnl >= 0 ? 'profit-text' : 'loss-text' }] : [],
      dot: stockRealized !== 0 && pnl != null,
      hoverItems: pnl != null ? [
        { label: '股票当日盈亏', value: pnl },
        ...(stockRealized !== 0 ? [{ label: '当日落袋（股票）', value: stockRealized }] : []),
      ] : [],
    }
  }

  const optionGetCell = (dayObj) => {
    const raw = dayObj.data?.optionRealized ?? null
    const pnl = raw != null && raw !== 0 ? raw : null
    return {
      pnl,
      lines: pnl != null ? [{ text: compactPnL(pnl), cls: pnl >= 0 ? 'profit-text' : 'loss-text' }] : [],
      dot: false,
      hoverItems: pnl != null ? [{ label: '期权已实现', value: pnl }] : [],
    }
  }

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  // Daily display: stock mark-to-market (that day's price action) + option realized lump.
  function getPnlDisplay(data, stockDailyPnL) {
    const stockDaily = stockDailyPnL  // null or number
    const optionRealized = data?.optionRealized ?? 0
    const total = (stockDaily ?? 0) + optionRealized
    const hasData = stockDaily != null || optionRealized !== 0
    const hadRealizedTrade = (data?.stockRealized ?? 0) !== 0 || optionRealized !== 0
    return { pnl: hasData ? total : null, stockDaily, optionRealized, hadRealizedTrade, realized: data?.realized ?? 0 }
  }

  return (
    <div className="space-y-3">

      {/* Summary panels */}
      <div className="space-y-2">

        {/* All-time */}
        <div className="card p-3">
          <p className="text-[11px] font-semibold text-claude-muted uppercase tracking-wider mb-2">总览</p>
          <div className="flex">
            <div className="flex-1 pr-4">
              <p className="text-[11px] text-claude-muted mb-0.5">总盈亏</p>
              <p className={`text-xl font-bold ${getPnLClass(totalPnL)}`}>
                {totalPnL !== 0 ? fmt.pnl(totalPnL) : '—'}
              </p>
              <p className="text-[11px] text-claude-muted mt-0.5">已实现 + 未实现</p>
            </div>
            <div className="flex-1 px-4 border-l border-claude-border">
              <p className="text-[11px] text-claude-muted mb-0.5">已实现</p>
              <p className={`text-lg font-bold ${getPnLClass(totalRealizedPnL)}`}>
                {totalRealizedPnL !== 0 ? fmt.pnl(totalRealizedPnL) : '—'}
              </p>
              <p className="text-[11px] text-claude-muted mt-0.5">历史全部</p>
            </div>
            <div className="flex-1 pl-4 border-l border-claude-border">
              <p className="text-[11px] text-claude-muted mb-0.5">未实现</p>
              <p className={`text-lg font-bold ${getPnLClass(currentUnrealizedPnL)}`}>
                {currentUnrealizedPnL !== 0 ? fmt.pnl(currentUnrealizedPnL) : '—'}
              </p>
              <p className="text-[11px] text-claude-muted mt-0.5">当前持仓</p>
            </div>
          </div>
        </div>

        {/* YTD */}
        <div className="card p-3">
          <p className="text-[11px] font-semibold text-claude-muted uppercase tracking-wider mb-2">
            年初至今 · {new Date().getFullYear()}
          </p>
          <div className="flex">
            <div className="flex-1 pr-4">
              <p className="text-[11px] text-claude-muted mb-0.5">总盈亏</p>
              <p className={`text-xl font-bold ${getPnLClass(ytdTotalPnL)}`}>
                {ytdTotalPnL !== 0 ? fmt.pnl(ytdTotalPnL) : '—'}
              </p>
              <p className="text-[11px] text-claude-muted mt-0.5">已实现 + 未实现</p>
            </div>
            <div className="flex-1 px-4 border-l border-claude-border">
              <p className="text-[11px] text-claude-muted mb-0.5">已实现</p>
              <p className={`text-lg font-bold ${getPnLClass(ytdSummary)}`}>
                {ytdSummary !== 0 ? fmt.pnl(ytdSummary) : '—'}
              </p>
              <p className="text-[11px] text-claude-muted mt-0.5">1 月 1 日起落袋</p>
            </div>
            <div className="flex-1 pl-4 border-l border-claude-border">
              <p className="text-[11px] text-claude-muted mb-0.5">未实现变动</p>
              <p className={`text-lg font-bold ${getPnLClass(ytdUnrealizedChange)}`}>
                {ytdUnrealizedChange !== 0 ? fmt.pnl(ytdUnrealizedChange) : '—'}
              </p>
              <p className="text-[11px] text-claude-muted mt-0.5">较年初浮盈</p>
            </div>
          </div>
        </div>

        {/* Monthly */}
        <div className="card p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-claude-muted uppercase tracking-wider">
              {year} 年 {MONTHS[month]}
            </p>
            <div className="flex items-center gap-3 text-[11px] text-claude-muted">
              {monthlySummary.winRate !== null && (
                <span>
                  胜率&nbsp;
                  <span className="font-semibold text-claude-text">{monthlySummary.winRate}%</span>
                  &nbsp;
                  <span className="font-medium" style={{ color: '#16a34a' }}>{monthlySummary.winDays} 盈</span>
                  &nbsp;·&nbsp;
                  <span className="font-medium" style={{ color: '#dc2626' }}>{monthlySummary.lossDays} 亏</span>
                </span>
              )}
              {monthlySummary.bestDay && (
                <span className="flex items-center gap-1">
                  <Trophy size={10} style={{ color: '#16a34a' }} />
                  <span className="profit-text font-semibold">{compactPnL(monthlySummary.bestDay.value)}</span>
                  <span className="text-claude-subtle">{month + 1}/{monthlySummary.bestDay.day}</span>
                </span>
              )}
              {monthlySummary.worstDay && (
                <span className="flex items-center gap-1">
                  <AlertTriangle size={10} style={{ color: '#dc2626' }} />
                  <span className="loss-text font-semibold">{compactPnL(monthlySummary.worstDay.value)}</span>
                  <span className="text-claude-subtle">{month + 1}/{monthlySummary.worstDay.day}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex">
            <div className="flex-1 pr-4">
              <p className="text-[11px] text-claude-muted mb-0.5">月度总盈亏</p>
              {histLoading && monthlyTotalPnL == null ? (
                <p className="text-sm text-claude-muted animate-pulse">加载中…</p>
              ) : (
                <p className={`text-xl font-bold ${getPnLClass(monthlyTotalPnL)}`}>
                  {monthlyTotalPnL != null ? fmt.pnl(monthlyTotalPnL) : '—'}
                </p>
              )}
              <p className="text-[11px] text-claude-muted mt-0.5">已实现 + 未实现变动</p>
            </div>
            <div className="flex-1 px-4 border-l border-claude-border">
              <p className="text-[11px] text-claude-muted mb-0.5">已实现</p>
              <p className={`text-lg font-bold ${getPnLClass(monthlySummary.totalRealized)}`}>
                {monthlySummary.totalRealized !== 0 ? fmt.pnl(monthlySummary.totalRealized) : '—'}
              </p>
              <p className="text-[11px] text-claude-muted mt-0.5">{monthlySummary.tradingDays} 个有数据日</p>
            </div>
            <div className="flex-1 pl-4 border-l border-claude-border">
              <p className="text-[11px] text-claude-muted mb-0.5">未实现变动</p>
              {histLoading && monthlyUnrealizedPnL == null ? (
                <p className="text-sm text-claude-muted animate-pulse">加载中…</p>
              ) : (
                <p className={`text-lg font-bold ${getPnLClass(monthlyUnrealizedPnL)}`}>
                  {monthlyUnrealizedPnL != null ? fmt.pnl(monthlyUnrealizedPnL) : '—'}
                </p>
              )}
              <p className="text-[11px] text-claude-muted mt-0.5">月末 − 月初浮盈</p>
            </div>
          </div>
        </div>

      </div>

      {/* Navigation bar */}
      <div className="card p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <button onClick={prevMonth}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-claude-muted hover:text-claude-text">
              <ChevronLeft size={15} />
            </button>
            <h2 className="text-base font-bold text-claude-text min-w-[120px] text-center">
              {year}年&nbsp;{MONTHS[month]}
            </h2>
            <button onClick={nextMonth}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-claude-muted hover:text-claude-text">
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="flex items-center gap-1">
            {availableYears.map(y => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
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
              className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                month === i
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-claude-muted hover:bg-gray-100 hover:text-claude-text'
              }`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Stock calendar */}
      <CalendarGrid
        title="股票日历"
        calendarDays={calendarDays}
        getCell={stockGetCell}
        monthlyPnL={monthlyStockPnL}
        loading={histLoading && monthlyStockPnL == null}
        todayStr={todayStr}
        dotLegend="当日有股票落袋"
      />

      {/* Option calendar — only rendered when the portfolio has options */}
      {hasOptions && (
        <CalendarGrid
          title="期权日历"
          calendarDays={calendarDays}
          getCell={optionGetCell}
          monthlyPnL={monthlyOptionPnL}
          loading={false}
          todayStr={todayStr}
        />
      )}

    </div>
  )
}
