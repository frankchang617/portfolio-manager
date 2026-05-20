import { useState } from 'react'
import Modal from '../Modal'
import { usePortfolio } from '../../contexts/PortfolioContext'

export default function PortfolioModal({ isOpen, onClose, editPortfolio = null }) {
  const { dispatch } = usePortfolio()
  const [name, setName] = useState(editPortfolio?.name || '')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return

    if (editPortfolio) {
      dispatch({ type: 'UPDATE_PORTFOLIO', id: editPortfolio.id, updates: { name: name.trim() } })
    } else {
      dispatch({ type: 'CREATE_PORTFOLIO', name: name.trim() })
    }
    onClose()
    setName('')
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editPortfolio ? '重命名组合' : '新建投资组合'} size="sm">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="label">组合名称</label>
          <input
            className="input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：科技股组合"
            autoFocus
            maxLength={50}
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">取消</button>
          <button type="submit" className="btn-primary" disabled={!name.trim()}>
            {editPortfolio ? '保存' : '创建'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
