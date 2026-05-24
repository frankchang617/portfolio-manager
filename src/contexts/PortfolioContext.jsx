import { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react'
import { fetchQuotes, getPortfolioSymbols } from '../utils/api'
import { cloudLoad, cloudSave } from '../lib/supabase'

const STORAGE_KEY = 'portfolio_manager_v3'

function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// Replay transactions and annotate each sell with its realized P&L
function computeTxnPnL(initialShares, initialAvgCost, transactions) {
  let shares = initialShares
  let totalCost = initialShares * initialAvgCost
  return transactions.map(t => {
    const commission = t.commission ?? 0
    if (t.action === 'buy') {
      totalCost += t.price * t.shares + commission
      shares += t.shares
      return t
    } else {
      const avgNow = shares > 0 ? totalCost / shares : 0
      const realizedPnL = (t.price - avgNow) * t.shares - commission
      totalCost -= avgNow * t.shares
      shares -= t.shares
      if (shares <= 0) { shares = 0; totalCost = 0 }
      return { ...t, realizedPnL }
    }
  })
}

// Calculate weighted-average position from a transaction list
// starts from (initialShares, initialAvgCost) and replays all txns
function calcPosition(initialShares, initialAvgCost, transactions) {
  let shares = initialShares
  let totalCost = initialShares * initialAvgCost
  let realizedPnL = 0

  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date))
  for (const t of sorted) {
    const commission = t.commission ?? 0
    if (t.action === 'buy') {
      totalCost += t.price * t.shares + commission
      shares += t.shares
    } else {
      const avgNow = shares > 0 ? totalCost / shares : 0
      realizedPnL += (t.price - avgNow) * t.shares - commission
      totalCost -= avgNow * t.shares
      shares -= t.shares
      if (shares <= 0) { shares = 0; totalCost = 0 }
    }
  }

  return {
    shares: Math.max(0, shares),
    avgCost: shares > 0 ? totalCost / shares : (initialAvgCost || 0),
    realizedPnL,
  }
}

const sampleStocks = [
  { id: generateId(), symbol: 'AAPL', name: 'Apple Inc.', shares: 100, avgCost: 150.00, note: '', transactions: [], initialShares: 100, initialAvgCost: 150.00, stockRealizedPnL: 0 },
  { id: generateId(), symbol: 'MSFT', name: 'Microsoft Corp.', shares: 50, avgCost: 380.00, note: '', transactions: [], initialShares: 50, initialAvgCost: 380.00, stockRealizedPnL: 0 },
  { id: generateId(), symbol: 'NVDA', name: 'NVIDIA Corp.', shares: 20, avgCost: 500.00, note: '', transactions: [], initialShares: 20, initialAvgCost: 500.00, stockRealizedPnL: 0 },
  { id: generateId(), symbol: 'TSLA', name: 'Tesla Inc.', shares: 30, avgCost: 220.00, note: '', transactions: [], initialShares: 30, initialAvgCost: 220.00, stockRealizedPnL: 0 },
]

const samplePortfolio = {
  id: 'portfolio-1',
  name: '总投资组合',
  isAggregate: true,
  createdAt: new Date().toISOString(),
  cash: 0,
  stocks: [],
  options: [],
  transactions: [],
  realizedPnL: 0,
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch (_) {}
  return null
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      portfolios: state.portfolios,
      activePortfolioId: state.activePortfolioId,
      settings: state.settings,
      dailySnapshots: state.dailySnapshots,
      portfolioSnapshots: state.portfolioSnapshots,
    }))
  } catch (_) {}
}

const initialState = {
  portfolios: [samplePortfolio],
  activePortfolioId: 'portfolio-1',
  prices: {},
  lastUpdated: null,
  isLoading: false,
  error: null,
  dailySnapshots: [],
  portfolioSnapshots: {},
  settings: {
    riskFreeRate: 0.05,
    autoRefresh: true,
    refreshInterval: 60,
  },
}

