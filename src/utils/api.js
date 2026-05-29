const API_KEY = import.meta.env.VITE_FINNHUB_KEY
const BASE = 'https://finnhub.io/api/v1'

/**
 * Fetch a single quote from Finnhub
 * Returns { symbol, name, price, change, changePercent, previousClose, open }
 */
async function fetchSingleQuote(symbol) {
  const url = `${BASE}/quote?symbol=${symbol}&token=${API_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`)
  const d = await res.json()
  // Finnhub returns { c: current, d: change, dp: changePercent, h, l, o: open, pc: previousClose }
  if (!d.c) return null
  return {
    symbol,
    name: symbol,
    price: d.c,
    change: d.d ?? 0,
    changePercent: d.dp ?? 0,
    previousClose: d.pc ?? d.c,
    open: d.o ?? d.c,
  }
}

/**
 * Fetch quotes for all symbols in parallel
 * @param {string[]} symbols
 * @returns {Promise<Record<string, QuoteData>>}
 */
export async function fetchQuotes(symbols) {
  if (!symbols || symbols.length === 0) return {}
  if (!API_KEY) throw new Error('未配置 Finnhub API Key（VITE_FINNHUB_KEY）')

  const unique = [...new Set(symbols.map(s => s.toUpperCase()))]

  const results = await Promise.allSettled(unique.map(fetchSingleQuote))

  const quotes = {}
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      quotes[unique[i]] = r.value
    }
  })
  return quotes
}

/**
 * Fetch company profile (name, logo) for a single symbol
 * Returns { name } or null if not found
 */
export async function fetchCompanyProfile(symbol) {
  if (!API_KEY) return null
  const res = await fetch(`${BASE}/stock/profile2?symbol=${symbol}&token=${API_KEY}`)
  if (!res.ok) return null
  const d = await res.json()
  if (!d.name) return null
  return { name: d.name }
}

// ── Historical daily closes (Yahoo Finance, free, no key needed) ─────────────
// Symbol formats: US='AAPL', HK='0700.HK', SG='D05.SI', TW='2330.TW'
// Cache key v1 — bump to 'yf_hist_v2' if data schema changes
const YF_CACHE_KEY = 'yf_hist_v1'
const YF_CACHE_TTL = 24 * 60 * 60 * 1000  // 24 h

function _yfCacheRead() {
  try { return JSON.parse(localStorage.getItem(YF_CACHE_KEY) || '{}') } catch { return {} }
}
function _yfCacheWrite(cache) {
  try { localStorage.setItem(YF_CACHE_KEY, JSON.stringify(cache)) } catch {}
}

/**
 * Fetch daily closing prices from Yahoo Finance via a CORS proxy.
 * Returns { [dateStr: 'YYYY-MM-DD']: closePrice } for the requested range.
 * Results are cached in localStorage for 24 h per symbol+range pair.
 *
 * @param {string} symbol  Yahoo Finance ticker (e.g. 'AAPL', '0700.HK', 'D05.SI')
 * @param {string} range   Yahoo Finance range string: '1y' | '2y' | '5y' | 'max'
 */
export async function fetchHistoricalPrices(symbol, range = '5y') {
  const cache = _yfCacheRead()
  const key = `${symbol}_${range}`
  if (cache[key] && Date.now() - cache[key].ts < YF_CACHE_TTL) return cache[key].data

  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(yfUrl)}`

  const res = await fetch(proxyUrl)
  if (!res.ok) throw new Error(`fetchHistoricalPrices ${symbol}: HTTP ${res.status}`)
  const json = await res.json()

  const result = json.chart?.result?.[0]
  if (!result) throw new Error(`fetchHistoricalPrices ${symbol}: no data returned`)

  const timestamps = result.timestamp ?? []
  const closes = result.indicators?.quote?.[0]?.close ?? []
  const data = {}
  timestamps.forEach((ts, i) => {
    if (closes[i] != null) {
      data[new Date(ts * 1000).toISOString().split('T')[0]] = closes[i]
    }
  })

  cache[key] = { ts: Date.now(), data }
  _yfCacheWrite(cache)
  return data
}

/**
 * Extract all unique underlying symbols from a portfolio
 */
export function getPortfolioSymbols(portfolio) {
  const symbols = new Set()
  portfolio.stocks.forEach(s => symbols.add(s.symbol.toUpperCase()))
  portfolio.options.forEach(o => symbols.add(o.symbol.toUpperCase()))
  return [...symbols]
}
