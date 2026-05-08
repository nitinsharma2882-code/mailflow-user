import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import Button from '../components/ui/Button'

const PROVIDER_COLORS = {
  gmail:   { bg: '#FFF2F2', border: '#EA4335', color: '#EA4335', icon: '📧', name: 'Gmail' },
  outlook: { bg: '#F0F4FF', border: '#0078D4', color: '#0078D4', icon: '📨', name: 'Outlook' },
  yahoo:   { bg: '#FFF0FF', border: '#6001D2', color: '#6001D2', icon: '📩', name: 'Yahoo' },
  aol:     { bg: '#FFF8F0', border: '#FF0B00', color: '#FF0B00', icon: '📬', name: 'AOL' },
  other:   { bg: 'var(--bg2)', border: 'var(--bdr)', color: 'var(--txt2)', icon: '📧', name: 'Other' },
}

function getProvider(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase() || ''
  if (domain.includes('gmail'))   return 'gmail'
  if (domain.includes('outlook') || domain.includes('hotmail') || domain.includes('live')) return 'outlook'
  if (domain.includes('yahoo'))   return 'yahoo'
  if (domain.includes('aol'))     return 'aol'
  return 'other'
}

function ProviderCard({ provider, results }) {
  const config   = PROVIDER_COLORS[provider] || PROVIDER_COLORS.other
  const total    = results.length
  const sent     = results.filter(r => r.sent).length
  const inbox    = results.filter(r => r.inboxResult === 'inbox').length
  const spam     = results.filter(r => r.inboxResult === 'spam').length
  const inboxPct = sent > 0 ? Math.round((inbox / sent) * 100) : 0
  const spamPct  = sent > 0 ? Math.round((spam  / sent) * 100) : 0

  return (
    <div style={{
      background: config.bg,
      border: '1px solid ' + config.border,
      borderRadius: 12,
      padding: '20px 24px',
      flex: 1,
      minWidth: 220,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>{config.icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: config.color }}>{config.name}</div>
          <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{total} test account{total !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: '#1D7348' }}>📥 Inbox</span>
          <span style={{ fontWeight: 700, color: '#1D7348' }}>{inboxPct}%</span>
        </div>
        <div style={{ background: '#E0E0E0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
          <div style={{ background: '#22C55E', height: '100%', borderRadius: 4, width: inboxPct + '%', transition: 'width 0.8s ease' }} />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: '#C0392B' }}>🗑 Spam</span>
          <span style={{ fontWeight: 700, color: '#C0392B' }}>{spamPct}%</span>
        </div>
        <div style={{ background: '#E0E0E0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
          <div style={{ background: '#EF4444', height: '100%', borderRadius: 4, width: spamPct + '%', transition: 'width 0.8s ease' }} />
        </div>
      </div>

      {results.map((r, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 0',
          borderTop: '1px solid ' + config.border + '33',
          fontSize: 11,
        }}>
          <span style={{ fontFamily: 'monospace', color: 'var(--txt2)' }}>{r.email}</span>
          <span style={{
            fontWeight: 700,
            color: r.inboxResult === 'inbox' ? '#1D7348'
              : r.inboxResult === 'spam' ? '#C0392B'
              : r.sent ? '#F39C12' : '#888'
          }}>
            {!r.sent ? '❌ Not sent'
              : r.inboxResult === 'inbox' ? '✅ Inbox'
              : r.inboxResult === 'spam' ? '🗑 Spam'
              : r.inboxResult === 'checking' ? '⏳ Checking...'
              : '⏳ Waiting...'}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function TestCampaign() {
  const { servers, addToast, addTestCampaignToHistory, testCampaignHistory } = useAppStore()
  const [step, setStep]           = useState('setup')
  const [form, setForm]           = useState({
    subject: '', fromName: '', html: '<p>Hi,</p><p>This is a test email.</p>',
    sendMode: 'server', serverId: '',
    smtpEmail: '', smtpPass: '',
    awsKey: '', awsSecret: '', awsRegion: 'us-east-1', awsFrom: '',
  })
  const [testAccounts, setTestAccounts] = useState([])
  const [results, setResults]           = useState([])
  const [sending, setSending]           = useState(false)
  const [checking, setChecking]         = useState(false)
  const [pollCount, setPollCount]       = useState(0)
  const [waitSeconds, setWaitSeconds]   = useState(0)
  const [csvAccounts, setCsvAccounts]   = useState([])
  const [csvFilePath, setCsvFilePath]   = useState('')

  const IS = {
    width: '100%', padding: '8px 11px',
    border: '1px solid var(--bdr2)', borderRadius: 'var(--rad)',
    fontSize: 13, background: 'var(--bg2)', color: 'var(--txt)',
    fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box',
  }

  useEffect(() => {
    fetchTestAccounts()
    window.api.servers.getAll().then(data => {
      if (data && data.length > 0) setForm(f => ({ ...f, serverId: data[0].id }))
    })
  }, [])

  async function fetchTestAccounts() {
    try {
      const result = await window.api.license.getTestAccounts()
      if (result && result.success && result.accounts) {
        setTestAccounts(result.accounts)
        setResults(result.accounts.map(a => ({
          email: a.email, provider: getProvider(a.email),
          sent: false, inboxResult: null, error: null,
        })))
      } else {
        setTestAccounts([])
        setResults([])
      }
    } catch (err) {
      console.log('[TestCampaign] Could not fetch test accounts:', err.message)
      setTestAccounts([])
      setResults([])
    }
  }

  async function handlePickSmtpCsv() {
    try {
      const filePath = await window.api.dialog.openFile({ filters: [{ name: 'CSV', extensions: ['csv'] }] })
      if (!filePath) return
      const parsed = await window.api.smtp.parseCsv(filePath)
      if (!parsed || !parsed.accounts || parsed.accounts.length === 0) {
        addToast('No valid SMTP accounts found in CSV', 'error')
        return
      }
      setCsvAccounts(parsed.accounts)
      setCsvFilePath(filePath)
      addToast('Loaded ' + parsed.accounts.length + ' SMTP accounts from CSV', 'success')
    } catch (err) {
      addToast('Failed to load CSV: ' + err.message, 'error')
    }
  }

  async function handleStartTest() {
    if (!form.subject) { addToast('Enter a subject line', 'error'); return }
    if (!form.html)    { addToast('Enter email HTML body', 'error'); return }
    if (form.sendMode === 'csv_smtp' && csvAccounts.length === 0) {
      addToast('Upload a CSV file with SMTP accounts', 'error')
      return
    }
    if (testAccounts.length === 0) {
      addToast('No test accounts configured. Ask admin to add test accounts.', 'error')
      return
    }

    setSending(true)
    setStep('sending')

    try {
      const result = await window.api.sending.runTestCampaign({
        subject:     form.subject,
        fromName:    form.fromName,
        html:        form.html,
        sendMode:    form.sendMode,
        serverId:    form.serverId,
        smtpEmail:   form.smtpEmail,
        smtpPass:    form.smtpPass,
        awsKey:      form.awsKey,
        awsSecret:   form.awsSecret,
        awsRegion:   form.awsRegion,
        awsFrom:     form.awsFrom,
        csvAccounts: csvAccounts,
      })

      if (!result.success) {
        addToast(result.error || 'Test failed', 'error')
        setStep('setup')
        setSending(false)
        return
      }

      setResults(prev => prev.map(r => {
        const sent = result.results.find(sr => sr.email === r.email)
        return { ...r, sent: sent?.status === 'sent', error: sent?.error || null, inboxResult: sent?.status === 'sent' ? 'checking' : null }
      }))

      setSending(false)
      setStep('results')
      addTestCampaignToHistory({
        id:          result.sessionId || Date.now().toString(),
        subject:     form.subject,
        fromName:    form.fromName,
        html:        form.html,
        sendMode:    form.sendMode,
        serverId:    form.serverId,
        smtpEmail:   form.smtpEmail,
        smtpPass:    form.smtpPass,
        awsKey:      form.awsKey,
        awsSecret:   form.awsSecret,
        awsRegion:   form.awsRegion,
        awsFrom:     form.awsFrom,
        csvAccounts: csvAccounts,
        testedAt:    new Date().toISOString(),
        overallPct:  0,
      })

      let countdown = 60
      setWaitSeconds(countdown)
      const interval = setInterval(() => {
        countdown--
        setWaitSeconds(countdown)
        if (countdown <= 0) {
          clearInterval(interval)
          startPolling(result.sessionId)
        }
      }, 1000)

    } catch (err) {
      addToast('Error: ' + err.message, 'error')
      setStep('setup')
      setSending(false)
    }
  }

  async function startPolling(sid) {
    setChecking(true)
    let attempts = 0
    const maxAttempts = 6

    const poll = async () => {
      try {
        const res = await window.api.license.getTestResults(sid)
        if (res && res.success && res.results) {
          setResults(prev => prev.map(r => {
            const updated = res.results.find(ur => ur.email === r.email)
            return updated && updated.inboxResult ? { ...r, inboxResult: updated.inboxResult } : r
          }))
        }
      } catch (err) {
        console.log('[TestCampaign] Poll error:', err.message)
      }

      attempts++
      setPollCount(attempts)

      if (attempts < maxAttempts) {
        setTimeout(poll, 15000)
      } else {
        setChecking(false)
        setResults(prev => prev.map(r => ({
          ...r, inboxResult: r.inboxResult === 'checking' ? 'unknown' : r.inboxResult,
        })))
      }
    }

    poll()
  }

  function resetTest() {
    setStep('setup')
    setResults(results.map(r => ({ ...r, sent: false, inboxResult: null })))
    setWaitSeconds(0)
    setChecking(false)
    setPollCount(0)
    setCsvAccounts([])
    setCsvFilePath('')
  }

  const groupedResults = results.reduce((acc, r) => {
    const p = r.provider || 'other'
    if (!acc[p]) acc[p] = []
    acc[p].push(r)
    return acc
  }, {})

  const totalSent  = results.filter(r => r.sent).length
  const totalInbox = results.filter(r => r.inboxResult === 'inbox').length
  const totalSpam  = results.filter(r => r.inboxResult === 'spam').length
  const overallPct = totalSent > 0 ? Math.round((totalInbox / totalSent) * 100) : 0

  return (
    <div style={{ fontFamily: 'var(--font)' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 4 }}>🧪 Test Campaign</h2>
          <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Send a test email to check inbox placement across providers</div>
        </div>
        {step !== 'setup' && (
          <Button variant="ghost" size="sm" onClick={resetTest}>← New Test</Button>
        )}
      </div>

      {testAccounts.length === 0 && (
        <div style={{
          background: '#FFF8E1', border: '1px solid #F39C12', borderRadius: 'var(--rad)',
          padding: '12px 16px', fontSize: 12, color: '#856404', marginBottom: 20
        }}>
          ⚠ No test accounts configured yet. Ask your admin to add Gmail, Outlook, Yahoo, and AOL test accounts in the admin panel. Once added, they will appear here automatically.
        </div>
      )}

      {step === 'setup' && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 320 }}>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>📝 Email Content</div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>Subject Line *</label>
                <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  placeholder="e.g. Special offer just for you" style={IS} />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>From Name</label>
                <input value={form.fromName} onChange={e => setForm(f => ({ ...f, fromName: e.target.value }))}
                  placeholder="e.g. Your Company" style={IS} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>HTML Body *</label>
                <textarea value={form.html} onChange={e => setForm(f => ({ ...f, html: e.target.value }))}
                  rows={8} placeholder="Paste your HTML email here..."
                  style={{ ...IS, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
              </div>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>📤 Send Via</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {[
                  ['server',      '🖥 Saved Server'],
                  ['custom_smtp', '📧 Gmail App Password'],
                  ['aws_ses',     '☁️ AWS SES'],
                  ['csv_smtp',    '📋 Upload SMTP CSV'],
                ].map(([val, label]) => (
                  <div key={val} onClick={() => setForm(f => ({ ...f, sendMode: val }))} style={{
                    padding: '10px 12px',
                    border: '1.5px solid ' + (form.sendMode === val ? 'var(--pu)' : 'var(--bdr2)'),
                    borderRadius: 'var(--rad)', cursor: 'pointer',
                    background: form.sendMode === val ? 'var(--pu-l)' : 'var(--bg)',
                    fontSize: 13, fontWeight: form.sendMode === val ? 600 : 400,
                  }}>
                    {label}
                  </div>
                ))}
              </div>

              {form.sendMode === 'server' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>Select Server</label>
                  <select value={form.serverId} onChange={e => setForm(f => ({ ...f, serverId: e.target.value }))} style={IS}>
                    <option value="">-- Select --</option>
                    {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.email || s.from_email})</option>)}
                  </select>
                </div>
              )}

              {form.sendMode === 'custom_smtp' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>Gmail Address</label>
                    <input type="email" value={form.smtpEmail} onChange={e => setForm(f => ({ ...f, smtpEmail: e.target.value }))}
                      placeholder="you@gmail.com" style={IS} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>App Password</label>
                    <input type="password" value={form.smtpPass} onChange={e => setForm(f => ({ ...f, smtpPass: e.target.value }))}
                      placeholder="xxxx xxxx xxxx xxxx" style={IS} />
                  </div>
                </div>
              )}

              {form.sendMode === 'aws_ses' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    ['Access Key ID',     'awsKey',    'text',     'AKIA...'],
                    ['Secret Access Key', 'awsSecret', 'password', '••••••••'],
                    ['From Email',        'awsFrom',   'email',    'you@domain.com'],
                  ].map(([label, key, type, ph]) => (
                    <div key={key}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>{label}</label>
                      <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                        placeholder={ph} style={IS} />
                    </div>
                  ))}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>Region</label>
                    <select value={form.awsRegion} onChange={e => setForm(f => ({ ...f, awsRegion: e.target.value }))} style={IS}>
                      {['us-east-1','us-west-2','eu-west-1','ap-south-1','ap-southeast-1'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {form.sendMode === 'csv_smtp' && (
                <div>
                  <div
                    onClick={handlePickSmtpCsv}
                    style={{
                      border: '2px dashed var(--bdr2)', borderRadius: 'var(--rad)',
                      padding: '20px 12px', textAlign: 'center', cursor: 'pointer',
                      background: csvAccounts.length > 0 ? 'var(--gr-l)' : 'var(--bg)',
                      marginBottom: csvAccounts.length > 0 ? 10 : 0,
                    }}
                  >
                    {csvAccounts.length > 0 ? (
                      <>
                        <div style={{ fontSize: 20, marginBottom: 4 }}>✅</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gr)' }}>
                          {csvAccounts.length} account{csvAccounts.length !== 1 ? 's' : ''} loaded
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2, wordBreak: 'break-all' }}>
                          {csvFilePath.split(/[\\/]/).pop()}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>Click to replace</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 24, marginBottom: 4 }}>📂</div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>Click to upload SMTP CSV</div>
                        <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>email, password, host, port columns</div>
                      </>
                    )}
                  </div>
                  {csvAccounts.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
                      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--txt2)' }}>Preview (first {Math.min(5, csvAccounts.length)}):</div>
                      {csvAccounts.slice(0, 5).map((a, i) => (
                        <div key={i} style={{ fontFamily: 'monospace', padding: '2px 0' }}>
                          {a.email}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rad-l)', padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--txt2)' }}>
                📬 Test Accounts ({testAccounts.length})
              </div>
              {testAccounts.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic' }}>No accounts configured yet</div>
              ) : testAccounts.map((a, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 0',
                  borderBottom: i < testAccounts.length - 1 ? '1px solid var(--bdr)' : 'none',
                  fontSize: 12,
                }}>
                  <span>{PROVIDER_COLORS[getProvider(a.email)]?.icon || '📧'}</span>
                  <span style={{ color: 'var(--txt2)' }}>{a.email}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'setup' && testCampaignHistory.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: 'var(--txt2)' }}>🕒 Previous Tests</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {testCampaignHistory.map((h) => (
              <div key={h.id} style={{
                background: 'var(--bg2)', border: '1px solid var(--bdr)',
                borderRadius: 'var(--rad)', padding: '12px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{h.subject}</div>
                  <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
                    {h.fromName && <span>{h.fromName} · </span>}
                    {h.sendMode} · {new Date(h.testedAt).toLocaleString()}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => {
                  setForm(f => ({
                    ...f,
                    subject:   h.subject,
                    fromName:  h.fromName,
                    html:      h.html,
                    sendMode:  h.sendMode,
                    serverId:  h.serverId || f.serverId,
                    smtpEmail: h.smtpEmail || '',
                    smtpPass:  h.smtpPass  || '',
                    awsKey:    h.awsKey    || '',
                    awsSecret: h.awsSecret || '',
                    awsRegion: h.awsRegion || 'us-east-1',
                    awsFrom:   h.awsFrom   || '',
                  }))
                  if (h.csvAccounts && h.csvAccounts.length > 0) {
                    setCsvAccounts(h.csvAccounts)
                    setCsvFilePath('(from history)')
                  }
                  addToast('Form prefilled from previous test', 'info')
                }}>↩ Re-run</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'setup' && (
        <div style={{ marginTop: 20 }}>
          <Button variant="primary" loading={sending} onClick={handleStartTest} disabled={testAccounts.length === 0}>
            🚀 Start Test Campaign
          </Button>
        </div>
      )}

      {step === 'sending' && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📤</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Sending test emails...</div>
          <div style={{ fontSize: 13, color: 'var(--txt3)' }}>Sending to {testAccounts.length} test accounts</div>
        </div>
      )}

      {step === 'results' && (
        <div>
          <div style={{
            background: overallPct >= 80 ? 'var(--gr-l)' : overallPct >= 50 ? '#FFF8E1' : 'var(--re-l)',
            border: '1px solid ' + (overallPct >= 80 ? 'var(--gr)' : overallPct >= 50 ? '#F39C12' : 'var(--re)'),
            borderRadius: 'var(--rad-l)', padding: '20px 24px', marginBottom: 24,
            display: 'flex', alignItems: 'center', gap: 20,
          }}>
            <div style={{ fontSize: 48, fontWeight: 900, color: overallPct >= 80 ? 'var(--gr)' : overallPct >= 50 ? '#F39C12' : 'var(--re)' }}>
              {overallPct}%
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Overall Inbox Rate</div>
              <div style={{ fontSize: 13, color: 'var(--txt2)' }}>
                {totalInbox} inbox · {totalSpam} spam · {totalSent - totalInbox - totalSpam} checking of {totalSent} sent
              </div>
              {waitSeconds > 0 && (
                <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 4 }}>⏳ Checking inboxes in {waitSeconds}s...</div>
              )}
              {checking && waitSeconds === 0 && (
                <div style={{ fontSize: 12, color: 'var(--pu)', marginTop: 4 }}>🔄 Checking inboxes... (attempt {pollCount}/6)</div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(groupedResults).map(([provider, provResults]) => (
              <ProviderCard key={provider} provider={provider} results={provResults} />
            ))}
          </div>

          {Object.keys(groupedResults).length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)' }}>Waiting for results...</div>
          )}
        </div>
      )}
    </div>
  )
}