function loadInitialState() {
  const saved = loadState()
  if (saved) {
    const portfolios = (saved.portfolios ?? []).map(p => {
      if (p.name === '总投资组合') return { ...p, isAggregate: true, stocks: [], cash: 0 }
      // Migrate closed options: subtract commission into stored realizedPnL so display layer no longer needs to
      const options = (p.options ?? []).map(o => {
        if (o.status === 'closed' && !o.commissionApplied) {
          return { ...o, realizedPnL: (o.realizedPnL ?? 0) - (o.commission ?? 0), commissionApplied: true }
        }
        return o
      })
      // Migrate sell transactions that are missing per-transaction realizedPnL
      const stocks = (p.stocks ?? []).map(stock => {
        const txns = stock.transactions ?? []
        if (!txns.some(t => t.action === 'sell' && t.realizedPnL === undefined)) return stock
        const sorted = [...txns].sort((a, b) => new Date(a.date) - new Date(b.date))
        const migrated = computeTxnPnL(stock.initialShares ?? 0, stock.initialAvgCost ?? 0, sorted)
        const pos = calcPosition(stock.initialShares ?? 0, stock.initialAvgCost ?? 0, migrated)
        return { ...stock, transactions: migrated, shares: pos.shares, avgCost: pos.avgCost, stockRealizedPnL: pos.realizedPnL }
      })
      return { ...p, options, stocks, strategies: p.strategies ?? [] }
    })
    return { ...initialState, ...saved, portfolios, dailySnapshots: saved.dailySnapshots ?? [], portfolioSnapshots: saved.portfolioSnapshots ?? {}, prices: {}, isLoading: false, error: null }
  }
  return initialState
}

