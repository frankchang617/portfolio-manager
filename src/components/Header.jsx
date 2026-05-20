import { useState, useRef } from 'react'
import { RefreshCw, Plus, ChevronDown, Edit2, Trash2, Check, Menu, Download, Upload, Sun, Moon } from 'lucide-react'
import { usePortfolio } from '../contexts/PortfolioContext'
import { useTheme } from '../contexts/ThemeContext'
import PortfolioModal from './modals/PortfolioModal'

const STORAGE_KEY = 'portfolio_manager_v3'

const INTERVALS = [
  { label: '30s',   value: 30 },
  { label: '1 min', value: 60 },
  { label: '5 min', value: 300 },
]

export default function Header({ onMenuClick }) {
  const { state, dispatch, activePortfolio, refreshPrices } = usePortfolio()
  const { dark, toggle: toggleDark } = useTheme()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [intervalOpen, setIntervalOpen] = useState(false)
  const [portfolioModal, setPortfolioModal] = useState({ open: false, edit: null })
  const importRef = useRef(null)

  const handleExport = () => {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `portfolio-backup-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result)
        if (!parsed.portfolios || !Array.isArray(parsed.portfolios)) {
          alert('文件格式不正确，请选择有效的备份文件')
          return
        }
        if (!confirm('导入将覆盖当前所有数据，确认继续？')) return
        localStorage.setItem(STORAGE_KEY, ev.target.result)
        window.location.reload()
      } catch {
        alert('文件解析失败，请确认是有效的 JSON 备份文件')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleDelete = (portfolio) => {
    if (state.portfolios.length === 1) { alert('至少保留一个投资组合'); return }
    if (confirm(`确定删除「${portfolio.name}」？`)) {
      dispatch({ type: 'DELETE_PORTFOLIO', id: portfolio.id })
    }
    setDropdownOpen(false)
  }

  const lastUpdatedText = state.lastUpdated
    ? (() => {
        const mins = Math.floor((Date.now() - new Date(state.lastUpdated)) / 60000)
        return mins < 1 ? '刚刚更新' : `${mins} 分钟前`
      })()
    : '未获取价格'

  const currentInterval = INTERVALS.find(i => i.value === state.settings.refreshInterval) || INTERVALS[1]
  const autoRefresh = state.settings.autoRefresh

  /* ── Pill button base style ── */
  const pillBase = {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '5px 14px', borderRadius: '980px',
    fontSize: '13px', fontWeight: '400', cursor: 'pointer',
    transition: 'all 0.15s', letterSpacing: '-0.01em',
    userSelect: 'none',
  }

  return (
    <>
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'var(--claude-glass)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderBottom: '1px solid var(--claude-border)',
        }}
      >
        <div className="px-4 md:px-6 flex items-center justify-between py-2.5">

          {/* Left: hamburger + portfolio selector */}
          <div className="flex items-center gap-2">
            <button
              onClick={onMenuClick}
              className="md:hidden p-2 rounded-xl text-claude-muted hover:text-claude-text transition-colors"
              style={{ background: 'var(--claude-hover)' }}
            >
              <Menu size={17} />
            </button>

            {/* Portfolio dropdown trigger */}
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                style={{
                  ...pillBase,
                  background: 'var(--claude-hover)',
                  color: 'var(--claude-text)',
                  border: 'none',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--claude-card-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--claude-hover)'}
              >
                <span className="max-w-[180px] truncate font-medium">{activePortfolio?.name || '选择组合'}</span>
                <ChevronDown size={13} className={`transition-transform text-claude-subtle ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {dropdownOpen && (
                <div className="absolute left-0 top-full mt-2 w-72 bg-white rounded-2xl z-50 py-2 fade-in"
                  style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.14)', border: '1px solid var(--claude-border)' }}>
                  <p className="text-[10px] font-semibold text-claude-subtle uppercase tracking-widest px-4 py-2">
                    我的投资组合
                  </p>
                  {state.portfolios.map(p => (
                    <div key={p.id}
                      className="flex items-center group px-4 py-2.5 cursor-pointer transition-colors"
                      style={{ gap: '0' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--claude-card-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                      onClick={() => { dispatch({ type: 'SELECT_PORTFOLIO', id: p.id }); setDropdownOpen(false) }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {p.id === state.activePortfolioId && (
                            <Check size={13} style={{ color: '#0071e3', flexShrink: 0 }} />
                          )}
                          <span className={`text-sm truncate ${p.id === state.activePortfolioId ? 'font-semibold text-claude-text' : 'text-claude-muted'}`}>
                            {p.name}
                          </span>
                        </div>
                        <p className="text-xs text-claude-subtle mt-0.5 ml-5">
                          {p.isAggregate ? '汇总视图（只读）' : `${p.stocks.length} 股票 · ${p.options.length} 期权`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                        <button onClick={e => { e.stopPropagation(); setPortfolioModal({ open: true, edit: p }); setDropdownOpen(false) }}
                          className="p-1.5 rounded-lg text-claude-subtle hover:text-claude-text transition-colors"
                          style={{ background: 'var(--claude-hover)' }}>
                          <Edit2 size={12} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDelete(p) }}
                          className="p-1.5 rounded-lg text-claude-subtle hover:text-loss transition-colors"
                          style={{ background: 'var(--claude-hover)' }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div style={{ borderTop: '1px solid var(--claude-border)', marginTop: '4px', paddingTop: '4px' }}>
                    <button
                      onClick={() => { setPortfolioModal({ open: true, edit: null }); setDropdownOpen(false) }}
                      className="flex items-center gap-2 w-full px-4 py-2.5 text-sm font-medium transition-colors"
                      style={{ color: '#0071e3' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--claude-card-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      <Plus size={14} />新建投资组合
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-claude-subtle hidden md:block" style={{ letterSpacing: '-0.01em' }}>
              {lastUpdatedText}
            </span>

            {/* Refresh */}
            <button
              onClick={refreshPrices}
              disabled={state.isLoading}
              style={{
                ...pillBase,
                background: 'var(--claude-hover)',
                color: 'var(--claude-muted)',
                border: 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--claude-card-2)'; e.currentTarget.style.color = 'var(--claude-text)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--claude-hover)'; e.currentTarget.style.color = 'var(--claude-muted)' }}
            >
              <RefreshCw size={13} className={state.isLoading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">刷新</span>
            </button>

            {/* Auto refresh toggle */}
            <button
              onClick={() => dispatch({ type: 'UPDATE_SETTINGS', settings: { autoRefresh: !autoRefresh } })}
              style={{
                ...pillBase,
                background: autoRefresh ? '#0071e3' : 'var(--claude-hover)',
                color: autoRefresh ? '#ffffff' : 'var(--claude-muted)',
                border: 'none',
                fontWeight: '500',
              }}
              onMouseEnter={e => {
                if (autoRefresh) e.currentTarget.style.background = '#0077ed'
                else { e.currentTarget.style.background = 'var(--claude-card-2)'; e.currentTarget.style.color = 'var(--claude-text)' }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = autoRefresh ? '#0071e3' : 'var(--claude-hover)'
                e.currentTarget.style.color = autoRefresh ? '#ffffff' : 'var(--claude-muted)'
              }}
            >
              Auto {autoRefresh ? 'ON' : 'OFF'}
            </button>

            {/* Interval picker */}
            <div className="relative">
              <button
                onClick={() => setIntervalOpen(!intervalOpen)}
                style={{
                  ...pillBase,
                  background: 'var(--claude-hover)',
                  color: 'var(--claude-muted)',
                  border: 'none',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--claude-card-2)'; e.currentTarget.style.color = 'var(--claude-text)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--claude-hover)'; e.currentTarget.style.color = 'var(--claude-muted)' }}
              >
                {currentInterval.label}
                <ChevronDown size={13} className={`text-claude-subtle transition-transform ${intervalOpen ? 'rotate-180' : ''}`} />
              </button>
              {intervalOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-xl z-50 py-1.5 w-24 fade-in"
                  style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: '1px solid var(--claude-border)' }}>
                  {INTERVALS.map(i => (
                    <button key={i.value}
                      onClick={() => { dispatch({ type: 'UPDATE_SETTINGS', settings: { refreshInterval: i.value } }); setIntervalOpen(false) }}
                      className="w-full text-left px-3 py-2 text-sm transition-colors"
                      style={{
                        color: state.settings.refreshInterval === i.value ? '#0071e3' : 'var(--claude-text)',
                        fontWeight: state.settings.refreshInterval === i.value ? '600' : '400',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--claude-card-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      {i.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dark mode toggle */}
            <button
              onClick={toggleDark}
              title={dark ? '切换为浅色模式' : '切换为深色模式'}
              className="p-2 rounded-xl text-claude-subtle hover:text-claude-text transition-colors"
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(128,128,128,0.10)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            {/* Backup/Restore */}
            <div className="flex items-center gap-0.5 pl-2 ml-1" style={{ borderLeft: '1px solid var(--claude-border)' }}>
              <button onClick={handleExport} title="导出备份"
                className="p-2 rounded-xl text-claude-subtle hover:text-claude-text transition-colors"
                onMouseEnter={e => e.currentTarget.style.background = 'var(--claude-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <Download size={14} />
              </button>
              <button onClick={() => importRef.current?.click()} title="导入备份"
                className="p-2 rounded-xl text-claude-subtle hover:text-claude-text transition-colors"
                onMouseEnter={e => e.currentTarget.style.background = 'var(--claude-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <Upload size={14} />
              </button>
              <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            </div>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {state.error && (
        <div className="px-6 py-3 text-xs text-center"
          style={{ background: '#fff9ec', borderBottom: '1px solid #ffe5a0', color: '#8a6000' }}>
          获取实时价格失败（网络限制或 API 限额）。{state.error}
        </div>
      )}

      {/* Click-away */}
      {(dropdownOpen || intervalOpen) && (
        <div className="fixed inset-0 z-20" onClick={() => { setDropdownOpen(false); setIntervalOpen(false) }} />
      )}

      <PortfolioModal
        isOpen={portfolioModal.open}
        onClose={() => setPortfolioModal({ open: false, edit: null })}
        editPortfolio={portfolioModal.edit}
      />
    </>
  )
}
