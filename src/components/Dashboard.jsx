import { useMemo, useState, useEffect, useRef } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { useChartColors } from '../hooks/useDarkMode'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
  AreaChart, Area, CartesianGrid,
} from 'recharts'
import { usePortfolio } from '../contexts/PortfolioContext'
import { fmt, getPnLClass } from '../utils/formatters'
import { calculateOptionMetrics } from '../utils/blackScholes'
import { fetchHistoricalPrices } from '../utils/api'

// ── Historical asset reconstruction helpers ──────────────────────────────────

// Replay transactions up to (and including) targetDate for a single stock.
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

// Compute cash balance at dateStr by reversing transactions that happened after dateStr.
// Works backward from the known current portfolio.cash.
function cashAtDate(portfolio, dateStr) {
  let cash = portfolio.cash ?? 0
  // Undo stock transactions after dateStr
  for (const s of portfolio.stocks ?? []) {
    for (const t of s.transactions ?? []) {
      if (!t.date || t.date <= dateStr) continue
      if (t.action === 'buy') cash += t.price * t.shares + (t.commission ?? 0)
      else if (t.action === 'sell') cash -= t.price * t.shares - (t.commission ?? 0)
    }
  }
  // Undo option cash flows after dateStr
  for (const o of portfolio.options ?? []) {
    const contracts = Math.abs(o.contracts ?? 1)
    const openCash = (o.premium ?? 0) * contracts * 100
    const openComm = o.commission ?? 0
    // Undo opening premium if option was opened after dateStr
    if (o.tradeDate && o.tradeDate > dateStr) {
      if (o.direction === 'sell') cash -= openCash - openComm   // received premium → undo: subtract
      else                        cash += openCash + openComm   // paid premium → undo: add back
    }
    // Undo closing cash flow if option closed after dateStr but opened on/before dateStr
    if (o.status === 'closed' && o.closeDate && o.closeDate > dateStr &&
        (!o.tradeDate || o.tradeDate <= dateStr)) {
      const closeCash = (o.closePrice ?? 0) * contracts * 100
      const closeComm = o.closeCommission ?? 0
      if (o.direction === 'sell') cash += closeCash + closeComm  // paid to buy back → undo: add back
      else                        cash -= closeCash - closeComm  // received to close → undo: subtract
    }
  }
  return Math.max(0, cash)
}

// ── Calendar-consistent P&L helpers ─────────────────────────────────────────
// Same logic as DailyPnLCalendar so both pages show the same numbers.

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

// Most recent trading-day close strictly before dateStr (scan back up to 10 days).
function prevClosePrice(histPrices, sym, dateStr) {
  const series = histPrices[sym]
  if (!series) return null
  for (let back = 1; back <= 10; back++) {
    const d = offsetDate(dateStr, -back)
    if (series[d] != null) return series[d]
  }
  return null
}

// Close on dateStr; for today use live Finnhub price.
function closeOnDate(histPrices, livePrices, sym, dateStr, todayStr) {
  if (dateStr === todayStr) return livePrices[sym]?.price ?? null
  return histPrices[sym]?.[dateStr] ?? null
}

// Stock-only unrealized P&L at dateStr using Yahoo Finance histPrices.
function getUnrealizedAtDate(portfolios, histPrices, dateStr) {
  let total = 0; let hasData = false
  for (const p of portfolios) {
    for (const stock of p.stocks ?? []) {
      const sym = stock.symbol.toUpperCase()
      const price = histPrices[sym]?.[dateStr]
      if (!price) continue
      const { shares, avgCost } = positionAtDate(stock, dateStr)
      if (shares > 0) { hasData = true; total += (price - avgCost) * shares }
    }
  }
  return hasData ? total : null
}

// Mark-to-market daily stock P&L (equity-change form — same formula as Calendar).
function getStockDailyPnL(portfolios, histPrices, livePrices, dateStr, todayStr) {
  let total = 0; let hasData = false
  const prevDay = offsetDate(dateStr, -1)
  for (const p of portfolios) {
    for (const stock of p.stocks ?? []) {
      const sym = stock.symbol.toUpperCase()
      const cToday = closeOnDate(histPrices, livePrices, sym, dateStr, todayStr)
      const cPrev  = prevClosePrice(histPrices, sym, dateStr)
      const sharesOpen = positionAtDate(stock, prevDay).shares
      const todayTxns = (stock.transactions ?? []).filter(t => t.date === dateStr)
      if (sharesOpen > 0 && cToday != null && cPrev != null) {
        total += sharesOpen * (cToday - cPrev); hasData = true
      }
      for (const t of todayTxns) {
        if (t.action === 'buy'  && cToday != null) { total += t.shares * (cToday - t.price); hasData = true }
        if (t.action === 'sell' && cToday != null) { total += t.shares * (t.price - cToday); hasData = true }
      }
    }
  }
  return hasData ? total : null
}

