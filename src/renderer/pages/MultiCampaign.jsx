import React, { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import Button from '../components/ui/Button'

const MAX_PAGES = 4

export default function MultiCampaign() {
  const { resendCampaign, clearResendCampaign, setActivePage, addToast } = useAppStore()

  const [template, setTemplate] = useState({
    subject:   '',
    fromName:  '',
    html_body: '',
  })

  const [poolInstances, setPoolInstances] = useState([])

  const [pages, setPages] = useState([
    { id: 1, contactListId: '', contactListName: '', contacts: 0, smtpFile: '', smtpAccounts: [], instanceId: '', instanceIp: '', status: 'idle', sent: 0, failed: 0, total: 0 }
  ])

  const [launching, setLaunching] = useState(false)
  const [activePage, setActivePageNum] = useState(1)

  useEffect(() => {
    if (resendCampaign) {
      setTemplate({
        subject:   resendCampaign.subject   || '',
        fromName:  resendCampaign.from_name || '',
        html_body: resendCampaign.html_body || '',
      })
      clearResendCampaign()
    }
    loadInstances()
  }, [])

  async function loadInstances() {
    try {
      const result = await window.api.license.getInstances()
      if (result.success && result.instances) {
        setPoolInstances(result.instances)
        if (result.instances.length === 0) {
          addToast('No instances available. Ask admin to add instances to pool.', 'error')
        }
      } else {
        console.error('Failed to load instances:', result.error)
        addToast('Could not load instances: ' + (result.error || 'Unknown error'), 'error')
      }
    } catch (err) {
      console.error('loadInstances error:', err.message)
      addToast('Error loading instances: ' + err.message, 'error')
    }
  }

  function addPage() {
    if (pages.length >= MAX_PAGES) {
      addToast('Maximum 4 pages allowed', 'error')
      return
    }
    setPages(prev => [...prev, {
      id:              prev.length + 1,
      contactListId:   '',
      contactListName: '',
      contacts:        0,
      smtpFile:        '',
      smtpAccounts:    [],
      instanceId:      '',
      instanceIp:      '',
      status:          'idle',
      sent:            0,
      failed:          0,
      total:           0,
    }])
  }

  function removePage(pageId) {
    if (pages.length === 1) { addToast('Need at least 1 page', 'error'); return }
    setPages(prev => prev.filter(p => p.id !== pageId))
  }

  function updatePage(pageId, updates) {
    setPages(prev => prev.map(p => p.id === pageId ? { ...p, ...updates } : p))
  }

  async function handlePickContacts(pageId) {
    const result = await window.api.dialog.openFile({
      title:      'Select Contacts CSV',
      filters:    [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return

    try {
      const listName = 'MultiCampaign-Page' + pageId + '-' + Date.now()
      const imported = await window.api.contacts.importCSV(result.filePaths[0], listName)
      if (imported && imported.total > 0) {
        updatePage(pageId, {
          contactListId:   imported.listId || '',
          contactListName: listName,
          total:           imported.total,
          contacts:        imported.total,
        })
        addToast('Page ' + pageId + ': Loaded ' + imported.total + ' contacts', 'success')
      }
    } catch (err) {
      addToast('Error loading contacts: ' + err.message, 'error')
    }
  }

  async function handlePickSmtp(pageId) {
    const result = await window.api.dialog.openFile({
      title:      'Select SMTP CSV',
      filters:    [{ name: 'CSV Files', extensions: ['csv', 'txt'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return

    try {
      const parsed = await window.api.smtp.parseCsv(result.filePaths[0])
      if (parsed.success && parsed.accounts.length > 0) {
        updatePage(pageId, {
          smtpFile:     result.filePaths[0],
          smtpAccounts: parsed.accounts,
        })
        addToast('Page ' + pageId + ': Loaded ' + parsed.accounts.length + ' SMTP accounts', 'success')
      } else {
        addToast('No valid SMTP accounts found', 'error')
      }
    } catch (err) {
      addToast('Error: ' + err.message, 'error')
    }
  }

  function canLaunch() {
    return pages.every(p =>
      p.contactListId &&
      p.smtpAccounts.length > 0 &&
      p.instanceIp
    ) && template.subject && template.html_body
  }

  async function handleLaunchAll() {
    if (!canLaunch()) {
      addToast('Each page needs: contacts, SMTP accounts, and an IP assigned', 'error')
      return
    }
    setLaunching(true)

    const launchPromises = pages.map(async (page) => {
      try {
        updatePage(page.id, { status: 'running' })
        const result = await window.api.sending.startMultiCampaignPage({
          pageId:        page.id,
          contactListId: page.contactListId,
          subject:       template.subject,
          fromName:      template.fromName,
          html_body:     template.html_body,
          smtpFile:      page.smtpFile,
          smtpAccounts:  page.smtpAccounts,
          instanceIp:    page.instanceIp,
          instanceToken: 'mailflow-agent-2026',
        })
        if (result.success) {
          updatePage(page.id, { status: 'running', total: result.total })
          addToast('Page ' + page.id + ' launched — ' + result.total + ' emails', 'success')
        } else {
          updatePage(page.id, { status: 'failed', error: result.error })
          addToast('Page ' + page.id + ' failed: ' + result.error, 'error')
        }
      } catch (err) {
        updatePage(page.id, { status: 'failed', error: err.message })
        addToast('Page ' + page.id + ' error: ' + err.message, 'error')
      }
    })

    await Promise.all(launchPromises)
    setLaunching(false)

    pages.forEach(page => {
      if (page.instanceIp) pollPageProgress(page.id, page.instanceIp)
    })
  }

  async function pollPageProgress(pageId, instanceIp) {
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch('http://' + instanceIp + ':3000/status/multi-page-' + pageId, {
          headers: { 'x-agent-token': 'mailflow-agent-2026' }
        })
        if (res.ok) {
          const data = await res.json()
          updatePage(pageId, {
            sent:   data.sent   || 0,
            failed: data.failed || 0,
            total:  data.total  || 0,
            status: data.status === 'completed' ? 'completed' : 'running',
          })
          if (data.status === 'completed' || data.status === 'stopped') {
            clearInterval(intervalId)
          }
        }
      } catch {}
    }, 3000)
  }

  const IS = {
    width: '100%', padding: '8px 11px',
    border: '1px solid var(--bdr2)', borderRadius: 'var(--rad)',
    fontSize: 13, background: 'var(--bg2)', color: 'var(--txt)',
    fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box'
  }

  return (
    <div style={{ fontFamily: 'var(--font)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 4 }}>🚀 Multi-Page Campaign</h2>
          <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
            Send same template to different recipient lists via different IPs simultaneously
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => setActivePage('campaigns')}>← Back</Button>
          {pages.length < MAX_PAGES && (
            <Button variant="ghost" size="sm" onClick={addPage}>+ Add Page</Button>
          )}
          <Button variant="primary" loading={launching} onClick={handleLaunchAll} disabled={!canLaunch()}>
            🚀 Launch All {pages.length} Page{pages.length > 1 ? 's' : ''}
          </Button>
        </div>
      </div>

      {/* Template section — shared across all pages */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 20, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>📝 Template (shared across all pages)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>Subject Line *</label>
            <input value={template.subject} onChange={e => setTemplate(t => ({ ...t, subject: e.target.value }))}
              placeholder="Enter subject..." style={IS} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>From Name</label>
            <input value={template.fromName} onChange={e => setTemplate(t => ({ ...t, fromName: e.target.value }))}
              placeholder="Your Company" style={IS} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>HTML Body *</label>
          <textarea value={template.html_body}
            onChange={e => setTemplate(t => ({ ...t, html_body: e.target.value }))}
            rows={6} placeholder="Paste your HTML email here..."
            style={{ ...IS, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
        </div>
      </div>

      {/* Page tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {pages.map(p => (
          <button key={p.id} onClick={() => setActivePageNum(p.id)}
            style={{
              padding: '8px 16px', borderRadius: 'var(--rad)', fontSize: 13, cursor: 'pointer',
              fontFamily: 'var(--font)', fontWeight: activePage === p.id ? 700 : 400,
              background: activePage === p.id ? 'var(--pu)' : 'var(--bg2)',
              color: activePage === p.id ? '#fff' : 'var(--txt2)',
              border: activePage === p.id ? '1px solid var(--pu)' : '1px solid var(--bdr)',
            }}>
            Page {p.id}
            {p.status === 'running'   && <span style={{ marginLeft: 6, color: '#22C55E' }}>●</span>}
            {p.status === 'completed' && <span style={{ marginLeft: 6, color: '#4A3AFF' }}>✓</span>}
            {p.status === 'failed'    && <span style={{ marginLeft: 6, color: '#C0392B' }}>✕</span>}
          </button>
        ))}
      </div>

      {/* Active page config */}
      {pages.filter(p => p.id === activePage).map(page => (
        <div key={page.id} style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Page {page.id} Configuration</div>
            {pages.length > 1 && (
              <button onClick={() => removePage(page.id)}
                style={{ padding: '5px 10px', background: '#3A1A1A', border: '1px solid var(--re)', borderRadius: 'var(--rad)', color: 'var(--re)', fontSize: 12, cursor: 'pointer' }}>
                Remove Page
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {/* Recipients */}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--txt2)' }}>👥 Recipients</div>
              <div onClick={() => handlePickContacts(page.id)}
                style={{ border: '2px dashed var(--bdr2)', borderRadius: 'var(--rad)', padding: 16, textAlign: 'center', cursor: 'pointer', marginBottom: 8 }}>
                {page.contacts > 0 ? (
                  <div>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>✅</div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{page.contacts.toLocaleString()} contacts</div>
                    <div style={{ fontSize: 11, color: 'var(--txt3)' }}>Click to change</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>📤</div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Upload CSV</div>
                    <div style={{ fontSize: 11, color: 'var(--txt3)' }}>email,name,address</div>
                  </div>
                )}
              </div>
            </div>

            {/* SMTP */}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--txt2)' }}>📧 SMTP Accounts</div>
              <div onClick={() => handlePickSmtp(page.id)}
                style={{ border: '2px dashed var(--bdr2)', borderRadius: 'var(--rad)', padding: 16, textAlign: 'center', cursor: 'pointer', marginBottom: 8 }}>
                {page.smtpAccounts.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>✅</div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{page.smtpAccounts.length} SMTP accounts</div>
                    <div style={{ fontSize: 11, color: 'var(--txt3)' }}>Click to change</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>📋</div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Upload SMTP CSV</div>
                    <div style={{ fontSize: 11, color: 'var(--txt3)' }}>email,app_password</div>
                  </div>
                )}
              </div>
            </div>

            {/* IP / Instance */}
            <div style={{ background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--txt2)' }}>🖥 Sending IP</div>
              <select value={page.instanceIp}
                onChange={e => updatePage(page.id, { instanceIp: e.target.value })}
                style={{ ...IS, marginBottom: 8 }}>
                <option value="">-- Select Instance --</option>
                {poolInstances.map(inst => (
                  <option key={inst.id} value={inst.ip_address}>
                    {inst.ip_address} ({inst.status})
                  </option>
                ))}
              </select>
              {page.instanceIp && (
                <div style={{ fontSize: 11, color: 'var(--gr)', fontWeight: 600 }}>
                  ● {page.instanceIp}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <button onClick={loadInstances}
                  style={{ padding: '5px 10px', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', fontSize: 11, cursor: 'pointer', color: 'var(--txt2)' }}>
                  ↻ Refresh IPs
                </button>
                <span style={{ fontSize: 11, color: 'var(--txt3)' }}>
                  {poolInstances.length} instance(s) available
                </span>
              </div>
            </div>
          </div>

          {/* Progress bar when running */}
          {page.status === 'running' && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--txt2)', marginBottom: 4 }}>
                <span>Sending via {page.instanceIp}...</span>
                <span>{page.sent}/{page.total}</span>
              </div>
              <div style={{ background: 'var(--bdr)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                <div style={{
                  background: 'var(--pu)', height: '100%', borderRadius: 4,
                  width: page.total > 0 ? Math.round((page.sent / page.total) * 100) + '%' : '0%',
                  transition: 'width 0.5s ease'
                }} />
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--gr)' }}>✅ Sent: {page.sent}</span>
                <span style={{ color: 'var(--re)' }}>❌ Failed: {page.failed}</span>
              </div>
            </div>
          )}

          {page.status === 'completed' && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--gr-l)', border: '1px solid var(--gr)', borderRadius: 'var(--rad)', fontSize: 13, color: 'var(--gr)', fontWeight: 600 }}>
              ✅ Page {page.id} completed — {page.sent} sent, {page.failed} failed
            </div>
          )}

          {page.status === 'failed' && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--re-l)', border: '1px solid var(--re)', borderRadius: 'var(--rad)', fontSize: 13, color: 'var(--re)' }}>
              ❌ Page {page.id} failed: {page.error}
            </div>
          )}
        </div>
      ))}

      {/* Summary bar */}
      {pages.some(p => p.status !== 'idle') && (
        <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {pages.map(p => (
            <div key={p.id} style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '10px 16px', flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Page {p.id}</div>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4 }}>{p.instanceIp || '—'}</div>
              <div style={{
                fontSize: 13, fontWeight: 700,
                color: p.status === 'completed' ? 'var(--gr)' : p.status === 'failed' ? 'var(--re)' : p.status === 'running' ? '#F39C12' : 'var(--txt3)'
              }}>
                {p.status === 'completed' ? '✅ Done' : p.status === 'failed' ? '❌ Failed' : p.status === 'running' ? '⏳ Running' : '⏸ Idle'}
              </div>
              {p.total > 0 && (
                <div style={{ fontSize: 11, color: 'var(--txt2)', marginTop: 4 }}>
                  {p.sent}/{p.total} sent
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
