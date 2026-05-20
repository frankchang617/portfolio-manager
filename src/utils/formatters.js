export const fmt = {
  currency: (val, digits = 2) => {
    if (val == null || isNaN(val)) return '—'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(val)
  },

  pct: (val, digits = 2) => {
    if (val == null || isNaN(val)) return '—'
    const sign = val > 0 ? '+' : ''
    return `${sign}${val.toFixed(digits)}%`
  },

  pctChange: (val) => {
    if (val == null || isNaN(val)) return '—'
    const sign = val > 0 ? '+' : ''
    return `${sign}${val.toFixed(2)}%`
  },

  pnl: (val) => {
    if (val == null || isNaN(val)) return '—'
    const sign = val > 0 ? '+' : ''
    return `${sign}${new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val)}`
  },

  number: (val, digits = 2) => {
    if (val == null || isNaN(val)) return '—'
    return val.toFixed(digits)
  },

  shares: (val) => {
    if (val == null || isNaN(val)) return '—'
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(val)
  },

  date: (str) => {
    if (!str) return '—'
    const d = new Date(str)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  },

  shortDate: (str) => {
    if (!str) return '—'
    const d = new Date(str + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  },

  greek: (val, digits = 4) => {
    if (val == null || isNaN(val)) return '—'
    return val.toFixed(digits)
  },

  large: (val) => {
    if (val == null || isNaN(val)) return '—'
    if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`
    if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
    if (Math.abs(val) >= 1e3) return `$${(val / 1e3).toFixed(2)}K`
    return fmt.currency(val)
  },
}

export function getPnLClass(val) {
  if (val == null || val === 0) return 'text-claude-muted'
  return val > 0 ? 'profit-text' : 'loss-text'
}

export function getPnLSign(val) {
  if (val > 0) return '+'
  return ''
}
