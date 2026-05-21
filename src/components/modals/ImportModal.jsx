import { useState, useCallback, useRef } from 'react'
import { X, Download, Upload, AlertCircle, CheckCircle2, FileText } from 'lucide-react'
import { usePortfolio } from '../../contexts/PortfolioContext'

// ── CSV 模板内容 ─────────────────────────────────────────────────────────────

const STOCK_HEADERS = '日期,股票代码,操作,股数,价格'
const STOCK_SAMPLE = [
  '2024-01-15,AAPL,buy,100,185.00',
  '2024-03-20,AAPL,sell,50,195.00',
  '2024-06-10,MSFT,buy,20,420.00',
].join('\n')

const OPTION_HEADERS = '交易日期,股票代码,期权类型,行权价,到期日,方向,合约数,权利金,平仓日期,平仓价格'
const OPTION_SAMPLE = [
  '2024-01-15,AAPL,call,190,2024-03-15,sell,1,3.50,,',
  '2024-02-20,TSLA,put,180,2024-04-19,buy,2,2.00,2024-03-01,1.00',
  '2024-05-10,NVDA,call,800,2024-06-21,sell,3,15.00,,',
].join('\n')

function downloadTemplate(type) {
  const [headers, sample, filename] = type === 'stock'
    ? [STOCK_HEADERS, STOCK_SAMPLE, '股票交易导入模板.csv']
    : [OPTION_HEADERS, OPTION_SAMPLE, '期权持仓导入模板.csv']
  const blob = new Blob(['﻿' + headers + '\n' + sample], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── CSV 解析 ─────────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0]
    .replace(/^﻿/, '')
    .split(',')
    .map(h => h.trim().replace(/^"|"$/g, ''))

  return lines.slice(1).filter(l => l.trim()).map(line => {
    const fields = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
      else cur += ch
    }
    fields.push(cur.trim())
    const obj = {}
    headers.forEach((h, i) => { obj[h] = (fields[i] ?? '').replace(/^"|"$/g, '') })
    return obj
  })
}

// ── 券商格式解析 ─────────────────────────────────────────────────────────────

// 解析单行 CSV（处理引号内的逗号）
function parseCSVLine(line) {
  const fields = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue }
    if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  fields.push(cur.trim())
  return fields
}

