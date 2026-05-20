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

/**
 * Extract all unique underlying symbols from a portfolio
 */
export function getPortfolioSymbols(portfolio) {
  const symbols = new Set()
  portfolio.stocks.forEach(s => symbols.add(s.symbol.toUpperCase()))
  portfolio.options.forEach(o => symbols.add(o.symbol.toUpperCase()))
  return [...symbols]
}
