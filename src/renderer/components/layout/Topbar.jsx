import React from 'react'
import { useAppStore } from '../../store/useAppStore'
import Button from '../ui/Button'
import styles from './Topbar.module.css'

const PAGE_TITLES = {
  dashboard:      'Dashboard',
  campaigns:      'Campaigns',
  'new-campaign': 'New campaign',
  contacts:       'Contacts',
  servers:        'Email servers',
  templates:      'Templates',
  analytics:      'Analytics',
  verify:         'Email verification',
  smtp:           'SMTP tester',
}

export default function Topbar({ licenseInfo }) {
  const { activePage, setActivePage } = useAppStore()

  const daysLeft      = licenseInfo?.daysRemaining
  const isLifetime    = licenseInfo?.isLifetime
  const expiringSoon  = licenseInfo?.expiringSoon

  return (
    <header className={styles.topbar}>
      <h1 className={styles.title}>{PAGE_TITLES[activePage] || 'Dashboard'}</h1>

      {/* License badge */}
      {licenseInfo && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
          background: isLifetime ? '#EEF0FF'
            : expiringSoon ? '#FDEDEC'
            : '#E8F7EE',
          color: isLifetime ? '#4A3AFF'
            : expiringSoon ? '#C0392B'
            : '#1D7348',
        }}>
          {isLifetime
            ? '♾ Lifetime'
            : expiringSoon
              ? `⚠ ${daysLeft}d left`
              : `✓ ${daysLeft}d left`}
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={() => setActivePage('verify')}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1L1 3.5v4C1 10.3 3.5 12.5 6.5 13c3-.5 5.5-2.7 5.5-5.5v-4L6.5 1z"
              stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          Verify emails
        </Button>
        <Button variant="primary" size="sm" onClick={() => setActivePage('new-campaign')}>
          + New campaign
        </Button>
      </div>
    </header>
  )
}
