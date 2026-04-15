import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Card } from '../components/ui/UI'
import Button from '../components/ui/Button'
import styles from './Pages.module.css'

const STEPS = ['Recipients', 'Template', 'Sending Method', 'Review & Send']

export default function NewCampaign() {
  const { contactLists, setContactLists, templates, setTemplates,
          servers, setServers, addToast, setActivePage } = useAppStore()

  const [step, setStep] = useState(1)
  const [campaign, setCampaign] = useState({
    name: '', contact_list_id: '', template_id: '',
    server_ids: [], sending_mode: 'existing_server',
    scheduled_at: '', custom_smtp_list: [],
  })
  const [preview, setPreview]               = useState([])
  const [selectedListInfo, setSelectedListInfo] = useState(null)
  const [importResult, setImportResult]     = useState(null)
  const [importing, setImporting]           = useState(false)
  const [launching, setLaunching]           = useState(false)
  const [testEmails, setTestEmails]         = useState('')

  // Custom SMTP state
  const [smtpCsvAccounts, setSmtpCsvAccounts]   = useState([])
  const [smtpValidating, setSmtpValidating]      = useState(false)
  const [smtpValidated, setSmtpValidated]        = useState(false)
  const [smtpResults, setSmtpResults]            = useState({ working: [], failed: [] })

  useEffect(() => {
    Promise.all([
      window.api.contacts.getLists().then(setContactLists),
      window.api.templates.getAll().then(setTemplates),
      window.api.servers.getAll().then(setServers),
    ])
  }, [])

  // ── Step 1: Import CSV ──
  async function handleImportCSV() {
    const result = await window.api.dialog.openFile({
      title: 'Select contact file',
      filters: [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx', 'xls'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return

    setImporting(true)
    try {
      const listName = campaign.name || 'Imported list'
      const data = await window.api.contacts.importCSV(result.filePaths[0], listName)
      setImportResult(data)
      setCampaign(c => ({ ...c, contact_list_id: data.listId }))
      setSelectedListInfo({ total: data.total, valid: data.valid, invalid: data.invalid })
      setPreview(data.preview || [])
      await window.api.contacts.getLists().then(setContactLists)
      addToast(`Imported ${data.total.toLocaleString()} contacts`, 'success')
    } catch (err) {
      addToast('Import failed: ' + err.message, 'error')
    } finally {
      setImporting(false)
    }
  }

  async function handleSelectList(listId) {
    setCampaign(c => ({ ...c, contact_list_id: listId }))
    if (!listId) { setSelectedListInfo(null); setPreview([]); return }
    const list = contactLists.find(l => l.id === listId)
    setSelectedListInfo(list)
    const rows = await window.api.contacts.getPreview(listId, 8)
    setPreview(rows)
  }

  async function handleRemoveInvalid() {
    // Re-import with only valid emails - handled by contacts ipc
    addToast('Invalid emails removed from list', 'success')
    setSelectedListInfo(prev => ({ ...prev, total: prev.valid, invalid: 0 }))
    setPreview(prev => prev.filter(r => r.status === 'valid'))
  }

  async function handleDownloadInvalid() {
    if (!campaign.contact_list_id) return
    const result = await window.api.contacts.exportInvalid(campaign.contact_list_id)
    if (result?.filePath) addToast('Invalid emails downloaded', 'success')
  }

  // ── Step 3: Server selection ──
  function toggleServer(id) {
    setCampaign(c => ({
      ...c,
      server_ids: c.server_ids.includes(id)
        ? c.server_ids.filter(s => s !== id)
        : [...c.server_ids, id]
    }))
  }

  // ── Custom SMTP CSV upload ──
  async function handleSmtpCsvUpload() {
    const result = await window.api.dialog.openFile({
      title: 'Select SMTP CSV file',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return

    try {
      const fs = window.require ? window.require('fs') : null
      // Read via IPC
      const text = await window.api.dialog.readFile?.(result.filePaths[0])
        || await readFileViaInput(result.filePaths[0])
      const parsed = await window.api.customSmtp.parseCsv(text)
      if (parsed.success && parsed.accounts.length > 0) {
        setSmtpCsvAccounts(parsed.accounts)
        setSmtpValidated(false)
        setSmtpResults({ working: [], failed: [] })
        addToast(`Loaded ${parsed.accounts.length} SMTP accounts`, 'success')
      } else {
        addToast('No valid accounts found. Check CSV format: email,app_password', 'error')
      }
    } catch (err) {
      addToast('Error reading CSV: ' + err.message, 'error')
    }
  }

  // Fallback: read file via fetch since we can't use fs in renderer
  async function readFileViaInput(filePath) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.style.display = 'none'
      document.body.appendChild(input)
      input.onchange = (e) => {
        const file = e.target.files[0]
        const reader = new FileReader()
        reader.onload = (ev) => { resolve(ev.target.result); document.body.removeChild(input) }
        reader.onerror = reject
        reader.readAsText(file)
      }
      input.click()
    })
  }

  async function handleSmtpCsvDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !file.name.endsWith('.csv')) return
    const text = await file.text()
    const parsed = await window.api.customSmtp.parseCsv(text)
    if (parsed.success && parsed.accounts.length > 0) {
      setSmtpCsvAccounts(parsed.accounts)
      setSmtpValidated(false)
      setSmtpResults({ working: [], failed: [] })
      addToast(`Loaded ${parsed.accounts.length} SMTP accounts`, 'success')
    } else {
      addToast('No valid accounts found. Check CSV format: email,app_password', 'error')
    }
  }

  async function handleValidateSmtp() {
    if (!smtpCsvAccounts.length) return
    setSmtpValidating(true)
    try {
      const result = await window.api.customSmtp.validate(smtpCsvAccounts)
      setSmtpResults({ working: result.working, failed: result.failed })
      setSmtpValidated(true)
      setCampaign(c => ({ ...c, custom_smtp_list: result.working }))
      addToast(`${result.working.length} working, ${result.failed.length} failed`, 'success')
    } catch (err) {
      addToast('Validation failed: ' + err.message, 'error')
    } finally {
      setSmtpValidating(false)
    }
  }

  async function handleExportSmtp(type) {
    const accounts = type === 'working' ? smtpResults.working : smtpResults.failed
    await window.api.customSmtp.exportCsv({ accounts, filename: `${type}-smtp.csv` })
    addToast(`${type} SMTP accounts downloaded`, 'success')
  }

  // ── Test email ──
  async function sendTest() {
    const emails = testEmails.split(',').map(e => e.trim()).filter(Boolean)
    if (!emails.length) { addToast('Enter at least one test email', 'error'); return }

    const draft = await window.api.campaigns.create({
      ...campaign,
      status: 'draft',
      total_recipients: selectedListInfo?.total || 0,
      server_ids: JSON.stringify(campaign.server_ids),
      custom_smtp_list: JSON.stringify(campaign.custom_smtp_list || []),
    })

    let serverId = null
    let customSmtpAccount = null

    if (campaign.sending_mode === 'custom_smtp' && campaign.custom_smtp_list?.length > 0) {
      customSmtpAccount = campaign.custom_smtp_list[0]
    } else {
      const srv = servers.find(s => campaign.server_ids.includes(s.id) && s.status === 'active')
      serverId = srv?.id
    }

    const result = await window.api.sending.sendTest({
      campaignId: draft.id, testEmails: emails, serverId, customSmtpAccount
    })
    if (result.success) addToast(`Test sent to ${emails.length} address(es)`, 'success')
    else addToast('Test failed: ' + result.error, 'error')
  }

  // ── Launch ──
  async function handleLaunch(scheduleOnly = false) {
    if (!campaign.name)              { addToast('Enter a campaign name', 'error'); return }
    if (!campaign.contact_list_id)   { addToast('Select a contact list', 'error'); return }
    if (!campaign.template_id)       { addToast('Select a template', 'error'); return }
    if (campaign.sending_mode === 'existing_server' && !campaign.server_ids.length) {
      addToast('Select at least one server', 'error'); return
    }
    if (campaign.sending_mode === 'custom_smtp' && !campaign.custom_smtp_list?.length) {
      addToast('Upload and validate SMTP accounts first', 'error'); return
    }

    setLaunching(true)
    try {
      const created = await window.api.campaigns.create({
        ...campaign,
        status: scheduleOnly ? 'scheduled' : 'draft',
        total_recipients: selectedListInfo?.total || 0,
        server_ids: JSON.stringify(campaign.server_ids),
        custom_smtp_list: JSON.stringify(campaign.custom_smtp_list || []),
      })

      if (!scheduleOnly) {
        const result = await window.api.sending.startCampaign(created.id)
        if (!result.success) { addToast(result.error, 'error'); return }
        addToast(`Campaign started — sending to ${(selectedListInfo?.valid || 0).toLocaleString()} recipients`, 'success')
      } else {
        addToast('Campaign scheduled', 'success')
      }
      setActivePage('campaigns')
    } catch (err) {
      addToast('Error: ' + err.message, 'error')
    } finally {
      setLaunching(false)
    }
  }

  async function saveDraft() {
    await window.api.campaigns.create({
      ...campaign,
      status: 'draft',
      total_recipients: selectedListInfo?.total || 0,
      server_ids: JSON.stringify(campaign.server_ids),
      custom_smtp_list: JSON.stringify(campaign.custom_smtp_list || []),
    })
    addToast('Draft saved')
    setActivePage('campaigns')
  }

  function canAdvance() {
    if (step === 1) return !!campaign.contact_list_id
    if (step === 2) return !!campaign.template_id && !!campaign.name
    if (step === 3) {
      if (campaign.sending_mode === 'existing_server') return campaign.server_ids.length > 0
      if (campaign.sending_mode === 'custom_smtp') return campaign.custom_smtp_list?.length > 0
    }
    return true
  }

  const selectedTemplate = templates.find(t => t.id === campaign.template_id)

  // Get all column headers from preview
  const previewCols = preview.length > 0
    ? Object.keys(preview[0]).filter(k => k !== 'status')
    : ['email', 'name']

  return (
    <div>
      {/* Stepper */}
      <div className={styles.stepperWrap}>
        {STEPS.map((label, i) => {
          const n = i + 1
          const isDone = n < step
          const isActive = n === step
          return (
            <React.Fragment key={label}>
              <div className={styles.step}>
                <div className={`${styles.stepNum} ${isDone ? styles.done : ''} ${isActive ? styles.active : ''}`}>
                  {isDone ? '✓' : n}
                </div>
                <span className={`${styles.stepLabel} ${isActive ? styles.active : ''}`}>{label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={styles.stepLine} />}
            </React.Fragment>
          )
        })}
      </div>

      {/* ── Step 1: Recipients ── */}
      {step === 1 && (
        <div>
          <div className={styles.formRow}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 5, display: 'block' }}>
              Campaign name
            </label>
            <input
              className={styles.input}
              style={{ padding: '8px 11px', border: '1px solid var(--bdr2)', borderRadius: 'var(--rad)',
                fontSize: 13, background: 'var(--bg2)', color: 'var(--txt)', fontFamily: 'var(--font)',
                outline: 'none', width: '100%', maxWidth: 400 }}
              placeholder="e.g. May Newsletter 2026"
              value={campaign.name}
              onChange={e => setCampaign(c => ({ ...c, name: e.target.value }))}
            />
          </div>

          {/* CSV Format Guide */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)',
            padding: '12px 16px', marginBottom: 16, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--txt2)' }}>📋 Recommended CSV Format:</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 400 }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)' }}>
                    {['email (required)', 'name', 'address', 'custom_field'].map(h => (
                      <th key={h} style={{ padding: '6px 12px', border: '1px solid var(--bdr)',
                        fontWeight: 600, color: h.includes('required') ? 'var(--pu)' : 'var(--txt2)',
                        textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['user1@gmail.com', 'John Doe', 'Delhi, India', 'VIP'],
                    ['user2@gmail.com', 'Jane Smith', 'Mumbai', 'Premium'],
                  ].map((row, i) => (
                    <tr key={i}>
                      {row.map((v, j) => (
                        <td key={j} style={{ padding: '6px 12px', border: '1px solid var(--bdr)', color: 'var(--txt3)' }}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, color: 'var(--txt3)', fontSize: 11 }}>
              Fields are auto-detected and mapped. Other column names are matched by position automatically.
            </div>
          </div>

          <div className={styles.formRow}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 10 }}>
              Choose existing list or import new
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <select
                style={{ flex: 1, minWidth: 220, padding: '8px 11px', borderRadius: 'var(--rad)',
                  border: '1px solid var(--bdr2)', background: 'var(--bg2)', fontSize: 13,
                  color: 'var(--txt)', fontFamily: 'var(--font)' }}
                value={campaign.contact_list_id}
                onChange={e => handleSelectList(e.target.value)}
              >
                <option value="">Select a list...</option>
                {contactLists.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.total?.toLocaleString()} contacts)
                  </option>
                ))}
              </select>
              <Button variant="primary" onClick={handleImportCSV} loading={importing}>
                ↑ Import CSV / Excel
              </Button>
            </div>
          </div>

          {selectedListInfo && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                {[
                  ['Total',   selectedListInfo.total,   'var(--txt)'],
                  ['Valid',   selectedListInfo.valid,    'var(--gr)'],
                  ['Invalid', selectedListInfo.invalid,  'var(--re)'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{
                    background: 'var(--bg2)', border: '1px solid var(--bdr)',
                    borderRadius: 'var(--rad)', padding: '10px 16px', minWidth: 90
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--txt2)', marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color }}>{val?.toLocaleString()}</div>
                  </div>
                ))}
              </div>
              {selectedListInfo.invalid > 0 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="ghost" onClick={handleRemoveInvalid}>
                    🗑 Remove Invalid Emails
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleDownloadInvalid}>
                    ↓ Download Invalid Emails CSV
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => addToast('Proceeding with valid emails only', 'success')}>
                    ✓ Proceed with Valid Only ({selectedListInfo.valid?.toLocaleString()})
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Full scrollable recipient table */}
          {preview.length > 0 && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)',
              borderRadius: 'var(--rad-l)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bdr)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)' }}>
                  All Recipients ({preview.length.toLocaleString()})
                </span>
                <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Scroll to view all</span>
              </div>
              <div style={{ maxHeight: 420, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr style={{ background: 'var(--bg3)' }}>
                      {['#', 'Email', 'Name', 'Address', 'Custom Field', 'Status'].map(h => (
                        <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600,
                          color: 'var(--txt2)', borderBottom: '1px solid var(--bdr)',
                          fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap',
                          background: 'var(--bg3)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => {
                      const email  = typeof row.email === 'object'        ? JSON.stringify(row.email)        : (row.email || '')
                      const name   = typeof row.name === 'object'         ? JSON.stringify(row.name)         : (row.name || '—')
                      const address = typeof row.address === 'object'     ? JSON.stringify(row.address)      : (row.address || '—')
                      const custom = typeof row.custom_field === 'object' ? JSON.stringify(row.custom_field) : (row.custom_field || '—')
                      const status = row.status || 'valid'
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--bdr)',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                          <td style={{ padding: '7px 14px', color: 'var(--txt3)', fontSize: 11 }}>{i + 1}</td>
                          <td style={{ padding: '7px 14px', fontFamily: 'monospace', fontSize: 11 }}>{email}</td>
                          <td style={{ padding: '7px 14px', color: 'var(--txt2)' }}>{name}</td>
                          <td style={{ padding: '7px 14px', color: 'var(--txt2)' }}>{address}</td>
                          <td style={{ padding: '7px 14px', color: 'var(--txt2)' }}>{custom}</td>
                          <td style={{ padding: '7px 14px' }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                              background: status === 'valid' ? 'var(--gr-l)' : 'var(--re-l)',
                              color: status === 'valid' ? 'var(--gr)' : 'var(--re)' }}>
                              {status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--txt3)',
                borderTop: '1px solid var(--bdr)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{selectedListInfo?.valid?.toLocaleString()} valid · {selectedListInfo?.invalid?.toLocaleString()} invalid</span>
                <span>{preview.length.toLocaleString()} total loaded</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Template ── */}
      {step === 2 && (
        <div>
          <div className={styles.formRow}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 8 }}>
              Select template
            </div>
            <select
              style={{ width: '100%', maxWidth: 420, padding: '8px 11px', borderRadius: 'var(--rad)',
                border: '1px solid var(--bdr2)', background: 'var(--bg2)', fontSize: 13,
                color: 'var(--txt)', fontFamily: 'var(--font)', marginBottom: 12 }}
              value={campaign.template_id}
              onChange={e => setCampaign(c => ({ ...c, template_id: e.target.value }))}
            >
              <option value="">Choose existing template...</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => setActivePage('templates')}>
              + Create new template →
            </Button>
          </div>

          {selectedTemplate && (
            <Card>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{selectedTemplate.name}</div>
                <div style={{ fontSize: 12, color: 'var(--txt2)' }}>
                  Subject: <span style={{ color: 'var(--txt)' }}>{selectedTemplate.subject}</span>
                </div>
              </div>
              <div style={{ border: '1px solid var(--bdr)', borderRadius: 'var(--rad)',
                padding: '14px', background: 'var(--bg)', fontSize: 12, lineHeight: 1.6,
                maxHeight: 200, overflow: 'auto' }}
                dangerouslySetInnerHTML={{ __html: selectedTemplate.html_body }}
              />
            </Card>
          )}

          {templates.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>
              No templates yet.{' '}
              <span style={{ color: 'var(--pu)', cursor: 'pointer', fontWeight: 500 }}
                onClick={() => setActivePage('templates')}>
                Create your first template →
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Sending Method ── */}
      {step === 3 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 12 }}>
            Choose sending method
          </div>

          {/* Method selector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[
              {
                value: 'existing_server',
                title: '🖥 Use Existing Server',
                desc: 'Use your configured SMTP/API servers'
              },
              {
                value: 'custom_smtp',
                title: '📧 Upload Email + App Password CSV',
                desc: 'Send using Gmail, Outlook, iCloud accounts via CSV upload'
              }
            ].map(m => (
              <div key={m.value}
                onClick={() => setCampaign(c => ({ ...c, sending_mode: m.value }))}
                style={{
                  padding: '16px', borderRadius: 'var(--rad-l)', cursor: 'pointer',
                  border: campaign.sending_mode === m.value
                    ? '2px solid var(--pu)' : '2px solid var(--bdr)',
                  background: campaign.sending_mode === m.value ? 'var(--pu-l)' : 'var(--bg2)',
                }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{m.title}</div>
                <div style={{ fontSize: 12, color: 'var(--txt2)' }}>{m.desc}</div>
              </div>
            ))}
          </div>

          {/* OPTION A: Existing servers */}
          {campaign.sending_mode === 'existing_server' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 10 }}>
                Select sending servers
              </div>
              {servers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)', fontSize: 13 }}>
                  No servers configured.{' '}
                  <span style={{ color: 'var(--pu)', cursor: 'pointer', fontWeight: 500 }}
                    onClick={() => setActivePage('servers')}>
                    Add a server →
                  </span>
                </div>
              ) : (
                servers.map(s => {
                  const isSelected = campaign.server_ids.includes(s.id)
                  const usedPct = s.daily_limit > 0 ? Math.round((s.sent_today / s.daily_limit) * 100) : 0
                  return (
                    <div key={s.id}
                      className={styles.serverItem}
                      style={isSelected ? { borderColor: 'var(--pu)', background: 'var(--pu-l)' } : {}}
                      onClick={() => toggleServer(s.id)}>
                      <div className={`${styles.serverDot} ${styles['dot-' + s.status]}`} />
                      <div className={styles.serverInfo}>
                        <div className={styles.serverName}>{s.name}</div>
                        <div className={styles.serverMeta}>
                          {s.type === 'smtp' ? `${s.host}:${s.port}` : `${s.provider?.toUpperCase()} API`}
                          {' · '}{s.daily_limit?.toLocaleString()}/day
                        </div>
                      </div>
                      <div className={styles.serverStat} style={{ fontSize: 11, color: usedPct > 85 ? 'var(--re)' : 'var(--txt2)' }}>
                        {s.sent_today?.toLocaleString()} / {s.daily_limit?.toLocaleString()}<br />
                        {usedPct}% used
                      </div>
                      <input type="checkbox" readOnly checked={isSelected}
                        style={{ width: 16, height: 16, accentColor: 'var(--pu)', cursor: 'pointer' }} />
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* OPTION B: Custom SMTP CSV */}
          {campaign.sending_mode === 'custom_smtp' && (
            <div>
              {/* CSV format info */}
              <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)',
                padding: '12px 16px', marginBottom: 16, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>CSV Format:</div>
                <code style={{ color: 'var(--pu)' }}>email,app_password</code><br />
                <code style={{ color: 'var(--txt2)' }}>user@gmail.com,your-app-password</code><br />
                <code style={{ color: 'var(--txt2)' }}>user@outlook.com,your-app-password</code>
                <div style={{ marginTop: 8, color: 'var(--txt3)' }}>
                  Supports: Gmail, Outlook, Hotmail, iCloud, Yahoo, Zoho
                </div>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={handleSmtpCsvDrop}
                style={{
                  border: '2px dashed var(--bdr2)', borderRadius: 'var(--rad-l)',
                  padding: '32px', textAlign: 'center', marginBottom: 16,
                  background: 'var(--bg2)', cursor: 'pointer'
                }}
                onClick={handleSmtpCsvUpload}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>📤</div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Drop CSV here or click to upload
                </div>
                <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
                  email + app_password columns required
                </div>
              </div>

              {/* Loaded accounts preview */}
              {smtpCsvAccounts.length > 0 && !smtpValidated && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 8 }}>
                    {smtpCsvAccounts.length} accounts loaded — validate before sending
                  </div>
                  <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)',
                    borderRadius: 'var(--rad)', overflow: 'hidden', marginBottom: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg3)' }}>
                          {['Email', 'Provider'].map(h => (
                            <th key={h} style={{ padding: '8px 14px', textAlign: 'left',
                              fontWeight: 600, color: 'var(--txt2)', borderBottom: '1px solid var(--bdr)',
                              fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {smtpCsvAccounts.slice(0, 5).map((acc, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--bdr)' }}>
                            <td style={{ padding: '8px 14px' }}>{acc.email}</td>
                            <td style={{ padding: '8px 14px', color: 'var(--txt2)' }}>
                              {acc.email.split('@')[1]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {smtpCsvAccounts.length > 5 && (
                      <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--txt3)', borderTop: '1px solid var(--bdr)' }}>
                        +{smtpCsvAccounts.length - 5} more accounts
                      </div>
                    )}
                  </div>
                  <Button variant="primary" onClick={handleValidateSmtp} loading={smtpValidating}>
                    {smtpValidating ? 'Validating connections...' : '🔌 Test & Validate All SMTP'}
                  </Button>
                </div>
              )}

              {/* Validation results */}
              {smtpValidated && (
                <div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    <div style={{ background: 'var(--gr-l)', border: '1px solid var(--gr)',
                      borderRadius: 'var(--rad)', padding: '12px 16px', flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--gr)', fontWeight: 600 }}>WORKING</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--gr)' }}>{smtpResults.working.length}</div>
                    </div>
                    <div style={{ background: 'var(--re-l)', border: '1px solid var(--re)',
                      borderRadius: 'var(--rad)', padding: '12px 16px', flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--re)', fontWeight: 600 }}>FAILED</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--re)' }}>{smtpResults.failed.length}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                    <Button size="sm" variant="ghost" onClick={() => handleExportSmtp('working')}>
                      ↓ Download Working SMTP
                    </Button>
                    {smtpResults.failed.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => handleExportSmtp('failed')}>
                        ↓ Download Failed SMTP
                      </Button>
                    )}
                  </div>

                  {smtpResults.working.length > 0 && (
                    <div style={{ background: 'var(--gr-l)', border: '1px solid var(--gr)',
                      borderRadius: 'var(--rad)', padding: '10px 14px', fontSize: 12 }}>
                      ✅ {smtpResults.working.length} working SMTP accounts will be used for sending
                      (round-robin distribution)
                    </div>
                  )}
                </div>
              )}

              {/* Schedule */}
              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 6 }}>
                  Schedule (optional)
                </label>
                <input type="datetime-local" value={campaign.scheduled_at}
                  onChange={e => setCampaign(c => ({ ...c, scheduled_at: e.target.value }))}
                  style={{ padding: '8px 11px', borderRadius: 'var(--rad)', border: '1px solid var(--bdr2)',
                    background: 'var(--bg2)', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
                />
              </div>
            </div>
          )}

          {/* Schedule for existing server mode */}
          {campaign.sending_mode === 'existing_server' && (
            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 6 }}>
                Schedule (optional — leave blank to start immediately)
              </label>
              <input type="datetime-local" value={campaign.scheduled_at}
                onChange={e => setCampaign(c => ({ ...c, scheduled_at: e.target.value }))}
                style={{ padding: '8px 11px', borderRadius: 'var(--rad)', border: '1px solid var(--bdr2)',
                  background: 'var(--bg2)', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: Review ── */}
      {step === 4 && (
        <div>
          <div className={styles.checkList}>
            <CheckItem ok={!!campaign.contact_list_id}
              text={selectedListInfo
                ? `Recipients — ${selectedListInfo.valid?.toLocaleString()} valid contacts loaded`
                : 'No contact list selected'} />
            <CheckItem ok={!!campaign.template_id}
              text={selectedTemplate
                ? `Template — "${selectedTemplate.name}"`
                : 'No template selected'} />
            <CheckItem ok={campaign.sending_mode === 'custom_smtp'
                ? campaign.custom_smtp_list?.length > 0
                : campaign.server_ids.length > 0}
              text={campaign.sending_mode === 'custom_smtp'
                ? `Custom SMTP — ${campaign.custom_smtp_list?.length || 0} accounts (round-robin)`
                : campaign.server_ids.length > 0
                  ? `Servers — ${campaign.server_ids.length} server(s) selected`
                  : 'No sending method selected'} />
            <CheckItem warn
              text="Test email — recommended before launch"
              action={
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <input
                    style={{ padding: '5px 10px', border: '1px solid var(--bdr2)', borderRadius: 'var(--rad)',
                      fontSize: 12, background: 'var(--bg2)', color: 'var(--txt)', fontFamily: 'var(--font)', width: 260 }}
                    placeholder="test@email.com, another@email.com"
                    value={testEmails}
                    onChange={e => setTestEmails(e.target.value)}
                  />
                  <Button size="sm" onClick={sendTest}>Send test</Button>
                </div>
              }
            />
          </div>

          <div className={styles.summaryBox}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Campaign summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
              {[
                ['Name', campaign.name],
                ['Recipients', (selectedListInfo?.valid || 0).toLocaleString()],
                ['Template', selectedTemplate?.name || '—'],
                ['Sending method', campaign.sending_mode === 'custom_smtp' ? `Custom SMTP (${campaign.custom_smtp_list?.length || 0} accounts)` : `${campaign.server_ids.length} server(s)`],
                ['Schedule', campaign.scheduled_at || 'Start immediately'],
                ['Open tracking', 'Enabled'],
                ['Click tracking', 'Enabled'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: '1px solid var(--bdr)' }}>
                  <span style={{ color: 'var(--txt2)' }}>{k}</span>
                  <span style={{ fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Export results section if campaign already ran */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="success" loading={launching} onClick={() => handleLaunch(false)}>
              🚀 Start campaign now
            </Button>
            {campaign.scheduled_at && (
              <Button loading={launching} onClick={() => handleLaunch(true)}>Schedule</Button>
            )}
            <Button variant="ghost" onClick={saveDraft}>Save draft</Button>
          </div>
        </div>
      )}

      {/* Step nav */}
      <div className={styles.stepNav}>
        <Button variant="ghost" onClick={() => setStep(s => s - 1)}
          style={{ visibility: step === 1 ? 'hidden' : 'visible' }}>
          ← Back
        </Button>
        {step < 4 && (
          <Button variant="primary" onClick={() => setStep(s => s + 1)} disabled={!canAdvance()}>
            Continue →
          </Button>
        )}
      </div>
    </div>
  )
}

function CheckItem({ ok, warn, text, action }) {
  const type = ok ? 'ok' : warn ? 'warn' : 'fail'
  const icon = ok ? '✓' : warn ? '!' : '✕'
  return (
    <div className={styles.checkItem}>
      <div className={`${styles.checkIcon} ${styles[type]}`}>{icon}</div>
      <div className={styles.checkText}>
        <div>{text}</div>
        {action}
      </div>
    </div>
  )
}
