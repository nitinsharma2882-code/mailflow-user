import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import { SectionHeader, Badge, ProgressBar } from '../components/ui/UI'
import Button from '../components/ui/Button'

const RAILWAY_URL = 'https://mailflow-tracking-server-production.up.railway.app'
const ADMIN_KEY   = 'mailflow-admin-2026'

export default function Campaigns() {
  const { campaigns, setCampaigns, setActivePage, addToast } = useAppStore()
  const [filter, setFilter]       = useState('all')
  const [openersPanel, setOpenersPanel] = useState(null) // { campaignId, campaignName }
  const [openers, setOpeners]     = useState([])
  const [openersLoading, setOpenersLoading] = useState(false)

  const load = useCallback(() => {
    window.api.campaigns.getAll()
      .then(data => setCampaigns(Array.isArray(data) ? data : []))
      .catch(err => console.error('[Campaigns] Failed to load:', err))
  }, [setCampaigns])

  useEffect(() => {
    load()

    // campaign:statusChange triggers a full reload (fired when campaign completes/cancels)
    const onStatusChange = () => load()
    window.api.on('campaign:statusChange', onStatusChange)

    // Auto-refresh every 5s for running campaigns
    const interval = setInterval(() => {
      const current = useAppStore.getState().campaigns
      const hasRunning = Array.isArray(current) && current.some(c => c.status === 'running')
      if (hasRunning) load()
    }, 5000)

    return () => {
      clearInterval(interval)
      window.api.off('campaign:statusChange', onStatusChange)
    }
  }, [load])

  const safeCampaigns = Array.isArray(campaigns) ? campaigns : []
  const filtered = filter === 'all' ? safeCampaigns : safeCampaigns.filter(c => c.status === filter)

  async function handlePause(id) {
    await window.api.sending.pauseCampaign(id)
    addToast('Campaign paused')
    load()
  }

  async function handleResume(id) {
    await window.api.sending.resumeCampaign(id)
    addToast('Campaign resumed', 'success')
    load()
  }

  async function handleCancel(id) {
    if (!confirm('Cancel this campaign? Remaining emails will not be sent.')) return
    await window.api.sending.cancelCampaign(id)
    addToast('Campaign cancelled')
    load()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this campaign and all its data?')) return
    await window.api.campaigns.delete(id)
    addToast('Campaign deleted')
    load()
  }

  async function handleExport(id, type) {
    const result = await window.api.sending.exportResults(id, type)
    if (result && result.success) addToast('Downloaded ' + result.count + ' rows', 'success')
    else if (result && !result.cancelled) addToast('No data found for export', 'error')
  }

  async function handleShowOpeners(campaign) {
    setOpenersPanel({ campaignId: campaign.id, campaignName: campaign.name })
    setOpenersLoading(true)
    setOpeners([])
    try {
      // Try Railway tracking server first
      const res = await fetch(RAILWAY_URL + '/api/campaign/' + campaign.id + '/openers', {
        headers: { 'x-admin-key': ADMIN_KEY }
      })
      if (res.ok) {
        const data = await res.json()
        setOpeners(data.openers || [])
      }
    } catch {}

    // Also fetch from local analytics
    try {
      const data = await window.api.analytics.getOpeners(campaign.id)
      if (data && data.openers && data.openers.length > 0) {
        setOpeners(prev => {
          const emails = new Set(prev.map(o => o.email))
          const merged = [...prev]
          for (const o of data.openers) {
            if (!emails.has(o.email)) merged.push(o)
          }
          return merged
        })
      }
    } catch {}
    setOpenersLoading(false)
  }

  function getOpenRate(c) {
    if (!c.sent_count || c.sent_count === 0) return null
    const opens = c.open_count || 0
    return ((opens / c.sent_count) * 100).toFixed(1)
  }

  function getProgressPct(c) {
    if (!c.total_recipients || c.total_recipients === 0) return 0
    return Math.round(((c.sent_count || 0) / c.total_recipients) * 100)
  }

  const statusColor = {
    running:   { bg: '#E8F7EE', color: '#1D7348', dot: '#22C55E' },
    sent:      { bg: '#EEF2FF', color: '#4A3AFF', dot: '#4A3AFF' },
    paused:    { bg: '#FEF9E7', color: '#F39C12', dot: '#F39C12' },
    cancelled: { bg: '#F5F5F5', color: '#888',    dot: '#888'    },
    draft:     { bg: '#F5F5F5', color: '#888',    dot: '#CCC'    },
    scheduled: { bg: '#EFF6FF', color: '#3B82F6', dot: '#3B82F6' },
    failed:    { bg: '#FDEDEC', color: '#C0392B', dot: '#C0392B' },
  }

  return (
    <div>
      <SectionHeader title="All Campaigns">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 'var(--rad)', border: '1px solid var(--bdr2)',
              background: 'var(--bg2)', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}>
            <option value="all">All Status</option>
            <option value="running">Running</option>
            <option value="sent">Sent</option>
            <option value="scheduled">Scheduled</option>
            <option value="paused">Paused</option>
            <option value="draft">Draft</option>
          </select>
          <Button size="sm" variant="ghost" onClick={load}>↻ Refresh</Button>
          <Button variant="primary" size="sm" onClick={() => setActivePage('new-campaign')}>
            + New Campaign
          </Button>
        </div>
      </SectionHeader>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--txt3)', fontSize: 13 }}>
          No campaigns found. Create your first campaign to get started.
        </div>
      )}

      {filtered.map(c => {
        const sc  = statusColor[c.status] || statusColor.draft
        const pct = getProgressPct(c)
        const openRate = getOpenRate(c)
        const isRunning = c.status === 'running'

        return (
          <div key={c.id} style={{
            background: 'var(--bg2)', border: '1px solid var(--bdr)',
            borderRadius: 'var(--rad-l)', padding: '16px 20px', marginBottom: 12,
            borderLeft: isRunning ? '3px solid #22C55E' : '3px solid transparent',
          }}>
            {/* Row 1: Name + Status + Live indicator */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {isRunning && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, fontWeight: 700, color: '#22C55E' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22C55E',
                        display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                      LIVE
                    </span>
                  )}
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
                  {new Date(c.created_at).toLocaleString()} · {c.list_name || 'No list'} · {c.template_name || 'No template'}
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                background: sc.bg, color: sc.color, flexShrink: 0, textTransform: 'uppercase'
              }}>
                {c.status}
              </span>
            </div>

            {/* Row 2: Stats */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 12, flexWrap: 'wrap' }}>
              {[
                ['📊 Total',   (c.total_recipients || 0).toLocaleString(), 'var(--txt)'],
                ['✅ Sent',    (c.sent_count || 0).toLocaleString(),        '#1D7348'  ],
                ['❌ Failed',  (c.failed_count || 0).toLocaleString(),      '#C0392B'  ],
                ['👁 Opens',   (c.open_count || 0).toLocaleString(),        '#4A3AFF'  ],
                ['📈 Open %',  openRate !== null ? openRate + '%' : '—',    openRate > 25 ? '#1D7348' : openRate > 10 ? '#F39C12' : 'var(--txt2)'],
              ].map(([label, val, color]) => (
                <div key={label} style={{ textAlign: 'center', minWidth: 70 }}>
                  <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Row 3: Progress bar */}
            {c.status !== 'draft' && c.total_recipients > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--txt3)', marginBottom: 4 }}>
                  <span>{isRunning ? 'Sending...' : 'Progress'}</span>
                  <span>{(c.sent_count || 0).toLocaleString()} / {(c.total_recipients || 0).toLocaleString()} ({pct}%)</span>
                </div>
                <div style={{ background: 'var(--bdr)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    background: isRunning ? '#22C55E' : '#4A3AFF',
                    height: '100%', borderRadius: 4,
                    width: pct + '%', transition: 'width 0.5s ease'
                  }} />
                </div>
              </div>
            )}

            {/* Row 4: Actions */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {c.status === 'running' && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => handlePause(c.id)}>⏸ Pause</Button>
                  <Button size="sm" variant="ghost-danger" onClick={() => handleCancel(c.id)}>✕ Cancel</Button>
                </>
              )}
              {c.status === 'paused' && (
                <Button size="sm" variant="success" onClick={() => handleResume(c.id)}>▶ Resume</Button>
              )}
              {(c.status === 'sent' || c.status === 'running' || c.status === 'paused') && (
                <>
                  <Button size="sm" onClick={() => handleShowOpeners(c)}>
                    👁 Opens ({c.open_count || 0})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleExport(c.id, 'sent')}>
                    ↓ Sent CSV
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleExport(c.id, 'failed')}>
                    ↓ Failed CSV
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost-danger" onClick={() => handleDelete(c.id)}>🗑 Delete</Button>
            </div>
          </div>
        )
      })}

      {/* Openers Panel */}
      {openersPanel && (
        <div style={{
          position: 'fixed', top: 0, right: 0, width: 420, height: '100vh',
          background: 'var(--bg2)', borderLeft: '1px solid var(--bdr)',
          padding: 24, overflowY: 'auto', zIndex: 200,
          boxShadow: '-4px 0 24px rgba(0,0,0,0.3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>👁 Email Openers</div>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{openersPanel.campaignName}</div>
            </div>
            <button onClick={() => setOpenersPanel(null)} style={{
              background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--txt3)'
            }}>✕</button>
          </div>

          <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 8 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#4A3AFF' }}>{openers.length}</div>
            <div style={{ fontSize: 11, color: 'var(--txt3)' }}>unique openers tracked</div>
          </div>

          {openersLoading ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Loading openers...</div>
          ) : openers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)', fontSize: 13 }}>
              No opens tracked yet.<br/>
              <span style={{ fontSize: 11 }}>Opens are tracked when recipients load email images.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {openers.map((o, i) => (
                <div key={i} style={{
                  padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--bdr)',
                  borderRadius: 8, fontSize: 12
                }}>
                  <div style={{ fontWeight: 500, marginBottom: 2 }}>{o.email || o.recipient_email || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
                    {o.opened_at || o.created_at ? new Date(o.opened_at || o.created_at).toLocaleString() : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
