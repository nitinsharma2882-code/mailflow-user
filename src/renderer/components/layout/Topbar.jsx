import React from 'react'
import { useAppStore } from '../../store/useAppStore'
import Button from '../ui/Button'
import styles from './Topbar.module.css'

const PAGE_TITLES = {
  dashboard:       'Dashboard',
  campaigns:       'Campaigns',
  'new-campaign':  'New campaign',
  contacts:        'Contacts',
  servers:         'Email servers',
  templates:       'Templates',
  analytics:       'Analytics',
  verify:          'Email verification',
  smtp:            'SMTP tester',
  'test-campaign': 'Test Campaign',
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
        <button
          disabled
          title="Email Verification — Coming in Version 2"
          style={{
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid #CCCCCC',
            borderRadius: 6,
            color: '#AAAAAA',
            fontSize: 12,
            cursor: 'not-allowed',
            opacity: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
          ○ Verify emails <span style={{fontSize:9, background:'#E8E8E8', padding:'1px 5px', borderRadius:3, color:'#888'}}>v2</span>
        </button>
        <Button variant="ghost" size="sm" onClick={() => setActivePage('test-campaign')}>
          🧪 Test
        </Button>
        <Button variant="primary" size="sm" onClick={() => setActivePage('new-campaign')}>
          + New campaign
        </Button>
      </div>
    </header>
  )
}