// ── Performance statistics helpers ──────────────────────────────────────────

// IRR via Newton-Raphson: cash flows = [{days, amount}], days from t0
function solveIRR(flows) {
  const npv  = r => flows.reduce((s, cf) => s + cf.amount / Math.pow(1 + r, cf.days), 0)
  const dnpv = r => flows.reduce((s, cf) => s - cf.days * cf.amount / Math.pow(1 + r, cf.days + 1), 0)
  let r = 0.001
  for (let i = 0; i < 300; i++) {
    const f = npv(r), df = dnpv(r)
    if (Math.abs(df) < 1e-15) break
    const nr = r - f / df
    if (Math.abs(nr - r) < 1e-10) { r = nr; break }
    r = Math.max(nr, -0.9999)
  }
  return r
}

// Transaction-based annualized return (MWRR/IRR), no snapshots needed.
// Each buy = negative cash flow, each sell = positive, today's market value = terminal inflow.
function calcPortfolioIRR(portfolio, prices) {
  const flows = []   // {date: Date, amount: number}

  for (const stock of portfolio.stocks ?? []) {
    const txns = (stock.transactions ?? [])
      .filter(t => t.date && (t.action === 'buy' || t.action === 'sell'))
      .map(t => ({ ...t, _d: new Date(t.date) }))

    // Initial position (pre-transaction shares) treated as a buy one day before first txn
    if ((stock.initialShares ?? 0) > 0 && stock.initialAvgCost > 0) {
      const anchor = txns.length > 0
        ? new Date(txns.reduce((m, t) => t._d < m ? t._d : m, txns[0]._d).getTime() - 86400000)
        : null
      if (anchor) flows.push({ date: anchor, amount: -(stock.initialShares * stock.initialAvgCost) })
    }

    for (const t of txns) {
      const commission = t.commission ?? 0
      flows.push({
        date: t._d,
        amount: t.action === 'buy'
          ? -(t.price * t.shares + commission)
          :   t.price * t.shares - commission,
      })
    }
  }

  if (flows.length === 0) return null

  // Terminal value: current market value of remaining positions + cash
  const today = new Date()
  let terminal = portfolio.cash ?? 0
  for (const stock of portfolio.stocks ?? []) {
    if (stock.shares > 0) {
      const p = prices[stock.symbol.toUpperCase()]?.price ?? stock.avgCost
      terminal += p * stock.shares
    }
  }
  flows.push({ date: today, amount: terminal })

  const t0 = flows.reduce((m, cf) => cf.date < m ? cf.date : m, flows[0].date)
  const totalDays = (today - t0) / 86400000
  if (totalDays < 7) return null

  const normalized = flows.map(cf => ({ days: Math.max(0, (cf.date - t0) / 86400000), amount: cf.amount }))

  const r = solveIRR(normalized)
  const annualized = (Math.pow(1 + r, 365) - 1) * 100
  if (!isFinite(annualized) || Math.abs(annualized) > 9999) return null
  return annualized
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

// ── Per-portfolio performance metrics (calendar-consistent) ─────────────────
function calcPortfolioPerf(portfolio, histPrices, livePrices) {
  const todayStr   = new Date().toISOString().split('T')[0]
  const curYear    = new Date().getFullYear()
  const curMM      = String(new Date().getMonth() + 1).padStart(2, '0')
  const monthStart = `${curYear}-${curMM}-01`
  const ytdStart   = `${curYear}-01-01`
  const histLoaded = Object.keys(histPrices).length > 0
  const allP       = [portfolio]

  const stockUnrealizedNow = (portfolio.stocks ?? []).reduce((s, stk) => {
    if (stk.shares <= 0) return s
    const p = livePrices[stk.symbol.toUpperCase()]?.price
    return p != null ? s + (p - stk.avgCost) * stk.shares : s
  }, 0)

  // Portfolio value (stock market value + cash) at dateStr using Yahoo prices
  const valueAt = (dateStr) => {
    let v = 0, hasPrice = false
    for (const s of portfolio.stocks ?? []) {
      const price = histPrices[s.symbol.toUpperCase()]?.[dateStr]
      if (!price) continue
      const { shares } = positionAtDate(s, dateStr)
      if (shares > 0) { v += shares * price; hasPrice = true }
    }
    return hasPrice ? v + cashAtDate(portfolio, dateStr) : null
  }

  // Last portfolio value strictly before targetDate
  const lastBefore = (targetDate) => {
    for (let back = 1; back <= 10; back++) {
      const d = offsetDate(targetDate, -back)
      if (d > todayStr) continue
      const v = valueAt(d)
      if (v != null) return v
    }
    return null
  }

  // Realized P&L (stock + option) within [from, to]
  const realizedIn = (from, to) => {
    let s = 0
    for (const stk of portfolio.stocks ?? [])
      for (const t of stk.transactions ?? [])
        if (t.action === 'sell' && t.date >= from && t.date <= to && t.realizedPnL != null) s += t.realizedPnL
    for (const o of portfolio.options ?? [])
      if (o.status === 'closed' && o.closeDate >= from && o.closeDate <= to && o.realizedPnL != null) s += o.realizedPnL
    return s
  }

  // ── Today ──
  const todayStockPnL = histLoaded
    ? getStockDailyPnL(allP, histPrices, livePrices, todayStr, todayStr)
    : null
  const todayOptRealized = (portfolio.options ?? [])
    .filter(o => o.status === 'closed' && o.closeDate === todayStr && o.realizedPnL != null)
    .reduce((s, o) => s + o.realizedPnL, 0)
  // Fallback to Finnhub prev-close when hist not yet loaded
  const todayFallback = (portfolio.stocks ?? []).reduce((s, stk) => {
    const q = livePrices[stk.symbol.toUpperCase()]
    return q?.price != null && q?.previousClose != null
      ? s + (q.price - q.previousClose) * stk.shares : s
  }, 0)
  const todayPnL = (todayStockPnL ?? todayFallback) + todayOptRealized
  const todayBase = histLoaded ? lastBefore(todayStr) : null
  const todayPct  = todayBase ? (todayPnL / todayBase) * 100 : null

  // ── Monthly ──
  let startMonthUnr = 0
  if (histLoaded) {
    for (let back = 1; back <= 10; back++) {
      const d = offsetDate(monthStart, -back)
      if (d > todayStr) continue
      const val = getUnrealizedAtDate(allP, histPrices, d)
      if (val != null) { startMonthUnr = val; break }
    }
  }
  const monthPnL = histLoaded
    ? (stockUnrealizedNow - startMonthUnr) + realizedIn(monthStart, todayStr)
    : null
  const monthBase = histLoaded ? lastBefore(monthStart) : null
  const monthPct  = monthBase && monthPnL != null ? (monthPnL / monthBase) * 100 : null

  // ── YTD ──
  let startYtdUnr = 0
  if (histLoaded) {
    for (let back = 1; back <= 10; back++) {
      const d = offsetDate(ytdStart, -back)
      const val = getUnrealizedAtDate(allP, histPrices, d)
      if (val != null) { startYtdUnr = val; break }
    }
  }
  const ytdPnL = histLoaded
    ? (stockUnrealizedNow - startYtdUnr) + realizedIn(ytdStart, todayStr)
    : null
  const ytdBase = histLoaded ? lastBefore(ytdStart) : null
  const ytdPct  = ytdBase && ytdPnL != null ? (ytdPnL / ytdBase) * 100 : null

  return { todayPnL, todayPct, monthPnL, monthPct, ytdPnL, ytdPct }
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
  // Stock-only total (cost-basis denominator is stocks only, so this % is meaningful)
  const stockTotalPnL = stockUnrealizedPnL + stockRealizedPnL
  const stockTotalPct = costBasis > 0 ? (stockTotalPnL / costBasis) * 100 : 0
  // Option total P&L (no meaningful cost-basis %, show as amount only)
  const optionTotalPnL = optionUnrealizedPnL + optionRealizedPnL
  const todayPnL = enriched.reduce((s, r) => s + r.todayPnL, 0)
  const todayPct = totalStockValue > 0 ? (todayPnL / totalStockValue) * 100 : 0
  const holdingsCount = stocks.filter(s => s.shares > 0).length

  return {
    totalValue, totalStockValue, cash,
    stockUnrealizedPnL, optionUnrealizedPnL, unrealizedPnL, unrealizedPct,
    stockRealizedPnL, optionRealizedPnL, realizedPnL,
    totalPnL, totalPnLPct,
    stockTotalPnL, stockTotalPct, optionTotalPnL,
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

// ── Performance overview card ────────────────────────────────────────────────
function PerfCard({ label, pnl, pct, detail, loading }) {
  const pos = pct != null ? pct > 0 : pnl > 0
  const neg = pct != null ? pct < 0 : pnl < 0
  return (
    <div
      className={`rounded-2xl p-5 border flex flex-col ${
        pos ? 'bg-gradient-to-br from-emerald-50 to-white border-emerald-100'
            : neg ? 'bg-gradient-to-br from-red-50 to-white border-red-100'
            : 'bg-white border-claude-border'
      }`}
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
    >
      <p className="text-xs font-medium text-claude-muted mb-3">{label}</p>
      {loading ? (
        <div className="space-y-2 mt-1">
          <div className="w-24 h-8 bg-gray-100 rounded animate-pulse" />
          <div className="w-16 h-4 bg-gray-100 rounded animate-pulse" />
        </div>
      ) : (
        <div className="flex items-end justify-between">
          <div>
            <p className={`text-3xl font-bold leading-none tabular-nums ${
              pos ? 'text-emerald-600' : neg ? 'text-red-500' : 'text-claude-muted'
            }`}>
              {pct != null ? fmt.pctChange(pct) : '—'}
            </p>
            {pnl != null && (
              <p className={`text-sm font-mono mt-2 font-medium ${
                pos ? 'text-emerald-500' : neg ? 'text-red-400' : 'text-claude-muted'
              }`}>
                {fmt.pnl(pnl)}
              </p>
            )}
            {detail && <p className="text-[11px] text-claude-subtle mt-1.5">{detail}</p>}
          </div>
          {(pos || neg) && (
            <div className={`mb-1 opacity-20 ${pos ? 'text-emerald-600' : 'text-red-500'}`}>
              {pos ? <TrendingUp size={36} /> : <TrendingDown size={36} />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Portfolio card (grid item) ───────────────────────────────────────────────
function PortfolioCard({ portfolio, metrics, snapshots, perf, isActive, onSelect }) {
  const maxDrawdown = calcMaxDrawdown(snapshots)
  const pct = v => v != null ? fmt.pctChange(v) : '—'
  const cls = v => v == null ? 'text-claude-muted' : v > 0 ? 'text-profit' : v < 0 ? 'text-loss' : 'text-claude-muted'

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
          <p className="text-2xl font-bold text-claude-text">{fmt.currency(metrics.totalValue)}</p>
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

      {/* Performance metrics */}
      <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
        {/* Row 1: 今日 / 本月 / 年初至今 */}
        <div className="grid grid-cols-3 gap-x-3">
          <div>
            <p className="text-[10px] text-claude-muted mb-0.5">今日收益</p>
            <p className={`text-xs font-semibold font-mono ${cls(perf?.todayPct)}`}>
              {pct(perf?.todayPct)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-claude-muted mb-0.5">本月收益</p>
            <p className={`text-xs font-semibold font-mono ${cls(perf?.monthPct)}`}>
              {pct(perf?.monthPct)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-claude-muted mb-0.5">年初至今</p>
            <p className={`text-xs font-semibold font-mono ${cls(perf?.ytdPct)}`}>
              {pct(perf?.ytdPct)}
            </p>
          </div>
        </div>
        {/* Row 2: 股票收益% [期权收益$] 最大回撤 */}
        {metrics.optionTotalPnL !== 0 ? (
          <div className="grid grid-cols-3 gap-x-3">
            <div>
              <p className="text-[10px] text-claude-muted mb-0.5">股票收益</p>
              <p className={`text-xs font-semibold font-mono ${cls(metrics.stockTotalPct)}`}>
                {fmt.pctChange(metrics.stockTotalPct)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-claude-muted mb-0.5">期权收益</p>
              <p className={`text-xs font-semibold font-mono ${cls(metrics.optionTotalPnL)}`}>
                {fmt.pnl(metrics.optionTotalPnL)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-claude-muted mb-0.5">最大回撤</p>
              <p className={`text-xs font-semibold font-mono ${maxDrawdown == null || maxDrawdown === 0 ? 'text-claude-muted' : 'text-loss'}`}>
                {maxDrawdown != null ? (maxDrawdown > 0 ? `-${maxDrawdown.toFixed(1)}%` : '0.0%') : '—'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <p className="text-[10px] text-claude-muted mb-0.5">总收益</p>
              <p className={`text-xs font-semibold font-mono ${cls(metrics.stockTotalPct)}`}>
                {fmt.pctChange(metrics.stockTotalPct)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-claude-muted mb-0.5">最大回撤</p>
              <p className={`text-xs font-semibold font-mono ${maxDrawdown == null || maxDrawdown === 0 ? 'text-claude-muted' : 'text-loss'}`}>
                {maxDrawdown != null ? (maxDrawdown > 0 ? `-${maxDrawdown.toFixed(1)}%` : '0.0%') : '—'}
              </p>
            </div>
          </div>
        )}
      </div>
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
          <span className="font-medium text-claude-text">{fmt.currency(d?.totalValue)}</span>
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

  // Historical prices for asset-trend reconstruction
  const [histPrices, setHistPrices] = useState({})
  const [histLoading, setHistLoading] = useState(false)
  const fetchedSymbols = useRef(new Set())

  useEffect(() => {
    const symbols = []
    for (const p of state.portfolios.filter(p => !p.isAggregate)) {
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
  }, [state.portfolios])

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
      unrealizedPct:  agg.costBasis > 0 ? (agg.unrealizedPnL / agg.costBasis) * 100 : 0,
      totalPnLPct:    agg.costBasis > 0 ? (agg.totalPnL / agg.costBasis) * 100 : 0,
      stockTotalPnL:  agg.stockUnrealizedPnL + agg.stockRealizedPnL,
      stockTotalPct:  agg.costBasis > 0 ? ((agg.stockUnrealizedPnL + agg.stockRealizedPnL) / agg.costBasis) * 100 : 0,
      optionTotalPnL: agg.optionUnrealizedPnL + agg.optionRealizedPnL,
      todayPct:       agg.totalStockValue > 0 ? (agg.todayPnL / agg.totalStockValue) * 100 : 0,
    }
  }, [allMetrics])

  // Realized P&L indexed by date — mirrors Calendar's dailyData structure.
  const realizedMap = useMemo(() => {
    const map = {}
    for (const p of state.portfolios.filter(p => !p.isAggregate)) {
      for (const s of p.stocks ?? []) {
        for (const t of s.transactions ?? []) {
          if (t.action === 'sell' && t.date && t.realizedPnL != null) {
            if (!map[t.date]) map[t.date] = { total: 0, optionRealized: 0 }
            map[t.date].total += t.realizedPnL
          }
        }
      }
      for (const o of p.options ?? []) {
        if (o.status === 'closed' && o.closeDate && o.realizedPnL != null) {
          if (!map[o.closeDate]) map[o.closeDate] = { total: 0, optionRealized: 0 }
          map[o.closeDate].total += o.realizedPnL
          map[o.closeDate].optionRealized += o.realizedPnL
        }
      }
    }
    return map
  }, [state.portfolios])

  // Per-portfolio performance metrics keyed by portfolio.id
  const portfolioPerfs = useMemo(() => {
    const result = {}
    for (const { portfolio } of allMetrics) {
      result[portfolio.id] = calcPortfolioPerf(portfolio, histPrices, prices)
    }
    return result
  }, [allMetrics, histPrices, prices])

  // Reconstruct daily total asset value from transactions + Yahoo Finance hist prices.
  // Stock market value at date d = Σ(positionAtDate(stock, d).shares × price[d])
  // Cash at date d = current cash reversed through all transactions after d.
  const historicalAssetData = useMemo(() => {
    if (Object.keys(histPrices).length === 0) return null
    const allPortfolios = state.portfolios.filter(p => !p.isAggregate)
    const todayStr = new Date().toISOString().split('T')[0]
    // Only use Yahoo Finance data up to yesterday — today's data is incomplete
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Find earliest transaction date across all portfolios
    let earliest = null
    for (const p of allPortfolios) {
      for (const s of p.stocks ?? []) {
        for (const t of s.transactions ?? []) {
          if (t.date && (!earliest || t.date < earliest)) earliest = t.date
        }
      }
    }
    if (!earliest) return null

    // Collect every trading date from histPrices within range (exclude today)
    const allDates = new Set()
    for (const prices of Object.values(histPrices)) {
      for (const date of Object.keys(prices)) {
        if (date >= earliest && date <= yesterdayStr) allDates.add(date)
      }
    }
    if (allDates.size === 0) return null

    const sorted = [...allDates].sort()
    const result = []
    for (const dateStr of sorted) {
      let totalValue = 0
      for (const p of allPortfolios) {
        // Stock market value
        for (const s of p.stocks ?? []) {
          const sym = s.symbol.toUpperCase()
          const price = histPrices[sym]?.[dateStr]
          if (!price) continue
          const { shares } = positionAtDate(s, dateStr)
          if (shares > 0) totalValue += shares * price
        }
        // Cash (option premium cash flows already reversed inside cashAtDate)
        totalValue += cashAtDate(p, dateStr)
      }
      if (totalValue > 0) result.push({ date: dateStr, totalValue })
    }

    // Append today's data point using real-time Finnhub prices (same source as summary cards)
    let todayValue = 0
    let hasTodayPrice = false
    for (const p of allPortfolios) {
      for (const s of p.stocks ?? []) {
        const sym = s.symbol.toUpperCase()
        const rtPrice = prices[sym]?.price
        if (!rtPrice) continue
        const { shares } = positionAtDate(s, todayStr)
        if (shares > 0) { todayValue += shares * rtPrice; hasTodayPrice = true }
      }
      todayValue += cashAtDate(p, todayStr)
    }
    if (hasTodayPrice && todayValue > 0) result.push({ date: todayStr, totalValue: todayValue })

    return result.length >= 2 ? result : null
  }, [state.portfolios, histPrices, prices])

  // Performance cards — calendar-consistent (mark-to-market), same numbers as DailyPnLCalendar.
  const performanceMetrics = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0]
    const curYear  = new Date().getFullYear()
    const curMM    = String(new Date().getMonth() + 1).padStart(2, '0')
    const monthStart = `${curYear}-${curMM}-01`
    const ytdStart   = `${curYear}-01-01`
    const allPortfolios = state.portfolios.filter(p => !p.isAggregate)
    const histLoaded = Object.keys(histPrices).length > 0

    // Last historicalAssetData value strictly before targetDate → percentage denominator.
    const baseValue = (targetDate) =>
      historicalAssetData?.filter(d => d.date < targetDate).at(-1)?.totalValue ?? null

    // ── Today (mark-to-market, consistent with Calendar) ──
    const todayStockPnL = histLoaded
      ? getStockDailyPnL(allPortfolios, histPrices, prices, todayStr, todayStr)
      : null
    const todayOptRealized = realizedMap[todayStr]?.optionRealized ?? 0
    const todayPnL = (todayStockPnL ?? totals.todayPnL) + todayOptRealized
    const todayBase = baseValue(todayStr)
    const todayPct  = todayBase ? (todayPnL / todayBase) * 100 : totals.todayPct

    // ── Monthly: unrealized change + realized this month ──
    const stockUnrealizedNow = totals.stockUnrealizedPnL
    let startMonthUnrealized = 0
    if (histLoaded) {
      for (let back = 1; back <= 10; back++) {
        const d = offsetDate(monthStart, -back)
        if (d > todayStr) continue
        const val = getUnrealizedAtDate(allPortfolios, histPrices, d)
        if (val != null) { startMonthUnrealized = val; break }
      }
    }
    const monthUnrealizedChange = histLoaded ? stockUnrealizedNow - startMonthUnrealized : null
    const monthRealized = Object.entries(realizedMap)
      .filter(([d]) => d >= monthStart && d <= todayStr)
      .reduce((s, [, v]) => s + v.total, 0)
    const monthPnL = monthUnrealizedChange != null ? monthUnrealizedChange + monthRealized : null
    const monthBase = baseValue(monthStart)
    const monthPct  = monthBase && monthPnL != null ? (monthPnL / monthBase) * 100 : null

    // ── YTD: unrealized change + realized this year ──
    let startYtdUnrealized = 0
    if (histLoaded) {
      for (let back = 1; back <= 10; back++) {
        const d = offsetDate(ytdStart, -back)
        const val = getUnrealizedAtDate(allPortfolios, histPrices, d)
        if (val != null) { startYtdUnrealized = val; break }
      }
    }
    const ytdUnrealizedChange = histLoaded ? stockUnrealizedNow - startYtdUnrealized : null
    const ytdRealized = Object.entries(realizedMap)
      .filter(([d]) => d >= ytdStart && d <= todayStr)
      .reduce((s, [, v]) => s + v.total, 0)
    const ytdPnL = ytdUnrealizedChange != null ? ytdUnrealizedChange + ytdRealized : null
    const ytdBase = baseValue(ytdStart)
    const ytdPct  = ytdBase && ytdPnL != null ? (ytdPnL / ytdBase) * 100 : null

    return { todayPnL, todayPct, monthPnL, monthPct, ytdPnL, ytdPct }
  }, [state.portfolios, histPrices, prices, historicalAssetData, realizedMap,
      totals.todayPnL, totals.todayPct, totals.stockUnrealizedPnL])

  const snapshotData = useMemo(() => {
    // Prefer reconstructed historical data; fall back to dailySnapshots
    const baseData = historicalAssetData ?? (state.dailySnapshots ?? [])
    let cutoffStr = null
    if (timeRange === 'ytd') {
      cutoffStr = `${new Date().getFullYear()}-01-01`
    } else if (timeRange !== 'all') {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - parseInt(timeRange))
      cutoffStr = cutoff.toISOString().split('T')[0]
    }
    const filtered = cutoffStr ? baseData.filter(s => s.date >= cutoffStr) : baseData
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
  }, [historicalAssetData, state.dailySnapshots, timeRange])

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
    { emoji: '🌐', label: '跨组合总资产', value: fmt.currency(totals.totalValue), highlight: true },
    { emoji: '📈', label: '股票持仓总值', value: fmt.currency(totals.totalStockValue) },
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

      {/* ── Performance % overview (4 cards) ── */}
      <div className="grid grid-cols-4 gap-3">
        <PerfCard
          label="今日涨跌"
          pnl={performanceMetrics.todayPnL}
          pct={performanceMetrics.todayPct}
          detail="较昨日收盘"
          loading={histLoading && Object.keys(histPrices).length === 0}
        />
        <PerfCard
          label="本月涨跌"
          pnl={performanceMetrics.monthPnL}
          pct={performanceMetrics.monthPct}
          detail="自本月初"
          loading={histLoading && historicalAssetData == null}
        />
        <PerfCard
          label="年初至今"
          pnl={performanceMetrics.ytdPnL}
          pct={performanceMetrics.ytdPct}
          detail={`自 ${new Date().getFullYear()} 年 1 月 1 日`}
          loading={histLoading && historicalAssetData == null}
        />
        <PerfCard
          label="股票收益率"
          pnl={totals.stockTotalPnL}
          pct={totals.stockTotalPct}
          detail={totals.optionTotalPnL !== 0
            ? `期权收益 ${fmt.pnl(totals.optionTotalPnL)}`
            : `基于持仓成本 ${fmt.currency(totals.costBasis)}`}
        />
      </div>

      {/* ── Cross-portfolio metric cards ── */}
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
        {histLoading ? (
          <div className="h-40 flex items-center justify-center text-claude-muted text-sm animate-pulse">
            加载历史价格数据中…
          </div>
        ) : snapshotData.length < 2 ? (
          <div className="h-40 flex items-center justify-center text-claude-muted text-sm">
            暂无足够数据显示走势图
          </div>
        ) : (() => {
          const values = snapshotData.map(d => d.totalValue).filter(v => v > 0)
          const rawMin = Math.min(...values)
          const rawMax = Math.max(...values)
          const range = rawMax - rawMin || 1000
          // Step rounded up to nearest $1K; cap so we get ≤ 20 ticks
          const step = Math.max(1000, Math.ceil(range / 20 / 1000) * 1000)
          const domainMin = Math.floor(rawMin / step) * step
          const domainMax = Math.ceil(rawMax / step) * step
          const ticks = []
          for (let v = domainMin; v <= domainMax + step * 0.01; v += step) ticks.push(v)
          return (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={snapshotData}>
                <defs>
                  <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false} />
                <YAxis ticks={ticks} domain={[domainMin, domainMax]}
                  tick={{ fontSize: 11, fill: cc.axis }} axisLine={false} tickLine={false}
                  tickFormatter={yTickFmt} width={72} />
                <Tooltip content={<SnapshotTooltip />} />
                <Area type="monotone" dataKey="totalValue" stroke="#3b82f6" strokeWidth={2}
                  fill="url(#valueGrad)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          )
        })()}
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
              perf={portfolioPerfs[portfolio.id]}
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
