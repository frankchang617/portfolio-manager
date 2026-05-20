import { useState, useCallback } from 'react'
import { X, ChevronLeft } from 'lucide-react'
import { usePortfolio } from '../../contexts/PortfolioContext'
import CalendarPicker from '../CalendarPicker'

// ── 策略配置 ──────────────────────────────────────────────────────────────────

export const STRATEGY_CONFIGS = {
  bull_call_spread: {
    name: 'Bull Call Spread', nameZh: '牛市看涨价差',
    desc: '适合温和看涨，限定收益与风险',
    color: '#3b82f6',
    sameExpiry: true,
    legs: [
      { label: '买入 Call', direction: 'buy',  optionType: 'call', hint: '低行权价' },
      { label: '卖出 Call', direction: 'sell', optionType: 'call', hint: '高行权价' },
    ],
  },
  bear_put_spread: {
    name: 'Bear Put Spread', nameZh: '熊市看跌价差',
    desc: '适合温和看跌，限定收益与风险',
    color: '#8b5cf6',
    sameExpiry: true,
    legs: [
      { label: '买入 Put', direction: 'buy',  optionType: 'put', hint: '高行权价' },
      { label: '卖出 Put', direction: 'sell', optionType: 'put', hint: '低行权价' },
    ],
  },
  bull_put_spread: {
    name: 'Bull Put Spread', nameZh: '牛市看跌价差（收取权利金）',
    desc: '卖出价差组合，看涨+收权利金',
    color: '#10b981',
    sameExpiry: true,
    legs: [
      { label: '卖出 Put', direction: 'sell', optionType: 'put', hint: '高行权价' },
      { label: '买入 Put', direction: 'buy',  optionType: 'put', hint: '低行权价' },
    ],
  },
  bear_call_spread: {
    name: 'Bear Call Spread', nameZh: '熊市看涨价差（收取权利金）',
    desc: '卖出价差组合，看跌+收权利金',
    color: '#f59e0b',
    sameExpiry: true,
    legs: [
      { label: '卖出 Call', direction: 'sell', optionType: 'call', hint: '低行权价' },
      { label: '买入 Call', direction: 'buy',  optionType: 'call', hint: '高行权价' },
    ],
  },
  iron_condor: {
    name: 'Iron Condor', nameZh: '铁秃鹰',
    desc: '中性策略，适合低波动率市场，4条腿',
    color: '#da7756',
    sameExpiry: true,
    legs: [
      { label: '买入 Put', direction: 'buy',  optionType: 'put',  hint: '最低行权价' },
      { label: '卖出 Put', direction: 'sell', optionType: 'put',  hint: '次低行权价' },
      { label: '卖出 Call', direction: 'sell', optionType: 'call', hint: '次高行权价' },
      { label: '买入 Call', direction: 'buy',  optionType: 'call', hint: '最高行权价' },
    ],
  },
  iron_butterfly: {
    name: 'Iron Butterfly', nameZh: '铁蝴蝶',
    desc: '中性策略，ATM卖出，收取最大权利金，4条腿',
    color: '#ec4899',
    sameExpiry: true,
    legs: [
      { label: '买入 Put（OTM）',  direction: 'buy',  optionType: 'put',  hint: '低行权价' },
      { label: '卖出 Put（ATM）',  direction: 'sell', optionType: 'put',  hint: 'ATM行权价' },
      { label: '卖出 Call（ATM）', direction: 'sell', optionType: 'call', hint: 'ATM行权价' },
      { label: '买入 Call（OTM）', direction: 'buy',  optionType: 'call', hint: '高行权价' },
    ],
  },
  straddle: {
    name: 'Straddle', nameZh: '跨式',
    desc: '买入同一行权价的Call和Put，押注大幅波动',
    color: '#06b6d4',
    sameExpiry: true,
    sameStrike: true,
    legs: [
      { label: '买入 Call', direction: 'buy', optionType: 'call', hint: 'ATM行权价' },
      { label: '买入 Put',  direction: 'buy', optionType: 'put',  hint: '相同行权价' },
    ],
  },
  strangle: {
    name: 'Strangle', nameZh: '宽跨式',
    desc: '买入OTM的Call和Put，成本低于Straddle',
    color: '#14b8a6',
    sameExpiry: true,
    legs: [
      { label: '买入 Call（OTM）', direction: 'buy', optionType: 'call', hint: '高行权价' },
      { label: '买入 Put（OTM）',  direction: 'buy', optionType: 'put',  hint: '低行权价' },
    ],
  },
  butterfly_spread: {
    name: 'Butterfly Spread', nameZh: '蝴蝶价差',
    desc: '押注标的在中间行权价附近，3条腿',
    color: '#6366f1',
    sameExpiry: true,
    legs: [
      { label: '买入 Call（低）',     direction: 'buy',  optionType: 'call', hint: '低行权价',    contractsMult: 1 },
      { label: '卖出 Call x2（中）',  direction: 'sell', optionType: 'call', hint: '中间行权价',  contractsMult: 2 },
      { label: '买入 Call（高）',     direction: 'buy',  optionType: 'call', hint: '高行权价',    contractsMult: 1 },
    ],
  },
  calendar_spread: {
    name: 'Calendar Spread', nameZh: '日历价差',
    desc: '相同行权价，不同到期日，利用时间价值差',
    color: '#84cc16',
    sameExpiry: false,
    legs: [
      { label: '卖出（近月）', direction: 'sell', optionType: null, hint: '相同行权价，近月到期' },
      { label: '买入（远月）', direction: 'buy',  optionType: null, hint: '相同行权价，远月到期' },
    ],
  },

  // ── 单腿策略 ────────────────────────────────────────────────────────────────
  long_call: {
    name: 'Long Call', nameZh: '买入看涨期权',
    desc: '看涨，风险有限（权利金），收益无限',
    color: '#3b82f6',
    sameExpiry: true,
    legs: [
      { label: '买入 Call', direction: 'buy', optionType: 'call', hint: '行权价' },
    ],
  },
  long_put: {
    name: 'Long Put', nameZh: '买入看跌期权',
    desc: '看跌，风险有限（权利金），下行收益显著',
    color: '#8b5cf6',
    sameExpiry: true,
    legs: [
      { label: '买入 Put', direction: 'buy', optionType: 'put', hint: '行权价' },
    ],
  },
  covered_call: {
    name: 'Covered Call', nameZh: '备兑看涨（卖出Call）',
    desc: '持有标的股票前提下卖出Call，增强收益',
    color: '#10b981',
    sameExpiry: true,
    legs: [
      { label: '卖出 Call', direction: 'sell', optionType: 'call', hint: '行权价（通常OTM）' },
    ],
  },
  cash_secured_put: {
    name: 'Cash Secured Put', nameZh: '现金担保卖出Put',
    desc: '卖出Put并持有足额现金，愿意以行权价买入标的',
    color: '#f59e0b',
    sameExpiry: true,
    legs: [
      { label: '卖出 Put', direction: 'sell', optionType: 'put', hint: '行权价（通常OTM）' },
    ],
  },
  naked_call: {
    name: 'Naked Call', nameZh: '裸卖看涨（风险较高）',
    desc: '卖出Call但不持有标的，收益有限，风险无限',
    color: '#ef4444',
    sameExpiry: true,
    legs: [
      { label: '卖出 Call', direction: 'sell', optionType: 'call', hint: '行权价' },
    ],
  },
  naked_put: {
    name: 'Naked Put', nameZh: '裸卖看跌',
    desc: '卖出Put但不持有足额现金对冲，看涨/中性',
    color: '#f97316',
    sameExpiry: true,
    legs: [
      { label: '卖出 Put', direction: 'sell', optionType: 'put', hint: '行权价' },
    ],
  },
}

