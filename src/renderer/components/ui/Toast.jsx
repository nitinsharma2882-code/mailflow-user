import React from 'react'
import { useAppStore } from '../../store/useAppStore'
import styles from './Toast.module.css'

export default function Toast() {
  const { toasts } = useAppStore()

  return (
    <div className={styles.container}>
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${styles[t.type]}`}>
          {t.type === 'success' && <span className={styles.icon}>✓</span>}
          {t.type === 'error' && <span className={styles.icon}>✕</span>}
          {t.message}
        </div>
      ))}
    </div>
  )
}
