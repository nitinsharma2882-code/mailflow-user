import React from 'react'
import styles from './UI.module.css'

/* ── Badge ── */
export function Badge({ children, variant = 'default' }) {
  return <span className={`${styles.badge} ${styles['badge-' + variant]}`}>{children}</span>
}

/* ── Stat Card ── */
export function StatCard({ label, value, delta, deltaType = 'neutral' }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {delta && <div className={`${styles.statDelta} ${styles[deltaType]}`}>{delta}</div>}
    </div>
  )
}

/* ── Progress Bar ── */
export function ProgressBar({ value = 0, max = 100, color = 'purple' }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className={styles.progTrack}>
      <div className={`${styles.progFill} ${styles['prog-' + color]}`} style={{ width: pct + '%' }} />
    </div>
  )
}

/* ── Section Header ── */
export function SectionHeader({ title, children }) {
  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children && <div className={styles.sectionActions}>{children}</div>}
    </div>
  )
}

/* ── Card ── */
export function Card({ children, className = '', padding = true }) {
  return (
    <div className={`${styles.card} ${padding ? styles.cardPadded : ''} ${className}`}>
      {children}
    </div>
  )
}

/* ── Table ── */
export function Table({ columns, data, emptyText = 'No data', onRowClick }) {
  if (!data || data.length === 0) {
    return (
      <div className={styles.tableWrap}>
        <div className={styles.emptyState}>{emptyText}</div>
      </div>
    )
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={{ width: col.width }}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={row.id || i} onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : {}}>
              {columns.map(col => (
                <td key={col.key}>
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Input ── */
export function Input({ label, error, className = '', ...props }) {
  return (
    <div className={`${styles.formField} ${className}`}>
      {label && <label className={styles.label}>{label}</label>}
      <input className={`${styles.input} ${error ? styles.inputError : ''}`} {...props} />
      {error && <span className={styles.fieldError}>{error}</span>}
    </div>
  )
}

/* ── Select ── */
export function Select({ label, error, children, className = '', ...props }) {
  return (
    <div className={`${styles.formField} ${className}`}>
      {label && <label className={styles.label}>{label}</label>}
      <select className={`${styles.input} ${error ? styles.inputError : ''}`} {...props}>
        {children}
      </select>
      {error && <span className={styles.fieldError}>{error}</span>}
    </div>
  )
}

/* ── Textarea ── */
export function Textarea({ label, error, className = '', ...props }) {
  return (
    <div className={`${styles.formField} ${className}`}>
      {label && <label className={styles.label}>{label}</label>}
      <textarea className={`${styles.input} ${styles.textarea} ${error ? styles.inputError : ''}`} {...props} />
      {error && <span className={styles.fieldError}>{error}</span>}
    </div>
  )
}

/* ── Divider ── */
export function Divider() {
  return <hr className={styles.divider} />
}

/* ── Empty State ── */
export function Empty({ icon, title, description, action }) {
  return (
    <div className={styles.emptyFull}>
      {icon && <div className={styles.emptyIcon}>{icon}</div>}
      <div className={styles.emptyTitle}>{title}</div>
      {description && <div className={styles.emptyDesc}>{description}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

/* ── Gauge Row ── */
export function GaugeRow({ label, value, max = 100, color = '#7B72FF' }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className={styles.gaugeRow}>
      <span className={styles.gaugeLabel}>{label}</span>
      <div className={styles.gaugeTrack}>
        <div className={styles.gaugeFill} style={{ width: pct + '%', background: color }} />
      </div>
      <span className={styles.gaugeVal}>{pct}%</span>
    </div>
  )
}

/* ── Loading Spinner ── */
export function Spinner({ size = 24 }) {
  return (
    <div className={styles.spinnerWrap}>
      <div className={styles.bigSpinner} style={{ width: size, height: size }} />
    </div>
  )
}
