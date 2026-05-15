import React from 'react'
import { useAppStore } from '../../store/useAppStore'
import styles from './Toast.module.css'

export default function Toast() {
  const { toasts, removeToast } = useAppStore()

  return (
    <div className={styles.container}>
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${styles[t.type]}`}>
          {t.type === 'success' && <span className={styles.icon}>✓</span>}
          {t.type === 'error' && <span className={styles.icon}>✕</span>}
          <span className={styles.message}>{t.message}</span>
          <button className={styles.dismiss} onClick={() => removeToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
