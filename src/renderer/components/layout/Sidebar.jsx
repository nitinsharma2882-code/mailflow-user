import React from 'react'
import { useAppStore } from '../../store/useAppStore'
import styles from './Sidebar.module.css'

const NAV = [
  {
    section: 'Workspace',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: IconGrid },
      { id: 'campaigns', label: 'Campaigns', icon: IconList, badge: null },
      { id: 'new-campaign', label: 'New campaign', icon: IconPlus },
    ]
  },
  {
    section: 'Tools',
    items: [
      { id: 'contacts', label: 'Contacts', icon: IconUsers },
      { id: 'servers', label: 'Servers', icon: IconServer },
      { id: 'templates', label: 'Templates', icon: IconTemplate },
      { id: 'analytics', label: 'Analytics', icon: IconChart },
      { id: 'verify', label: 'Email verify', icon: IconShield },
      { id: 'smtp', label: 'SMTP tester', icon: IconCheck },
    ]
  }
]

export default function Sidebar() {
  const { activePage, setActivePage, campaigns } = useAppStore()

  const runningCount = campaigns.filter(c => c.status === 'running').length

  return (
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoMark}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="3" width="16" height="12" rx="2" stroke="white" strokeWidth="1.4"/>
            <path d="M1 6.5L9 11.5L17 6.5" stroke="white" strokeWidth="1.4"/>
          </svg>
        </div>
        <span className={styles.logoName}>Mailflow</span>
        <span className={styles.logoTag}>User</span>
      </div>

      {/* Nav */}
      <nav className={styles.nav}>
        {NAV.map(group => (
          <div key={group.section} className={styles.group}>
            <div className={styles.groupLabel}>{group.section}</div>
            {group.items.map(item => {
              const Icon = item.icon
              const isActive = activePage === item.id
              const badge = item.id === 'campaigns' && runningCount > 0 ? runningCount : null

              return (
                <button
                  key={item.id}
                  className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                  onClick={() => setActivePage(item.id)}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                  {badge && <span className={styles.badge}>{badge}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.userRow}>
          <div className={styles.avatar}>RK</div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>Rahul Kumar</div>
            <div className={styles.userEmail}>rahul@company.com</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

// Icon components
function IconGrid({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="1" width="6" height="6" rx="1.5"/>
    <rect x="9" y="1" width="6" height="6" rx="1.5"/>
    <rect x="1" y="9" width="6" height="6" rx="1.5"/>
    <rect x="9" y="9" width="6" height="6" rx="1.5"/>
  </svg>
}
function IconList({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 4h12v2H2zm0 4h12v2H2zm0 4h8v2H2z"/>
  </svg>
}
function IconPlus({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8"/>
  </svg>
}
function IconUsers({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <circle cx="6" cy="5" r="3"/>
    <path d="M1 14c0-3 2.2-4.5 5-4.5s5 1.5 5 4.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
    <path d="M11 2a3 3 0 010 6M13 14c0-2-1-3.5-3-4" stroke="currentColor" strokeWidth="1.2" fill="none"/>
  </svg>
}
function IconServer({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="2.5" width="14" height="4" rx="1.5"/>
    <rect x="1" y="9.5" width="14" height="4" rx="1.5"/>
    <circle cx="13" cy="4.5" r="1"/>
    <circle cx="13" cy="11.5" r="1"/>
  </svg>
}
function IconTemplate({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="1.5" width="14" height="3" rx="1"/>
    <path d="M1 7h14M1 10h10M1 13h12" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
}
function IconChart({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 13.5V8h3v5.5H1zm5 0V4h3v9.5H6zm5 0V1.5h4v12h-4z"/>
  </svg>
}
function IconShield({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1.5L2 4.5v5C2 13 4.8 15.5 8 16.5c3.2-1 6-3.5 6-7v-5L8 1.5z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
    <path d="M5.5 8.5l2 2 3-3.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
  </svg>
}
function IconCheck({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4.5 8l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
}