function reducer(state, action) {
  switch (action.type) {

    case 'CREATE_PORTFOLIO': {
      const portfolio = {
        id: generateId(), name: action.name, createdAt: new Date().toISOString(),
        cash: 0, stocks: [], options: [], transactions: [], realizedPnL: 0,
      }
      return { ...state, portfolios: [...state.portfolios, portfolio], activePortfolioId: portfolio.id }
    }

    case 'UPDATE_PORTFOLIO':
      return { ...state, portfolios: state.portfolios.map(p => p.id === action.id ? { ...p, ...action.updates } : p) }

    case 'DELETE_PORTFOLIO': {
      const remaining = state.portfolios.filter(p => p.id !== action.id)
      return { ...state, portfolios: remaining, activePortfolioId: remaining[remaining.length - 1]?.id ?? null }
    }

    case 'SELECT_PORTFOLIO':
      return { ...state, activePortfolioId: action.id }

    // ── Stocks ──────────────────────────────────────────────────────────────

    case 'ADD_STOCK': {
      const stock = {
        id: generateId(), transactions: [], initialShares: 0, initialAvgCost: 0, stockRealizedPnL: 0,
        ...action.stock,
      }
      return { ...state, portfolios: state.portfolios.map(p =>
        p.id === action.portfolioId ? { ...p, stocks: [...p.stocks, stock] } : p
      )}
    }

    case 'UPDATE_STOCK':
      return { ...state, portfolios: state.portfolios.map(p =>
        p.id === action.portfolioId
          ? { ...p, stocks: p.stocks.map(s => s.id === action.stockId ? { ...s, ...action.updates } : s) }
          : p
      )}

    case 'DELETE_STOCK':
      return { ...state, portfolios: state.portfolios.map(p =>
        p.id === action.portfolioId ? { ...p, stocks: p.stocks.filter(s => s.id !== action.stockId) } : p
      )}

    // ── Stock Transactions ───────────────────────────────────────────────────

    case 'ADD_STOCK_TRANSACTION': {
      const { portfolioId, stockId, transaction } = action

      return { ...state, portfolios: state.portfolios.map(p => {
        if (p.id !== portfolioId) return p
        const stock = p.stocks.find(s => s.id === stockId)
        if (!stock) return p

        // For sell transactions, store per-transaction realized P&L
        // stock.avgCost is the weighted-avg cost before this transaction
        let txn = { id: generateId(), ...transaction }
        if (txn.action === 'sell' && stock.shares > 0) {
          txn = { ...txn, realizedPnL: (txn.price - stock.avgCost) * txn.shares - (txn.commission ?? 0) }
        }

        const stocks = p.stocks.map(s => {
          if (s.id !== stockId) return s
          const transactions = [...(s.transactions || []), txn]
          const pos = calcPosition(s.initialShares ?? s.shares, s.initialAvgCost ?? s.avgCost, transactions)
          return { ...s, transactions, shares: pos.shares, avgCost: pos.avgCost, stockRealizedPnL: pos.realizedPnL }
        })
        const oldPosRpnl = stock.stockRealizedPnL ?? 0
        const newPos = calcPosition(stock.initialShares ?? stock.shares, stock.initialAvgCost ?? stock.avgCost, [...(stock.transactions || []), txn])
        const rpnlDiff = newPos.realizedPnL - oldPosRpnl
        return { ...p, stocks, realizedPnL: (p.realizedPnL || 0) + rpnlDiff }
      })}
    }

    case 'DELETE_STOCK_TRANSACTION': {
      const { portfolioId, stockId, transactionId } = action
      return { ...state, portfolios: state.portfolios.map(p => {
        if (p.id !== portfolioId) return p
        const stocks = p.stocks.map(s => {
          if (s.id !== stockId) return s
          const transactions = (s.transactions || []).filter(t => t.id !== transactionId)
          const pos = calcPosition(s.initialShares ?? 0, s.initialAvgCost ?? 0, transactions)
          return { ...s, transactions, shares: pos.shares, avgCost: pos.avgCost, stockRealizedPnL: pos.realizedPnL }
        })
        // Recalculate portfolio realized P&L from all stocks
        const portfolioRpnl = stocks.reduce((sum, s) => sum + (s.stockRealizedPnL || 0), 0)
        return { ...p, stocks, realizedPnL: portfolioRpnl }
      })}
    }

    case 'UPDATE_STOCK_TRANSACTION': {
      const { portfolioId, stockId, transactionId, updates } = action
      return { ...state, portfolios: state.portfolios.map(p => {
        if (p.id !== portfolioId) return p
        const stocks = p.stocks.map(s => {
          if (s.id !== stockId) return s
          const transactions = (s.transactions || []).map(t =>
            t.id !== transactionId ? t : { ...t, ...updates }
          )
          const pos = calcPosition(s.initialShares ?? 0, s.initialAvgCost ?? 0, transactions)
          return { ...s, transactions, shares: pos.shares, avgCost: pos.avgCost, stockRealizedPnL: pos.realizedPnL }
        })
        const portfolioRpnl = stocks.reduce((sum, s) => sum + (s.stockRealizedPnL || 0), 0)
        return { ...p, stocks, realizedPnL: portfolioRpnl }
      })}
    }

    case 'CLEAR_STOCK_TRANSACTIONS': {
      const { portfolioId, stockId } = action
      return { ...state, portfolios: state.portfolios.map(p => {
        if (p.id !== portfolioId) return p
        const stocks = p.stocks.map(s => {
          if (s.id !== stockId) return s
          // Reset to initial values
          return { ...s, transactions: [], shares: s.initialShares ?? 0, avgCost: s.initialAvgCost ?? 0, stockRealizedPnL: 0 }
        })
        const portfolioRpnl = stocks.reduce((sum, s) => sum + (s.stockRealizedPnL || 0), 0)
        return { ...p, stocks, realizedPnL: portfolioRpnl }
      })}
    }

    // ── Cash ────────────────────────────────────────────────────────────────

    case 'UPDATE_CASH':
      return { ...state, portfolios: state.portfolios.map(p =>
        p.id === action.portfolioId ? { ...p, cash: action.cash } : p
      )}

    // ── Options ─────────────────────────────────────────────────────────────

    case 'ADD_OPTION': {
      const option = { id: generateId(), ...action.option }
      return { ...state, portfolios: state.portfolios.map(p =>
        p.id === action.portfolioId ? { ...p, options: [...p.options, option] } : p
      )}
    }

    case 'UPDATE_OPTION':
      return { ...state, portfolios: state.portfolios.map(p =>
        p.id === action.portfolioId
          ? { ...p, options: p.options.map(o => o.id === action.optionId ? { ...o, ...action.updates } : o) }
          : p
      )}

    case 'DELETE_OPTION':
      return { ...state, portfolios: state.portfolios.map(p =>
        p.id === action.portfolioId ? { ...p, options: p.options.filter(o => o.id !== action.optionId) } : p
      )}

    // Mark option as closed (keep in list for history)
    case 'CLOSE_OPTIONS_POSITION': {
      const { portfolioId, optionId, closePrice, closeDate, closeCommission } = action
      const portfolio = state.portfolios.find(p => p.id === portfolioId)
      const option = portfolio?.options.find(o => o.id === optionId)
      if (!option) return state
      const contracts = Math.abs(option.contracts ?? 1)
      const direction = option.direction || (option.contracts > 0 ? 'buy' : 'sell')
      const premium = option.avgPremium ?? option.premium ?? 0
      const grossPnL = direction === 'buy'
        ? (closePrice - premium) * contracts * 100
        : (premium - closePrice) * contracts * 100
      const realizedPnL = grossPnL - (option.commission ?? 0) - (closeCommission ?? 0)
      const options = portfolio.options.map(o =>
        o.id === optionId
          ? { ...o, status: 'closed', closePrice, closeDate: closeDate || new Date().toISOString().split('T')[0], realizedPnL, closeCommission: closeCommission ?? 0, commissionApplied: true }
          : o
      )
      const totalOptionsRealizedPnL = options.reduce((s, o) => s + (o.realizedPnL ?? 0), 0)
      return { ...state, portfolios: state.portfolios.map(p =>
        p.id === portfolioId ? { ...p, options, realizedPnL: totalOptionsRealizedPnL } : p
      )}
    }

    // Legacy: remove option from list
    case 'CLOSE_OPTION': {
      const { portfolioId, optionId, closePrice, closeDate } = action
      const portfolio = state.portfolios.find(p => p.id === portfolioId)
      const option = portfolio?.options.find(o => o.id === optionId)
      if (!option) return state
      const absContracts = Math.abs(option.contracts)
      const isLong = option.contracts > 0
      const proceeds = closePrice * absContracts * 100
      const costBasis = option.avgPremium * absContracts * 100
      const realizedPnL = isLong ? proceeds - costBasis : costBasis - proceeds
      return { ...state, portfolios: state.portfolios.map(p =>
        p.id === portfolioId
          ? { ...p, options: p.options.filter(o => o.id !== optionId), realizedPnL: (p.realizedPnL || 0) + realizedPnL }
          : p
      )}
    }

    // ── Prices / Settings ────────────────────────────────────────────────────

    case 'RECORD_DAILY_SNAPSHOT': {
      const today = new Date().toISOString().split('T')[0]
      if ((state.dailySnapshots ?? []).some(s => s.date === today)) return state

      const subPortfolios = state.portfolios.filter(p => !p.isAggregate)
      let totalValue = 0, unrealizedPnL = 0, realizedPnL = 0, todayPnL = 0
      const newPortfolioSnapshots = { ...(state.portfolioSnapshots ?? {}) }

      for (const p of subPortfolios) {
        let pValue = p.cash ?? 0
        let pUnrealized = 0
        let pRealized = 0

        totalValue += p.cash ?? 0
        for (const s of p.stocks) {
          const q = state.prices[s.symbol.toUpperCase()]
          const price = q?.price ?? null
          const prevClose = q?.previousClose ?? null
          const mv = price != null ? price * s.shares : s.avgCost * s.shares
          totalValue += mv
          pValue += mv
          if (price != null) {
            unrealizedPnL += (price - s.avgCost) * s.shares
            pUnrealized += (price - s.avgCost) * s.shares
          }
          if (price != null && prevClose != null) todayPnL += (price - prevClose) * s.shares
          realizedPnL += s.stockRealizedPnL ?? 0
          pRealized += s.stockRealizedPnL ?? 0
        }
        for (const o of (p.options ?? [])) {
          if (o.status === 'closed') {
            realizedPnL += o.realizedPnL ?? 0
            pRealized += o.realizedPnL ?? 0
          }
        }

        const pSnap = {
          date: today,
          totalValue: +pValue.toFixed(2),
          totalPnL: +(pUnrealized + pRealized).toFixed(2),
        }
        const existing = newPortfolioSnapshots[p.id] ?? []
        newPortfolioSnapshots[p.id] = [...existing.filter(s => s.date !== today), pSnap]
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-365)
      }

      const snapshot = {
        date: today,
        totalValue: +totalValue.toFixed(2),
        unrealizedPnL: +unrealizedPnL.toFixed(2),
        realizedPnL: +realizedPnL.toFixed(2),
        totalPnL: +(unrealizedPnL + realizedPnL).toFixed(2),
        todayPnL: +todayPnL.toFixed(2),
      }

      const snapshots = [...(state.dailySnapshots ?? []), snapshot]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-365)

      return { ...state, dailySnapshots: snapshots, portfolioSnapshots: newPortfolioSnapshots }
    }

    case 'SET_PRICES':
      return { ...state, prices: { ...state.prices, ...action.prices }, lastUpdated: new Date(), isLoading: false, error: null }

    case 'SET_LOADING':
      return { ...state, isLoading: action.value }

    case 'SET_ERROR':
      return { ...state, error: action.message, isLoading: false }

    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } }

    // ── Bulk Import ──────────────────────────────────────────────────────────

    // ── Strategy ─────────────────────────────────────────────────────────────

    case 'ADD_STRATEGY': {
      const { portfolioId, strategy } = action
      // strategy: { id, name, type, legs: [optionData] }
      const newOptions = strategy.legs.map(leg => ({
        id: generateId(),
        strategyId: strategy.id,
        strategyType: strategy.type,
        status: 'open',
        ...leg,
      }))
      return { ...state, portfolios: state.portfolios.map(p => {
        if (p.id !== portfolioId) return p
        const strategies = [...(p.strategies ?? []), {
          id: strategy.id, name: strategy.name, type: strategy.type,
          createdAt: new Date().toISOString(),
        }]
        return { ...p, options: [...(p.options ?? []), ...newOptions], strategies }
      })}
    }

    case 'DELETE_STRATEGY': {
      const { portfolioId, strategyId } = action
      return { ...state, portfolios: state.portfolios.map(p => {
        if (p.id !== portfolioId) return p
        const options = (p.options ?? []).filter(o => o.strategyId !== strategyId)
        const optionRpnl = options.filter(o => o.status === 'closed').reduce((s, o) => s + (o.realizedPnL ?? 0), 0)
        const stockRpnl = (p.stocks ?? []).reduce((s, stk) => s + (stk.stockRealizedPnL ?? 0), 0)
        return {
          ...p,
          options,
          strategies: (p.strategies ?? []).filter(s => s.id !== strategyId),
          realizedPnL: stockRpnl + optionRpnl,
        }
      })}
    }

    // ── Bulk Import ──────────────────────────────────────────────────────────

    case 'BULK_IMPORT_STOCKS': {
      const { portfolioId, imports } = action
      return { ...state, portfolios: state.portfolios.map(p => {
        if (p.id !== portfolioId) return p
        let stocks = [...p.stocks]

        for (const imp of imports) {
          const sym = imp.symbol.toUpperCase()
          const existingIdx = stocks.findIndex(s => s.symbol.toUpperCase() === sym)
          const newTxns = [...imp.transactions]
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(t => ({ id: generateId(), ...t }))

          if (existingIdx === -1) {
            const processedTxns = computeTxnPnL(0, 0, newTxns)
            const pos = calcPosition(0, 0, processedTxns)
            stocks = [...stocks, {
              id: generateId(), symbol: sym, name: imp.name || sym,
              shares: pos.shares, avgCost: pos.avgCost, note: '',
              initialShares: 0, initialAvgCost: 0,
              stockRealizedPnL: pos.realizedPnL, transactions: processedTxns,
            }]
          } else {
            const existing = stocks[existingIdx]
            const allTxns = [...(existing.transactions ?? []), ...newTxns]
              .sort((a, b) => new Date(a.date) - new Date(b.date))
            const processedTxns = computeTxnPnL(existing.initialShares ?? 0, existing.initialAvgCost ?? 0, allTxns)
            const pos = calcPosition(existing.initialShares ?? 0, existing.initialAvgCost ?? 0, processedTxns)
            stocks = stocks.map((s, i) => i === existingIdx
              ? { ...s, transactions: processedTxns, shares: pos.shares, avgCost: pos.avgCost, stockRealizedPnL: pos.realizedPnL }
              : s
            )
          }
        }

        const portfolioRpnl = stocks.reduce((sum, s) => sum + (s.stockRealizedPnL ?? 0), 0)
          + (p.options ?? []).filter(o => o.status === 'closed').reduce((sum, o) => sum + (o.realizedPnL ?? 0), 0)
        return { ...p, stocks, realizedPnL: portfolioRpnl }
      })}
    }

    case 'BULK_IMPORT_OPTIONS': {
      const { portfolioId, options } = action
      return { ...state, portfolios: state.portfolios.map(p => {
        if (p.id !== portfolioId) return p

        const newOptions = options.map(o => {
          const contracts = Math.abs(o.contracts)
          const base = {
            id: generateId(), symbol: o.symbol, optionType: o.optionType,
            strike: o.strike, expiration: o.expiration, direction: o.direction,
            contracts, avgPremium: o.avgPremium, commission: o.commission ?? 0,
            tradeDate: o.tradeDate, status: o.status ?? 'open',
          }
          if (o.status === 'closed' && o.closeDate != null) {
            const grossPnL = o.direction === 'buy'
              ? (o.closePrice - o.avgPremium) * contracts * 100
              : (o.avgPremium - o.closePrice) * contracts * 100
            return { ...base, closeDate: o.closeDate, closePrice: o.closePrice,
              realizedPnL: grossPnL - (o.commission ?? 0), commissionApplied: true }
          }
          return base
        })

        const allOptions = [...(p.options ?? []), ...newOptions]
        const optionRpnl = allOptions.filter(o => o.status === 'closed').reduce((s, o) => s + (o.realizedPnL ?? 0), 0)
        const stockRpnl = (p.stocks ?? []).reduce((s, stk) => s + (stk.stockRealizedPnL ?? 0), 0)
        return { ...p, options: allOptions, realizedPnL: stockRpnl + optionRpnl }
      })}
    }

    case 'HYDRATE': {
      const saved = action.payload
      if (!saved?.portfolios?.length) return state
      const portfolios = (saved.portfolios ?? []).map(p => {
        if (p.name === '总投资组合') return { ...p, isAggregate: true, stocks: [], cash: 0 }
        const options = (p.options ?? []).map(o => {
          if (o.status === 'closed' && !o.commissionApplied) {
            return { ...o, realizedPnL: (o.realizedPnL ?? 0) - (o.commission ?? 0), commissionApplied: true }
          }
          return o
        })
        const stocks = (p.stocks ?? []).map(stock => {
          const txns = stock.transactions ?? []
          if (!txns.some(t => t.action === 'sell' && t.realizedPnL === undefined)) return stock
          const sorted = [...txns].sort((a, b) => new Date(a.date) - new Date(b.date))
          const migrated = computeTxnPnL(stock.initialShares ?? 0, stock.initialAvgCost ?? 0, sorted)
          const pos = calcPosition(stock.initialShares ?? 0, stock.initialAvgCost ?? 0, migrated)
          return { ...stock, transactions: migrated, shares: pos.shares, avgCost: pos.avgCost, stockRealizedPnL: pos.realizedPnL }
        })
        return { ...p, options, stocks, strategies: p.strategies ?? [] }
      })
      return {
        ...state,
        ...saved,
        portfolios,
        dailySnapshots: saved.dailySnapshots ?? [],
        portfolioSnapshots: saved.portfolioSnapshots ?? {},
        prices: {},
        isLoading: false,
        error: null,
      }
    }

    default:
      return state
  }
}

