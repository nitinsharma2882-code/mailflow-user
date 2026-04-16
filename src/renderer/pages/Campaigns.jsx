import React, { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import { SectionHeader, Badge, ProgressBar } from '../components/ui/UI'
import Button from '../components/ui/Button'

export default function Campaigns() {
  const { campaigns, setCampaigns, setActivePage, addToast } = useAppStore()
  const [filter, setFilter]           = useState('all')
  const [liveStats, setLiveStats]     = useState({})
  const [openersPanel, setOpenersPanel] = useState(null) // { campaignId, data }
  const [loadingOpeners, setLoadingOpeners] = useState(false)
  const refreshRef = useRef(null)

  useEffect(() => {
    window.api.campaigns.getAll().then(setCampaigns)

    // Real-time sending progress
    window.api.on('sending:progress', ({ campaignId, sent_count, failed_count, total_recipients }) => {
      setLiveStats(prev => ({ ...prev, [campaignId]: { sent: sent_count, failed: failed_count, total: total_recipients } }))
    })

    // Real-time open tracking
    window.api.on('tracking:open', ({ campaignId, email, openedAt }) => {
      // Update live stats open count
      setCampaigns(prev => prev.map(c =>
        c.id === campaignId ? { ...c, open_count: (c.open_count || 0) + 1 } : c
      ))
      // If openers panel is open for this campaign, add the new opener
      setOpenersPanel(prev => {
        if (!prev || prev.campaignId !== campaignId) return prev
        const alreadyIn = prev.data?.openers?.some(o => o.email === email)
        if (alreadyIn) return prev
        return {
          ...prev,
          data: {
            ...prev.data,
            openers:   [{ email, opened_at: openedAt }, ...(prev.data?.openers || [])],
            openCount: (prev.data?.openCount || 0) + 1,
          }
        }
      })
    })

    // Campaign completed
    window.api.on('campaign:statusChange', (campaignId, status) => {
      window.api.campaigns.getAll().then(setCampaigns)
      if (status === 'sent') addToast('✅ Campaign completed!', 'success')
    })

    // Auto-refresh every 3s while running
    refreshRef.current = setInterval(() => {
      window.api.campaigns.getAll().then(data => {
        setCampaigns(data)
        if (!data.some(c => c.status === 'running')) clearInterval(refreshRef.current)
      })
    }, 3000)

    return () => clearInterval(refreshRef.current)
  }, [])

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter)

  async function handlePause(id) {
    await window.api.sending.pauseCampaign(id)
    window.api.campaigns.getAll().then(setCampaigns)
  }

  async function handleResume(id) {
    await window.api.sending.resumeCampaign(id)
    window.api.campaigns.getAll().then(setCampaigns)
  }

  async function handleCancel(id) {
    if (!confirm('Cancel this campaign?')) return
    await window.api.sending.cancelCampaign(id)
    window.api.campaigns.getAll().then(setCampaigns)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this campaign and all its data?')) return
    await window.api.campaigns.delete(id)
    window.api.campaigns.getAll().then(setCampaigns)
  }

  async function handleExport(id, type) {
    const result = await window.api.sending.exportResults(id, type)
    if (result.success) addToast(`Downloaded ${result.count} rows`, 'success')
  }

  async function handleResend(row) {
    window._resendCampaign = {
      ...row,
      server_ids: (() => { try { return typeof row.server_ids === 'string' ? JSON.parse(row.server_ids) : (row.server_ids || []) } catch { return [] } })(),
      sending_mode: row.sending_mode || 'existing_server',
    }
    setActivePage('new-campaign')
  }

  async function showOpeners(campaignId) {
    setLoadingOpeners(true)
    setOpenersPanel({ campaignId, data: null })
    try {
      const data = await window.api.analytics.getOpeners(campaignId)
      setOpenersPanel({ campaignId, data })
    } catch (err) {
      addToast('Failed to load openers', 'error')
      setOpenersPanel(null)
    } finally {
      setLoadingOpeners(false)
    }
  }

  // ── Openers Panel ──────────────────────────────────────────────────────────
  if (openersPanel) {
    const d = openersPanel.data
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button onClick={() => setOpenersPanel(null)}
            style={{ background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '6px 14px', cursor: 'pointer', color: 'var(--txt)', fontSize: 13 }}>
            ← Back
          </button>
          <div style={{ fontWeight: 600, fontSize: 15 }}>📬 Email Opens</div>
        </div>

        {/* Stats */}
        {d && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              ['Recipients', d.total, 'var(--txt)'],
              ['Sent',       d.sent,  'var(--gr)'],
              ['Opened',     d.openCount, 'var(--pu)'],
              ['Open Rate',  d.openRate + '%', d.openRate > 20 ? 'var(--gr)' : 'var(--am)'],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: '14px 20px', minWidth: 110 }}>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Openers list */}
        {loadingOpeners ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Loading...</div>
        ) : d?.openers?.length > 0 ? (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--bdr)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)' }}>
                {d.openers.length} unique opener{d.openers.length !== 1 ? 's' : ''}
              </span>
              <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Live updates enabled</span>
            </div>
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ position: 'sticky', top: 0 }}>
                  <tr style={{ background: 'var(--bg3)' }}>
                    {['#', 'Email', 'Opened At'].map(h => (
                      <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--txt2)', borderBottom: '1px solid var(--bdr)', fontSize: 11, textTransform: 'uppercase', background: 'var(--bg3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.openers.map((o, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--bdr)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '9px 16px', color: 'var(--txt3)', fontSize: 11 }}>{i + 1}</td>
                      <td style={{ padding: '9px 16px', fontFamily: 'monospace', fontSize: 12 }}>{o.email}</td>
                      <td style={{ padding: '9px 16px', color: 'var(--txt2)', fontSize: 12 }}>
                        {o.opened_at ? new Date(o.opened_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--txt3)', fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
            No opens recorded yet.<br />
            <span style={{ fontSize: 12 }}>Opens appear here in real-time when recipients open the email.</span>
          </div>
        )}
      </div>
    )
  }

  // ── Campaign List ──────────────────────────────────────────────────────────
  return (
    <div>
      <SectionHeader title="All Campaigns">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 'var(--rad)', border: '1px solid var(--bdr2)', background: 'var(--bg2)', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}>
            <option value="all">All status</option>
            <option value="running">Running</option>
            <option value="sent">Sent</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Draft</option>
            <option value="paused">Paused</option>
          </select>
          <Button variant="primary" size="sm" onClick={() => setActivePage('new-campaign')}>+ New Campaign</Button>
        </div>
      </SectionHeader>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--txt3)', fontSize: 13 }}>
          No campaigns found. Create your first campaign to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(row => {
            const live    = liveStats[row.id]
            const sent    = live?.sent  ?? row.sent_count    ?? 0
            const failed  = live?.failed ?? row.failed_count ?? 0
            const total   = live?.total ?? row.total_recipients ?? 0
            const opens   = row.open_count || 0
            const pct     = total > 0 ? Math.round((sent / total) * 100) : 0
            const openRate = sent > 0 ? ((opens / sent) * 100).toFixed(1) : null

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
                      <span style={{ fontSize: 11, color: 'var(--pu)', fontWeight: 600 }}>● LIVE</span>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 20, marginBottom: 10, flexWrap: 'wrap' }}>
                  {[
                    ['Recipients', total.toLocaleString(), 'var(--txt)'],
                    ['Sent',       sent.toLocaleString(),  'var(--gr)'],
                    ['Failed',     failed.toLocaleString(), failed > 0 ? 'var(--re)' : 'var(--txt3)'],
                    ['Opens',      openRate ? openRate + '%' : (opens > 0 ? opens : '—'), 'var(--pu)'],
                  ].map(([label, val, color]) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Progress bar */}
                {total > 0 && row.status !== 'draft' && row.status !== 'scheduled' && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--txt3)', marginBottom: 4 }}>
                      <span>{row.status === 'running' ? `Sending... ${sent.toLocaleString()} / ${total.toLocaleString()}` : `${sent.toLocaleString()} / ${total.toLocaleString()} sent`}</span>
                      <span>{pct}%</span>
                    </div>
                    <div style={{ background: 'var(--bdr)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                      <div style={{
                        background: row.status === 'running' ? 'var(--pu)' : row.status === 'sent' ? 'var(--gr)' : 'var(--txt3)',
                        height: '100%', borderRadius: 4, width: `${pct}%`, transition: 'width 0.5s ease',
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
                  {(row.status === 'sent' || row.status === 'running') && opens >= 0 && (
                    <Button size="sm" variant="ghost" onClick={() => showOpeners(row.id)}>
                      👁 Opens ({opens})
                    </Button>
                  )}
                  {row.status === 'sent' && (
                    <>
                      <Button size="sm" onClick={() => handleExport(row.id, 'successful')}>↓ Sent CSV</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleExport(row.id, 'failed')}>↓ Failed CSV</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => handleResend(row)}>✏️ Edit & Resend</Button>
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
