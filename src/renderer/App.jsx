import React, { useEffect, useState } from 'react'
import Layout from './components/layout/Layout'
import Dashboard from './pages/Dashboard'
import Campaigns from './pages/Campaigns'
import NewCampaign from './pages/NewCampaign'
import Contacts from './pages/Contacts'
import Servers from './pages/Servers'
import Templates from './pages/Templates'
import Analytics from './pages/Analytics'
import VerifyEmails from './pages/VerifyEmails'
import SmtpTester from './pages/SmtpTester'
import ActivationScreen from './pages/ActivationScreen'
import Toast from './components/ui/Toast'
import { useAppStore } from './store/useAppStore'

const PAGES = {
  dashboard:      Dashboard,
  campaigns:      Campaigns,
  'new-campaign': NewCampaign,
  contacts:       Contacts,
  servers:        Servers,
  templates:      Templates,
  analytics:      Analytics,
  verify:         VerifyEmails,
  smtp:           SmtpTester,
}

export default function App() {
  const { activePage, addToast, setCampaignProgress, updateCampaign } = useAppStore()
  const [licenseStatus, setLicenseStatus] = useState('checking')
  const [licenseInfo,   setLicenseInfo]   = useState(null)
  const [expiredPlan,   setExpiredPlan]   = useState(false)
  const isDev = import.meta.env.DEV

  useEffect(() => {
    if (isDev) {
      setLicenseStatus('valid')
      return
    }

    checkLicenseStatus()

    if (window.api) {
      window.api.on('sending:progress', (data) => {
        setCampaignProgress(data.campaignId, data)
        updateCampaign(data.campaignId, {
          sent_count: data.sent_count,
          failed_count: data.failed_count,
        })
      })
      window.api.on('campaign:statusChange', (id, status) => {
        updateCampaign(id, { status })
        if (status === 'sent') addToast('Campaign completed!', 'success')
      })
    }
  }, [])

  async function checkLicenseStatus() {
    try {
      const result = await window.api.license.check()
      if (result.valid) {
        setLicenseInfo(result.license)
        setLicenseStatus('valid')

        // Warn if expiring soon
        if (result.license?.expiringSoon) {
          addToast(
            `License expires in ${result.license.daysRemaining} day(s) — renew soon`,
            'warning',
            8000
          )
        }
      } else {
        setExpiredPlan(result.reason === 'expired')
        setLicenseStatus('invalid')
      }
    } catch {
      setLicenseStatus('invalid')
    }
  }

  // Checking
  if (licenseStatus === 'checking') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#F7F7F8',
        fontFamily: 'DM Sans, system-ui', color: '#5A5A72', fontSize: 14
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, border: '3px solid #E0E0E8',
            borderTopColor: '#4A3AFF', borderRadius: '50%',
            animation: 'spin 0.7s linear infinite', margin: '0 auto 16px'
          }}/>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          Verifying license...
        </div>
      </div>
    )
  }

  // Not licensed / expired
  if (licenseStatus === 'invalid') {
    return (
      <>
        <ActivationScreen
          onActivated={(info) => {
            setLicenseInfo(info)
            setExpiredPlan(false)
            setLicenseStatus('valid')
          }}
          expiredPlan={expiredPlan}
        />
        <Toast />
      </>
    )
  }

  // Main app
  const PageComponent = PAGES[activePage] || Dashboard
  return (
    <>
      <Layout licenseInfo={licenseInfo}>
        <PageComponent />
      </Layout>
      <Toast />
    </>
  )
}
