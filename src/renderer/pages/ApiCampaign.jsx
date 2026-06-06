import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import Button from '../components/ui/Button'

const LICENSE_SERVER = 'https://mailflow-license-server-production.up.railway.app'
const MAX_APIS  = 4
const MAX_PAGES = 4

// ─── helpers ──────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const contacts = []
  let headerSkipped = false
  for (const line of lines) {
    if (!headerSkipped && /^"?email/i.test(line)) { headerSkipped = true; continue }
    const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''))
    const email = parts[0]?.trim()
    if (!email || !email.includes('@')) continue
    contacts.push({ email, name: parts[1] || '', address: parts[2] || '', unique_id: parts[3] || '' })
  }
  return contacts
}

function fmtSize(bytes) {
  if (!bytes || bytes < 1024) return (bytes || 0) + ' B'
  if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function fileIcon(type) {
  if (!type) return '📄'
  if (type.startsWith('image/'))    return '🖼'
  if (type === 'application/pdf')   return '📕'
  if (type.startsWith('video/'))    return '🎬'
  return '📄'
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
function Stepper({ steps, current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
      {steps.map((label, i) => {
        const n = i + 1; const active = current === n; const done = current > n
        return (
          <React.Fragment key={n}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 5,
                background: done ? '#22C55E' : active ? 'var(--pu)' : 'var(--bg2)',
                color:      done || active ? '#fff' : 'var(--txt3)',
                border:     done || active ? 'none' : '1px solid var(--bdr2)',
                transition: 'all 0.2s',
              }}>
                {done ? '✓' : n}
              </div>
              <div style={{
                fontSize: 11, fontWeight: active ? 700 : 400, textAlign: 'center', whiteSpace: 'nowrap',
                color: active ? 'var(--pu)' : done ? '#22C55E' : 'var(--txt3)',
              }}>{label}</div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ height: 1, flex: 0.3, marginBottom: 20, background: current > i + 1 ? '#22C55E' : 'var(--bdr2)' }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Card shell ───────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--bdr)',
      borderRadius: 'var(--rad-l)', padding: 24, ...style
    }}>
      {children}
    </div>
  )
}