const STRATEGY_TYPE_LABELS = {
  bull_call_spread: 'Bull Call Spread',
  bear_put_spread: 'Bear Put Spread',
  bull_put_spread: 'Bull Put Spread',
  bear_call_spread: 'Bear Call Spread',
  iron_condor: 'Iron Condor',
  iron_butterfly: 'Iron Butterfly',
  straddle: 'Straddle',
  strangle: 'Strangle',
  butterfly_spread: 'Butterfly Spread',
  calendar_spread: 'Calendar Spread',
}

// ── 数字输入组件 ─────────────────────────────────────────────────────────────

function NumInput({ value, onChange, placeholder, step = '0.01', min = '0' }) {
  return (
    <input
      type="number" step={step} min={min} value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="input text-sm"
    />
  )
}

// ── 主组件 ───────────────────────────────────────────────────────────────────

export default function StrategyModal({ onClose }) {
  const { activePortfolio, dispatch } = usePortfolio()
  const [step, setStep] = useState('select') // 'select' | 'form'
  const [selectedType, setSelectedType] = useState(null)
  const [error, setError] = useState('')

  const today = new Date().toISOString().split('T')[0]

  const [shared, setShared] = useState({
    symbol: '',
    tradeDate: today,
    contracts: '1',
    expiration: '',      // shared expiration (sameExpiry strategies)
    optionType: 'call',  // for calendar spread
    commission: '',      // per-leg commission
  })

  const initLegs = useCallback((config) => {
    return config.legs.map(l => ({
      strike: '',
      premium: '',
      expiration: '', // per-leg expiry (non-sameExpiry strategies)
    }))
  }, [])

  const [legs, setLegs] = useState([])

  const handleSelectType = (type) => {
    setSelectedType(type)
    setLegs(initLegs(STRATEGY_CONFIGS[type]))
    setError('')
    setStep('form')
  }

  const updateLeg = (i, field, val) => {
    setLegs(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l))
  }

  const config = selectedType ? STRATEGY_CONFIGS[selectedType] : null

  // Shared strike for sameStrike strategies (Straddle)
  const [sharedStrike, setSharedStrike] = useState('')

  const handleSubmit = () => {
    if (!activePortfolio) return
    setError('')

    const sym = shared.symbol.trim().toUpperCase()
    if (!sym) return setError('请输入标的代码')
    if (!shared.tradeDate) return setError('请选择交易日期')

    const contracts = parseFloat(shared.contracts)
    if (!(contracts > 0)) return setError('合约数须为正数')

    const expiry = config.sameExpiry ? shared.expiration : null
    if (config.sameExpiry && !expiry) return setError('请选择到期日')

    for (let i = 0; i < legs.length; i++) {
      const legConf = config.legs[i]
      const leg = legs[i]

      const strike = config.sameStrike ? parseFloat(sharedStrike) : parseFloat(leg.strike)
      if (!(strike > 0)) return setError(`第 ${i + 1} 条腿：行权价须为正数`)
      if (!(parseFloat(leg.premium) >= 0)) return setError(`第 ${i + 1} 条腿：权利金须为非负数`)
      if (!config.sameExpiry && !leg.expiration) return setError(`第 ${i + 1} 条腿：请选择到期日`)

      // Calendar spread: optionType from shared
      const optionType = legConf.optionType ?? shared.optionType
      if (!optionType) return setError(`第 ${i + 1} 条腿：请选择期权类型`)
    }

    const strategyId = `strat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const strategyName = `${sym} ${config.nameZh}`

    const builtLegs = config.legs.map((legConf, i) => {
      const leg = legs[i]
      const mult = legConf.contractsMult ?? 1
      return {
        symbol: sym,
        optionType: legConf.optionType ?? shared.optionType,
        direction: legConf.direction,
        strike: config.sameStrike ? parseFloat(sharedStrike) : parseFloat(leg.strike),
        expiration: config.sameExpiry ? expiry : leg.expiration,
        contracts: contracts * mult,
        avgPremium: parseFloat(leg.premium),
        commission: parseFloat(shared.commission) || 0,
        tradeDate: shared.tradeDate,
      }
    })

    dispatch({
      type: 'ADD_STRATEGY',
      portfolioId: activePortfolio.id,
      strategy: { id: strategyId, name: strategyName, type: selectedType, legs: builtLegs },
    })

    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay">
      <div className="bg-white rounded-2xl shadow-modal w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-claude-border flex-shrink-0">
          {step === 'form' && (
            <button onClick={() => setStep('select')}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-claude-muted">
              <ChevronLeft size={17} />
            </button>
          )}
          <h2 className="text-base font-semibold text-claude-text flex-1">
            {step === 'select' ? '选择期权策略类型' : `新建 ${config?.nameZh}`}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={17} className="text-claude-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Step 1: 选择策略类型 ── */}
          {step === 'select' && (
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(STRATEGY_CONFIGS).map(([type, cfg]) => (
                <button key={type} onClick={() => handleSelectType(type)}
                  className="text-left p-4 rounded-xl border border-claude-border hover:border-blue-300 hover:bg-blue-50/30 transition-all group">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                    <span className="text-sm font-semibold text-claude-text">{cfg.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-md bg-gray-100 text-claude-muted ml-auto">
                      {cfg.legs.length} 腿
                    </span>
                  </div>
                  <p className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.nameZh}</p>
                  <p className="text-xs text-claude-muted mt-1 leading-relaxed">{cfg.desc}</p>
                </button>
              ))}
            </div>
          )}

          {/* ── Step 2: 填写策略详情 ── */}
          {step === 'form' && config && (
            <div className="space-y-5">
              {/* 共享字段 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">标的代码 *</label>
                  <input className="input uppercase" value={shared.symbol}
                    onChange={e => setShared(s => ({ ...s, symbol: e.target.value.toUpperCase() }))}
                    placeholder="如 AAPL" />
                </div>
                <div>
                  <label className="label">交易日期 *</label>
                  <CalendarPicker value={shared.tradeDate}
                    onChange={v => setShared(s => ({ ...s, tradeDate: v }))} />
                </div>
                <div>
                  <label className="label">合约数 *</label>
                  <NumInput value={shared.contracts} step="1" min="1"
                    onChange={v => setShared(s => ({ ...s, contracts: v }))} placeholder="1" />
                </div>
                {config.sameExpiry && (
                  <div>
                    <label className="label">到期日 *</label>
                    <CalendarPicker value={shared.expiration}
                      onChange={v => setShared(s => ({ ...s, expiration: v }))} placeholder="选择到期日" />
                  </div>
                )}
                <div>
                  <label className="label">手续费/腿（$）</label>
                  <NumInput value={shared.commission}
                    onChange={v => setShared(s => ({ ...s, commission: v }))}
                    placeholder="如 0.65" step="0.01" min="0" />
                </div>
                {!config.sameExpiry && (
                  <div>
                    <label className="label">期权类型</label>
                    <div className="flex gap-2">
                      {['call', 'put'].map(t => (
                        <button key={t} onClick={() => setShared(s => ({ ...s, optionType: t }))}
                          className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                            shared.optionType === t
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'text-claude-muted border-claude-border hover:border-gray-300'
                          }`}>
                          {t === 'call' ? 'Call' : 'Put'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Straddle 共享行权价 */}
              {config.sameStrike && (
                <div className="max-w-xs">
                  <label className="label">行权价（所有腿相同）*</label>
                  <NumInput value={sharedStrike} onChange={setSharedStrike} placeholder="如 190" />
                </div>
              )}

              {/* 各腿输入 */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-claude-text">各腿详情</h3>
                {config.legs.map((legConf, i) => (
                  <div key={i} className="rounded-xl border border-claude-border p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ backgroundColor: config.color }}>
                        {i + 1}
                      </div>
                      <span className="text-sm font-semibold text-claude-text">{legConf.label}</span>
                      <span className="text-xs text-claude-muted ml-1">({legConf.hint})</span>
                      <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                        legConf.direction === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {legConf.direction === 'buy' ? '买入' : '卖出'}
                        {legConf.contractsMult && legConf.contractsMult > 1 ? ` ×${legConf.contractsMult}` : ''}
                      </span>
                      {legConf.optionType && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          legConf.optionType === 'call' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {legConf.optionType === 'call' ? 'Call' : 'Put'}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {!config.sameStrike && (
                        <div>
                          <label className="label">行权价 *</label>
                          <NumInput value={legs[i]?.strike ?? ''} onChange={v => updateLeg(i, 'strike', v)} placeholder="190" />
                        </div>
                      )}
                      <div>
                        <label className="label">权利金/股 *</label>
                        <NumInput value={legs[i]?.premium ?? ''} onChange={v => updateLeg(i, 'premium', v)} placeholder="3.50" />
                      </div>
                      {!config.sameExpiry && (
                        <div>
                          <label className="label">到期日 *</label>
                          <CalendarPicker value={legs[i]?.expiration ?? ''}
                            onChange={v => updateLeg(i, 'expiration', v)} placeholder="选择到期日" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <p className="text-sm text-loss bg-red-50 rounded-xl px-4 py-3">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'form' && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-claude-border flex-shrink-0">
            <button onClick={onClose} className="btn-secondary">取消</button>
            <button onClick={handleSubmit} className="btn-primary">
              创建策略（{config?.legs.length} 条腿）
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export { STRATEGY_TYPE_LABELS }
