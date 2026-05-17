import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import { StatCard, SectionHeader, Table, Card, GaugeRow, Badge, ProgressBar, Spinner } from '../components/ui/UI'
import Button from '../components/ui/Button'
import styles from './Pages.module.css'

export default function Dashboard() {
  const { analytics, setAnalytics, setActivePage, campaigns, setCampaigns, setLoading, isLoading, addToast } = useAppStore()

  const [instanceInfo, setInstanceInfo]         = useState(null)
  const [loadingInstance, setLoadingInstance]   = useState(false)
  const [planInfo, setPlanInfo]                 = useState(null)

  const handleRefreshInstance = useCallback(async () => {
    setLoadingInstance(true)
    try {
      const result = await window.api.license.getInstance()
      if (result && result.success && result.ip) {
        setInstanceInfo(result)
        addToast('✅ Server assigned — IP: ' + result.ip, 'success')
      } else if (result && result.limitReached) {
        addToast('⚠️ Instance limit reached. Your plan allows ' + result.max_instances + ' instance(s). Contact admin to upgrade.', 'error')
      } else if (result && result.error) {
        addToast('⚠ ' + result.error, 'error')
      } else {
        addToast('No server assigned yet. Contact admin to add instances to pool.', 'error')
      }
    } catch (err) {
      addToast('Failed to fetch server: ' + err.message, 'error')
    } finally {
      setLoadingInstance(false)
    }
  }, [addToast])

  const handleReleaseInstance = useCallback(async () => {
    const confirmed = confirm(
      'Release your current instance?\n\n' +
      '• If pool has available instances — you get one immediately\n' +
      '• If pool is empty — new instance created (5-10 minutes)\n\n' +
      'Continue?'
    )
    if (!confirmed) return
    setLoadingInstance(true)
    try {
      const result = await window.api.license.releaseInstance()
      if (result && result.success) {
        if (result.newIp) {
          setInstanceInfo({
            success:    true,
            ip:         result.newIp,
            status:     'assigned',
            assignedAt: new Date().toISOString(),
            agentToken: result.agentToken || 'mailflow-agent-2026',
            agentPort:  result.agentPort  || 3000,
          })
          addToast('✅ New server assigned from pool: ' + result.newIp, 'success')
        } else if (result.rebuilding) {
          setInstanceInfo(null)
          addToast('⏳ Instance released. New one being created — click Refresh Server in 5-10 minutes', 'success')
        } else {
          setInstanceInfo(null)
          addToast('✅ ' + (result.message || 'Instance released'), 'success')
        }
      } else {
        addToast('❌ ' + (result?.error || 'Release failed'), 'error')
      }
    } catch (err) {
      addToast('❌ Error: ' + err.message, 'error')
    } finally {
      setLoadingInstance(false)
    }
  }, [addToast])

  useEffect(() => {
    loadData()
    loadPlan()
  }, [])

  useEffect(function() {
    autoLoadInstance()
    var interval = setInterval(function() {
      window.api.license.getInstance().then(function(result) {
        if (result && result.success && result.ip) {
          setInstanceInfo(result)
        }
      }).catch(function() {})
    }, 30000)
    return function() { clearInterval(interval) }
  }, [])

  useEffect(function() {
    function handleInstanceChanged(data) {
      if (data && data.ip) {
        setInstanceInfo(function(prev) { return Object.assign({}, prev, { ip: data.ip, status: 'assigned' }) })
      } else {
        setInstanceInfo(null)
      }
    }
    window.api.on('instance:changed', handleInstanceChanged)
    return function() { window.api.off('instance:changed', handleInstanceChanged) }
  }, [])

  async function autoLoadInstance() {
    try {
      const result = await window.api.license.getInstance()
      if (result && result.success && result.ip) {
        setInstanceInfo(result)
        console.log('[Dashboard] Instance loaded:', result.ip)
      } else {
        setInstanceInfo(null)
      }
    } catch (err) {
      console.log('[Dashboard] No instance:', err.message)
      setInstanceInfo(null)
    }
  }

  async function loadPlan() {
    try {
      const result = await window.api.license.getPlan()
      if (result && result.success) setPlanInfo(result)
    } catch {}
  }

  async function loadData() {
    setLoading('dashboard', true)
    try {
      const [analyticsData, campaignData] = await Promise.all([
        window.api.analytics.getDashboard(),
        window.api.campaigns.getAll(),
      ])
      setAnalytics(analyticsData)
      setCampaigns(campaignData)
    } catch (err) {
      addToast('Failed to load dashboard', 'error')
    } finally {
      setLoading('dashboard', false)
    }
  }

  if (isLoading('dashboard')) return <Spinner />

  const t = analytics?.totals || {}
  const openRate  = t.total_sent > 0 ? ((t.total_opens  / t.total_sent) * 100).toFixed(1) : '0.0'
  const clickRate = t.total_sent > 0 ? ((t.total_clicks / t.total_sent) * 100).toFixed(1) : '0.0'
  const bounceRate= t.total_sent > 0 ? ((t.total_bounces/ t.total_sent) * 100).toFixed(1) : '0.0'

  const campaignCols = [
    { key: 'name',    label: 'Campaign', width: '28%',
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v}</div>
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
            {row.list_name || '—'} · {row.total_recipients?.toLocaleString() || 0} contacts
          </div>
        </div>
      )
    },
    { key: 'status', label: 'Status', width: '12%',
      render: v => <Badge variant={v}>{v}</Badge>
    },
    { key: 'sent_count', label: 'Sent', width: '10%',
      render: v => v?.toLocaleString() || '—'
    },
    { key: 'open_count', label: 'Opens', width: '10%',
      render: (v, row) => row.sent_count > 0
        ? ((v / row.sent_count) * 100).toFixed(1) + '%' : '—'
    },
    { key: 'sent_count', label: 'Progress', width: '14%',
      render: (v, row) => row.total_recipients > 0
        ? <ProgressBar value={v || 0} max={row.total_recipients} />
        : <ProgressBar value={0} max={1} />
    },
    { key: 'id', label: '', width: '14%',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" onClick={() => setActivePage('analytics')}>Stats</Button>
          {row.status === 'running' &&
            <Button size="sm" variant="ghost-danger"
              onClick={() => handlePause(row.id)}>Pause</Button>}
        </div>
      )
    },
  ]

  async function handlePause(id) {
    await window.api.sending.pauseCampaign(id)
    addToast('Campaign paused', 'info')
    loadData()
  }

  return (
    <div>
      {/* My Assigned Server card */}
      <div style={{
        background: 'var(--bg2)',
        border: '1px solid var(--bdr)',
        borderRadius: 'var(--rad-l)',
        padding: '16px 20px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40,
            background: instanceInfo ? 'var(--gr-l)' : 'var(--bg3)',
            border: '1px solid ' + (instanceInfo ? 'var(--gr)' : 'var(--bdr)'),
            borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20
          }}>🖥</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>My Assigned Server</div>
            {instanceInfo && instanceInfo.ip ? (
              <div style={{ fontSize: 12, color: 'var(--txt2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontFamily: 'monospace',
                  background: 'var(--bg3)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  color: 'var(--pu)',
                  fontWeight: 600
                }}>{instanceInfo.ip}</span>
                <span style={{
                  background: 'var(--gr-l)',
                  color: 'var(--gr)',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 20
                }}>● {instanceInfo.status || 'Ready'}</span>
                {instanceInfo.assignedAt && (
                  <span style={{ color: 'var(--txt3)', fontSize: 11 }}>
                    Since {new Date(instanceInfo.assignedAt).toLocaleDateString()}
                  </span>
                )}
                <button
                  onClick={function() {
                    navigator.clipboard.writeText(instanceInfo.ip)
                    addToast('✅ IP copied to clipboard', 'success')
                  }}
                  style={{
                    padding: '3px 8px',
                    background: 'transparent',
                    border: '1px solid var(--bdr)',
                    borderRadius: 4,
                    color: 'var(--txt3)',
                    fontSize: 10,
                    cursor: 'pointer',
                  }}>
                  Copy
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
                No server assigned yet — click Refresh to check
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={handleRefreshInstance} loading={loadingInstance} variant="primary" size="sm">
            🔄 Refresh Server
          </Button>
          <Button onClick={handleReleaseInstance} variant="ghost-danger" size="sm" loading={loadingInstance}>
            🔄 Release Instance
          </Button>
        </div>
      </div>

      {/* Instance Plan card */}
      {planInfo && (
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--bdr)',
          borderRadius: 'var(--rad-l)', padding: '14px 20px',
          marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, fontSize: 18,
            background: planInfo.plan === 'premium' ? 'rgba(245,166,35,0.12)' : planInfo.plan === 'standard' ? 'rgba(74,58,255,0.12)' : 'rgba(255,255,255,0.06)',
            border: '1px solid ' + (planInfo.plan === 'premium' ? 'rgba(245,166,35,0.3)' : planInfo.plan === 'standard' ? 'rgba(74,58,255,0.3)' : 'var(--bdr)'),
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {planInfo.plan === 'premium' ? '⭐' : planInfo.plan === 'standard' ? '🔷' : '🔲'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Instance Plan</span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.5px',
                background: planInfo.plan === 'premium' ? 'rgba(245,166,35,0.15)' : planInfo.plan === 'standard' ? 'rgba(74,58,255,0.15)' : 'rgba(255,255,255,0.08)',
                color: planInfo.plan === 'premium' ? '#F5A623' : planInfo.plan === 'standard' ? '#7B72FF' : 'var(--txt2)'
              }}>
                {planInfo.label || planInfo.plan}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt2)' }}>
              {planInfo.usedInstances || 0} / {planInfo.maxInstances || 1} instance{(planInfo.maxInstances || 1) !== 1 ? 's' : ''} used
              <div style={{ marginTop: 6, height: 4, background: 'var(--bdr)', borderRadius: 2, width: 200, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: ((planInfo.usedInstances || 0) / (planInfo.maxInstances || 1) * 100) + '%',
                  background: planInfo.plan === 'premium' ? '#F5A623' : planInfo.plan === 'standard' ? '#7B72FF' : '#888'
                }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Instance limit warning */}
      {planInfo && planInfo.usedInstances >= planInfo.max_instances && (
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid #EF4444',
          borderRadius: 'var(--rad)',
          padding: '10px 16px',
          marginBottom: 12,
          fontSize: 12,
          color: '#EF4444',
          fontWeight: 500,
        }}>
          ⚠️ You have used all {planInfo.max_instances} instance(s) on your {planInfo.label} plan.
          Contact admin to upgrade your plan.
        </div>
      )}

      {/* Stats row */}
      <div className={styles.statGrid}>
        <StatCard label="Total sent" value={(t.total_sent || 0).toLocaleString()}
          delta={`${t.total_campaigns || 0} campaigns`} deltaType="neutral" />
        <StatCard label="Open rate" value={openRate + '%'}
          delta="Industry avg: 21%" deltaType="up" />
        <StatCard label="Click rate" value={clickRate + '%'}
          delta="Industry avg: 2.6%" deltaType="up" />
        <StatCard label="Bounce rate" value={bounceRate + '%'}
          delta={bounceRate > 3 ? 'Above safe range' : 'Within safe range'}
          deltaType={bounceRate > 3 ? 'down' : 'neutral'} />
      </div>

      {/* Recent campaigns */}
      <SectionHeader title="Recent campaigns">
        <Button size="sm" variant="ghost" onClick={() => setActivePage('campaigns')}>View all →</Button>
        <Button size="sm" variant="primary" onClick={() => setActivePage('new-campaign')}>+ New</Button>
      </SectionHeader>
      <div style={{ marginBottom: 20 }}>
        <Table
          columns={campaignCols}
          data={campaigns.slice(0, 5)}
          emptyText="No campaigns yet — create your first one above"
        />
      </div>

      {/* Bottom row: server health + queue */}
      <div className={styles.twoCol}>
        <Card>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>Server health</div>
          {analytics?.serverHealth?.length > 0
            ? analytics.serverHealth.map(s => (
                <GaugeRow
                  key={s.id}
                  label={s.name}
                  value={s.sent_today}
                  max={s.daily_limit || 500}
                  color={
                    (s.sent_today / (s.daily_limit || 500)) > 0.85 ? '#C0392B' :
                    (s.sent_today / (s.daily_limit || 500)) > 0.6  ? '#B86E00' : '#7B72FF'
                  }
                />
              ))
            : <div style={{ color: 'var(--txt3)', fontSize: 13 }}>No servers configured yet.</div>
          }
          <Button size="sm" variant="ghost" onClick={() => setActivePage('servers')}
            style={{ marginTop: 10 }}>
            Manage servers →
          </Button>
        </Card>

        <Card>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>Summary</div>
          <InfoRow label="Total campaigns" value={t.total_campaigns || 0} />
          <InfoRow label="Total delivered" value={(t.total_delivered || 0).toLocaleString()} />
          <InfoRow label="Total opens" value={(t.total_opens || 0).toLocaleString()} />
          <InfoRow label="Total clicks" value={(t.total_clicks || 0).toLocaleString()} />
          <InfoRow label="Total bounces" value={(t.total_bounces || 0).toLocaleString()}
            valueColor={t.total_bounces > 100 ? 'var(--re)' : undefined} />
          <InfoRow label="Total failed" value={(t.total_failed || 0).toLocaleString()}
            valueColor={t.total_failed > 0 ? 'var(--am)' : undefined} />
        </Card>
      </div>
    </div>
  )
}

function InfoRow({ label, value, valueColor }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', fontSize:13,
      padding:'7px 0', borderBottom:'1px solid var(--bdr)' }}>
      <span style={{ color:'var(--txt2)' }}>{label}</span>
      <span style={{ fontWeight:500, color: valueColor || 'var(--txt)' }}>{value}</span>
    </div>
  )
}
