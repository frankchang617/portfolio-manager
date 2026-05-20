# 持仓编辑页：可编辑股票代码 & 交易记录 设计规格

日期：2026-05-20  
状态：已批准

---

## 背景

`StockModal.jsx` 是持仓管理的核心编辑页。当前编辑模式（`editStock` 非空时）仅支持删除交易记录，无法修改已有记录，也无法更改股票代码。本规格新增两个功能：

1. **编辑股票代码（及公司名称）**
2. **行内编辑已有交易记录**

---

## 功能一：编辑股票代码

### 交互
- 编辑模式下，标题 `<h2>` 旁显示 ✏️ 图标按钮
- 点击图标 → 标题区域切换为两个输入框（股票代码 + 公司名称）+ 保存 / 取消按钮
- 股票代码输入框：强制大写，仅允许 `A-Z0-9.`（与新增股票逻辑一致）
- 保存时校验：代码不能为空
- 确认 → dispatch `UPDATE_STOCK`，payload `{ symbol, name }`；取消 → 恢复显示

### State（新增，仅在 `StockModal` 内）
```
editingSymbol: boolean          // 是否正在编辑股票代码
symbolDraft: string             // 编辑中的代码草稿
nameDraft: string               // 编辑中的名称草稿
```

### 数据层
复用现有 `UPDATE_STOCK` action，无需改动 reducer。

---

## 功能二：行内编辑交易记录（A1 方案）

### 交互
- 交易记录列表中，每行 hover 时右侧显示 ✏️（编辑）和 🗑️（删除）两个按钮
- 点击 ✏️：
  - 该行变为蓝色摘要条（只读，显示当前值）
  - 摘要条正下方展开编辑表单，包含：
    - 第一行：交易类型（select）｜ 交易日期（CalendarPicker）｜ 数量
    - 第二行：价格 ｜ 手续费（可选）
    - 操作区：保存按钮 + 取消按钮 + 实时总额预览
  - 同一时间只有一行处于编辑态；点击其他行的 ✏️ 会先关闭当前编辑，再打开新的
- 保存时校验：数量 > 0，价格 > 0，日期非空
- 保存 → dispatch `UPDATE_STOCK_TRANSACTION`，折叠回普通行
- 取消 → 直接折叠，数据不变
- Escape 键：关闭当前编辑态（不保存）

### State（新增，仅在 `StockModal` 内）
```
editingTxId: string | null      // 当前编辑行的交易 ID，null 表示无
editForm: {                     // 编辑中的表单值
  action: 'buy' | 'sell'
  date: string                  // YYYY-MM-DD
  shares: string
  price: string
  commission: string
}
```

### 数据层：新增 `UPDATE_STOCK_TRANSACTION` action

```js
// dispatch payload
{
  type: 'UPDATE_STOCK_TRANSACTION',
  portfolioId: string,
  stockId: string,
  transactionId: string,
  updates: {
    action, date, shares, price, commission, total
  }
}

// reducer 逻辑（追加在 PortfolioContext reducer 中）
case 'UPDATE_STOCK_TRANSACTION':
  return {
    ...state,
    portfolios: state.portfolios.map(p =>
      p.id !== action.portfolioId ? p : {
        ...p,
        stocks: p.stocks.map(s =>
          s.id !== action.stockId ? s : {
            ...s,
            transactions: s.transactions.map(t =>
              t.id !== action.transactionId ? t : { ...t, ...action.updates }
            )
          }
        )
      }
    )
  }
```

> **重算逻辑**：修改交易记录后，需调用已有的 `calcPosition(initialShares, initialAvgCost, transactions)` 函数重算整个持仓，并将结果 `{ shares, avgCost, stockRealizedPnL }` 写回 stock 对象。与 `DELETE_STOCK_TRANSACTION` 的处理方式完全一致。

---

## 组件变更范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/contexts/PortfolioContext.jsx` | 新增 | 添加 `UPDATE_STOCK_TRANSACTION` case |
| `src/components/modals/StockModal.jsx` | 修改 | 新增编辑 symbol 及行内编辑交易记录功能 |

不涉及其他文件。

---

## 错误处理

- 股票代码为空时保存：显示行内错误提示，不关闭编辑态
- 交易数量 / 价格无效时保存：在操作区上方显示错误文字，不关闭编辑态
- 编辑态下关闭整个 Modal（按 ✕ 或 Escape）：直接丢弃草稿，正常关闭

---

## 不在本次范围内

- 批量编辑多条交易记录
- 编辑 `initialShares` / `initialAvgCost` 初始持仓字段
- 撤销 / 重做
