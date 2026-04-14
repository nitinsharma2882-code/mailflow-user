import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import { Input, Select, Card, SectionHeader } from '../components/ui/UI'
import Button from '../components/ui/Button'
import styles from './Pages.module.css'

const STEPS = ['Contacts', 'Template', 'Servers', 'Review & send']

export default function NewCampaign() {
  const { contactLists, setContactLists, templates, setTemplates,
          servers, setServers, addToast, setActivePage } = useAppStore()

  const [step, setStep] = useState(1)
  const [campaign, setCampaign] = useState({
    name: '', contact_list_id: '', template_id: '',
    server_ids: [], sending_mode: 'auto', scheduled_at: '',
  })
  const [preview, setPreview] = useState([])
  const [selectedListInfo, setSelectedListInfo] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [importing, setImporting] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [testEmails, setTestEmails] = useState('')
  const tplRef = useRef(null)

  useEffect(() => {
    Promise.all([
      window.api.contacts.getLists().then(setContactLists),
      window.api.templates.getAll().then(setTemplates),
      window.api.servers.getAll().then(setServers),
    ])
  }, [])

  // --- File import ---
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
    const rows = await window.api.contacts.getPreview(listId, 5)
    setPreview(rows)
  }

  function toggleServer(id) {
    setCampaign(c => ({
      ...c,
      server_ids: c.server_ids.includes(id)
        ? c.server_ids.filter(s => s !== id)
        : [...c.server_ids, id]
    }))
  }

  async function sendTest() {
    const emails = testEmails.split(',').map(e => e.trim()).filter(Boolean)
    if (!emails.length) { addToast('Enter at least one test email', 'error'); return }

    const srv = servers.find(s => campaign.server_ids.includes(s.id) && s.status === 'active')
    if (!srv) { addToast('Select an active server first', 'error'); return }

    // Save draft first to get a real campaign ID
    const draft = await window.api.campaigns.create({ ...campaign, status: 'draft', total_recipients: selectedListInfo?.total || 0 })
    const result = await window.api.sending.sendTest({ campaignId: draft.id, testEmails: emails, serverId: srv.id })
    if (result.success) addToast(`Test sent to ${emails.length} address(es)`, 'success')
    else addToast('Test failed: ' + result.error, 'error')
  }

  async function handleLaunch(scheduleOnly = false) {
    if (!campaign.name) { addToast('Enter a campaign name', 'error'); return }
    if (!campaign.contact_list_id) { addToast('Select a contact list', 'error'); return }
    if (!campaign.template_id) { addToast('Select a template', 'error'); return }
    if (!campaign.server_ids.length) { addToast('Select at least one server', 'error'); return }

    setLaunching(true)
    try {
      const created = await window.api.campaigns.create({
        ...campaign,
        status: scheduleOnly ? 'scheduled' : 'draft',
        total_recipients: selectedListInfo?.total || 0,
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
    await window.api.campaigns.create({ ...campaign, status: 'draft', total_recipients: selectedListInfo?.total || 0 })
    addToast('Draft saved')
    setActivePage('campaigns')
  }

  // Validate step before advancing
  function canAdvance() {
    if (step === 1) return !!campaign.contact_list_id
    if (step === 2) return !!campaign.template_id && !!campaign.name
    if (step === 3) return campaign.server_ids.length > 0
    return true
  }

  const selectedTemplate = templates.find(t => t.id === campaign.template_id)

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

      {/* ── Step 1: Contacts ── */}
      {step === 1 && (
        <div>
          <div className={styles.formRow}>
            <label className={styles.formLabel} style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 5, display: 'block' }}>
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
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 14 }}>
              <span style={{ color: 'var(--gr)', fontWeight: 600 }}>{selectedListInfo.valid?.toLocaleString()} valid</span>
              {' · '}
              <span style={{ color: 'var(--re)' }}>{selectedListInfo.invalid?.toLocaleString()} invalid</span>
              {' · '}
              {selectedListInfo.total?.toLocaleString()} total
            </div>
          )}

          {preview.length > 0 && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)' }}>
                    {['Email', 'Name', 'Status'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600,
                        color: 'var(--txt2)', borderBottom: '1px solid var(--bdr)', fontSize: 11, textTransform: 'uppercase' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--bdr)' }}>
                      <td style={{ padding: '9px 14px' }}>{row.email}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--txt2)' }}>{row.name || '—'}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                          background: row.status === 'valid' ? 'var(--gr-l)' : 'var(--re-l)',
                          color: row.status === 'valid' ? 'var(--gr)' : 'var(--re)' }}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--txt3)', borderTop: '1px solid var(--bdr)' }}>
                Showing {preview.length} of {selectedListInfo?.total?.toLocaleString()} contacts
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
                {selectedTemplate.variables && JSON.parse(selectedTemplate.variables || '[]').length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--txt2)', marginTop: 4 }}>
                    Variables: {JSON.parse(selectedTemplate.variables).map(v => (
                      <span key={v} className={styles.varChip} style={{ marginRight: 4 }}>
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                )}
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

      {/* ── Step 3: Servers ── */}
      {step === 3 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 12 }}>
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
                  onClick={() => toggleServer(s.id)}
                >
                  <div className={`${styles.serverDot} ${styles['dot-' + s.status]}`} />
                  <div className={styles.serverInfo}>
                    <div className={styles.serverName}>{s.name}</div>
                    <div className={styles.serverMeta}>
                      {s.type === 'smtp' ? `${s.host}:${s.port} · ${s.encryption?.toUpperCase()}` : `${s.provider?.toUpperCase()} API`}
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

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 10 }}>
              Sending mode
            </div>
            <div className={styles.radioGroup}>
              {[
                { value: 'auto', title: 'Auto (recommended)', desc: 'System handles distribution, rate limiting, batching & retry automatically' },
                { value: 'manual', title: 'Manual control', desc: 'System still manages sending but you set batch sizes and delays yourself' },
              ].map(m => (
                <div key={m.value}
                  className={`${styles.radioCard} ${campaign.sending_mode === m.value ? styles.selected : ''}`}
                  onClick={() => setCampaign(c => ({ ...c, sending_mode: m.value }))}>
                  <div className={styles.radioCardTitle}>{m.title}</div>
                  <div className={styles.radioCardDesc}>{m.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 6 }}>
              Schedule (optional — leave blank to start immediately)
            </label>
            <input type="datetime-local" value={campaign.scheduled_at}
              onChange={e => setCampaign(c => ({ ...c, scheduled_at: e.target.value }))}
              style={{ padding: '8px 11px', borderRadius: 'var(--rad)', border: '1px solid var(--bdr2)',
                background: 'var(--bg2)', fontSize: 13, color: 'var(--txt)', fontFamily: 'var(--font)' }}
            />
          </div>
        </div>
      )}

      {/* ── Step 4: Review ── */}
      {step === 4 && (
        <div>
          <div className={styles.checkList}>
            <CheckItem ok={!!campaign.contact_list_id}
              text={selectedListInfo
                ? `Contacts — ${selectedListInfo.valid?.toLocaleString()} valid recipients loaded`
                : 'No contact list selected'} />
            <CheckItem ok={!!campaign.template_id}
              text={selectedTemplate
                ? `Template — "${selectedTemplate.name}" · Open & click tracking enabled`
                : 'No template selected'} />
            <CheckItem ok={campaign.server_ids.length > 0}
              text={campaign.server_ids.length > 0
                ? `Servers — ${campaign.server_ids.length} server(s) selected · ${campaign.sending_mode} mode`
                : 'No servers selected'} />
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
                ['Servers', campaign.server_ids.length + ' selected'],
                ['Mode', campaign.sending_mode],
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
