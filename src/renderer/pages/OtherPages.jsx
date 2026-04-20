// ── Contacts Page ──────────────────────────────────────────────────
import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { SectionHeader, Table, Badge } from '../components/ui/UI'
import Button from '../components/ui/Button'

export function Contacts() {
  const { contactLists, setContactLists, addToast } = useAppStore()

  useEffect(() => {
    window.api.contacts.getLists().then(setContactLists)
  }, [])

  async function handleImport() {
    const result = await window.api.dialog.openFile({
      title: 'Import contacts',
      filters: [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx', 'xls'] }],
      properties: ['openFile'],
    })
    if (result.canceled) return
    const name = prompt('List name?', 'New list')
    if (!name) return
    try {
      const data = await window.api.contacts.importCSV(result.filePaths[0], name)
      addToast(`Imported ${data.total.toLocaleString()} contacts`, 'success')
      window.api.contacts.getLists().then(setContactLists)
    } catch (err) {
      addToast('Import failed: ' + err.message, 'error')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this list and all its contacts?')) return
    await window.api.contacts.deleteList(id)
    addToast('List deleted')
    window.api.contacts.getLists().then(setContactLists)
  }

  async function handleExportInvalid(id) {
    const r = await window.api.contacts.exportInvalid(id)
    if (r.success) addToast(`Exported ${r.count} invalid emails`, 'success')
  }

  const cols = [
    { key: 'name', label: 'List name', width: '32%', render: v => <strong>{v}</strong> },
    { key: 'total', label: 'Total', width: '11%', render: v => v?.toLocaleString() },
    { key: 'valid', label: 'Valid', width: '11%',
      render: v => <span style={{ color: 'var(--gr)', fontWeight: 500 }}>{v?.toLocaleString()}</span>
    },
    { key: 'invalid', label: 'Invalid', width: '11%',
      render: v => v > 0
        ? <span style={{ color: 'var(--re)', fontWeight: 500 }}>{v?.toLocaleString()}</span>
        : '0'
    },
    { key: 'created_at', label: 'Imported', width: '14%',
      render: v => new Date(v).toLocaleDateString()
    },
    { key: 'id', label: 'Actions', width: '21%',
      render: (id, row) => (
        <div style={{ display: 'flex', gap: 6 }}>
          {row.invalid > 0 && (
            <Button size="sm" variant="ghost" onClick={() => handleExportInvalid(id)}>
              ↓ Invalid
            </Button>
          )}
          <Button size="sm" variant="ghost-danger" onClick={() => handleDelete(id)}>Delete</Button>
        </div>
      )
    },
  ]

  return (
    <div>
      <SectionHeader title="Contact lists">
        <Button variant="primary" onClick={handleImport}>↑ Import CSV / Excel</Button>
      </SectionHeader>
      <Table columns={cols} data={contactLists}
        emptyText="No contact lists yet. Import a CSV to get started." />
    </div>
  )
}

// ── Servers Page ────────────────────────────────────────────────────
const SES_REGIONS = [
  { value: 'us-east-1',      label: 'US East (N. Virginia)' },
  { value: 'us-east-2',      label: 'US East (Ohio)' },
  { value: 'us-west-1',      label: 'US West (N. California)' },
  { value: 'us-west-2',      label: 'US West (Oregon)' },
  { value: 'ap-south-1',     label: 'Asia Pacific (Mumbai)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { value: 'eu-west-1',      label: 'Europe (Ireland)' },
  { value: 'eu-central-1',   label: 'Europe (Frankfurt)' },
  { value: 'eu-west-2',      label: 'Europe (London)' },
  { value: 'ca-central-1',   label: 'Canada (Central)' },
  { value: 'sa-east-1',      label: 'South America (São Paulo)' },
]

export function Servers() {
  const { servers, setServers, addToast } = useAppStore()
  const [showAdd, setShowAdd]     = useState(false)
  const [srvMode, setSrvMode]     = useState('smtp')
  const [provider, setProvider]   = useState('ses')
  const [testing, setTesting]     = useState(null)
  const [testingNew, setTestingNew] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving]       = useState(false)
  const [form, setForm] = useState({
    name: '', host: '', port: 587, email: '', password: '',
    encryption: 'tls', api_key: '', secret_key: '', region: 'us-east-1',
    from_email: '', from_name: '', daily_limit: 500, per_min_limit: 60
  })

  useEffect(() => { window.api.servers.getAll().then(setServers) }, [])

  const IS = {
    width: '100%', padding: '8px 11px', border: '1px solid var(--bdr2)',
    borderRadius: 'var(--rad)', fontSize: 13, background: 'var(--bg2)',
    color: 'var(--txt)', fontFamily: 'var(--font)', outline: 'none', boxSizing: 'border-box'
  }

  const F = ({ label, fkey, type='text', hint, ...rest }) => (
    <div style={{ marginBottom: 13 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>{label}</label>
      <input type={type} value={form[fkey]} onChange={e => setForm(f => ({ ...f, [fkey]: e.target.value }))}
        style={IS} {...rest} />
      {hint && <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>{hint}</div>}
    </div>
  )

  const Sel = ({ label, fkey, children, hint }) => (
    <div style={{ marginBottom: 13 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)', display: 'block', marginBottom: 5 }}>{label}</label>
      <select value={form[fkey]} onChange={e => setForm(f => ({ ...f, [fkey]: e.target.value }))} style={IS}>
        {children}
      </select>
      {hint && <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>{hint}</div>}
    </div>
  )

  async function handleTestNew() {
    setTestingNew(true)
    setTestResult(null)
    try {
      let result
      if (srvMode === 'smtp') {
        result = await window.api.servers.testConfig({ ...form, type: 'smtp' })
      } else if (provider === 'ses') {
        result = await window.api.servers.testSes({
          api_key:   form.api_key.trim(),
          password:  form.secret_key.trim(),
          region:    form.region,
          from_email: form.from_email.trim(),
          provider:  'ses',
          type:      'api'
        })
      } else {
        result = { success: true, message: 'API credentials saved — send test email to verify' }
      }
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, message: err.message })
    } finally {
      setTestingNew(false)
    }
  }

  async function handleTest(id) {
    setTesting(id)
    const result = await window.api.servers.test(id)
    if (result.success) addToast(`✓ Connected in ${result.latency}ms`, 'success')
    else addToast('✕ ' + result.message, 'error')
    setTesting(null)
    window.api.servers.getAll().then(setServers)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this server?')) return
    await window.api.servers.delete(id)
    window.api.servers.getAll().then(setServers)
  }

  async function handleSave() {
    if (!form.name) { addToast('Enter a server name', 'error'); return }
    if (srvMode === 'api' && provider === 'ses') {
      if (!form.api_key)    { addToast('Enter Access Key ID', 'error'); return }
      if (!form.secret_key) { addToast('Enter Secret Access Key', 'error'); return }
      if (!form.from_email) { addToast('Enter verified sender email', 'error'); return }
    }

    setSaving(true)
    try {
      const payload = {
        ...form,
        type:     srvMode,
        provider: srvMode === 'api' ? provider : null,
        // For SES: api_key = Access Key ID, password = Secret Access Key
        password: srvMode === 'api' && provider === 'ses' ? form.secret_key : form.password,
      }
      const srv = await window.api.servers.create(payload)

      // Auto-test
      const result = await window.api.servers.test(srv.id)
      if (result.success) addToast(`✅ Server saved & connected! ${result.message}`, 'success')
      else addToast(`Server saved. Note: ${result.message}`, 'info')

      setShowAdd(false)
      setTestResult(null)
      setForm({ name:'', host:'', port:587, email:'', password:'', encryption:'tls',
                api_key:'', secret_key:'', region:'us-east-1', from_email:'', from_name:'',
                daily_limit:500, per_min_limit:60 })
      window.api.servers.getAll().then(setServers)
    } catch (err) {
      addToast('Error saving server: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const statusDotColor = { active:'#22C55E', error:'#EF4444', limited:'#F59E0B', untested:'#9CA3AF' }

  return (
    <div>
      <SectionHeader title="Email Servers">
        <Button variant="primary" onClick={() => { setShowAdd(v => !v); setTestResult(null) }}>
          {showAdd ? '✕ Cancel' : '+ Add Server'}
        </Button>
      </SectionHeader>

      {/* Server list */}
      {servers.map(s => {
        const usedPct = s.daily_limit > 0 ? Math.round((s.sent_today / s.daily_limit) * 100) : 0
        return (
          <div key={s.id} style={{
            display:'flex', alignItems:'center', gap:12, padding:'13px 16px',
            background:'var(--bg2)', border:'1px solid var(--bdr)', borderRadius:'var(--rad-l)', marginBottom:8,
            ...(s.status === 'error' ? { borderColor:'#FCA5A5', background:'var(--re-l)' } : {}),
            ...(usedPct > 85 ? { borderColor:'#FCD34D' } : {}),
          }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background: statusDotColor[s.status]||'#9CA3AF', flexShrink:0 }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, fontSize:13 }}>{s.name}</div>
              <div style={{ fontSize:11, color:'var(--txt3)', marginTop:2 }}>
                {s.type === 'smtp'
                  ? `${s.host}:${s.port} · ${s.encryption?.toUpperCase()}`
                  : `${s.provider?.toUpperCase()} · ${s.region || ''} · ${s.from_email || ''}`}
                {' · '}{s.daily_limit?.toLocaleString()}/day
                {s.last_tested && ` · Tested ${new Date(s.last_tested).toLocaleTimeString()}`}
              </div>
            </div>
            <div style={{ fontSize:12, color: usedPct>85?'var(--re)':'var(--txt2)', textAlign:'right', flexShrink:0 }}>
              {(s.sent_today||0).toLocaleString()} / {s.daily_limit?.toLocaleString()}<br/>{usedPct}% used
            </div>
            <Badge variant={s.type}>{s.type?.toUpperCase()}</Badge>
            <Badge variant={s.status}>{s.status}</Badge>
            <Button size="sm" loading={testing===s.id} onClick={() => handleTest(s.id)}>Test</Button>
            <Button size="sm" variant="ghost-danger" onClick={() => handleDelete(s.id)}>Remove</Button>
          </div>
        )
      })}

      {servers.length === 0 && !showAdd && (
        <div style={{ textAlign:'center', padding:'48px', color:'var(--txt3)', fontSize:13 }}>
          No servers yet. Add a SMTP server or AWS SES account to start sending.
        </div>
      )}

      {/* Add server form */}
      {showAdd && (
        <div style={{ background:'var(--bg)', border:'1px solid var(--bdr)', borderRadius:'var(--rad-l)', padding:20, marginTop:14 }}>
          <div style={{ fontWeight:600, fontSize:14, marginBottom:14 }}>Add New Server</div>

          {/* Mode toggle */}
          <div style={{ display:'flex', gap:8, marginBottom:16 }}>
            {[
              { val:'smtp', title:'📧 SMTP Server',   desc:'Gmail, Outlook, custom SMTP' },
              { val:'api',  title:'☁️ Cloud API',      desc:'AWS SES, SendGrid, Mailgun'  },
            ].map(m => (
              <div key={m.val} onClick={() => setSrvMode(m.val)}
                style={{ flex:1, padding:12, border:`1.5px solid ${srvMode===m.val?'var(--pu)':'var(--bdr2)'}`,
                  borderRadius:'var(--rad-l)', cursor:'pointer', background: srvMode===m.val?'var(--pu-l)':'var(--bg2)' }}>
                <div style={{ fontWeight:600, fontSize:13, marginBottom:2 }}>{m.title}</div>
                <div style={{ fontSize:12, color:'var(--txt2)' }}>{m.desc}</div>
              </div>
            ))}
          </div>

          <F label="Server nickname *" fkey="name" placeholder={srvMode==='smtp'?'e.g. Gmail SMTP #1':'e.g. AWS SES Production'} />

          {/* ── SMTP Form ── */}
          {srvMode === 'smtp' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <F label="SMTP Host *" fkey="host" placeholder="smtp.gmail.com" />
              <F label="Port" fkey="port" type="number" placeholder="587" />
              <F label="Email address *" fkey="email" type="email" placeholder="you@gmail.com" />
              <F label="App password *" fkey="password" type="password" placeholder="xxxx xxxx xxxx xxxx" hint="Use App Password, not your login password" />
              <Sel label="Encryption" fkey="encryption">
                <option value="tls">TLS (STARTTLS) — recommended</option>
                <option value="ssl">SSL</option>
                <option value="none">None</option>
              </Sel>
              <F label="Daily send limit" fkey="daily_limit" type="number" placeholder="500" />
              <F label="From name" fkey="from_name" placeholder="Your Company" />
              <F label="From email" fkey="from_email" type="email" placeholder="no-reply@domain.com" />
            </div>
          )}

          {/* ── API Form ── */}
          {srvMode === 'api' && (
            <div>
              {/* Provider select */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:16 }}>
                {[
                  { val:'ses',      label:'Amazon SES',  icon:'🔶' },
                  { val:'sendgrid', label:'SendGrid',     icon:'🟦' },
                  { val:'mailgun',  label:'Mailgun',      icon:'🟥' },
                ].map(p => (
                  <div key={p.val} onClick={() => setProvider(p.val)}
                    style={{ padding:12, border:`1.5px solid ${provider===p.val?'var(--pu)':'var(--bdr2)'}`,
                      borderRadius:'var(--rad)', cursor:'pointer', textAlign:'center',
                      background: provider===p.val?'var(--pu-l)':'var(--bg2)' }}>
                    <div style={{ fontSize:20, marginBottom:4 }}>{p.icon}</div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.label}</div>
                  </div>
                ))}
              </div>

              {/* AWS SES specific form */}
              {provider === 'ses' && (
                <div>
                  <div style={{ background:'#FFF8E1', border:'1px solid #F39C12', borderRadius:'var(--rad)', padding:'10px 14px', marginBottom:16, fontSize:12, color:'#856404' }}>
                    ℹ️ Make sure your IAM user has <strong>AmazonSESFullAccess</strong> policy and your sender email is verified in AWS SES console.
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                    <F label="Access Key ID *" fkey="api_key" placeholder="AKIAIOSFODNN7EXAMPLE"
                       hint="Found in AWS IAM → Users → Security credentials" />
                    <F label="Secret Access Key *" fkey="secret_key" type="password" placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                       hint="Only visible once when created" />
                    <div>
                      <label style={{ fontSize:12, fontWeight:600, color:'var(--txt2)', display:'block', marginBottom:5 }}>AWS Region *</label>
                      <select value={form.region} onChange={e => setForm(f => ({...f, region: e.target.value}))} style={IS}>
                        {SES_REGIONS.map(r => <option key={r.value} value={r.value}>{r.label} ({r.value})</option>)}
                      </select>
                      <div style={{ fontSize:11, color:'var(--txt3)', marginTop:4 }}>Must match your SES region</div>
                    </div>
                    <F label="Verified Sender Email *" fkey="from_email" type="email" placeholder="no-reply@yourdomain.com"
                       hint="Must be verified in SES console" />
                    <F label="From Name" fkey="from_name" placeholder="Your Company" />
                    <F label="Daily Send Limit" fkey="daily_limit" type="number" placeholder="50000"
                       hint="Check your SES quota in AWS console" />
                  </div>
                </div>
              )}

              {/* Other API providers */}
              {provider !== 'ses' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                  <F label="API Key *" fkey="api_key" type="password" placeholder="sk-..." />
                  <F label="Daily limit" fkey="daily_limit" type="number" placeholder="50000" />
                  <F label="From email *" fkey="from_email" type="email" placeholder="no-reply@domain.com" />
                  <F label="From name" fkey="from_name" placeholder="Mailflow" />
                  {provider === 'mailgun' && (
                    <F label="Domain/Region" fkey="region" placeholder="mailgun.org" hint="Your Mailgun domain or region" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div style={{
              marginTop:12, padding:'10px 14px', borderRadius:'var(--rad)', fontSize:12,
              background: testResult.success ? 'var(--gr-l)' : 'var(--re-l)',
              border: `1px solid ${testResult.success ? 'var(--gr)' : 'var(--re)'}`,
              color: testResult.success ? 'var(--gr)' : 'var(--re)'
            }}>
              {testResult.success ? '✅' : '❌'} {testResult.message}
              {testResult.success && testResult.quota && (
                <div style={{ marginTop:6, color:'var(--txt2)', fontWeight:400 }}>
                  Daily quota: {testResult.quota.max24Hour?.toLocaleString()} · 
                  Used today: {testResult.quota.sentLast24h?.toLocaleString()} · 
                  Rate: {testResult.quota.maxRate}/sec
                </div>
              )}
            </div>
          )}

          <div style={{ display:'flex', gap:8, marginTop:16, flexWrap:'wrap' }}>
            <Button onClick={handleTestNew} loading={testingNew}>
              🔌 Test Connection
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              💾 Save Server
            </Button>
            <Button variant="ghost" onClick={() => { setShowAdd(false); setTestResult(null) }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Templates Page ──────────────────────────────────────────────────
export function Templates() {
  const { templates, setTemplates, addToast } = useAppStore()
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name:'', subject:'', from_name:'', html_body:'' })

  useEffect(() => {
    window.api.templates.getAll().then(setTemplates)
  }, [])

  function openNew() {
    setEditing('new')
    setForm({ name:'', subject:'', from_name:'', html_body:
      '<p>Hi <strong>{{name}}</strong>,</p><br><p>Your message here.</p><br><p>Best,<br>The Team</p>'
    })
  }

  async function openEdit(t) {
    const full = await window.api.templates.getById(t.id)
    setEditing(full.id)
    setForm({ name: full.name, subject: full.subject, from_name: full.from_name || '', html_body: full.html_body || '' })
  }

  async function handleSave() {
    if (!form.name || !form.subject || !form.html_body) {
      addToast('Fill in all required fields', 'error'); return
    }
    if (editing === 'new') {
      await window.api.templates.create(form)
      addToast('Template created', 'success')
    } else {
      await window.api.templates.update(editing, form)
      addToast('Template saved', 'success')
    }
    setEditing(null)
    window.api.templates.getAll().then(setTemplates)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this template?')) return
    await window.api.templates.delete(id)
    addToast('Template deleted')
    window.api.templates.getAll().then(setTemplates)
  }

  async function handleDuplicate(id) {
    await window.api.templates.duplicate(id)
    addToast('Template duplicated', 'success')
    window.api.templates.getAll().then(setTemplates)
  }

  function insertVar(varName) {
    setForm(f => ({ ...f, html_body: f.html_body + `{{${varName}}}` }))
  }

  if (editing !== null) {
    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
          <Button variant="ghost" onClick={() => setEditing(null)}>← Back</Button>
          <h2 style={{ fontSize:15, fontWeight:600 }}>{editing === 'new' ? 'New template' : 'Edit template'}</h2>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
          {[['Template name', 'name', 'Q2 Newsletter'], ['Subject line', 'subject', 'Hi {{name}}, check this out'],
            ['From name', 'from_name', 'Your Company']
          ].map(([label, key, ph]) => (
            <div key={key}>
              <label style={{ fontSize:12, fontWeight:600, color:'var(--txt2)', display:'block', marginBottom:5 }}>{label}</label>
              <input value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))}
                placeholder={ph}
                style={{ width:'100%', padding:'8px 11px', border:'1px solid var(--bdr2)', borderRadius:'var(--rad)',
                  fontSize:13, background:'var(--bg2)', color:'var(--txt)', fontFamily:'var(--font)', outline:'none' }} />
            </div>
          ))}
        </div>

        <label style={{ fontSize:12, fontWeight:600, color:'var(--txt2)', display:'block', marginBottom:5 }}>Email body (HTML)</label>
        <div style={{ border:'1px solid var(--bdr)', borderRadius:'var(--rad)', marginBottom:14 }}>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap', padding:'8px', background:'var(--bg3)',
            borderBottom:'1px solid var(--bdr)', borderRadius:'var(--rad) var(--rad) 0 0' }}>
            {['name','email','company','city','tag'].map(v => (
              <button key={v} onClick={() => insertVar(v)}
                style={{ padding:'4px 8px', fontSize:12, border:'1px solid var(--pu-m)', borderRadius:5,
                  background:'var(--pu-l)', color:'var(--pu)', cursor:'pointer', fontFamily:'var(--font)' }}>
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <textarea
            value={form.html_body}
            onChange={e => setForm(f => ({ ...f, html_body: e.target.value }))}
            style={{ width:'100%', minHeight:240, padding:'14px', border:'none', borderRadius:'0 0 var(--rad) var(--rad)',
              fontSize:13, fontFamily:'var(--mono)', lineHeight:1.6, background:'var(--bg2)',
              color:'var(--txt)', outline:'none', resize:'vertical' }}
          />
        </div>

        {form.html_body && (
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--txt2)', display:'block', marginBottom:8 }}>Preview</label>
            <div style={{ border:'1px solid var(--bdr)', borderRadius:'var(--rad)', padding:'16px',
              background:'#fff', fontSize:13, lineHeight:1.7, maxHeight:280, overflow:'auto' }}
              dangerouslySetInnerHTML={{ __html: form.html_body }} />
          </div>
        )}

        <div style={{ display:'flex', gap:8 }}>
          <Button variant="primary" onClick={handleSave}>Save template</Button>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
        </div>
      </div>
    )
  }

  const cols = [
    { key:'name', label:'Template name', width:'26%', render: v => <strong>{v}</strong> },
    { key:'subject', label:'Subject', width:'32%', render: v => <span style={{ color:'var(--txt2)' }}>{v}</span> },
    { key:'variables', label:'Variables', width:'18%',
      render: v => {
        const vars = JSON.parse(v || '[]')
        return vars.length > 0
          ? vars.slice(0,3).map(vv => (
              <code key={vv} style={{ fontSize:11, background:'var(--pu-l)', color:'var(--pu)', padding:'1px 5px', borderRadius:4, marginRight:4 }}>
                {`{{${vv}}}`}
              </code>
            ))
          : <span style={{ color:'var(--txt3)', fontSize:12 }}>None</span>
      }
    },
    { key:'updated_at', label:'Modified', width:'10%', render: v => new Date(v).toLocaleDateString() },
    { key:'id', label:'', width:'14%',
      render: (id, row) => (
        <div style={{ display:'flex', gap:5 }}>
          <Button size="sm" variant="primary" onClick={() => openEdit(row)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => handleDuplicate(id)}>Copy</Button>
          <Button size="sm" variant="ghost-danger" onClick={() => handleDelete(id)}>Del</Button>
        </div>
      )
    },
  ]

  return (
    <div>
      <SectionHeader title="Email templates">
        <Button variant="primary" onClick={openNew}>+ New template</Button>
      </SectionHeader>
      <Table columns={cols} data={templates} emptyText="No templates yet. Create your first email template." />
    </div>
  )
}

// ── Analytics Page ──────────────────────────────────────────────────
export function Analytics() {
  const { addToast } = useAppStore()
  const [period, setPeriod] = useState('30days')
  const [data, setData] = useState(null)

  useEffect(() => {
    window.api.analytics.getDashboard().then(setData)
  }, [])

  async function handleExport() {
    const r = await window.api.analytics.export(period)
    if (r.success) addToast(`Exported ${r.count} rows`, 'success')
    else if (!r.cancelled) addToast('Export failed', 'error')
  }

  const t = data?.totals || {}
  const totalSent = t.total_sent || 0
  const openRate  = totalSent > 0 ? ((t.total_opens  / totalSent) * 100).toFixed(1) : '0.0'
  const clickRate = totalSent > 0 ? ((t.total_clicks / totalSent) * 100).toFixed(1) : '0.0'
  const bounceRate= totalSent > 0 ? ((t.total_bounces/ totalSent) * 100).toFixed(1) : '0.0'

  const cols = [
    { key:'name', label:'Campaign', width:'26%', render: v => <strong>{v}</strong> },
    { key:'sent_count', label:'Sent', width:'12%', render: v => (v||0).toLocaleString() },
    { key:'delivered_count', label:'Delivered', width:'12%', render: v => (v||0).toLocaleString() },
    { key:'open_count', label:'Opens', width:'12%',
      render: (v, row) => row.sent_count > 0 ? ((v/row.sent_count)*100).toFixed(1)+'%' : '—'
    },
    { key:'click_count', label:'Clicks', width:'12%',
      render: (v, row) => row.sent_count > 0 ? ((v/row.sent_count)*100).toFixed(1)+'%' : '—'
    },
    { key:'bounce_count', label:'Bounced', width:'12%',
      render: (v, row) => row.sent_count > 0
        ? <span style={{ color: v/row.sent_count > 0.03 ? 'var(--re)' : 'inherit' }}>
            {((v/row.sent_count)*100).toFixed(1)}%
          </span> : '—'
    },
    { key:'created_at', label:'Date', width:'12%', render: v => new Date(v).toLocaleDateString() },
  ]

  return (
    <div>
      <SectionHeader title="Analytics">
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select value={period} onChange={e => setPeriod(e.target.value)}
            style={{ padding:'5px 10px', borderRadius:'var(--rad)', border:'1px solid var(--bdr2)',
              background:'var(--bg2)', fontSize:13, color:'var(--txt)', fontFamily:'var(--font)' }}>
            <option value="30days">Last 30 days</option>
            <option value="90days">Last 90 days</option>
            <option value="alltime">All time</option>
          </select>
          <Button variant="ghost" size="sm" onClick={handleExport}>↓ Export CSV</Button>
        </div>
      </SectionHeader>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:24 }}>
        {[
          ['Total delivered', totalSent.toLocaleString(), 'All time'],
          ['Open rate', openRate+'%', 'Industry avg: 21%'],
          ['Click rate', clickRate+'%', 'Industry avg: 2.6%'],
          ['Bounce rate', bounceRate+'%', bounceRate > 3 ? 'Above threshold' : 'Safe range'],
        ].map(([label, value, delta]) => (
          <div key={label} style={{ background:'var(--bg2)', border:'1px solid var(--bdr)',
            borderRadius:'var(--rad-l)', padding:'16px 18px' }}>
            <div style={{ fontSize:12, color:'var(--txt2)', fontWeight:500, marginBottom:6 }}>{label}</div>
            <div style={{ fontSize:26, fontWeight:600, letterSpacing:'-0.5px' }}>{value}</div>
            <div style={{ fontSize:12, marginTop:5, color:'var(--txt3)' }}>{delta}</div>
          </div>
        ))}
      </div>

      <SectionHeader title="Per-campaign breakdown">
        <Button size="sm" variant="ghost" onClick={handleExport}>↓ Full report</Button>
      </SectionHeader>
      <Table columns={cols} data={data?.recent || []}
        emptyText="No campaign data yet. Complete a campaign to see analytics." />
    </div>
  )
}

// ── Email Verify Page ───────────────────────────────────────────────
export function VerifyEmails() {
  const { addToast } = useAppStore()
  const [opts, setOpts] = useState({ checkMx: true, checkSmtp: false })
  const [results, setResults] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [single, setSingle] = useState('')

  async function handleBulkVerify() {
    const r = await window.api.dialog.openFile({
      filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile'],
    })
    if (r.canceled) return
    setLoading(true)
    try {
      const data = await window.api.verify.verifyList(r.filePaths[0], opts)
      setResults(data.results || [])
      setSummary(data.summary)
      addToast(`Verified ${data.summary?.total || 0} emails`, 'success')
    } catch (err) {
      addToast('Verification failed: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSingle() {
    if (!single) { addToast('Enter an email address', 'error'); return }
    setLoading(true)
    const r = await window.api.verify.verifySingle(single)
    setResults([r])
    setSummary({ total:1, valid: r.status==='valid'?1:0, risky: r.status==='risky'?1:0, invalid: r.status==='invalid'?1:0 })
    setLoading(false)
  }

  async function handleExport(type) {
    const r = await window.api.verify.exportResults(results, type)
    if (r.success) addToast(`Exported ${r.count} emails`, 'success')
  }

  const cols = [
    { key:'email', label:'Email', width:'42%' },
    { key:'status', label:'Status', width:'14%', render: v => <Badge variant={v}>{v}</Badge> },
    { key:'reason', label:'Reason', width:'28%', render: v => <span style={{ color:'var(--txt2)' }}>{v}</span> },
    { key:'mx', label:'MX server', width:'16%', render: v => v
      ? <span style={{ fontFamily:'var(--mono)', fontSize:11 }}>{v}</span> : '—'
    },
  ]

  return (
    <div>
      <div style={{ display:'flex', gap:20, marginBottom:24, flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:280 }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:10 }}>Single email check</div>
          <div style={{ display:'flex', gap:8, marginBottom:14 }}>
            <input value={single} onChange={e => setSingle(e.target.value)}
              placeholder="user@example.com"
              style={{ flex:1, padding:'8px 11px', border:'1px solid var(--bdr2)', borderRadius:'var(--rad)',
                fontSize:13, background:'var(--bg2)', color:'var(--txt)', fontFamily:'var(--font)', outline:'none' }}
            />
            <Button variant="primary" loading={loading} onClick={handleSingle}>Check</Button>
          </div>
        </div>
        <div style={{ flex:1, minWidth:280 }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:10 }}>Bulk verify from CSV</div>
          <div style={{ border:'2px dashed var(--bdr2)', borderRadius:'var(--rad-l)', padding:'20px',
            textAlign:'center', cursor:'pointer', marginBottom:10 }}
            onClick={handleBulkVerify}>
            <div style={{ fontWeight:500, marginBottom:4 }}>Upload CSV of emails</div>
            <div style={{ fontSize:12, color:'var(--txt3)' }}>One email per row, or email column header</div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:7, marginBottom:10 }}>
            {[['checkMx','MX record lookup'],['checkSmtp','SMTP handshake (slower, more accurate)']].map(([k,l]) => (
              <label key={k} style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
                <input type="checkbox" checked={opts[k]} onChange={e => setOpts(o => ({...o,[k]:e.target.checked}))}
                  style={{ accentColor:'var(--pu)' }} />
                {l}
              </label>
            ))}
          </div>
          <Button variant="primary" loading={loading} onClick={handleBulkVerify}>Start bulk verification</Button>
        </div>
      </div>

      {summary && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:16 }}>
          {[['Total', summary.total, 'var(--txt)'],['Valid', summary.valid, 'var(--gr)'],
            ['Risky', summary.risky, 'var(--am)'],['Invalid', summary.invalid, 'var(--re)']].map(([l,v,c]) => (
            <div key={l} style={{ background:'var(--bg2)', border:'1px solid var(--bdr)', borderRadius:'var(--rad-l)', padding:'14px' }}>
              <div style={{ fontSize:12, color:'var(--txt2)', marginBottom:5 }}>{l}</div>
              <div style={{ fontSize:22, fontWeight:600, color: c }}>{(v||0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <>
          <Table columns={cols} data={results.slice(0, 200)} />
          <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
            <Button onClick={() => handleExport('valid')}>↓ Valid CSV</Button>
            <Button onClick={() => handleExport('risky')}>↓ Risky CSV</Button>
            <Button onClick={() => handleExport('invalid')}>↓ Invalid CSV</Button>
            <Button onClick={() => handleExport('all')}>↓ All results</Button>
          </div>
        </>
      )}
    </div>
  )
}

// ── SMTP Tester Page ────────────────────────────────────────────────
export function SmtpTester() {
  const { addToast } = useAppStore()
  const [form, setForm] = useState({ host:'', port:587, email:'', password:'', encryption:'tls' })
  const [results, setResults] = useState([])
  const [summary, setSummary] = useState(null)
  const [testing, setTesting] = useState(false)

  const F = ({ label, fkey, type='text', ...rest }) => (
    <div>
      <label style={{ fontSize:12, fontWeight:600, color:'var(--txt2)', display:'block', marginBottom:5 }}>{label}</label>
      <input type={type} value={form[fkey]} onChange={e => setForm(f => ({...f,[fkey]:e.target.value}))}
        style={{ width:'100%', padding:'8px 11px', border:'1px solid var(--bdr2)', borderRadius:'var(--rad)',
          fontSize:13, background:'var(--bg2)', color:'var(--txt)', fontFamily:'var(--font)', outline:'none' }}
        {...rest} />
    </div>
  )

  async function handleSingle() {
    if (!form.host || !form.email) { addToast('Fill in host and email', 'error'); return }
    setTesting(true)
    const r = await window.api.smtp.testSingle(form)
    if (r.success) addToast(`✓ Connected in ${r.latency}ms`, 'success')
    else addToast('✕ ' + r.message, 'error')
    setResults([{ ...form, status: r.success ? 'working' : 'failed', details: r.message || r.error, latency: r.latency }])
    setTesting(false)
  }

  async function handleBulk() {
    const r = await window.api.dialog.openFile({
      filters: [{ name:'CSV', extensions:['csv'] }], properties:['openFile'],
    })
    if (r.canceled) return
    setTesting(true)
    const data = await window.api.smtp.testBulk(r.filePaths[0])
    setResults(data.results || [])
    setSummary(data.summary)
    addToast(`Tested ${data.summary?.total || 0} SMTPs`, 'success')
    setTesting(false)
  }

  async function handleExport(type) {
    const r = await window.api.smtp.export(results, type)
    if (r.success) addToast(`Exported ${r.count} rows`, 'success')
  }

  const cols = [
    { key:'host', label:'Host', width:'22%' },
    { key:'port', label:'Port', width:'8%' },
    { key:'email', label:'Email', width:'24%' },
    { key:'status', label:'Status', width:'12%', render: v => <Badge variant={v}>{v}</Badge> },
    { key:'details', label:'Details', width:'24%', render: v => <span style={{ color:'var(--txt2)', fontSize:12 }}>{v}</span> },
    { key:'latency', label:'Latency', width:'10%', render: v => v ? v+'ms' : '—' },
  ]

  return (
    <div>
      <div style={{ display:'flex', gap:20, marginBottom:24, flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:280 }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>Single SMTP test</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <F label="Host" fkey="host" placeholder="smtp.gmail.com" />
            <F label="Port" fkey="port" type="number" placeholder="587" />
            <F label="Email" fkey="email" type="email" placeholder="you@gmail.com" />
            <F label="App password" fkey="password" type="password" placeholder="•••• ••••" />
          </div>
          <Button variant="primary" loading={testing} onClick={handleSingle}>Test connection</Button>
        </div>
        <div style={{ flex:1, minWidth:280 }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:12 }}>Bulk SMTP test</div>
          <div style={{ border:'2px dashed var(--bdr2)', borderRadius:'var(--rad-l)', padding:'24px',
            textAlign:'center', cursor:'pointer', marginBottom:12 }} onClick={handleBulk}>
            <div style={{ fontWeight:500, marginBottom:4 }}>Upload SMTP list CSV</div>
            <div style={{ fontSize:12, color:'var(--txt3)' }}>Columns: host, port, email, password</div>
          </div>
          <Button variant="primary" loading={testing} onClick={handleBulk}>Run bulk test</Button>
        </div>
      </div>

      {summary && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
          {[['Total', summary.total, 'var(--txt)'],['Working', summary.working, 'var(--gr)'],['Failed', summary.failed, 'var(--re)']].map(([l,v,c]) => (
            <div key={l} style={{ background:'var(--bg2)', border:'1px solid var(--bdr)', borderRadius:'var(--rad-l)', padding:'14px' }}>
              <div style={{ fontSize:12, color:'var(--txt2)', marginBottom:5 }}>{l}</div>
              <div style={{ fontSize:22, fontWeight:600, color: c }}>{(v||0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <>
          <Table columns={cols} data={results} />
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <Button onClick={() => handleExport('working')}>↓ Working SMTPs</Button>
            <Button onClick={() => handleExport('failed')}>↓ Failed SMTPs</Button>
            <Button onClick={() => handleExport('all')}>↓ All results</Button>
          </div>
        </>
      )}
    </div>
  )
}
