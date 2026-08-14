import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { isFutureDate } from '../utils/formatters'

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function CalendarPicker({ value, onChange, placeholder = '选择日期', minDate, warnFuture }) {
  const [open, setOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState('day')   // 'day' | 'month' | 'year'
  const [inputValue, setInputValue] = useState(value ? value.replace(/-/g, '/') : '')
  const ref = useRef(null)
  const inputRef = useRef(null)

  const parsed = value ? new Date(value + 'T00:00:00') : null
  const isFuture = warnFuture && value ? isFutureDate(value) : false
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth())

  // Year grid: 12 years anchored to nearest dozen
  const yearBase = Math.floor(viewYear / 12) * 12
  const years = Array.from({ length: 12 }, (_, i) => yearBase + i)

  // Sync input display when value changes externally
  useEffect(() => {
    setInputValue(value ? value.replace(/-/g, '/') : '')
    if (value) {
      const d = new Date(value + 'T00:00:00')
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
    }
  }, [value])

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setPickerMode('day') } }
    if (open) document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // ── Navigation ───────────────────────────────────────────────────────────
  const prevNav = () => {
    if (pickerMode === 'day') {
      if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) } else setViewMonth(m => m - 1)
    } else if (pickerMode === 'month') {
      setViewYear(y => y - 1)
    } else {
      setViewYear(y => y - 12)
    }
  }
  const nextNav = () => {
    if (pickerMode === 'day') {
      if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) } else setViewMonth(m => m + 1)
    } else if (pickerMode === 'month') {
      setViewYear(y => y + 1)
    } else {
      setViewYear(y => y + 12)
    }
  }

  // ── Keyboard input ───────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    const newVal = e.target.value
    const isAdding = newVal.length > inputValue.length

    if (!isAdding) { setInputValue(newVal); return }

    const digits = newVal.replace(/\D/g, '').slice(0, 8)
    let formatted = digits
    if (digits.length >= 5) formatted = digits.slice(0, 4) + '/' + digits.slice(4)
    if (digits.length >= 7) formatted = digits.slice(0, 4) + '/' + digits.slice(4, 6) + '/' + digits.slice(6)
    setInputValue(formatted)

    if (digits.length === 8) {
      const y = digits.slice(0, 4), m = digits.slice(4, 6), d = digits.slice(6, 8)
      const isoStr = `${y}-${m}-${d}`
      const date = new Date(isoStr + 'T00:00:00')
      if (!isNaN(date.getTime()) && date.getFullYear() === parseInt(y)) {
        onChange(isoStr)
        setViewYear(parseInt(y)); setViewMonth(parseInt(m) - 1)
        setOpen(false); setPickerMode('day')
      }
    }
  }

  const handleInputBlur  = () => setInputValue(value ? value.replace(/-/g, '/') : '')
  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') inputRef.current?.blur()
    if (e.key === 'Escape') { setOpen(false); setPickerMode('day'); inputRef.current?.blur() }
  }

  // ── Day grid ─────────────────────────────────────────────────────────────
  const firstDay    = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const prevDays    = new Date(viewYear, viewMonth, 0).getDate()
  const cells = []
  for (let i = firstDay - 1; i >= 0; i--)
    cells.push({ d: prevDays - i, m: viewMonth - 1 < 0 ? 11 : viewMonth - 1, y: viewMonth === 0 ? viewYear - 1 : viewYear, other: true })
  for (let i = 1; i <= daysInMonth; i++)
    cells.push({ d: i, m: viewMonth, y: viewYear, other: false })
  for (let i = 1; cells.length < 42; i++)
    cells.push({ d: i, m: viewMonth + 1 > 11 ? 0 : viewMonth + 1, y: viewMonth === 11 ? viewYear + 1 : viewYear, other: true })

  const isSelected = (c) => parsed && c.d === parsed.getDate() && c.m === parsed.getMonth() && c.y === parsed.getFullYear()
  const isToday    = (c) => { const t = new Date(); return c.d === t.getDate() && c.m === t.getMonth() && c.y === t.getFullYear() }

  const handleSelectDay = (c) => {
    const s = `${c.y}-${String(c.m + 1).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`
    onChange(s); setOpen(false); setPickerMode('day')
  }

  const handleSelectMonth = (mi) => { setViewMonth(mi); setPickerMode('day') }
  const handleSelectYear  = (yr) => { setViewYear(yr); setPickerMode('month') }

  // ── Header label ─────────────────────────────────────────────────────────
  const headerLabel =
    pickerMode === 'day'   ? `${MONTHS_LONG[viewMonth]} ${viewYear}` :
    pickerMode === 'month' ? `${viewYear}` :
                             `${yearBase} – ${yearBase + 11}`

  const headerClick = () => {
    if (pickerMode === 'day')   setPickerMode('month')
    else if (pickerMode === 'month') setPickerMode('year')
    // year mode: click does nothing (already the deepest level)
  }

  return (
    <div ref={ref} className="relative">
      {/* Text input + calendar icon */}
      <div className={`flex items-center w-full px-3 py-2.5 border rounded-xl transition-all
        ${open ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-claude-border hover:border-gray-400'}`}
        style={{ background: 'var(--claude-input-bg)' }}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          className="flex-1 text-sm bg-transparent outline-none text-claude-text placeholder:text-claude-subtle min-w-0"
        />
        <button type="button" onClick={() => { setOpen(o => !o); setPickerMode('day') }}
          className="text-claude-muted hover:text-claude-text transition-colors flex-shrink-0 ml-2">
          <Calendar size={15} />
        </button>
      </div>

      {/* Calendar panel */}
      {open && (
        <div className="absolute z-[100] top-full mt-2 rounded-2xl border border-claude-border w-72 p-4 fade-in"
          style={{ background: 'var(--claude-card)' }}
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)' }}>

          {/* Nav header */}
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevNav}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-claude-muted hover:text-claude-text">
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={headerClick}
              className={`font-semibold text-claude-text text-sm px-2 py-1 rounded-lg transition-colors ${pickerMode !== 'year' ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'}`}
            >
              {headerLabel}
            </button>
            <button onClick={nextNav}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-claude-muted hover:text-claude-text">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* ── Day view ── */}
          {pickerMode === 'day' && (
            <>
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map(d => <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((c, i) => {
                  const sel = isSelected(c), today = isToday(c)
                  return (
                    <button key={i} type="button" onClick={() => handleSelectDay(c)}
                      className={`h-9 w-full flex items-center justify-center rounded-xl text-sm transition-all
                        ${sel ? 'bg-blue-600 text-white font-semibold' : ''}
                        ${!sel && today ? 'font-semibold text-blue-600' : ''}
                        ${!sel && c.other ? 'text-gray-300 hover:bg-gray-50' : ''}
                        ${!sel && !c.other ? 'text-gray-800 hover:bg-gray-100' : ''}`}>
                      {c.d}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* ── Month view ── */}
          {pickerMode === 'month' && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              {MONTHS_SHORT.map((name, mi) => {
                const isCurrent = parsed && mi === parsed.getMonth() && viewYear === parsed.getFullYear()
                return (
                  <button key={mi} type="button" onClick={() => handleSelectMonth(mi)}
                    className={`py-2 rounded-xl text-sm font-medium transition-all
                      ${isCurrent ? 'bg-blue-600 text-white' : 'text-gray-800 hover:bg-gray-100'}`}>
                    {name}
                  </button>
                )
              })}
            </div>
          )}

          {/* ── Year view ── */}
          {pickerMode === 'year' && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              {years.map(yr => {
                const isCurrent = parsed && yr === parsed.getFullYear()
                return (
                  <button key={yr} type="button" onClick={() => handleSelectYear(yr)}
                    className={`py-2 rounded-xl text-sm font-medium transition-all
                      ${isCurrent ? 'bg-blue-600 text-white' : 'text-gray-800 hover:bg-gray-100'}`}>
                    {yr}
                  </button>
                )
              })}
            </div>
          )}

        </div>
      )}
      {isFuture && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          <span>⚠</span> 该日期在未来，请确认是否正确
        </p>
      )}
    </div>
  )
}
