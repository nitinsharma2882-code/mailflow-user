import React, { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import { SectionHeader, Badge, ProgressBar } from '../components/ui/UI'
import Button from '../components/ui/Button'

export default function Campaigns() {
  const { campaigns, setCampaigns, setActivePage, addToast } = useAppStore()
  const [filter, setFilter]         = useState('all')
  const [liveStats, setLiveStats]   = useState({}) // campaignId -> { sent, failed, total }
  const refreshRef = useRef(null)

  useEffect(() => {
    window.api.campaigns.getAll().then(setCampaigns)

    // Listen for real-time progress from sending engine
    window.api.on('sending:progress', ({ campaignId, sent_count, failed_count, total_recipients }) => {
      setLiveStats(prev => ({
        ...prev,
        [campaignId]: { sent: sent_count, failed: failed_count, total: total_recipients }
      }))
    })

    // When campaign finishes — refresh list and navigate to campaigns
    window.api.on('campaign:statusChange', (campaignId, status) => {
      window.api.campaigns.getAll().then(setCampaigns)
      if (status === 'sent') {
        addToast('✅ Campaign completed!', 'success')
        setActivePage('campaigns')
      }
    })

    // Auto-refresh every 3s while any campaign is running
    refreshRef.current = setInterval(() => {
      window.api.campaigns.getAll().then(data => {
        setCampaigns(data)
        const hasRunning = data.some(c => c.status === 'running')
        if (!hasRunning) {
          clearInterval(refreshRef.current)
        }
      })
    }, 3000)

    return () => clearInterval(refreshRef.current)
  }, [])

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter)

  async function handlePause(id) {
    await window.api.sending.pauseCampaign(id)
    addToast('Campaign paused')
    window.api.campaigns.getAll().then(setCampaigns)
  }

  async function handleResume(id) {
    await window.api.sending.resumeCampaign(id)
    addToast('Campaign resumed', 'success')
    window.api.campaigns.getAll().then(setCampaigns)
  }

  async function handleCancel(id) {
    if (!confirm('Cancel this campaign?')) return
    await window.api.sending.cancelCampaign(id)
    addToast('Campaign cancelled')
    window.api.campaigns.getAll().then(setCampaigns)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this campaign?')) return
    await window.api.campaigns.delete(id)
    addToast('Campaign deleted')
    window.api.campaigns.getAll().then(setCampaigns)
  }

  async function handleExport(id, type) {
    const result = await window.api.sending.exportResults(id, type)
    if (result.success) addToast(`Downloaded ${result.count} rows`, 'success')
  }

  return (
    <div>
      <SectionHeader title="All Campaigns">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 'var(--rad)', border: '1px solid var(--bdr2)',
              background: 'var(--bg2)', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}>
            <option value="all">All status</option>
            <option value="running">Running</option>
            <option value="sent">Sent</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Draft</option>
            <option value="paused">Paused</option>
          </select>
          <Button variant="primary" size="sm" onClick={() => setActivePage('new-campaign')}>
            + New Campaign
          </Button>
        </div>
      </SectionHeader>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--txt3)', fontSize: 13 }}>
          No campaigns found. Create your first campaign to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(row => {
            // Use live stats if available (real-time), else use DB values
            const live  = liveStats[row.id]
            const sent  = live?.sent  ?? row.sent_count  ?? 0
            const failed = live?.failed ?? row.failed_count ?? 0
            const total = live?.total ?? row.total_recipients ?? 0
            const pct   = total > 0 ? Math.round((sent / total) * 100) : 0
            const openRate = sent > 0 ? ((row.open_count || 0) / sent * 100).toFixed(1) : null

            return (
              <div key={row.id} style={{
                background: 'var(--bg2)', border: '1px solid var(--bdr)',
                borderRadius: 'var(--rad-l)', padding: '16px 18px',
                borderLeft: row.status === 'running' ? '3px solid var(--pu)' : '1px solid var(--bdr)',
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{row.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
                      {new Date(row.created_at).toLocaleDateString()} · {row.list_name || 'No list'} · {row.template_name || 'No template'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 12 }}>
                    <Badge variant={row.status}>{row.status}</Badge>
                    {row.status === 'running' && (
                      <span style={{ fontSize: 11, color: 'var(--pu)', fontWeight: 600, animation: 'pulse 1s infinite' }}>
                        ● LIVE
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 20, marginBottom: 10, flexWrap: 'wrap' }}>
                  {[
                    ['Recipients', total.toLocaleString(),  'var(--txt)'],
                    ['Sent',       sent.toLocaleString(),   'var(--gr)'],
                    ['Failed',     failed.toLocaleString(), failed > 0 ? 'var(--re)' : 'var(--txt3)'],
                    ['Opens',      openRate ? openRate + '%' : '—', 'var(--pu)'],
                  ].map(([label, val, color]) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Progress bar — show for running/paused/sent */}
                {total > 0 && row.status !== 'draft' && row.status !== 'scheduled' && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--txt3)', marginBottom: 4 }}>
                      <span>
                        {row.status === 'running' ? `Sending... ${sent.toLocaleString()} / ${total.toLocaleString()}` : `${sent.toLocaleString()} / ${total.toLocaleString()} sent`}
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div style={{ background: 'var(--bdr)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                      <div style={{
                        background: row.status === 'running' ? 'var(--pu)' : row.status === 'sent' ? 'var(--gr)' : 'var(--txt3)',
                        height: '100%', borderRadius: 4,
                        width: `${pct}%`,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {row.status === 'running' && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => handlePause(row.id)}>⏸ Pause</Button>
                      <Button size="sm" variant="ghost-danger" onClick={() => handleCancel(row.id)}>✕ Cancel</Button>
                    </>
                  )}
                  {row.status === 'paused' && (
                    <Button size="sm" variant="success" onClick={() => handleResume(row.id)}>▶ Resume</Button>
                  )}
                  {row.status === 'sent' && (
                    <>
                      <Button size="sm" onClick={() => handleExport(row.id, 'successful')}>↓ Sent CSV</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleExport(row.id, 'failed')}>↓ Failed CSV</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost-danger" onClick={() => handleDelete(row.id)}>🗑 Delete</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
