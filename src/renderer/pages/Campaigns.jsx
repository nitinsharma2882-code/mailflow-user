import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { SectionHeader, Table, Badge, ProgressBar } from '../components/ui/UI'
import Button from '../components/ui/Button'

export default function Campaigns() {
  const { campaigns, setCampaigns, setActivePage, addToast } = useAppStore()
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    window.api.campaigns.getAll().then(setCampaigns)
  }, [])

  const filtered = filter === 'all' ? campaigns
    : campaigns.filter(c => c.status === filter)

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

  const cols = [
    { key: 'name', label: 'Campaign', width: '26%',
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v}</div>
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
            {new Date(row.created_at).toLocaleDateString()} · {row.list_name || 'No list'}
          </div>
        </div>
      )
    },
    { key: 'status', label: 'Status', width: '11%',
      render: v => <Badge variant={v}>{v}</Badge>
    },
    { key: 'total_recipients', label: 'Recipients', width: '10%',
      render: v => (v || 0).toLocaleString()
    },
    { key: 'sent_count', label: 'Sent', width: '9%',
      render: (v, row) => row.status === 'draft' ? '—' : (v || 0).toLocaleString()
    },
    { key: 'open_count', label: 'Opens', width: '9%',
      render: (v, row) => row.sent_count > 0
        ? ((v / row.sent_count) * 100).toFixed(1) + '%' : '—'
    },
    { key: 'click_count', label: 'Clicks', width: '9%',
      render: (v, row) => row.sent_count > 0
        ? ((v / row.sent_count) * 100).toFixed(1) + '%' : '—'
    },
    { key: 'sent_count', label: 'Progress', width: '12%',
      render: (v, row) => row.total_recipients > 0
        ? <ProgressBar value={v || 0} max={row.total_recipients} /> : '—'
    },
    { key: 'id', label: 'Actions', width: '14%',
      render: (id, row) => (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {row.status === 'running' && (
            <Button size="sm" variant="ghost-danger" onClick={() => handlePause(id)}>Pause</Button>
          )}
          {row.status === 'paused' && (
            <Button size="sm" variant="success" onClick={() => handleResume(id)}>Resume</Button>
          )}
          {row.status === 'sent' && (
            <Button size="sm" onClick={() => handleExport(id, 'successful')}>↓ Report</Button>
          )}
          {(row.status === 'draft' || row.status === 'scheduled') && (
            <Button size="sm" variant="primary" onClick={() => setActivePage('new-campaign')}>Edit</Button>
          )}
          <Button size="sm" variant="ghost-danger" onClick={() => handleDelete(id)}>Delete</Button>
        </div>
      )
    },
  ]

  return (
    <div>
      <SectionHeader title="All campaigns">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 'var(--rad)', border: '1px solid var(--bdr2)',
              background: 'var(--bg2)', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
          >
            <option value="all">All status</option>
            <option value="running">Running</option>
            <option value="sent">Sent</option>
            <option value="scheduled">Scheduled</option>
            <option value="draft">Draft</option>
            <option value="paused">Paused</option>
          </select>
          <Button variant="primary" size="sm" onClick={() => setActivePage('new-campaign')}>
            + New campaign
          </Button>
        </div>
      </SectionHeader>
      <Table
        columns={cols}
        data={filtered}
        emptyText="No campaigns found. Create your first campaign to get started."
      />
    </div>
  )
}
