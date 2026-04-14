import React, { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { StatCard, SectionHeader, Table, Card, GaugeRow, Badge, ProgressBar, Spinner } from '../components/ui/UI'
import Button from '../components/ui/Button'
import styles from './Pages.module.css'

export default function Dashboard() {
  const { analytics, setAnalytics, setActivePage, campaigns, setCampaigns, setLoading, isLoading, addToast } = useAppStore()

  useEffect(() => {
    loadData()
  }, [])

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
