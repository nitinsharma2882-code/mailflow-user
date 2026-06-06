import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import Button from '../components/ui/Button'

const LICENSE_SERVER = 'https://mailflow-license-server-production.up.railway.app'
const MAX_ACCOUNTS = 4

function parseCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const contacts = []
  for (const line of lines) {
    if (line.toLowerCase().startsWith('email,') || line.toLowerCase() === 'email') continue
    const parts = line.split(',')
    const email = parts[0]?.trim()
    if (!email || !email.includes('@')) continue
    const name = parts[1]?.trim().replace(/^"|"$/g, '') || ''
    contacts.push({ email, name })
  }
  return contacts
}

export default function ApiCampaign() {
  const { setActivePage, addToast } = useAppStore()
  const [step, setStep] = useState(1)
  const [licenseKey, setLicenseKey] = useState('')

  // Step 1 — Recipients
  const [contacts, setContacts]       = useState([])
  const [csvFileName, setCsvFileName] = useState('')
  const csvInputRef = useRef(null)

  // Step 2 — Template
  const [subject, setSubject]         = useState('')
  const [fromName, setFromName]       = useState('')
  const [htmlBody, setHtmlBody]       = useState('')
  const [attachment, setAttachment]   = useState(null)
  const [previewMode, setPreviewMode] = useState(false)
  const fileInputRef = useRef(null)

  // Step 3 — Gmail Accounts
  const [gmailAccounts, setGmailAccounts]     = useState([])
  const [selectedIds, setSelectedIds]         = useState([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError]     = useState('')

  // Step 4 — Progress
  const [launching, setLaunching] = useState(false)
  const [jobId, setJobId]         = useState(null)
  const [jobStatus, setJobStatus] = useState(null)
  const pollRef                   = useRef(null)

  const IS = {
    width: '100%', padding: '8px 11px', border: '1px solid var(--bdr2)',
    borderRadius: 'var(--rad)', fontSize: 13, background: 'var(--bg2)',
    color: 'var(--txt)', fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box',
  }

  useEffect(() => {
    window.api?.license?.getCustomerInfo?.().then(info => {
      if (info?.key) setLicenseKey(info.key)
    }).catch(() => {})
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  function handleCSVChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const parsed = parseCSV(evt.target.result)
      if (parsed.length === 0) { addToast('No valid contacts found in CSV', 'error'); return }
      setContacts(parsed)
      setCsvFileName(file.name)
      addToast(parsed.length + ' contacts loaded', 'success')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleAttachmentChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const base64 = evt.target.result.split(',')[1]
      setAttachment({ name: file.name, content: base64, mimeType: file.type || 'application/octet-stream' })
      addToast('Attachment: ' + file.name, 'success')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function loadGmailAccounts() {
    setAccountsLoading(true)
    setAccountsError('')
    try {
      let key = licenseKey
      if (!key) {
        const info = await window.api.license.getCustomerInfo()
        key = info?.key || ''
        if (key) setLicenseKey(key)
      }
      if (!key) { setAccountsError('License key not available'); setAccountsLoading(false); return }
      const res  = await fetch(LICENSE_SERVER + '/api/user/gmail-pool/ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load accounts')
      setGmailAccounts(Array.isArray(data.accounts) ? data.accounts : [])
    } catch (err) {
      setAccountsError(err.message)
      setGmailAccounts([])
    } finally {
      setAccountsLoading(false)
    }
  }

  function goToStep(n) {
    if (n === 3) loadGmailAccounts()
    setStep(n)
  }

  function toggleAccount(id) {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= MAX_ACCOUNTS) { addToast('Max 4 accounts allowed', 'error'); return prev }
      return [...prev, id]
    })
  }

  async function handleLaunch() {
    if (!licenseKey)          { addToast('License key not loaded', 'error');              return }
    if (contacts.length === 0){ addToast('No contacts loaded', 'error');                  return }
    if (!subject)             { addToast('Subject line required', 'error');               return }
    if (!htmlBody)            { addToast('Email body required', 'error');                 return }
    if (selectedIds.length === 0){ addToast('Select at least one Gmail account', 'error'); return }

    setLaunching(true)
    try {
      const attachments = attachment
        ? [{ filename: attachment.name, content: attachment.content, contentType: attachment.mimeType }]
        : []

      const res  = await fetch(LICENSE_SERVER + '/api/user/gmail-pool/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey, accountIds: selectedIds, jobData: { contacts, subject, fromName, htmlBody, attachments } }),
      })
      const data = await res.json()
      if (!res.ok || !data.jobId) throw new Error(data.error || 'Failed to start campaign')

      const jid = data.jobId
      setJobId(jid)
      setJobStatus({ status: 'running', sent: 0, failed: 0, total: data.total || contacts.length })
      addToast('Campaign launched!', 'success')

      pollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(LICENSE_SERVER + '/api/user/gmail-pool/send-status/' + jid, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
          const sd = await sr.json()
          if (sd.success !== false) setJobStatus(sd)
          if (sd.status === 'completed' || sd.status === 'stopped' || sd.status === 'failed') {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        } catch (e) {}
      }, 3000)
    } catch (err) {
      addToast('Launch failed: ' + err.message, 'error')
    } finally {
      setLaunching(false)
    }
  }

  async function handleStop() {
    if (!jobId) return
    try {
      await fetch(LICENSE_SERVER + '/api/user/gmail-pool/send-stop/' + jobId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey }),
      })
      addToast('Stop requested', 'info')
    } catch (e) {
      addToast('Stop request failed', 'error')
    }
  }

  function resetAll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setStep(1); setJobId(null); setJobStatus(null)
    setContacts([]); setCsvFileName('')
    setSubject(''); setFromName(''); setHtmlBody(''); setAttachment(null); setPreviewMode(false)
    setSelectedIds([]); setGmailAccounts([])
  }

  const STEPS = ['Recipients', 'Template', 'Gmail Accounts', 'Preview & Send']

  return (
    <div style={{ fontFamily: 'var(--font)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 4 }}>⚡ API Campaign</h2>
          <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
            Send via shared Gmail Pool — no SMTP or EC2 needed
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setActivePage('campaigns')}>← Back</Button>
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
        {STEPS.map((label, i) => {
          const n      = i + 1
          const active = step === n
          const done   = step > n
          return (
            <React.Fragment key={n}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, marginBottom: 5,
                  background: done ? '#22C55E' : active ? 'var(--pu)' : 'var(--bg2)',
                  color:      done || active ? '#fff' : 'var(--txt3)',
                  border:     done || active ? 'none' : '1px solid var(--bdr2)',
                  transition: 'all 0.2s',
                }}>
                  {done ? '✓' : n}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: active ? 700 : 400,
                  color: active ? 'var(--pu)' : done ? '#22C55E' : 'var(--txt3)',
                  textAlign: 'center', whiteSpace: 'nowrap',
                }}>
                  {label}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{
                  height: 1, flex: 0.3, marginBottom: 20,
                  background: step > i + 1 ? '#22C55E' : 'var(--bdr2)',
                }} />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* ─── STEP 1: Recipients ─── */}
      {step === 1 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>👥 Upload Recipients CSV</div>
          <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 20 }}>
            Format: <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>email,name</code> — one contact per line, header row is skipped automatically
          </div>

          <input ref={csvInputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleCSVChange} />

          <div
            onClick={() => csvInputRef.current?.click()}
            style={{
              border: '2px dashed ' + (contacts.length > 0 ? '#22C55E' : 'var(--bdr2)'),
              borderRadius: 'var(--rad-l)', padding: '40px 20px',
              textAlign: 'center', cursor: 'pointer', marginBottom: 24,
              transition: 'border-color 0.2s',
            }}
          >
            {contacts.length > 0 ? (
              <div>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#22C55E' }}>{contacts.length.toLocaleString()} contacts loaded</div>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>{csvFileName}</div>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>Click to replace</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📤</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Click to upload CSV</div>
                <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 4 }}>email, name — one row per contact</div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={() => setStep(2)} disabled={contacts.length === 0}>
              Next: Template →
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 2: Template ─── */}
      {step === 2 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 20 }}>📝 Email Template</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>Subject Line *</label>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="Enter subject line..." style={IS} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>From Name</label>
              <input value={fromName} onChange={e => setFromName(e.target.value)}
                placeholder="Your Company Name" style={IS} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>HTML Body *</label>
            <textarea
              value={htmlBody} onChange={e => setHtmlBody(e.target.value)}
              rows={9} placeholder="Paste your HTML email body here..."
              style={{ ...IS, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>

          {/* Attachment */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 8 }}>Attachment (optional)</label>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleAttachmentChange} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '7px 14px', background: 'var(--bg)', border: '1px solid var(--bdr2)',
                  borderRadius: 'var(--rad)', fontSize: 12, cursor: 'pointer',
                  color: 'var(--txt2)', fontFamily: 'var(--font)',
                }}>
                📎 {attachment ? 'Change' : 'Upload'} Attachment
              </button>
              {attachment && (
                <>
                  <span style={{ fontSize: 12, color: '#22C55E' }}>✅ {attachment.name}</span>
                  <button onClick={() => setAttachment(null)}
                    style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--txt3)', lineHeight: 1 }}>
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Preview */}
          {htmlBody && (
            <div style={{ marginBottom: 20 }}>
              <button onClick={() => setPreviewMode(!previewMode)}
                style={{
                  padding: '7px 14px', borderRadius: 'var(--rad)', fontSize: 12,
                  cursor: 'pointer', fontFamily: 'var(--font)',
                  background: previewMode ? 'var(--pu)' : 'var(--bg)',
                  border: '1px solid ' + (previewMode ? 'var(--pu)' : 'var(--bdr2)'),
                  color: previewMode ? '#fff' : 'var(--txt2)',
                }}>
                {previewMode ? '✕ Hide Preview' : '👁 Preview Email'}
              </button>
              {previewMode && (
                <div style={{ marginTop: 12, border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', background: '#fff', overflow: 'hidden' }}>
                  <div style={{ padding: '8px 14px', background: '#f7f7f8', borderBottom: '1px solid #e0e0e8', fontSize: 11, color: '#666' }}>
                    <strong>Subject:</strong> {subject || '(no subject)'}
                    {fromName && <> · <strong>From:</strong> {fromName}</>}
                  </div>
                  <div style={{ padding: 16, maxHeight: 380, overflow: 'auto' }}
                    dangerouslySetInnerHTML={{ __html: htmlBody }} />
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
            <Button variant="primary" onClick={() => goToStep(3)} disabled={!subject || !htmlBody}>
              Next: Gmail Accounts →
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: Gmail Accounts ─── */}
      {step === 3 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>📬 Select Gmail Pool Accounts</div>
              <div style={{ fontSize: 11, color: 'var(--txt3)' }}>Up to 4 accounts — emails will be rotated across them</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                background: selectedIds.length > 0 ? 'rgba(74,58,255,0.1)' : 'var(--bg)',
                color: selectedIds.length > 0 ? 'var(--pu)' : 'var(--txt3)',
              }}>
                {selectedIds.length} / {MAX_ACCOUNTS} selected
              </span>
              <button onClick={loadGmailAccounts}
                style={{
                  padding: '5px 10px', background: 'var(--bg)', border: '1px solid var(--bdr)',
                  borderRadius: 'var(--rad)', fontSize: 11, cursor: 'pointer',
                  color: 'var(--txt2)', fontFamily: 'var(--font)',
                }}>
                ↻ Refresh
              </button>
            </div>
          </div>

          {accountsLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)', fontSize: 13 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
              Loading Gmail accounts...
            </div>
          ) : accountsError ? (
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--rad)', fontSize: 13,
              background: 'rgba(192,57,43,0.08)', border: '1px solid #C0392B', color: '#C0392B', marginBottom: 16,
            }}>
              ❌ {accountsError}
              <button onClick={loadGmailAccounts}
                style={{ marginLeft: 12, fontSize: 12, background: 'none', border: 'none', color: '#C0392B', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>
                Retry
              </button>
            </div>
          ) : gmailAccounts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)', fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No ready Gmail accounts available</div>
              <div style={{ fontSize: 12 }}>Contact admin to add and authenticate Gmail Pool accounts</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {gmailAccounts.map(acct => {
                const selected = selectedIds.includes(acct.id)
                const maxed    = !selected && selectedIds.length >= MAX_ACCOUNTS
                return (
                  <div key={acct.id}
                    onClick={maxed ? null : () => toggleAccount(acct.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px', borderRadius: 'var(--rad)',
                      border: '1px solid ' + (selected ? 'var(--pu)' : 'var(--bdr)'),
                      background: selected ? 'rgba(74,58,255,0.06)' : 'var(--bg)',
                      cursor: maxed ? 'not-allowed' : 'pointer',
                      opacity: maxed ? 0.4 : 1, transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                      border: '2px solid ' + (selected ? 'var(--pu)' : 'var(--bdr2)'),
                      background: selected ? 'var(--pu)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selected && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{acct.email}</div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      background: '#E8F7EE', color: '#1D7348', textTransform: 'uppercase',
                    }}>
                      Ready
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button variant="ghost" onClick={() => setStep(2)}>← Back</Button>
            <Button variant="primary" onClick={() => setStep(4)} disabled={selectedIds.length === 0}>
              Next: Preview & Send →
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 4: Preview & Send ─── */}
      {step === 4 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 20 }}>🚀 Preview & Launch</div>

          {/* Summary (pre-launch) */}
          {!jobId && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {[
                  ['👥 Recipients', contacts.length.toLocaleString() + ' contacts'],
                  ['📧 Subject',    subject],
                  ['✍️ From Name', fromName || '(not set)'],
                  ['📎 Attachment', attachment ? attachment.name : 'None'],
                ].map(([label, val]) => (
                  <div key={label} style={{
                    background: 'var(--bg)', border: '1px solid var(--bdr)',
                    borderRadius: 'var(--rad)', padding: '12px 16px',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, wordBreak: 'break-all' }}>{val}</div>
                  </div>
                ))}
              </div>

              <div style={{
                background: 'var(--bg)', border: '1px solid var(--bdr)',
                borderRadius: 'var(--rad)', padding: '12px 16px', marginBottom: 24,
              }}>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10 }}>
                  📬 Gmail Accounts ({selectedIds.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {gmailAccounts.filter(a => selectedIds.includes(a.id)).map(a => (
                    <span key={a.id} style={{
                      fontSize: 12, padding: '4px 12px', borderRadius: 20,
                      background: 'rgba(74,58,255,0.1)', color: 'var(--pu)', fontWeight: 500,
                    }}>
                      📬 {a.email}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Button variant="ghost" onClick={() => setStep(3)}>← Back</Button>
                <Button variant="primary" loading={launching} onClick={handleLaunch}>
                  🚀 Launch API Campaign
                </Button>
              </div>
            </>
          )}

          {/* Progress (post-launch) */}
          {jobId && jobStatus && (
            <div>
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--rad)', marginBottom: 20,
                fontSize: 13, fontWeight: 600,
                ...(jobStatus.status === 'completed'
                  ? { background: '#E8F7EE', border: '1px solid #22C55E', color: '#1D7348' }
                  : (jobStatus.status === 'stopped' || jobStatus.status === 'failed')
                  ? { background: 'rgba(192,57,43,0.08)', border: '1px solid #C0392B', color: '#C0392B' }
                  : { background: 'rgba(74,58,255,0.08)', border: '1px solid rgba(74,58,255,0.3)', color: 'var(--pu)' }
                ),
              }}>
                {jobStatus.status === 'completed' ? '✅ Campaign completed!' :
                 jobStatus.status === 'stopped'   ? '⏹ Campaign stopped' :
                 jobStatus.status === 'failed'    ? '❌ Campaign failed' :
                 '⏳ Sending in progress...'}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                  ['📊 Total',  (jobStatus.total  || contacts.length).toLocaleString(), 'var(--txt)'],
                  ['✅ Sent',   (jobStatus.sent   || 0).toLocaleString(),                '#1D7348'  ],
                  ['❌ Failed', (jobStatus.failed || 0).toLocaleString(),                '#C0392B'  ],
                ].map(([label, val, color]) => (
                  <div key={label} style={{
                    background: 'var(--bg)', border: '1px solid var(--bdr)',
                    borderRadius: 'var(--rad)', padding: '14px 16px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Progress bar */}
              {(() => {
                const total = jobStatus.total || contacts.length
                const sent  = jobStatus.sent  || 0
                const pct   = total > 0 ? Math.round((sent / total) * 100) : 0
                return (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--txt3)', marginBottom: 6 }}>
                      <span>{jobStatus.status === 'running' ? 'Sending...' : 'Progress'}</span>
                      <span>{sent.toLocaleString()} / {total.toLocaleString()} ({pct}%)</span>
                    </div>
                    <div style={{ background: 'var(--bdr)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                      <div style={{
                        background: jobStatus.status === 'completed' ? '#22C55E' : 'var(--pu)',
                        height: '100%', borderRadius: 4,
                        width: pct + '%', transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                )
              })()}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                {(jobStatus.status === 'completed' || jobStatus.status === 'stopped' || jobStatus.status === 'failed') && (
                  <Button variant="primary" onClick={resetAll}>+ New Campaign</Button>
                )}
                {jobStatus.status === 'running' && (
                  <button onClick={handleStop}
                    style={{
                      padding: '8px 20px', background: 'rgba(192,57,43,0.1)',
                      border: '1px solid #C0392B', borderRadius: 'var(--rad)',
                      color: '#C0392B', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'var(--font)',
                    }}>
                    ⏹ Stop Campaign
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