// "有效数据"：至少有一个非聚合子组合且包含股票或期权
function hasRealData(data) {
  if (!data?.portfolios?.length) return false
  return data.portfolios.some(p => !p.isAggregate && ((p.stocks?.length ?? 0) > 0 || (p.options?.length ?? 0) > 0))
}

const PortfolioContext = createContext(null)

export function PortfolioProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState)
  const refreshTimerRef = useRef(null)
  const syncTimerRef = useRef(null)
  // 云端加载完成前不写云端，避免初始空状态覆盖云端真实数据
  const cloudLoadDoneRef = useRef(false)
  // HYDRATE 后需要立即刷新价格（HYDRATE 会清空 prices: {}）
  const justHydratedRef = useRef(false)

  // 首次挂载：从云端加载数据；云端有真实数据则 HYDRATE，否则将本地真实数据上传
  useEffect(() => {
    cloudLoad().then(cloudData => {
      if (hasRealData(cloudData)) {
        justHydratedRef.current = true
        dispatch({ type: 'HYDRATE', payload: cloudData })
      } else {
        // 云端无真实数据，检查本地是否有真实数据
        const localData = loadState()
        if (hasRealData(localData)) {
          cloudSave(localData).catch(console.error)
        } else if (cloudData?.portfolios?.length) {
          // 云端和本地都没有真实数据，但云端有结构，仍然 HYDRATE 保持一致
          justHydratedRef.current = true
          dispatch({ type: 'HYDRATE', payload: cloudData })
        }
      }
    }).catch(console.error).finally(() => {
      cloudLoadDoneRef.current = true
    })
  }, [])

  // 状态变化：立即存 localStorage；云端加载完成后才延迟写云端
  useEffect(() => {
    saveState(state)
    if (!cloudLoadDoneRef.current) return
    clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      cloudSave({
        portfolios: state.portfolios,
        activePortfolioId: state.activePortfolioId,
        settings: state.settings,
        dailySnapshots: state.dailySnapshots,
        portfolioSnapshots: state.portfolioSnapshots,
      }).catch(console.error)
    }, 1500)
  }, [state.portfolios, state.activePortfolioId, state.settings, state.dailySnapshots, state.portfolioSnapshots])

  const activePortfolio = state.portfolios.find(p => p.id === state.activePortfolioId) || state.portfolios[0]

  const refreshPrices = useCallback(async () => {
    const subPortfolios = state.portfolios.filter(p => !p.isAggregate)
    if (subPortfolios.length === 0) return
    const allSymbols = new Set()
    subPortfolios.forEach(p => getPortfolioSymbols(p).forEach(s => allSymbols.add(s)))
    const symbols = [...allSymbols]
    if (symbols.length === 0) return
    dispatch({ type: 'SET_LOADING', value: true })
    try {
      const quotes = await fetchQuotes(symbols)
      dispatch({ type: 'SET_PRICES', prices: quotes })
      dispatch({ type: 'RECORD_DAILY_SNAPSHOT' })
    } catch (err) {
      dispatch({ type: 'SET_ERROR', message: err.message })
    }
  }, [state.portfolios])

  useEffect(() => { refreshPrices() }, [state.activePortfolioId])

  // HYDRATE 后 portfolios/refreshPrices 都会更新；此时立即刷新价格，
  // 避免用户等待 60 秒定时器才能看到最新数据
  useEffect(() => {
    if (justHydratedRef.current) {
      justHydratedRef.current = false
      refreshPrices()
    }
  }, [state.portfolios, refreshPrices])

  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    if (state.settings.autoRefresh) {
      refreshTimerRef.current = setInterval(refreshPrices, state.settings.refreshInterval * 1000)
    }
    return () => clearInterval(refreshTimerRef.current)
  }, [state.settings.autoRefresh, state.settings.refreshInterval, refreshPrices])

  return (
    <PortfolioContext.Provider value={{ state, dispatch, activePortfolio, refreshPrices }}>
      {children}
    </PortfolioContext.Provider>
  )
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext)
  if (!ctx) throw new Error('usePortfolio must be used within PortfolioProvider')
  return ctx
}