// MM/DD/YYYY → YYYY-MM-DD
function mmddyyyyToISO(str) {
  const m = str.replace(/"/g, '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}

// 自动识别券商格式
function detectBroker(text) {
  if (/Fees & Comm|"Schwab"/i.test(text)) return 'schwab'
  if (/Trades,Header|Asset Category/i.test(text)) return 'ibkr'
  if (/TRANSACTION ID/i.test(text) || /Bought \d|Sold \d/i.test(text)) return 'tda'
  return null
}

// Schwab 解析：Date / Action / Symbol / Quantity / Price / Fees & Comm
function parseSchwab(text) {
  const lines = text.replace(/\r/g, '').split('\n')
  const hi = lines.findIndex(l => /date.*action.*symbol.*quantity/i.test(l))
  if (hi < 0) return { rows: [], errors: ['未找到 Schwab 表头行，请确认文件来源正确'] }

  const hdrs = parseCSVLine(lines[hi]).map(h => h.toLowerCase())
  const gi = names => names.map(n => hdrs.findIndex(h => h.includes(n))).find(i => i >= 0) ?? -1
  const [iDate, iAct, iSym, iQty, iPrc, iFee] = [
    gi(['date']), gi(['action']), gi(['symbol']),
    gi(['quantity']), gi(['price']), gi(['fees', 'comm']),
  ]

  const rows = [], errors = []
  for (let i = hi + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cols = parseCSVLine(lines[i])
    const act = (cols[iAct] || '').toLowerCase()
    if (!['buy', 'sell'].includes(act)) continue
    const date = mmddyyyyToISO(cols[iDate] || '')
    const symbol = (cols[iSym] || '').replace(/"/g, '').toUpperCase().trim()
    const shares = parseFloat((cols[iQty] || '').replace(/[,"$]/g, ''))
    const price = parseFloat((cols[iPrc] || '').replace(/[,"$]/g, ''))
    const commission = parseFloat((cols[iFee] || '0').replace(/[,"$]/g, '')) || 0
    if (!date || !symbol || !(shares > 0) || !(price > 0)) { errors.push(`第 ${i + 1} 行解析失败`); continue }
    rows.push({ '日期': date, '股票代码': symbol, '操作': act, '股数': String(shares), '价格': String(price), _commission: commission })
  }
  return { rows, errors }
}

// IBKR 解析：Trades,Header,... / Trades,Data,Order,Stocks,...
function parseIBKR(text) {
  const lines = text.replace(/\r/g, '').split('\n')
  let hdrs = null
  const rows = [], errors = []
  for (const line of lines) {
    if (/^Trades,Header/.test(line)) { hdrs = parseCSVLine(line); continue }
    if (/^Trades,Data,Order,Stocks/.test(line) && hdrs) {
      const vals = parseCSVLine(line)
      const g = k => (vals[hdrs.indexOf(k)] || '').trim()
      const qty = parseFloat(g('Quantity'))
      if (!qty) continue
      const date = g('Date/Time').split(',')[0].trim()
      const symbol = g('Symbol').toUpperCase()
      const price = parseFloat(g('T. Price'))
      const commission = Math.abs(parseFloat(g('Comm/Fee')) || 0)
      if (!date || !symbol || !(price > 0)) continue
      rows.push({ '日期': date, '股票代码': symbol, '操作': qty > 0 ? 'buy' : 'sell', '股数': String(Math.abs(qty)), '价格': String(price), _commission: commission })
    }
  }
  if (rows.length === 0 && hdrs === null) errors.push('未找到 IBKR Trades 数据段，请确认文件来源正确')
  return { rows, errors }
}

// TD Ameritrade 解析：DATE / DESCRIPTION(Bought/Sold) / QUANTITY / SYMBOL / PRICE / COMMISSION
function parseTDA(text) {
  const lines = text.replace(/\r/g, '').split('\n')
  const hi = lines.findIndex(l => /DATE.*TRANSACTION/i.test(l))
  if (hi < 0) return { rows: [], errors: ['未找到 TD Ameritrade 表头行，请确认文件来源正确'] }

  const hdrs = parseCSVLine(lines[hi]).map(h => h.trim().toUpperCase())
  const gi = k => hdrs.findIndex(h => h.includes(k))
  const [iDate, iDesc, iQty, iSym, iPrc, iComm] = [gi('DATE'), gi('DESCRIPTION'), gi('QUANTITY'), gi('SYMBOL'), gi('PRICE'), gi('COMMISSION')]

  const rows = [], errors = []
  for (let i = hi + 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    const desc = (cols[iDesc] || '').toLowerCase()
    if (!desc.includes('bought') && !desc.includes('sold')) continue
    const date = mmddyyyyToISO(cols[iDate] || '')
    const symbol = (cols[iSym] || '').replace(/"/g, '').toUpperCase().trim()
    const shares = Math.abs(parseFloat((cols[iQty] || '').replace(/[,"]/g, '')))
    const price = parseFloat((cols[iPrc] || '').replace(/[,"$]/g, ''))
    const commission = Math.abs(parseFloat((cols[iComm] || '0').replace(/[,"$]/g, ''))) || 0
    if (!date || !symbol || !(shares > 0) || !(price > 0)) { errors.push(`第 ${i + 1} 行解析失败`); continue }
    rows.push({ '日期': date, '股票代码': symbol, '操作': desc.includes('bought') ? 'buy' : 'sell', '股数': String(shares), '价格': String(price), _commission: commission })
  }
  return { rows, errors }
}

// ── 行验证 ───────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validateStock(row) {
  const errs = []
  if (!DATE_RE.test(row['日期'] ?? '')) errs.push('日期格式须为 YYYY-MM-DD')
  if (!row['股票代码']?.trim()) errs.push('股票代码不能为空')
  const action = (row['操作'] ?? '').trim().toLowerCase()
  if (!['buy', 'sell', '买入', '卖出'].includes(action)) errs.push('操作须为 buy 或 sell')
  if (!(parseFloat(row['股数']) > 0)) errs.push('股数须为正数')
  if (!(parseFloat(row['价格']) > 0)) errs.push('价格须为正数')
  return errs
}

function validateOption(row) {
  const errs = []
  if (!DATE_RE.test(row['交易日期'] ?? '')) errs.push('交易日期格式须为 YYYY-MM-DD')
  if (!row['股票代码']?.trim()) errs.push('股票代码不能为空')
  if (!['call', 'put'].includes((row['期权类型'] ?? '').toLowerCase())) errs.push('期权类型须为 call 或 put')
  if (!(parseFloat(row['行权价']) > 0)) errs.push('行权价须为正数')
  if (!DATE_RE.test(row['到期日'] ?? '')) errs.push('到期日格式须为 YYYY-MM-DD')
  if (!['buy', 'sell'].includes((row['方向'] ?? '').toLowerCase())) errs.push('方向须为 buy 或 sell')
  if (!(parseFloat(row['合约数']) > 0)) errs.push('合约数须为正数')
  if (isNaN(parseFloat(row['权利金'])) || parseFloat(row['权利金']) < 0) errs.push('权利金须为非负数')
  if (row['平仓日期'] && !DATE_RE.test(row['平仓日期'])) errs.push('平仓日期格式须为 YYYY-MM-DD')
  if (row['平仓日期'] && row['平仓价格'] && isNaN(parseFloat(row['平仓价格']))) errs.push('平仓价格须为数字')
  return errs
}

// ── 主组件 ───────────────────────────────────────────────────────────────────

export default function ImportModal({ onClose }) {
  const { state, dispatch } = usePortfolio()
  const [type, setType] = useState('stock')
  const [brokerFormat, setBrokerFormat] = useState('generic')
  const [detectedBroker, setDetectedBroker] = useState(null)
  const [rows, setRows] = useState(null)
  const [portfolioId, setPortfolioId] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState(null)
  const fileRef = useRef()

  const subPortfolios = state.portfolios.filter(p => !p.isAggregate)
  const targetId = portfolioId ?? subPortfolios[0]?.id

  const processFile = useCallback((file) => {
    if (!file?.name.endsWith('.csv')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result

      if (type === 'option') {
        const parsed = parseCSV(text)
        setRows(parsed.map((row, i) => ({ ...row, _line: i + 2, _errors: validateOption(row) })))
        return
      }

      // 股票：尝试自动识别券商格式
      let fmt = brokerFormat
      if (fmt === 'generic') {
        const auto = detectBroker(text)
        if (auto) { fmt = auto; setBrokerFormat(auto); setDetectedBroker(auto) }
        else setDetectedBroker(null)
      }

      let brokerRows = [], parseErrors = []
      if (fmt === 'schwab')      ({ rows: brokerRows, errors: parseErrors } = parseSchwab(text))
      else if (fmt === 'ibkr')   ({ rows: brokerRows, errors: parseErrors } = parseIBKR(text))
      else if (fmt === 'tda')    ({ rows: brokerRows, errors: parseErrors } = parseTDA(text))
      else {
        brokerRows = parseCSV(text)
      }

      const validated = brokerRows.map((row, i) => ({ ...row, _line: i + 2, _errors: validateStock(row) }))
      const errRows   = parseErrors.map((e, i) => ({
        '日期': '', '股票代码': '', '操作': '', '股数': '', '价格': '',
        _line: 9000 + i, _errors: [e],
      }))
      setRows([...validated, ...errRows])
    }
    reader.readAsText(file, 'UTF-8')
  }, [type, brokerFormat])

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false)
    processFile(e.dataTransfer.files[0])
  }, [processFile])

  const validRows = rows?.filter(r => r._errors.length === 0) ?? []
  const errorRows = rows?.filter(r => r._errors.length > 0) ?? []

  const handleImport = () => {
    if (!validRows.length || !targetId) return

    if (type === 'stock') {
      const bySymbol = {}
      for (const row of validRows) {
        const sym = row['股票代码'].toUpperCase()
        if (!bySymbol[sym]) bySymbol[sym] = { name: sym, transactions: [] }
        bySymbol[sym].transactions.push({
          date: row['日期'],
          action: ['buy', '买入'].includes((row['操作'] || '').toLowerCase()) ? 'buy' : 'sell',
          shares: parseFloat(row['股数']),
          price: parseFloat(row['价格']),
          commission: row._commission ?? 0,
        })
      }
      dispatch({
        type: 'BULK_IMPORT_STOCKS',
        portfolioId: targetId,
        imports: Object.entries(bySymbol).map(([symbol, d]) => ({ symbol, ...d })),
      })
    } else {
      dispatch({
        type: 'BULK_IMPORT_OPTIONS',
        portfolioId: targetId,
        options: validRows.map(row => ({
          symbol: row['股票代码'].toUpperCase(),
          optionType: row['期权类型'].toLowerCase(),
          strike: parseFloat(row['行权价']),
          expiration: row['到期日'],
          direction: row['方向'].toLowerCase(),
          contracts: parseFloat(row['合约数']),
          avgPremium: parseFloat(row['权利金']),
          commission: 0,
          tradeDate: row['交易日期'],
          status: row['平仓日期'] ? 'closed' : 'open',
          closeDate: row['平仓日期'] || null,
          closePrice: row['平仓价格'] ? parseFloat(row['平仓价格']) : null,
        })),
      })
    }

    setDone(validRows.length)
  }

  const STOCK_COLS = ['日期', '股票代码', '操作', '股数', '价格']
  const OPTION_COLS = ['交易日期', '股票代码', '期权类型', '行权价', '到期日', '方向', '合约数', '权利金', '平仓日期', '平仓价格']
  const cols = type === 'stock' ? STOCK_COLS : OPTION_COLS

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-overlay">
      <div className="rounded-2xl shadow-modal w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col" style={{ background: 'var(--claude-card)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-claude-border flex-shrink-0">
          <h2 className="text-base font-semibold text-claude-text">CSV 批量导入</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={17} className="text-claude-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* 成功状态 */}
          {done !== null ? (
            <div className="text-center py-14">
              <CheckCircle2 size={52} className="mx-auto mb-4" style={{ color: '#16a34a' }} />
              <p className="text-lg font-semibold text-claude-text mb-1">导入成功</p>
              <p className="text-sm text-claude-muted">已成功导入 {done} 条记录</p>
              <button onClick={onClose} className="btn-primary mt-6 mx-auto">完成</button>
            </div>
          ) : (
            <>
              {/* 类型切换 */}
              <div className="flex gap-2">
                {[['stock', '股票交易'], ['option', '期权持仓']].map(([v, label]) => (
                  <button key={v} onClick={() => { setType(v); setRows(null); setBrokerFormat('generic'); setDetectedBroker(null) }}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                      type === v
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'text-claude-muted border-claude-border hover:border-gray-300 hover:text-claude-text'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* 券商格式选择（仅股票） */}
              {type === 'stock' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-claude-muted whitespace-nowrap">来源格式：</span>
                    {[
                      { id: 'generic',  label: '自定义模板' },
                      { id: 'schwab',   label: 'Schwab' },
                      { id: 'ibkr',     label: 'IBKR' },
                      { id: 'tda',      label: 'TD Ameritrade' },
                    ].map(({ id, label }) => (
                      <button key={id}
                        onClick={() => { setBrokerFormat(id); setRows(null); setDetectedBroker(null) }}
                        className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                          brokerFormat === id
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'text-claude-muted border-claude-border hover:border-gray-400 hover:text-claude-text'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {detectedBroker && (
                    <p className="text-xs text-blue-600 flex items-center gap-1">
                      <span>✦</span>
                      已自动识别为 {detectedBroker === 'schwab' ? 'Schwab' : detectedBroker === 'ibkr' ? 'IBKR' : 'TD Ameritrade'} 格式
                    </p>
                  )}
                </div>
              )}

              {/* 模板下载 */}
              <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-3.5">
                <div className="flex items-center gap-2.5">
                  <FileText size={15} className="text-blue-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">
                    {brokerFormat === 'generic' ? '下载 CSV 模板' : `${brokerFormat === 'schwab' ? 'Schwab' : brokerFormat === 'ibkr' ? 'IBKR' : 'TD Ameritrade'} 格式已选`}
                  </p>
                    <p className="text-xs text-blue-600 mt-0.5">
                      {brokerFormat === 'generic' ? '按模板格式填写数据后再上传' : '直接上传券商导出的原始 CSV 文件'}
                    </p>
                  </div>
                </div>
                {brokerFormat === 'generic' && (
                  <button onClick={() => downloadTemplate(type)}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-blue-200 rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-50 transition-colors flex-shrink-0">
                    <Download size={13} />下载模板
                  </button>
                )}
              </div>

              {/* 上传区域 */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl py-10 text-center cursor-pointer transition-all select-none ${
                  dragging
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-claude-border hover:border-gray-400 hover:bg-gray-50'
                }`}>
                <input ref={fileRef} type="file" accept=".csv" className="hidden"
                  onChange={e => { processFile(e.target.files[0]); e.target.value = '' }} />
                <Upload size={28} className="mx-auto mb-3 text-claude-subtle" />
                <p className="text-sm font-medium text-claude-text mb-1">拖拽 CSV 文件到此，或点击选择文件</p>
                <p className="text-xs text-claude-muted">仅支持 .csv 格式</p>
              </div>

              {/* 解析结果 */}
              {rows !== null && (
                <div className="space-y-3">
                  {/* 统计 */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 size={14} style={{ color: '#16a34a' }} />
                      <span className="text-sm font-medium text-claude-text">{validRows.length} 条有效</span>
                    </div>
                    {errorRows.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <AlertCircle size={14} style={{ color: '#dc2626' }} />
                        <span className="text-sm font-medium" style={{ color: '#dc2626' }}>
                          {errorRows.length} 条有误（将跳过）
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 错误明细 */}
                  {errorRows.length > 0 && (
                    <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 max-h-28 overflow-y-auto space-y-1.5">
                      {errorRows.map(row => (
                        <p key={row._line} className="text-xs" style={{ color: '#dc2626' }}>
                          <span className="font-semibold">第 {row._line} 行：</span>
                          {row._errors.join('、')}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* 有效行预览 */}
                  {validRows.length > 0 && (
                    <div className="rounded-xl border border-claude-border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b border-claude-border">
                              {cols.map(h => (
                                <th key={h} className="px-3 py-2 text-left font-semibold text-claude-subtle whitespace-nowrap">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {validRows.slice(0, 6).map(row => (
                              <tr key={row._line} className="border-b border-claude-border/40 last:border-0">
                                {cols.map(col => (
                                  <td key={col} className="px-3 py-2 font-mono text-claude-text whitespace-nowrap">
                                    {row[col] || <span className="text-claude-subtle">—</span>}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {validRows.length > 6 && (
                        <p className="text-xs text-claude-muted px-3 py-2 bg-gray-50 border-t border-claude-border">
                          还有 {validRows.length - 6} 条记录未显示
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 目标组合选择（多组合时显示） */}
              {subPortfolios.length > 1 && (
                <div>
                  <p className="label">导入到组合</p>
                  <div className="flex gap-2 flex-wrap">
                    {subPortfolios.map(p => (
                      <button key={p.id} onClick={() => setPortfolioId(p.id)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                          targetId === p.id
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'text-claude-muted border-claude-border hover:border-gray-300'
                        }`}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {done === null && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-claude-border flex-shrink-0">
            <p className="text-xs text-claude-muted">
              {rows === null
                ? '请先上传 CSV 文件'
                : `共解析 ${rows.length} 行，${validRows.length} 条可导入`}
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-secondary">取消</button>
              <button onClick={handleImport} disabled={!validRows.length}
                className={`btn-primary ${!validRows.length ? 'opacity-40 cursor-not-allowed' : ''}`}>
                导入{validRows.length > 0 ? ` ${validRows.length} 条` : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
