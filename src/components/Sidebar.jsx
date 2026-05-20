import { LayoutDashboard, TrendingUp, BarChart2, ClipboardList, BarChart3, CalendarDays, X } from 'lucide-react'

const NAV_ITEMS = [
  { id: 'dashboard',    label: '总览',    icon: LayoutDashboard },
  { id: 'stocks',       label: '持仓管理', icon: TrendingUp },
  { id: 'charts',       label: '图表分析', icon: BarChart2 },
  { id: 'transactions', label: '交易记录', icon: ClipboardList },
  { id: 'calendar',     label: '日历盈亏', icon: CalendarDays },
]

export default function Sidebar({ activeTab, setActiveTab, isOpen, onClose }) {
  const handleNav = (id) => {
    setActiveTab(id)
    onClose?.()
  }

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-screen w-52 flex flex-col z-40
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        style={{
          background: 'var(--claude-glass)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderRight: '1px solid var(--claude-border)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--claude-border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#0071e3 0%,#34aadc 100%)' }}>
              <BarChart3 size={14} className="text-white" />
            </div>
            <span className="font-semibold text-claude-text text-sm tracking-tight">Portfolio</span>
          </div>
          <button
            onClick={onClose}
            className="md:hidden p-1 rounded-lg text-claude-subtle hover:text-claude-text transition-colors"
            style={{ background: 'var(--claude-hover)' }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-0.5">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            const active = activeTab === item.id
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-all duration-150 rounded-xl"
                style={active ? {
                  color: '#0071e3',
                  background: 'rgba(0,113,227,0.09)',
                } : {
                  color: 'var(--claude-muted)',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--claude-hover)'; e.currentTarget.style.color = active ? '#0071e3' : 'var(--claude-text)' }}
                onMouseLeave={e => { e.currentTarget.style.background = active ? 'rgba(0,113,227,0.09)' : ''; e.currentTarget.style.color = active ? '#0071e3' : 'var(--claude-muted)' }}
              >
                <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
                <span style={{ letterSpacing: '-0.01em' }}>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer hint */}
        <div className="px-5 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--claude-border)' }}>
          <p className="text-[10px] text-claude-subtle leading-relaxed">
            Portfolio Manager
          </p>
        </div>
      </aside>
    </>
  )
}
