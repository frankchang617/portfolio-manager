// Standard normal CDF (Abramowitz & Stegun approximation)
function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const absx = Math.abs(x) / Math.SQRT2
  const t = 1.0 / (1.0 + p * absx)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absx * absx)
  return 0.5 * (1.0 + sign * y)
}

function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/**
 * Black-Scholes option pricing and Greeks
 * @param {number} S - Current stock price
 * @param {number} K - Strike price
 * @param {number} T - Time to expiry in years
 * @param {number} r - Risk-free rate (decimal, e.g. 0.05)
 * @param {number} sigma - Implied volatility (decimal, e.g. 0.30)
 * @param {'call'|'put'} type - Option type
 * @returns {{ price, delta, gamma, theta, vega, rho }}
 */
export function blackScholes(S, K, T, r, sigma, type) {
  if (T <= 0 || S <= 0 || K <= 0 || sigma <= 0) {
    const intrinsic = type === 'call'
      ? Math.max(0, S - K)
      : Math.max(0, K - S)
    return { price: intrinsic, delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0 }
  }

  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const nd1 = normalPDF(d1)
  const discountedK = K * Math.exp(-r * T)

  let price, delta, rho

  if (type === 'call') {
    price = S * normalCDF(d1) - discountedK * normalCDF(d2)
    delta = normalCDF(d1)
    rho = discountedK * T * normalCDF(d2) / 100
  } else {
    price = discountedK * normalCDF(-d2) - S * normalCDF(-d1)
    delta = normalCDF(d1) - 1
    rho = -discountedK * T * normalCDF(-d2) / 100
  }

  const gamma = nd1 / (S * sigma * sqrtT)
  // Theta per calendar day
  const theta = type === 'call'
    ? ((-S * nd1 * sigma / (2 * sqrtT)) - r * discountedK * normalCDF(d2)) / 365
    : ((-S * nd1 * sigma / (2 * sqrtT)) + r * discountedK * normalCDF(-d2)) / 365
  // Vega per 1% change in IV
  const vega = S * nd1 * sqrtT / 100

  return {
    price: Math.max(0, price),
    delta,
    gamma,
    theta,
    vega,
    rho,
  }
}

/**
 * Calculate days to expiry from expiration date string
 */
export function daysToExpiry(expirationDate) {
  const expiry = new Date(expirationDate)
  const now = new Date()
  const diffMs = expiry - now
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

/**
 * Determine moneyness
 */
export function getMoneyness(underlyingPrice, strike, type) {
  const diff = (underlyingPrice - strike) / strike
  if (Math.abs(diff) < 0.01) return 'ATM'
  if (type === 'call') return diff > 0 ? 'ITM' : 'OTM'
  return diff < 0 ? 'ITM' : 'OTM'
}

/**
 * Calculate all Greeks for an option position
 */
export function calculateOptionMetrics(option, underlyingPrice, riskFreeRate = 0.05) {
  const dte = daysToExpiry(option.expiration)
  const T = dte / 365
  const iv = option.impliedVolatility || 0.3
  const S = underlyingPrice || option.underlyingPrice || 0
  const K = option.strike
  const isLong = option.contracts > 0
  const absContracts = Math.abs(option.contracts)

  const greeks = blackScholes(S, K, T, riskFreeRate, iv, option.optionType)
  const sign = isLong ? 1 : -1

  // Market value (theoretical)
  const theoreticalPrice = greeks.price
  const marketValue = theoreticalPrice * absContracts * 100 * sign

  // Cost basis
  const costBasis = option.avgPremium * absContracts * 100

  // P&L
  const unrealizedPnL = isLong
    ? (theoreticalPrice - option.avgPremium) * absContracts * 100
    : (option.avgPremium - theoreticalPrice) * absContracts * 100

  return {
    dte,
    theoreticalPrice,
    marketValue,
    costBasis,
    unrealizedPnL,
    unrealizedPnLPct: costBasis !== 0 ? (unrealizedPnL / costBasis) * 100 : 0,
    delta: greeks.delta * sign,
    gamma: greeks.gamma * (isLong ? 1 : -1),
    theta: greeks.theta * sign * absContracts * 100,
    vega: greeks.vega * sign * absContracts * 100,
    moneyness: getMoneyness(S, K, option.optionType),
    totalDelta: greeks.delta * sign * absContracts * 100,
  }
}
