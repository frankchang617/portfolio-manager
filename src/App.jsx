import { useState } from 'react'
import { PortfolioProvider } from './contexts/PortfolioContext'
import { ThemeProvider } from './contexts/ThemeContext'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Dashboard from './components/Dashboard'
import StockPositions from './components/StockPositions'
import Charts from './components/Charts'
import Transactions from './components/Transactions'
import DailyPnLCalendar from './components/DailyPnLCalendar'

function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard':    return <Dashboard setActiveTab={setActiveTab} />
      case 'stocks':       return <StockPositions />
      case 'charts':       return <Charts />
      case 'transactions': return <Transactions />
      case 'calendar':     return <DailyPnLCalendar />
      default:             return <Dashboard setActiveTab={setActiveTab} />
    }
  }

  return (
    <div className="flex min-h-screen bg-claude-bg">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-h-screen md:ml-52">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 px-4 md:px-6 py-6 fade-in">
          {renderTab()}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <PortfolioProvider>
        <AppContent />
      </PortfolioProvider>
    </ThemeProvider>
  )
}
