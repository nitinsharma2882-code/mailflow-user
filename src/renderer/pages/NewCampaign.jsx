import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Card } from '../components/ui/UI'
import Button from '../components/ui/Button'
import styles from './Pages.module.css'

const STEPS = ['Campaign', 'Recipients', 'Template', 'SMTP / Server', 'Preview & Send']

export default function NewCampaign() {
  const { contactLists, setContactLists, templates, setTemplates,
          servers, setServers, addToast, setActivePage } = useAppStore()

  const [step, setStep]           = useState(1)
  const [campaign, setCampaign]   = useState({
    name: '', contact_list_id: '', template_id: '',
    server_ids: [], sending_mode: 'existing_server',
    scheduled_at: '', custom_smtp_list: [],
  })
  const [preview, setPreview]               = useState([])
  const [selectedListInfo, setSelectedListInfo] = useState(null)
  const [importing, setImporting]           = useState(false)
  const [launching, setLaunching]           = useState(false)
  const [testEmails, setTestEmails]         = useState('')
  const [quotaWarnings, setQuotaWarnings]   = useState([])

  // Custom SMTP state
  const [smtpCsvAccounts, setSmtpCsvAccounts] = useState([])
  const [smtpValidating, setSmtpValidating]   = useState(false)
  const [smtpValidated, setSmtpValidated]     = useState(false)
  const [smtpProgress, setSmtpProgress]       = useState({ completed: 0, total: 0 })
  const [smtpResults, setSmtpResults]         = useState({ working: [], failed: [], timeout: [], quotaExceeded: [] })

  useEffect(() => {
    Promise.all([
      window.api.contacts.getLists().then(setContactLists),
      window.api.templates.getAll().then(setTemplates),
      window.api.servers.getAll().then(setServers),
    ]).then(() => {
      // Check if we're editing/resending an existing campaign
      if (window._resendCampaign) {
        const r = window._resendCampaign
        setCampaign(c => ({
          ...c,
          name:            r.name ? r.name + ' (Copy)' : '',
          contact_list_id: r.contact_list_id || '',
          template_id:     r.template_id     || '',
          server_ids:      (() => { try { return JSON.parse(r.server_ids || '[]') } catch { return [] } })(),
          sending_mode:    r.sending_mode || 'existing_server',
        }))
        window._resendCampaign = null
        addToast('Campaign data pre-filled — review and send', 'success')
      }
    })

    window.api.on('customSmtp:progress', ({ completed, total }) => {
      setSmtpProgress({ completed, total })
    })
    window.api.on('sending:smtpQuota', ({ email }) => {
      setQuotaWarnings(prev => [...prev, email])
      addToast(`⚠ SMTP quota exceeded: ${email} — switched to next available`, 'error')
    })
  }, [])

  // ── Step 2: Contacts ──
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
    const rows = await window.api.contacts.getPreview(listId)
    setPreview(rows)
  }

  async function handleDownloadInvalid() {
    if (!campaign.contact_list_id) return
    await window.api.contacts.exportInvalid(campaign.contact_list_id)
    addToast('Invalid emails downloaded', 'success')
  }

  // ── Step 4: Server ──
  function toggleServer(id) {
    setCampaign(c => ({
      ...c,
      server_ids: c.server_ids.includes(id)
        ? c.server_ids.filter(s => s !== id)
        : [...c.server_ids, id]
    }))
  }

  // ── Custom SMTP ──
  async function handleSmtpCsvUpload() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.csv,.txt'
      input.style.display = 'none'
      document.body.appendChild(input)
      input.onchange = async (e) => {
        document.body.removeChild(input)
        const file = e.target.files[0]
        if (!file) return resolve()
        try {
          const text = await file.text()
          await parseAndSetSmtpAccounts(text)
        } catch (err) {
          addToast('Error reading file: ' + err.message, 'error')
        }
        resolve()
      }
      input.oncancel = () => { try { document.body.removeChild(input) } catch {} resolve() }
      input.click()
    })
  }

  async function parseAndSetSmtpAccounts(text) {
    const parsed = await window.api.customSmtp.parseCsv(text)
    if (parsed.success && parsed.accounts.length > 0) {
      setSmtpCsvAccounts(parsed.accounts)
      setSmtpValidated(false)
      setSmtpProgress({ completed: 0, total: 0 })
      setSmtpResults({ working: [], failed: [], timeout: [], quotaExceeded: [] })
      addToast(`✅ Loaded ${parsed.accounts.length} SMTP accounts`, 'success')
    } else {
      addToast(parsed.error || 'No valid accounts found. Format: email,app_password', 'error')
    }
  }

  async function handleSmtpDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files[0]
    if (!file) return
    try {
      const text = await file.text()
      await parseAndSetSmtpAccounts(text)
    } catch (err) {
      addToast('Error reading dropped file: ' + err.message, 'error')
    }
  }

  async function handleValidateSmtp() {
    if (!smtpCsvAccounts.length) return
    setSmtpValidating(true)
    setSmtpProgress({ completed: 0, total: smtpCsvAccounts.length })
    try {
      const result = await window.api.customSmtp.validate(smtpCsvAccounts)
      setSmtpResults({
        working:       result.working       || [],
        failed:        result.failed        || [],
        timeout:       result.timeout       || [],
        quotaExceeded: result.quotaExceeded || [],
      })
      setSmtpValidated(true)
      setCampaign(c => ({ ...c, custom_smtp_list: result.working }))
      addToast(`✅ ${result.working.length} working · ❌ ${result.failed.length} failed · ⏱ ${result.timeout?.length || 0} timeout`, 'success')
    } catch (err) {
      addToast('Validation failed: ' + err.message, 'error')
    } finally {
      setSmtpValidating(false)
    }
  }

  function handleClearSmtp() {
    setSmtpCsvAccounts([])
    setSmtpValidated(false)
    setSmtpProgress({ completed: 0, total: 0 })
    setSmtpResults({ working: [], failed: [], timeout: [], quotaExceeded: [] })
    setCampaign(c => ({ ...c, custom_smtp_list: [] }))
    addToast('SMTP list cleared', 'success')
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
      ...campaign, status: 'draft', total_recipients: selectedListInfo?.total || 0,
      server_ids: campaign.server_ids,
      custom_smtp_list: campaign.custom_smtp_list || [],
    })
    let serverId = null, customSmtpAccount = null
    if (campaign.sending_mode === 'custom_smtp' && campaign.custom_smtp_list?.length > 0) {
      customSmtpAccount = campaign.custom_smtp_list[0]
    } else {
      const srv = servers.find(s => campaign.server_ids.includes(s.id) && s.status === 'active')
      serverId = srv?.id
    }
    const result = await window.api.sending.sendTest({ campaignId: draft.id, testEmails: emails, serverId, customSmtpAccount })
    if (result.success) addToast(`Test sent to ${emails.length} address(es)`, 'success')
    else addToast('Test failed: ' + result.error, 'error')
  }

  // ── Launch ──
  async function handleLaunch(scheduleOnly = false) {
    if (!campaign.name)            { addToast('Enter a campaign name', 'error'); return }
    if (!campaign.contact_list_id) { addToast('Select a contact list', 'error'); return }
    if (!campaign.template_id)     { addToast('Select a template', 'error'); return }
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
      ...campaign, status: 'draft', total_recipients: selectedListInfo?.total || 0,
      server_ids: campaign.server_ids,
      custom_smtp_list: campaign.custom_smtp_list || [],
    })
    addToast('Draft saved')
    setActivePage('campaigns')
  }

  function canAdvance() {
    if (step === 1) return !!campaign.name
    if (step === 2) return !!campaign.contact_list_id
    if (step === 3) return !!campaign.template_id
    if (step === 4) {
      if (campaign.sending_mode === 'existing_server') return campaign.server_ids.length > 0
      if (campaign.sending_mode === 'custom_smtp') return campaign.custom_smtp_list?.length > 0
    }
    return true
  }

  const selectedTemplate = templates.find(t => t.id === campaign.template_id)

  const IS = {
    width: '100%', padding: '8px 11px', border: '1px solid var(--bdr2)',
    borderRadius: 'var(--rad)', fontSize: 13, background: 'var(--bg2)',
    color: 'var(--txt)', fontFamily: 'var(--font)', outline: 'none'
  }

  return (
    <div>
      {/* Stepper */}
      <div className={styles.stepperWrap}>
        {STEPS.map((label, i) => {
          const n = i + 1
          const isDone   = n < step
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

      {/* Quota warnings */}
      {quotaWarnings.length > 0 && (
        <div style={{ background: '#FFF3CD', border: '1px solid #F39C12', borderRadius: 8,
          padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#856404' }}>
          ⚠ SMTP quota exceeded for: {quotaWarnings.join(', ')} — switched to other available SMTPs
        </div>
      )}

      {/* ── Step 1: Campaign ── */}
      {step === 1 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Create Campaign</div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 6 }}>Campaign Name *</label>
            <input style={{ ...IS, maxWidth: 420 }} placeholder="e.g. May Newsletter 2026"
              value={campaign.name} onChange={e => setCampaign(c => ({ ...c, name: e.target.value }))} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 6 }}>
              Schedule (optional — leave blank to start immediately)
            </label>
            <input type="datetime-local" value={campaign.scheduled_at}
              onChange={e => setCampaign(c => ({ ...c, scheduled_at: e.target.value }))}
              style={{ ...IS, maxWidth: 300 }} />
          </div>
        </div>
      )}

      {/* ── Step 2: Recipients ── */}
      {step === 2 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Add Recipients</div>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)',
            borderRadius: 'var(--rad)', padding: '12px 16px', marginBottom: 16, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--txt2)' }}>📋 Recommended CSV Format:</div>
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
                {[['user1@gmail.com','John Doe','Delhi, India','VIP'],['user2@gmail.com','Jane Smith','Mumbai','Premium']].map((row,i) => (
                  <tr key={i}>
                    {row.map((v,j) => <td key={j} style={{ padding: '6px 12px', border: '1px solid var(--bdr)', color: 'var(--txt3)' }}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, color: 'var(--txt3)', fontSize: 11 }}>Fields auto-detected and mapped by position.</div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <select style={{ flex: 1, minWidth: 220, ...IS }} value={campaign.contact_list_id} onChange={e => handleSelectList(e.target.value)}>
              <option value="">Select existing list...</option>
              {contactLists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.total?.toLocaleString()} contacts)</option>)}
            </select>
            <Button variant="primary" onClick={handleImportCSV} loading={importing}>↑ Import CSV</Button>
          </div>

          {selectedListInfo && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                {[['Total', selectedListInfo.total, 'var(--txt)'],['Valid', selectedListInfo.valid, 'var(--gr)'],['Invalid', selectedListInfo.invalid, 'var(--re)']].map(([label, val, color]) => (
                  <div key={label} style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '10px 16px', minWidth: 90 }}>
                    <div style={{ fontSize: 11, color: 'var(--txt2)', marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color }}>{val?.toLocaleString()}</div>
                  </div>
                ))}
              </div>
              {selectedListInfo.invalid > 0 && (
                <Button size="sm" variant="ghost" onClick={handleDownloadInvalid}>↓ Download Invalid Emails CSV</Button>
              )}
            </div>
          )}

          {preview.length > 0 && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bdr)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)' }}>All Recipients ({preview.length.toLocaleString()})</span>
                <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Scroll to view all</span>
              </div>
              <div style={{ maxHeight: 380, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr style={{ background: 'var(--bg3)' }}>
                      {['#','Email','Name','Address','Custom Field','Status'].map(h => (
                        <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600,
                          color: 'var(--txt2)', borderBottom: '1px solid var(--bdr)',
                          fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap', background: 'var(--bg3)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => {
                      const email   = typeof row.email        === 'object' ? JSON.stringify(row.email)        : (row.email        || '')
                      const name    = typeof row.name         === 'object' ? JSON.stringify(row.name)         : (row.name         || '—')
                      const address = typeof row.address      === 'object' ? JSON.stringify(row.address)      : (row.address      || '—')
                      const custom  = typeof row.custom_field === 'object' ? JSON.stringify(row.custom_field) : (row.custom_field || '—')
                      const status  = row.status || 'valid'
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--bdr)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                          <td style={{ padding: '7px 14px', color: 'var(--txt3)', fontSize: 11 }}>{i + 1}</td>
                          <td style={{ padding: '7px 14px', fontFamily: 'monospace', fontSize: 11 }}>{email}</td>
                          <td style={{ padding: '7px 14px', color: 'var(--txt2)' }}>{name}</td>
                          <td style={{ padding: '7px 14px', color: 'var(--txt2)' }}>{address}</td>
                          <td style={{ padding: '7px 14px', color: 'var(--txt2)' }}>{custom}</td>
                          <td style={{ padding: '7px 14px' }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                              background: status === 'valid' ? 'var(--gr-l)' : 'var(--re-l)',
                              color: status === 'valid' ? 'var(--gr)' : 'var(--re)' }}>{status}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--txt3)', borderTop: '1px solid var(--bdr)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{selectedListInfo?.valid?.toLocaleString()} valid · {selectedListInfo?.invalid?.toLocaleString()} invalid</span>
                <span>{preview.length.toLocaleString()} total loaded</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Template ── */}
      {step === 3 && (
        <Step3Template
          templates={templates}
          setTemplates={setTemplates}
          campaign={campaign}
          setCampaign={setCampaign}
          addToast={addToast}
          onNext={() => setStep(4)}
        />
      )}

      {/* ── Step 4: SMTP / Server ── */}
      {step === 4 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Add SMTP / Server</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[
              { value: 'existing_server', title: '🖥 Use Existing Server', desc: 'Use configured SMTP/API servers' },
              { value: 'custom_smtp',     title: '📧 Upload SMTP CSV',     desc: 'Gmail, Outlook, iCloud via CSV' }
            ].map(m => (
              <div key={m.value} onClick={() => setCampaign(c => ({ ...c, sending_mode: m.value }))}
                style={{ padding: '16px', borderRadius: 'var(--rad-l)', cursor: 'pointer',
                  border: campaign.sending_mode === m.value ? '2px solid var(--pu)' : '2px solid var(--bdr)',
                  background: campaign.sending_mode === m.value ? 'var(--pu-l)' : 'var(--bg2)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{m.title}</div>
                <div style={{ fontSize: 12, color: 'var(--txt2)' }}>{m.desc}</div>
              </div>
            ))}
          </div>

          {campaign.sending_mode === 'existing_server' && (
            <div>
              {servers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)', fontSize: 13 }}>
                  No servers configured.{' '}
                  <span style={{ color: 'var(--pu)', cursor: 'pointer', fontWeight: 500 }} onClick={() => setActivePage('servers')}>Add a server →</span>
                </div>
              ) : servers.map(s => {
                const isSelected = campaign.server_ids.includes(s.id)
                const usedPct = s.daily_limit > 0 ? Math.round((s.sent_today / s.daily_limit) * 100) : 0
                return (
                  <div key={s.id} className={styles.serverItem}
                    style={isSelected ? { borderColor: 'var(--pu)', background: 'var(--pu-l)' } : {}}
                    onClick={() => toggleServer(s.id)}>
                    <div className={`${styles.serverDot} ${styles['dot-' + s.status]}`} />
                    <div className={styles.serverInfo}>
                      <div className={styles.serverName}>{s.name}</div>
                      <div className={styles.serverMeta}>{s.type === 'smtp' ? `${s.host}:${s.port}` : `${s.provider?.toUpperCase()} API`} · {s.daily_limit?.toLocaleString()}/day</div>
                    </div>
                    <div className={styles.serverStat} style={{ fontSize: 11, color: usedPct > 85 ? 'var(--re)' : 'var(--txt2)' }}>
                      {s.sent_today?.toLocaleString()} / {s.daily_limit?.toLocaleString()}<br />{usedPct}% used
                    </div>
                    <input type="checkbox" readOnly checked={isSelected} style={{ width: 16, height: 16, accentColor: 'var(--pu)', cursor: 'pointer' }} />
                  </div>
                )
              })}
            </div>
          )}

          {campaign.sending_mode === 'custom_smtp' && (
            <div>
              <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '12px 16px', marginBottom: 16, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>CSV Format (no header needed):</div>
                <code style={{ color: 'var(--pu)' }}>email,app_password</code><br />
                <code style={{ color: 'var(--txt2)' }}>user@gmail.com,abcd efgh ijkl mnop</code>
                <div style={{ marginTop: 6, color: 'var(--txt3)' }}>Supports: Gmail · Outlook · iCloud · Yahoo · Zoho</div>
              </div>

              <div onDragOver={e => e.preventDefault()} onDrop={handleSmtpDrop}
                style={{ border: '2px dashed var(--bdr2)', borderRadius: 'var(--rad-l)',
                  padding: '28px', textAlign: 'center', marginBottom: 16, background: 'var(--bg2)', cursor: 'pointer' }}
                onClick={handleSmtpCsvUpload}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📤</div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Drop CSV here or click to upload</div>
                <div style={{ fontSize: 12, color: 'var(--txt3)' }}>email + app_password · one per line</div>
              </div>

              {smtpCsvAccounts.length > 0 && !smtpValidated && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--txt2)' }}>{smtpCsvAccounts.length} accounts loaded</div>
                    <button onClick={handleClearSmtp}
                      style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--re)', borderRadius: 'var(--rad)', fontSize: 11, cursor: 'pointer', color: 'var(--re)', fontWeight: 600 }}>
                      🗑 Remove & Upload New
                    </button>
                  </div>
                  <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', overflow: 'hidden', marginBottom: 10, maxHeight: 200, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg3)' }}>
                          {['#','Email','Provider'].map(h => (
                            <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--txt2)', borderBottom: '1px solid var(--bdr)', fontSize: 11, background: 'var(--bg3)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {smtpCsvAccounts.map((acc, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--bdr)' }}>
                            <td style={{ padding: '7px 14px', color: 'var(--txt3)', fontSize: 11 }}>{i + 1}</td>
                            <td style={{ padding: '7px 14px' }}>{acc.email}</td>
                            <td style={{ padding: '7px 14px', color: 'var(--txt2)' }}>{acc.email.split('@')[1]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button variant="primary" onClick={handleValidateSmtp} loading={smtpValidating}>
                    {smtpValidating ? `Testing... (${smtpProgress.completed}/${smtpProgress.total})` : '🔌 Test & Validate All SMTP'}
                  </Button>
                  {smtpValidating && smtpProgress.total > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--txt2)', marginBottom: 4 }}>
                        <span>Testing in parallel (8 at a time)...</span>
                        <span>{smtpProgress.completed}/{smtpProgress.total}</span>
                      </div>
                      <div style={{ background: 'var(--bdr)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                        <div style={{ background: 'var(--pu)', height: '100%', borderRadius: 4,
                          width: `${Math.round((smtpProgress.completed / smtpProgress.total) * 100)}%`,
                          transition: 'width 0.3s ease' }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {smtpValidated && (
                <div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                    {[
                      ['WORKING',  smtpResults.working.length,           'var(--gr)',  'var(--gr-l)'],
                      ['FAILED',   smtpResults.failed.length,            'var(--re)',  'var(--re-l)'],
                      ['TIMEOUT',  smtpResults.timeout?.length  || 0,    '#888',       'var(--bg2)' ],
                      ['QUOTA',    smtpResults.quotaExceeded?.length||0, '#F39C12',    '#FFF3CD'    ],
                    ].map(([label, val, color, bg]) => (
                      <div key={label} style={{ background: bg, border: `1px solid ${color}`, borderRadius: 'var(--rad)', padding: '12px 16px', minWidth: 110 }}>
                        <div style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                    {smtpResults.working.length > 0 && <Button size="sm" variant="ghost" onClick={() => handleExportSmtp('working')}>↓ Working SMTP</Button>}
                    {smtpResults.failed.length  > 0 && <Button size="sm" variant="ghost" onClick={() => handleExportSmtp('failed')}>↓ Failed SMTP</Button>}
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <button onClick={handleClearSmtp}
                      style={{ padding: '6px 14px', background: 'none', border: '1px solid var(--re)', borderRadius: 'var(--rad)', fontSize: 12, cursor: 'pointer', color: 'var(--re)', fontWeight: 600 }}>
                      🗑 Remove & Upload New SMTP File
                    </button>
                  </div>
                  {smtpResults.working.length > 0 ? (
                    <div style={{ background: 'var(--gr-l)', border: '1px solid var(--gr)', borderRadius: 'var(--rad)', padding: '10px 14px', fontSize: 12 }}>
                      ✅ {smtpResults.working.length} working SMTP accounts ready · True round-robin · Quota exceeded auto-removed
                    </div>
                  ) : (
                    <div style={{ background: 'var(--re-l)', border: '1px solid var(--re)', borderRadius: 'var(--rad)', padding: '10px 14px', fontSize: 12, color: 'var(--re)' }}>
                      ❌ No working SMTP accounts found. Please check your app passwords.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 5: Preview & Send ── */}
      {step === 5 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Preview & Send</div>
          <div className={styles.summaryBox} style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Campaign Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
              {[
                ['Campaign Name',   campaign.name],
                ['Total Recipients',(selectedListInfo?.valid || 0).toLocaleString()],
                ['Invalid Skipped', (selectedListInfo?.invalid || 0).toLocaleString()],
                ['Template',        selectedTemplate?.name || '—'],
                ['Sending Method',  campaign.sending_mode === 'custom_smtp'
                  ? `Custom SMTP (${campaign.custom_smtp_list?.length || 0} accounts)`
                  : `${campaign.server_ids.length} server(s)`],
                ['Schedule',        campaign.scheduled_at || 'Start immediately'],
                ['Open Tracking',   'Enabled'],
                ['Click Tracking',  'Enabled'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--bdr)' }}>
                  <span style={{ color: 'var(--txt2)' }}>{k}</span>
                  <span style={{ fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {selectedTemplate && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 8 }}>EMAIL PREVIEW:</div>
              <div style={{ border: '1px solid var(--bdr)', borderRadius: 'var(--rad)',
                padding: '16px', background: '#fff', fontSize: 13, lineHeight: 1.6,
                maxHeight: 250, overflow: 'auto', color: '#000' }}
                dangerouslySetInnerHTML={{ __html: selectedTemplate.html_body }}
              />
              {selectedTemplate.attachments && JSON.parse(selectedTemplate.attachments || '[]').length > 0 && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', fontSize: 12 }}>
                  📎 {JSON.parse(selectedTemplate.attachments).length} attachment(s) will be sent with this email
                </div>
              )}
            </div>
          )}

          <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '14px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Send Test Email (recommended)</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={{ ...IS, maxWidth: 300 }}
                placeholder="test@email.com, another@email.com"
                value={testEmails} onChange={e => setTestEmails(e.target.value)} />
              <Button size="sm" onClick={sendTest}>Send Test</Button>
            </div>
          </div>

          <div className={styles.checkList} style={{ marginBottom: 20 }}>
            <CheckItem ok={!!campaign.contact_list_id} text={selectedListInfo ? `${selectedListInfo.valid?.toLocaleString()} valid recipients · ${selectedListInfo.invalid?.toLocaleString()} invalid skipped` : 'No contact list'} />
            <CheckItem ok={!!campaign.template_id} text={selectedTemplate ? `Template: "${selectedTemplate.name}"` : 'No template selected'} />
            <CheckItem ok={campaign.sending_mode === 'custom_smtp' ? campaign.custom_smtp_list?.length > 0 : campaign.server_ids.length > 0}
              text={campaign.sending_mode === 'custom_smtp' ? `${campaign.custom_smtp_list?.length || 0} SMTP accounts (round-robin)` : `${campaign.server_ids.length} server(s) selected`} />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="success" loading={launching} onClick={() => handleLaunch(false)}>🚀 Start Campaign Now</Button>
            {campaign.scheduled_at && <Button loading={launching} onClick={() => handleLaunch(true)}>📅 Schedule</Button>}
            <Button variant="ghost" onClick={saveDraft}>💾 Save Draft</Button>
          </div>
        </div>
      )}

      {/* Step nav */}
      <div className={styles.stepNav}>
        <Button variant="ghost" onClick={() => setStep(s => s - 1)} style={{ visibility: step === 1 ? 'hidden' : 'visible' }}>← Back</Button>
        {step < 5 && <Button variant="primary" onClick={() => setStep(s => s + 1)} disabled={!canAdvance()}>Continue →</Button>}
      </div>
    </div>
  )
}

// ── Step 3 Template Component ─────────────────────────────────────────────────
function Step3Template({ templates, setTemplates, campaign, setCampaign, addToast, onNext }) {
  const [tab, setTab]         = useState('existing')
  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState({ name: '', subject: '', from_name: '', html_body: '<p>Hi <strong>{{name}}</strong>,</p><br><p>Your message here.</p><br><p>Best,<br>The Team</p>' })
  const [saving, setSaving]   = useState(false)
  const [preview, setPreview] = useState(null)
  const [attachments, setAttachments] = useState([]) // { name, path, size, type, dataUrl }

  const selected = templates.find(t => t.id === campaign.template_id)

  async function openEdit(t) {
    if (t) {
      const full = await window.api.templates.getById(t.id)
      setForm({ name: full.name, subject: full.subject, from_name: full.from_name || '', html_body: full.html_body || '' })
      // Load existing attachments if any
      try { setAttachments(JSON.parse(full.attachments || '[]')) } catch { setAttachments([]) }
    } else {
      setForm({ name: '', subject: '', from_name: '', html_body: '<p>Hi <strong>{{name}}</strong>,</p><br><p>Your message here.</p><br><p>Best,<br>The Team</p>' })
      setAttachments([])
    }
    setEditing(t ? t.id : 'new')
  }

  // ── Attachment upload ──
  async function handleAddAttachment() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.accept = 'image/*,.pdf,.heic,.heif,video/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip'
      input.style.display = 'none'
      document.body.appendChild(input)
      input.onchange = async (e) => {
        document.body.removeChild(input)
        const files = Array.from(e.target.files || [])
        for (const file of files) {
          if (file.size > 20 * 1024 * 1024) {
            addToast(`${file.name} is too large (max 20MB)`, 'error')
            continue
          }
          const dataUrl = await readFileAsDataUrl(file)
          setAttachments(prev => [...prev, {
            name:    file.name,
            size:    file.size,
            type:    file.type,
            dataUrl: dataUrl,
          }])
        }
        resolve()
      }
      input.oncancel = () => { try { document.body.removeChild(input) } catch {} resolve() }
      input.click()
    })
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = e => resolve(e.target.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function removeAttachment(index) {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  function formatSize(bytes) {
    if (bytes < 1024)       return bytes + ' B'
    if (bytes < 1024*1024)  return (bytes/1024).toFixed(1) + ' KB'
    return (bytes/(1024*1024)).toFixed(1) + ' MB'
  }

  function getFileIcon(type) {
    if (!type) return '📄'
    if (type.startsWith('image/')) return '🖼'
    if (type === 'application/pdf') return '📕'
    if (type.startsWith('video/')) return '🎬'
    if (type.includes('word') || type.includes('doc')) return '📝'
    if (type.includes('sheet') || type.includes('excel')) return '📊'
    if (type.includes('presentation') || type.includes('powerpoint')) return '📊'
    if (type.includes('zip') || type.includes('compressed')) return '🗜'
    return '📄'
  }

  async function handleSave(andNext = false) {
    if (!form.name || !form.subject || !form.html_body) {
      addToast('Fill in template name, subject and body', 'error'); return
    }
    setSaving(true)
    try {
      const templateData = { ...form, attachments: JSON.stringify(attachments) }
      let saved
      if (editing === 'new') {
        saved = await window.api.templates.create(templateData)
        addToast('Template created', 'success')
      } else {
        saved = await window.api.templates.update(editing, templateData)
        addToast('Template saved', 'success')
      }
      const all = await window.api.templates.getAll()
      setTemplates(all)
      const newId = saved?.id || editing
      if (newId && newId !== 'new') setCampaign(c => ({ ...c, template_id: newId }))
      setEditing(false)
      if (andNext) onNext()
    } catch (err) {
      addToast('Save failed: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleUseTemplate(t) {
    setCampaign(c => ({ ...c, template_id: t.id }))
    addToast(`Template "${t.name}" selected`, 'success')
    onNext()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this template?')) return
    await window.api.templates.delete(id)
    addToast('Template deleted')
    if (campaign.template_id === id) setCampaign(c => ({ ...c, template_id: '' }))
    window.api.templates.getAll().then(setTemplates)
  }

  async function handleDuplicate(id) {
    await window.api.templates.duplicate(id)
    addToast('Template duplicated', 'success')
    window.api.templates.getAll().then(setTemplates)
  }

  function insertVar(v) { setForm(f => ({ ...f, html_body: f.html_body + `{{${v}}}` })) }

  const IS = {
    width: '100%', padding: '8px 11px', border: '1px solid var(--bdr2)',
    borderRadius: 'var(--rad)', fontSize: 13, background: 'var(--bg2)',
    color: 'var(--txt)', fontFamily: 'var(--font)', outline: 'none'
  }

  // ── Preview ──
  if (preview) {
    const previewAttachments = (() => { try { return JSON.parse(preview.attachments || '[]') } catch { return [] } })()
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => setPreview(null)} style={{ background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '6px 12px', cursor: 'pointer', color: 'var(--txt)', fontSize: 12 }}>← Back</button>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Preview: {preview.name}</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt2)', marginBottom: 6 }}>Subject: <strong>{preview.subject}</strong></div>
        <div style={{ border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '20px', background: '#fff', fontSize: 13, lineHeight: 1.7, minHeight: 200, color: '#000', maxHeight: 300, overflow: 'auto' }}
          dangerouslySetInnerHTML={{ __html: preview.html_body }} />
        {previewAttachments.length > 0 && (
          <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>📎 Attachments ({previewAttachments.length}):</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {previewAttachments.map((a, i) => (
                <div key={i} style={{ fontSize: 11, padding: '4px 8px', background: 'var(--bg3)', borderRadius: 4, color: 'var(--txt2)' }}>
                  {getFileIcon(a.type)} {a.name} ({formatSize(a.size)})
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button onClick={() => handleUseTemplate(preview)}
            style={{ padding: '9px 20px', background: 'var(--pu)', color: '#fff', border: 'none', borderRadius: 'var(--rad)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ✓ Use This Template →
          </button>
          <button onClick={() => setPreview(null)}
            style={{ padding: '9px 16px', background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', fontSize: 13, cursor: 'pointer', color: 'var(--txt)' }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Editor ──
  if (editing !== false) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => setEditing(false)} style={{ background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '6px 12px', cursor: 'pointer', color: 'var(--txt)', fontSize: 12 }}>← Back</button>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{editing === 'new' ? 'Create New Template' : 'Edit Template'}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {[['Template name *', 'name', 'Q2 Newsletter'], ['Subject line *', 'subject', 'Hi {{name}}, check this out'], ['From name', 'from_name', 'Your Company']].map(([label, key, ph]) => (
            <div key={key}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>{label}</label>
              <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph} style={IS} />
            </div>
          ))}
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>Email body (HTML) *</label>
        <div style={{ border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '8px', background: 'var(--bg3)', borderBottom: '1px solid var(--bdr)', borderRadius: 'var(--rad) var(--rad) 0 0' }}>
            {['name', 'email', 'company', 'city', 'tag'].map(v => (
              <button key={v} onClick={() => insertVar(v)}
                style={{ padding: '3px 8px', fontSize: 11, border: '1px solid var(--pu-m)', borderRadius: 4, background: 'var(--pu-l)', color: 'var(--pu)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <textarea value={form.html_body} onChange={e => setForm(f => ({ ...f, html_body: e.target.value }))}
            style={{ width: '100%', minHeight: 200, padding: '12px', border: 'none', fontSize: 13, fontFamily: 'monospace', lineHeight: 1.6, background: 'var(--bg2)', color: 'var(--txt)', outline: 'none', resize: 'vertical', borderRadius: '0 0 var(--rad) var(--rad)' }} />
        </div>

        {/* Live Preview */}
        {form.html_body && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 6 }}>Live Preview:</div>
            <div style={{ border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '14px', background: '#fff', fontSize: 13, lineHeight: 1.7, maxHeight: 200, overflow: 'auto', color: '#000' }}
              dangerouslySetInnerHTML={{ __html: form.html_body }} />
          </div>
        )}

        {/* ── Attachments Section ── */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)' }}>📎 Attachments (optional)</label>
            <button onClick={handleAddAttachment}
              style={{ padding: '5px 12px', background: 'var(--pu-l)', border: '1px solid var(--pu-m)', borderRadius: 'var(--rad)', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--pu)' }}>
              + Add Files
            </button>
          </div>

          <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 8 }}>
            Supports: Images (JPG, PNG, GIF, WebP, HEIC) · PDF · Video (MP4, MOV) · Documents (DOC, XLSX, PPT) · ZIP · Max 20MB per file
          </div>

          {attachments.length === 0 ? (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={async e => {
                e.preventDefault()
                const files = Array.from(e.dataTransfer.files)
                for (const file of files) {
                  if (file.size > 20 * 1024 * 1024) { addToast(`${file.name} too large (max 20MB)`, 'error'); continue }
                  const dataUrl = await readFileAsDataUrl(file)
                  setAttachments(prev => [...prev, { name: file.name, size: file.size, type: file.type, dataUrl }])
                }
              }}
              onClick={handleAddAttachment}
              style={{ border: '2px dashed var(--bdr2)', borderRadius: 'var(--rad)', padding: '20px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg2)' }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>📎</div>
              <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Drop files here or click to attach</div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {attachments.map((att, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)' }}>
                    <span style={{ fontSize: 18 }}>{getFileIcon(att.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{formatSize(att.size)}</div>
                    </div>
                    {att.type?.startsWith('image/') && att.dataUrl && (
                      <img src={att.dataUrl} alt={att.name}
                        style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--bdr)' }} />
                    )}
                    <button onClick={() => removeAttachment(i)}
                      style={{ background: 'none', border: '1px solid var(--re)', borderRadius: 4, padding: '3px 7px', cursor: 'pointer', color: 'var(--re)', fontSize: 11 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={handleAddAttachment}
                style={{ padding: '5px 12px', background: 'none', border: '1px dashed var(--bdr2)', borderRadius: 'var(--rad)', fontSize: 11, cursor: 'pointer', color: 'var(--txt2)' }}>
                + Add More Files
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => handleSave(false)} disabled={saving}
            style={{ padding: '9px 18px', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--txt)' }}>
            💾 Save Template
          </button>
          <button onClick={() => handleSave(true)} disabled={saving}
            style={{ padding: '9px 20px', background: 'var(--pu)', color: '#fff', border: 'none', borderRadius: 'var(--rad)', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : '✓ Save & Continue →'}
          </button>
          <button onClick={() => setEditing(false)}
            style={{ padding: '9px 16px', background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', fontSize: 13, cursor: 'pointer', color: 'var(--txt)' }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Main Template List ──
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Select Template</div>

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', overflow: 'hidden', width: 'fit-content' }}>
        {[['existing', '📋 Use Existing'], ['new', '✏️ Create New']].map(([val, label]) => (
          <button key={val} onClick={() => setTab(val)}
            style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: 'none', borderRight: val === 'existing' ? '1px solid var(--bdr)' : 'none',
              background: tab === val ? 'var(--pu)' : 'var(--bg2)',
              color: tab === val ? '#fff' : 'var(--txt2)' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'existing' && (
        <div>
          {templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--txt3)', fontSize: 13 }}>
              No templates yet.{' '}
              <span style={{ color: 'var(--pu)', cursor: 'pointer', fontWeight: 500 }} onClick={() => setTab('new')}>Create your first template →</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templates.map(t => {
                const isSelected = campaign.template_id === t.id
                const tAttachments = (() => { try { return JSON.parse(t.attachments || '[]') } catch { return [] } })()
                return (
                  <div key={t.id} style={{
                    border: isSelected ? '2px solid var(--pu)' : '1px solid var(--bdr)',
                    borderRadius: 'var(--rad-l)', padding: '14px 16px',
                    background: isSelected ? 'var(--pu-l)' : 'var(--bg2)',
                    display: 'flex', alignItems: 'center', gap: 12
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--txt2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Subject: {t.subject}
                      </div>
                      {tAttachments.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
                          📎 {tAttachments.length} attachment{tAttachments.length > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => setPreview(t)}
                        style={{ padding: '5px 10px', background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', fontSize: 11, cursor: 'pointer', color: 'var(--txt2)' }}>
                        👁 Preview
                      </button>
                      <button onClick={() => openEdit(t)}
                        style={{ padding: '5px 10px', background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', fontSize: 11, cursor: 'pointer', color: 'var(--txt2)' }}>
                        ✏️ Edit
                      </button>
                      <button onClick={() => handleDuplicate(t.id)}
                        style={{ padding: '5px 10px', background: 'none', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', fontSize: 11, cursor: 'pointer', color: 'var(--txt2)' }}>
                        Copy
                      </button>
                      <button onClick={() => handleDelete(t.id)}
                        style={{ padding: '5px 10px', background: 'none', border: '1px solid var(--re)', borderRadius: 'var(--rad)', fontSize: 11, cursor: 'pointer', color: 'var(--re)' }}>
                        Del
                      </button>
                      <button onClick={() => handleUseTemplate(t)}
                        style={{ padding: '5px 14px', background: 'var(--pu)', color: '#fff', border: 'none', borderRadius: 'var(--rad)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        ✓ Use →
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'new' && (
        <div style={{ textAlign: 'center', padding: '24px', background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✏️</div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Create a New Template</div>
          <div style={{ fontSize: 12, color: 'var(--txt2)', marginBottom: 16 }}>
            Build your email with HTML, add variables like {'{{name}}'}, attach files and preview before sending.
          </div>
          <button onClick={() => openEdit(null)}
            style={{ padding: '10px 24px', background: 'var(--pu)', color: '#fff', border: 'none', borderRadius: 'var(--rad)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + Create New Template
          </button>
        </div>
      )}

      {selected && (
        <div style={{ marginTop: 16, background: 'var(--gr-l)', border: '1px solid var(--gr)',
          borderRadius: 'var(--rad)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12 }}>
            ✅ Selected: <strong>{selected.name}</strong> · <span style={{ color: 'var(--txt2)' }}>{selected.subject}</span>
          </div>
          <button onClick={onNext}
            style={{ padding: '7px 16px', background: 'var(--pu)', color: '#fff', border: 'none', borderRadius: 'var(--rad)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Continue →
          </button>
        </div>
      )}
    </div>
  )
}

function CheckItem({ ok, warn, text }) {
  const type = ok ? 'ok' : warn ? 'warn' : 'fail'
  const icon = ok ? '✓' : warn ? '!' : '✕'
  return (
    <div className={styles.checkItem}>
      <div className={`${styles.checkIcon} ${styles[type]}`}>{icon}</div>
      <div className={styles.checkText}><div>{text}</div></div>
    </div>
  )
}