// ─── Progress display ─────────────────────────────────────────────────────────
function JobProgress({ jobStatus, totalContacts, onStop }) {
  const total  = jobStatus?.total  || totalContacts || 0
  const sent   = jobStatus?.sent   || 0
  const failed = jobStatus?.failed || 0
  const pct    = total > 0 ? Math.round((sent / total) * 100) : 0
  const status = jobStatus?.status || 'running'

  return (
    <div>
      <div style={{
        padding: '11px 16px', borderRadius: 'var(--rad)', marginBottom: 18,
        fontSize: 13, fontWeight: 600,
        ...(status === 'completed'
          ? { background: '#E8F7EE', border: '1px solid #22C55E', color: '#1D7348' }
          : (status === 'stopped' || status === 'failed')
          ? { background: 'rgba(192,57,43,0.08)', border: '1px solid #C0392B', color: '#C0392B' }
          : { background: 'rgba(74,58,255,0.08)', border: '1px solid rgba(74,58,255,0.3)', color: 'var(--pu)' }
        ),
      }}>
        {status === 'completed' ? '✅ Campaign completed!' :
         status === 'stopped'   ? '⏹ Campaign stopped' :
         status === 'failed'    ? '❌ Campaign failed' :
         '⏳ Sending in progress...'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
        {[['📊 Total', total.toLocaleString(), 'var(--txt)'],
          ['✅ Sent',   sent.toLocaleString(),   '#1D7348'  ],
          ['❌ Failed', failed.toLocaleString(),  '#C0392B'  ]].map(([lbl, val, clr]) => (
          <div key={lbl} style={{ background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4 }}>{lbl}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: clr }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--txt3)', marginBottom: 5 }}>
          <span>{status === 'running' ? 'Sending...' : 'Progress'}</span>
          <span>{sent.toLocaleString()} / {total.toLocaleString()} ({pct}%)</span>
        </div>
        <div style={{ background: 'var(--bdr)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
          <div style={{ background: status === 'completed' ? '#22C55E' : 'var(--pu)', height: '100%', borderRadius: 4, width: pct + '%', transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {onStop && status === 'running' && (
        <div style={{ textAlign: 'right' }}>
          <button onClick={onStop} style={{ padding: '7px 18px', background: 'rgba(192,57,43,0.1)', border: '1px solid #C0392B', borderRadius: 'var(--rad)', color: '#C0392B', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
            ⏹ Stop Campaign
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
const STEPS = ['Recipients', 'Template', 'Select APIs', 'Preview & Send']

export default function ApiCampaign() {
  const { setActivePage, addToast } = useAppStore()

  // ── License key ────────────────────────────────────────────────────────
  const [licenseKey, setLicenseKey] = useState('')

  // ── Section 1 state ────────────────────────────────────────────────────
  const [step, setStep]             = useState(1)
  const [contacts, setContacts]     = useState([])
  const [csvFile, setCsvFile]       = useState('')
  const [template, setTemplate]     = useState({ subject: '', fromName: '', htmlBody: '', attachment: null })
  const [poolAccounts, setPoolAccounts]   = useState([])
  const [selectedApis, setSelectedApis]   = useState([])   // array of account objects
  const [acctLoading, setAcctLoading]     = useState(false)
  const [acctError, setAcctError]         = useState('')
  const [launching, setLaunching]         = useState(false)
  const [jobId, setJobId]                 = useState(null)
  const [jobStatus, setJobStatus]         = useState(null)
  const [completedCampaigns, setCompletedCampaigns] = useState([])
  const [showClone, setShowClone]         = useState(false)
  const pollRef = useRef(null)

  // ── Section 2 (Clone & Reuse) state ────────────────────────────────────
  const [pages, setPages] = useState([{ id: 1, contacts: [], csvFile: '', selectedApiId: '', jobId: null, jobStatus: null, launching: false }])
  const pagePolls = useRef({})

  // ── Refs ───────────────────────────────────────────────────────────────
  const csvRef = useRef(null)
  const attRef = useRef(null)

  const IS = { width: '100%', padding: '8px 11px', border: '1px solid var(--bdr2)', borderRadius: 'var(--rad)', fontSize: 13, background: 'var(--bg2)', color: 'var(--txt)', fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box' }

  // ── init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    window.api?.license?.getCustomerInfo?.().then(info => {
      if (info?.key) setLicenseKey(info.key)
    }).catch(() => {})
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      Object.values(pagePolls.current).forEach(id => clearInterval(id))
    }
  }, [])

  // ── CSV ───────────────────────────────────────────────────────────────
  function handleCSVChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      const parsed = parseCSV(evt.target.result)
      if (!parsed.length) { addToast('No valid contacts in CSV', 'error'); return }
      setContacts(parsed); setCsvFile(file.name)
      addToast(parsed.length + ' contacts loaded', 'success')
    }
    reader.readAsText(file); e.target.value = ''
  }

  // ── Attachment ────────────────────────────────────────────────────────
  function handleAttachment(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      setTemplate(t => ({ ...t, attachment: { name: file.name, size: file.size, type: file.type, dataUrl: evt.target.result } }))
      addToast('Attachment: ' + file.name, 'success')
    }
    reader.readAsDataURL(file); e.target.value = ''
  }

  // ── Pool accounts ─────────────────────────────────────────────────────
  async function loadPoolAccounts() {
    setAcctLoading(true); setAcctError('')
    try {
      let key = licenseKey
      if (!key) {
        const info = await window.api.license.getCustomerInfo()
        key = info?.key || ''; if (key) setLicenseKey(key)
      }
      if (!key) { setAcctError('License key not available'); setAcctLoading(false); return }
      const res  = await fetch(LICENSE_SERVER + '/api/user/gmail-pool/ready', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load accounts')
      setPoolAccounts(Array.isArray(data.accounts) ? data.accounts : [])
    } catch (err) {
      setAcctError(err.message); setPoolAccounts([])
    } finally {
      setAcctLoading(false)
    }
  }

  function goStep(n) { if (n === 3) loadPoolAccounts(); setStep(n) }

  function toggleApi(acct) {
    setSelectedApis(prev => {
      if (prev.some(a => a.id === acct.id)) return prev.filter(a => a.id !== acct.id)
      if (prev.length >= MAX_APIS) { addToast('Max 4 accounts allowed', 'error'); return prev }
      return [...prev, acct]
    })
  }

  // ── Launch Section 1 ──────────────────────────────────────────────────
  async function handleLaunch() {
    if (!licenseKey)          { addToast('License key not loaded', 'error'); return }
    if (!contacts.length)     { addToast('No contacts loaded', 'error'); return }
    if (!template.subject)    { addToast('Subject required', 'error'); return }
    if (!template.htmlBody)   { addToast('Email body required', 'error'); return }
    if (!selectedApis.length) { addToast('Select at least one Gmail account', 'error'); return }

    setLaunching(true)
    try {
      const attachments = template.attachment
        ? [{ filename: template.attachment.name, content: template.attachment.dataUrl.split(',')[1], contentType: template.attachment.type }]
        : []

      const res  = await fetch(LICENSE_SERVER + '/api/user/gmail-pool/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          accountIds: selectedApis.map(a => a.id),
          jobData: { contacts, subject: template.subject, fromName: template.fromName, htmlBody: template.htmlBody, attachments },
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.jobId) throw new Error(data.error || 'Failed to start campaign')

      const jid = data.jobId
      setJobId(jid)
      setJobStatus({ status: 'running', sent: 0, failed: 0, total: data.total || contacts.length })
      addToast('Campaign launched!', 'success')

      pollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(LICENSE_SERVER + '/api/user/gmail-pool/send-status/' + jid, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
          const sd = await sr.json()
          if (sd.success !== false) setJobStatus(sd)
          if (sd.status === 'completed' || sd.status === 'stopped' || sd.status === 'failed') {
            clearInterval(pollRef.current); pollRef.current = null
            if (sd.status === 'completed') {
              setCompletedCampaigns(prev => [...prev, { subject: template.subject, total: sd.total || contacts.length, sent: sd.sent }])
              setShowClone(true)
            }
          }
        } catch {}
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
      await fetch(LICENSE_SERVER + '/api/user/gmail-pool/send-stop/' + jobId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ licenseKey }) })
      addToast('Stop requested', 'info')
    } catch { addToast('Stop request failed', 'error') }
  }

  // ── Section 2 helpers ─────────────────────────────────────────────────
  function addPage() {
    if (pages.length >= MAX_PAGES) { addToast('Maximum 4 pages allowed', 'error'); return }
    setPages(p => [...p, { id: p.length + 1, contacts: [], csvFile: '', selectedApiId: '', jobId: null, jobStatus: null, launching: false }])
  }

  function removePage(id) {
    if (pages.length <= 1) { addToast('Need at least 1 page', 'error'); return }
    if (pagePolls.current[id]) { clearInterval(pagePolls.current[id]); delete pagePolls.current[id] }
    setPages(p => p.filter(x => x.id !== id))
  }

  function updatePage(id, updates) {
    setPages(p => p.map(x => x.id === id ? { ...x, ...updates } : x))
  }

  function handlePageCSV(pageId, e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      const parsed = parseCSV(evt.target.result)
      if (!parsed.length) { addToast('No valid contacts', 'error'); return }
      updatePage(pageId, { contacts: parsed, csvFile: file.name })
      addToast('Page ' + pageId + ': ' + parsed.length + ' contacts', 'success')
    }
    reader.readAsText(file); e.target.value = ''
  }

  async function launchPage(page) {
    if (!page.contacts.length || !page.selectedApiId) return
    updatePage(page.id, { launching: true })
    try {
      const attachments = template.attachment
        ? [{ filename: template.attachment.name, content: template.attachment.dataUrl.split(',')[1], contentType: template.attachment.type }]
        : []

      const result = await window.api.gmail.sendCampaignForPage({
        licenseKey,
        contacts:       page.contacts,
        subject:        template.subject,
        fromName:       template.fromName,
        htmlBody:       template.htmlBody,
        attachments,
        gmailAccountId: page.selectedApiId,
      })

      if (!result || !result.jobId) throw new Error(result?.error || 'No jobId returned')

      updatePage(page.id, { jobId: result.jobId, jobStatus: { status: 'running', sent: 0, failed: 0, total: result.total || page.contacts.length }, launching: false })

      pagePolls.current[page.id] = setInterval(async () => {
        try {
          const sr = await fetch(LICENSE_SERVER + '/api/user/gmail-pool/send-status/' + result.jobId, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
          const sd = await sr.json()
          if (sd.success !== false) updatePage(page.id, { jobStatus: sd })
          if (sd.status === 'completed' || sd.status === 'stopped' || sd.status === 'failed') {
            clearInterval(pagePolls.current[page.id]); delete pagePolls.current[page.id]
          }
        } catch {}
      }, 3000)

    } catch (err) {
      addToast('Page ' + page.id + ' failed: ' + err.message, 'error')
      updatePage(page.id, { launching: false })
    }
  }

  async function handleLaunchAll() {
    const ready = pages.filter(p => p.contacts.length > 0 && p.selectedApiId && !p.jobId)
    if (!ready.length) { addToast('No pages ready to launch', 'error'); return }
    setLaunching2(true)
    await Promise.all(ready.map(launchPage))
    setLaunching2(false)
  }

  const [launching2, setLaunching2] = useState(false)

  async function stopPage(page) {
    if (!page.jobId) return
    try {
      await fetch(LICENSE_SERVER + '/api/user/gmail-pool/send-stop/' + page.jobId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ licenseKey }) })
      addToast('Stop requested for page ' + page.id, 'info')
    } catch {}
  }

  // ── Section 1 Step 4: can advance? ────────────────────────────────────
  const campaignDone = jobStatus?.status === 'completed' || jobStatus?.status === 'stopped' || jobStatus?.status === 'failed'
  const anyPage2Running = pages.some(p => p.jobStatus?.status === 'running')
  const allPage2Done    = pages.every(p => !p.jobId || (p.jobStatus?.status === 'completed' || p.jobStatus?.status === 'stopped' || p.jobStatus?.status === 'failed'))

  // ──────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'var(--font)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 4 }}>⚡ API Campaign</h2>
          <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Send via shared Gmail Pool — no SMTP or EC2 needed</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setActivePage('campaigns')}>← Back</Button>
      </div>

      {/* ── SECTION 1: 4-STEP WIZARD ─────────────────────────────────── */}
      <Stepper steps={STEPS} current={step} />

      {/* ── STEP 1: Recipients ── */}
      {step === 1 && (
        <Card>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>👥 Upload Recipients CSV</div>
          <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 18 }}>
            Columns: <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>email, name, address, unique_id</code> — header row skipped automatically
          </div>

          <input ref={csvRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleCSVChange} />

          <div onClick={() => csvRef.current?.click()}
            style={{ border: '2px dashed ' + (contacts.length > 0 ? '#22C55E' : 'var(--bdr2)'), borderRadius: 'var(--rad-l)', padding: '36px 20px', textAlign: 'center', cursor: 'pointer', marginBottom: 20, transition: 'border-color 0.2s' }}>
            {contacts.length > 0 ? (
              <div>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#22C55E' }}>{contacts.length.toLocaleString()} contacts loaded</div>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>{csvFile} · Click to replace</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📤</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Click to upload CSV</div>
                <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 4 }}>email, name, address, unique_id</div>
              </div>
            )}
          </div>

          {contacts.length > 0 && (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--bdr)', fontSize: 12, fontWeight: 600, color: 'var(--txt2)' }}>
                Preview — first {Math.min(contacts.length, 10)} of {contacts.length.toLocaleString()} rows
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg2)' }}>
                      {['#', 'Email', 'Name', 'Address', 'Transaction ID'].map(h => (
                        <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--txt2)', borderBottom: '1px solid var(--bdr)', whiteSpace: 'nowrap', fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.slice(0, 10).map((c, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--bdr)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                        <td style={{ padding: '6px 12px', color: 'var(--txt3)', fontSize: 11 }}>{i + 1}</td>
                        <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11 }}>{c.email}</td>
                        <td style={{ padding: '6px 12px', color: 'var(--txt2)' }}>{c.name || '—'}</td>
                        <td style={{ padding: '6px 12px', color: 'var(--txt2)' }}>{c.address || '—'}</td>
                        <td style={{ padding: '6px 12px', color: 'var(--txt3)', fontFamily: 'monospace', fontSize: 11 }}>{c.unique_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={() => setStep(2)} disabled={contacts.length === 0}>Next: Template →</Button>
          </div>
        </Card>
      )}

      {/* ── STEP 2: Template ── */}
      {step === 2 && (
        <Card>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 20 }}>📝 Email Template</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>From Name</label>
              <input value={template.fromName} onChange={e => setTemplate(t => ({ ...t, fromName: e.target.value }))} placeholder="Your Company Name" style={IS} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>Subject Line *</label>
              <input value={template.subject} onChange={e => setTemplate(t => ({ ...t, subject: e.target.value }))} placeholder="Enter subject line..." style={IS} />
            </div>
          </div>

          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>HTML Body *</label>
            <textarea value={template.htmlBody} onChange={e => setTemplate(t => ({ ...t, htmlBody: e.target.value }))}
              rows={9} placeholder="Paste your HTML email body here..."
              style={{ ...IS, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, height: 200 }} />
          </div>

          <div style={{ marginBottom: 16, fontSize: 12, color: 'var(--txt3)' }}>
            Template variables: <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, marginLeft: 4 }}>{'{{name}}'}</code>
            <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, marginLeft: 4 }}>{'{{email}}'}</code>
            <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, marginLeft: 4 }}>{'{{st}}'}</code>
            <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, marginLeft: 4 }}>{'{{id}}'}</code>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 8 }}>Attachment (optional)</label>
            <input ref={attRef} type="file" style={{ display: 'none' }} onChange={handleAttachment} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => attRef.current?.click()}
                style={{ padding: '7px 14px', background: 'var(--bg)', border: '1px solid var(--bdr2)', borderRadius: 'var(--rad)', fontSize: 12, cursor: 'pointer', color: 'var(--txt2)', fontFamily: 'var(--font)' }}>
                📎 {template.attachment ? 'Change' : 'Upload'} Attachment
              </button>
              {template.attachment && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13 }}>{fileIcon(template.attachment.type)}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{template.attachment.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{fmtSize(template.attachment.size)}</div>
                  </div>
                  <button onClick={() => setTemplate(t => ({ ...t, attachment: null }))}
                    style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: 'var(--txt3)', lineHeight: 1 }}>✕</button>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
            <Button variant="primary" onClick={() => goStep(3)} disabled={!template.subject || !template.htmlBody}>Next: Select APIs →</Button>
          </div>
        </Card>
      )}

      {/* ── STEP 3: Select Ready APIs ── */}
      {step === 3 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>📬 Select Gmail Pool Accounts</div>
              <div style={{ fontSize: 11, color: 'var(--txt3)' }}>Up to 4 accounts — emails round-robin across them</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: selectedApis.length > 0 ? 'rgba(74,58,255,0.1)' : 'var(--bg)', color: selectedApis.length > 0 ? 'var(--pu)' : 'var(--txt3)' }}>
                {selectedApis.length} / {MAX_APIS} selected
              </span>
              <button onClick={loadPoolAccounts} style={{ padding: '5px 10px', background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', fontSize: 11, cursor: 'pointer', color: 'var(--txt2)', fontFamily: 'var(--font)' }}>
                ↻ Refresh
              </button>
            </div>
          </div>

          {acctLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)', fontSize: 13 }}><div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>Loading Gmail accounts...</div>
          ) : acctError ? (
            <div style={{ padding: '14px 16px', borderRadius: 'var(--rad)', background: 'rgba(192,57,43,0.08)', border: '1px solid #C0392B', color: '#C0392B', fontSize: 13, marginBottom: 16 }}>
              ❌ {acctError}
              <button onClick={loadPoolAccounts} style={{ marginLeft: 12, fontSize: 12, background: 'none', border: 'none', color: '#C0392B', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>Retry</button>
            </div>
          ) : poolAccounts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)', fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No ready Gmail accounts available</div>
              <div style={{ fontSize: 12 }}>Contact admin to add and authenticate Gmail Pool accounts</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {poolAccounts.map(acct => {
                const sel   = selectedApis.some(a => a.id === acct.id)
                const maxed = !sel && selectedApis.length >= MAX_APIS
                return (
                  <div key={acct.id} onClick={maxed ? null : () => toggleApi(acct)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 'var(--rad)', border: '1px solid ' + (sel ? 'var(--pu)' : 'var(--bdr)'), background: sel ? 'rgba(74,58,255,0.06)' : 'var(--bg)', cursor: maxed ? 'not-allowed' : 'pointer', opacity: maxed ? 0.4 : 1, transition: 'all 0.15s' }}>
                    <div style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, border: '2px solid ' + (sel ? 'var(--pu)' : 'var(--bdr2)'), background: sel ? 'var(--pu)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {sel && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{acct.email}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#E8F7EE', color: '#1D7348', textTransform: 'uppercase' }}>Ready</span>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button variant="ghost" onClick={() => setStep(2)}>← Back</Button>
            <Button variant="primary" onClick={() => setStep(4)} disabled={selectedApis.length === 0}>Next: Preview & Send →</Button>
          </div>
        </Card>
      )}

      {/* ── STEP 4: Preview & Send ── */}
      {step === 4 && (
        <Card>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 20 }}>🚀 Preview & Launch</div>

          {!jobId && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {[['👥 Recipients', contacts.length.toLocaleString() + ' contacts'],
                  ['📧 Subject',    template.subject],
                  ['✍️ From Name', template.fromName || '(not set)'],
                  ['📎 Attachment', template.attachment ? template.attachment.name + ' (' + fmtSize(template.attachment.size) + ')' : 'None'],
                ].map(([lbl, val]) => (
                  <div key={lbl} style={{ background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '12px 16px' }}>
                    <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4 }}>{lbl}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, wordBreak: 'break-all' }}>{val}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: '12px 16px', marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10 }}>📬 Selected Gmail Accounts ({selectedApis.length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {selectedApis.map(a => (
                    <span key={a.id} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, background: 'rgba(74,58,255,0.1)', color: 'var(--pu)', fontWeight: 500 }}>📬 {a.email}</span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Button variant="ghost" onClick={() => setStep(3)}>← Back</Button>
                <Button variant="primary" loading={launching} onClick={handleLaunch} style={{ fontSize: 15, padding: '10px 28px' }}>
                  🚀 Launch API Campaign
                </Button>
              </div>
            </>
          )}

          {jobId && jobStatus && (
            <>
              <JobProgress jobStatus={jobStatus} totalContacts={contacts.length} onStop={handleStop} />
              {campaignDone && (
                <div style={{ marginTop: 16, padding: '14px 18px', background: '#E8F7EE', border: '1px solid #22C55E', borderRadius: 'var(--rad)', fontSize: 13 }}>
                  <div style={{ fontWeight: 600, color: '#1D7348', marginBottom: 6 }}>✅ Campaign Completed!</div>
                  <div style={{ color: '#2D7A4A', marginBottom: 10, fontSize: 12 }}>
                    📥 Check your inbox. If emails landed in inbox, use <strong>Clone & Reuse</strong> below to multiply your send with different Gmail accounts.
                  </div>
                  {!showClone && (
                    <button onClick={() => setShowClone(true)}
                      style={{ padding: '8px 20px', background: '#1D7348', color: '#fff', border: 'none', borderRadius: 'var(--rad)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
                      📋 Clone & Reuse this Campaign
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* ── SECTION 2: CLONE & REUSE ─────────────────────────────────── */}
      {showClone && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, marginBottom: 4 }}>🔄 Clone & Reuse — API Campaign</h3>
              <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Send same template via different Gmail accounts simultaneously — max {MAX_PAGES} pages</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {pages.length < MAX_PAGES && !anyPage2Running && (
                <Button variant="ghost" size="sm" onClick={addPage}>+ Add Page</Button>
              )}
              <Button variant="primary" loading={launching2} onClick={handleLaunchAll}
                disabled={!pages.some(p => p.contacts.length > 0 && p.selectedApiId && !p.jobId)}>
                🚀 Launch All Pages
              </Button>
            </div>
          </div>

          {/* Template info (read-only) */}
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', marginBottom: 10 }}>📝 Template (shared across all pages)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
              <div><span style={{ color: 'var(--txt3)' }}>Subject: </span><strong>{template.subject}</strong></div>
              <div><span style={{ color: 'var(--txt3)' }}>From: </span><strong>{template.fromName || '(not set)'}</strong></div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 8, fontFamily: 'monospace', background: 'var(--bg)', borderRadius: 4, padding: '6px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {template.htmlBody.substring(0, 120).replace(/<[^>]+>/g, ' ').trim()}...
            </div>
            {template.attachment && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--txt2)' }}>
                {fileIcon(template.attachment.type)} {template.attachment.name} ({fmtSize(template.attachment.size)})
              </div>
            )}
          </div>

          {/* Pages */}
          {pages.map(page => {
            const isRunning  = page.jobStatus?.status === 'running'
            const isDone     = page.jobStatus?.status === 'completed' || page.jobStatus?.status === 'stopped' || page.jobStatus?.status === 'failed'
            const pct        = page.jobStatus?.total > 0 ? Math.round(((page.jobStatus?.sent || 0) / page.jobStatus.total) * 100) : 0

            return (
              <div key={page.id} style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 20, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    Page {page.id}
                    {isRunning && <span style={{ marginLeft: 10, fontSize: 12, color: '#F39C12', fontWeight: 400 }}>⏳ Sending...</span>}
                    {isDone    && <span style={{ marginLeft: 10, fontSize: 12, color: '#22C55E', fontWeight: 400 }}>✅ Done</span>}
                  </div>
                  {!page.jobId && pages.length > 1 && (
                    <button onClick={() => removePage(page.id)}
                      style={{ padding: '4px 10px', background: 'rgba(192,57,43,0.1)', border: '1px solid #C0392B', borderRadius: 'var(--rad)', color: '#C0392B', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font)' }}>
                      Remove
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Recipients */}
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--txt2)' }}>👥 Recipients CSV</div>
                    {(() => {
                      const fileRef = React.createRef()
                      return (
                        <>
                          <input type="file" accept=".csv,.txt" style={{ display: 'none' }} ref={fileRef}
                            onChange={e => handlePageCSV(page.id, e)} />
                          <div onClick={isRunning ? null : () => fileRef.current?.click()}
                            style={{ border: '2px dashed ' + (page.contacts.length > 0 ? '#22C55E' : 'var(--bdr2)'), borderRadius: 'var(--rad)', padding: 16, textAlign: 'center', cursor: isRunning ? 'default' : 'pointer' }}>
                            {page.contacts.length > 0 ? (
                              <div>
                                <div style={{ fontSize: 20, marginBottom: 4 }}>✅</div>
                                <div style={{ fontSize: 12, fontWeight: 600 }}>{page.contacts.length.toLocaleString()} contacts</div>
                                <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{page.csvFile}</div>
                                {!isRunning && <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>Click to change</div>}
                              </div>
                            ) : (
                              <div>
                                <div style={{ fontSize: 22, marginBottom: 4 }}>📤</div>
                                <div style={{ fontSize: 12, fontWeight: 600 }}>Upload CSV</div>
                                <div style={{ fontSize: 11, color: 'var(--txt3)' }}>email, name, address, unique_id</div>
                              </div>
                            )}
                          </div>
                        </>
                      )
                    })()}
                  </div>

                  {/* Gmail API select */}
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad)', padding: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--txt2)' }}>📬 Gmail Account</div>
                    {isRunning ? (
                      <div style={{ padding: '10px', textAlign: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pu)' }}>
                          {poolAccounts.find(a => a.id === page.selectedApiId)?.email || page.selectedApiId}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>Sending in progress...</div>
                      </div>
                    ) : poolAccounts.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--txt3)', textAlign: 'center', padding: 12 }}>No accounts available<br/><button onClick={loadPoolAccounts} style={{ marginTop: 6, fontSize: 11, background: 'none', border: 'none', color: 'var(--pu)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>Load accounts</button></div>
                    ) : (
                      <select value={page.selectedApiId} onChange={e => updatePage(page.id, { selectedApiId: e.target.value })}
                        style={{ ...IS, marginBottom: 0 }}>
                        <option value="">-- Select Account --</option>
                        {poolAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.email}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Progress for this page */}
                {page.jobId && page.jobStatus && (
                  <div style={{ marginTop: 16 }}>
                    {isRunning && (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--txt2)', marginBottom: 4 }}>
                          <span>Sending...</span><span>{pct}% — {(page.jobStatus.sent||0)}/{page.jobStatus.total}</span>
                        </div>
                        <div style={{ background: 'var(--bdr)', borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 8 }}>
                          <div style={{ background: 'var(--pu)', height: '100%', borderRadius: 4, width: pct + '%', transition: 'width 0.5s ease' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: 11, marginBottom: 8 }}>
                          <span style={{ color: '#1D7348' }}>✅ {page.jobStatus.sent || 0}</span>
                          <span style={{ color: '#C0392B' }}>❌ {page.jobStatus.failed || 0}</span>
                          <span style={{ color: 'var(--txt3)' }}>📊 {page.jobStatus.total}</span>
                        </div>
                        <button onClick={() => stopPage(page)} style={{ padding: '5px 12px', background: 'rgba(192,57,43,0.1)', border: '1px solid #C0392B', borderRadius: 'var(--rad)', color: '#C0392B', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)' }}>
                          ⏹ Stop
                        </button>
                      </div>
                    )}
                    {page.jobStatus.status === 'completed' && (
                      <div style={{ padding: '10px 14px', background: '#E8F7EE', border: '1px solid #22C55E', borderRadius: 'var(--rad)', fontSize: 12, color: '#1D7348', fontWeight: 600 }}>
                        ✅ Page {page.id} completed — {page.jobStatus.sent || 0} sent, {page.jobStatus.failed || 0} failed
                      </div>
                    )}
                    {(page.jobStatus.status === 'stopped' || page.jobStatus.status === 'failed') && (
                      <div style={{ padding: '10px 14px', background: 'rgba(192,57,43,0.08)', border: '1px solid #C0392B', borderRadius: 'var(--rad)', fontSize: 12, color: '#C0392B' }}>
                        {page.jobStatus.status === 'stopped' ? '⏹ Stopped' : '❌ Failed'} — {page.jobStatus.sent || 0} sent, {page.jobStatus.failed || 0} failed
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* All pages done summary */}
          {allPage2Done && pages.some(p => p.jobId) && (
            <div style={{ padding: '14px 18px', background: '#E8F7EE', border: '1px solid #22C55E', borderRadius: 'var(--rad-l)', fontSize: 13, color: '#1D7348', fontWeight: 600 }}>
              ✅ All pages completed!
            </div>
          )}
        </div>
      )}
    </div>
  )
}
