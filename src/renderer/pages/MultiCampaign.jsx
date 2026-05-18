import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import Button from '../components/ui/Button'

const MAX_PAGES = 4

function InstanceSelector({ value, onChange, instances, onRefresh, selectedIps }) {
  const otherSelected      = (selectedIps || []).filter(function(ip) { return ip && ip !== value })
  const myInstances        = instances.filter(function(i) { return i.is_mine && !i.purpose && !otherSelected.includes(i.ip_address) })
  const availableInstances = instances.filter(function(i) { return !i.is_mine && i.status === 'ready' && !otherSelected.includes(i.ip_address) })
  const inUseInstances     = instances.filter(function(i) { return i.purpose && i.usage_status === 'active' })
  const usedByOther        = instances.filter(function(i) { return otherSelected.includes(i.ip_address) && i.ip_address !== value })

  return (
    <div>
      <select value={value} onChange={function(e) { onChange(e.target.value) }}
        style={{width:'100%', padding:'8px 11px', border:'1px solid var(--bdr2)', borderRadius:'var(--rad)',
          fontSize:13, background:'var(--bg2)', color:'var(--txt)', fontFamily:'var(--font)', outline:'none',
          marginBottom:8}}>
        <option value="">-- Select Instance --</option>

        {myInstances.length > 0 && (
          <optgroup label="── Your Assigned Instance ──">
            {myInstances.map(function(i) {
              return (
                <option key={i.id} value={i.ip_address}>
                  ● {i.ip_address} (your instance)
                </option>
              )
            })}
          </optgroup>
        )}

        {availableInstances.length > 0 && (
          <optgroup label="── Available in Pool ──">
            {availableInstances.map(function(i) {
              return (
                <option key={i.id} value={i.ip_address}>
                  ○ {i.ip_address} (free)
                </option>
              )
            })}
          </optgroup>
        )}

        {inUseInstances.length > 0 && (
          <optgroup label="── In Use by Other Pages ──">
            {inUseInstances.map(function(i) {
              return (
                <option key={i.id} value={i.ip_address} disabled>
                  ✕ {i.ip_address} (Page {i.page_number})
                </option>
              )
            })}
          </optgroup>
        )}

        {usedByOther.length > 0 && (
          <optgroup label="── Selected by Another Tab ──">
            {usedByOther.map(function(i) {
              return (
                <option key={'other-' + i.id} value={i.ip_address} disabled>
                  ✕ {i.ip_address} (used by another page)
                </option>
              )
            })}
          </optgroup>
        )}
      </select>

      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <button onClick={onRefresh}
          style={{padding:'4px 10px', background:'var(--bg)', border:'1px solid var(--bdr)',
            borderRadius:'var(--rad)', fontSize:11, cursor:'pointer', color:'var(--txt2)'}}>
          ↻ Refresh
        </button>
        <span style={{fontSize:11, color:'var(--txt3)'}}>
          {availableInstances.length + myInstances.length} available
        </span>
        {value && (
          <span style={{fontSize:11, color:'var(--gr)', fontWeight:600}}>● {value}</span>
        )}
      </div>
    </div>
  )
}

export default function MultiCampaign() {
  const { resendCampaign, clearResendCampaign, setActivePage, addToast } = useAppStore()

  const [template, setTemplate]       = useState({ subject: '', fromName: '', html_body: '' })
  const [instances, setInstances]     = useState([])
  const [pages, setPages]             = useState([
    { id: 1, contactListId: '', contacts: 0, smtpAccounts: [], instanceIp: '', status: 'idle', sent: 0, failed: 0, total: 0, pageKey: null }
  ])
  const [activeTab, setActiveTab]     = useState(1)
  const [launching, setLaunching]     = useState(false)
  const [campaignId]                  = useState('multi-' + Date.now())
  const [slots, setSlots]             = useState(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const listenersAttached             = useRef(false)

  const handleProgress = useCallback(function(data) {
    setPages(function(prev) {
      return prev.map(function(p) {
        if ('page-' + p.id === data.pageKey) {
          return Object.assign({}, p, {
            sent:   data.sent   != null ? data.sent   : p.sent,
            failed: data.failed != null ? data.failed : p.failed,
            total:  data.total  != null ? data.total  : p.total,
            status: data.status === 'completed' ? 'completed'
                  : data.status === 'failed'    ? 'failed'
                  : data.status === 'stopped'   ? 'stopped'
                  : 'running',
          })
        }
        return p
      })
    })
  }, [])

  const handleComplete = useCallback(function(data) {
    setPages(function(prev) {
      return prev.map(function(p) {
        if ('page-' + p.id === data.pageKey) {
          addToast('Page ' + p.id + ' completed — ' + data.sent + ' emails sent', 'success')
          window.api.license.updateCampaignInstance({
            instanceIp: p.instanceIp,
            campaignId: campaignId,
            pageNumber: p.id,
            status:     'completed',
          }).catch(function() {})
          return Object.assign({}, p, { status: 'completed', sent: data.sent, failed: data.failed })
        }
        return p
      })
    })
  }, [campaignId])

  async function loadSlots() {
    setSlotsLoading(true)
    try {
      var result = await window.api.license.getSlots()
      if (result && result.success) {
        setSlots(result)
      }
    } catch (err) {
      console.log('[MultiCampaign] Slots error:', err.message)
    } finally {
      setSlotsLoading(false)
    }
  }

  function canAddPage() {
    if (!slots) return true
    return (pages.length + 1) <= slots.maxAllowed
  }

  useEffect(function() {
    if (resendCampaign) {
      setTemplate({
        subject:   resendCampaign.subject   || '',
        fromName:  resendCampaign.from_name || '',
        html_body: resendCampaign.html_body || '',
      })
      clearResendCampaign()
    }
    loadInstances()
    loadSlots()

    if (!listenersAttached.current) {
      listenersAttached.current = true
      window.api.on('multicampaign:progress', handleProgress)
      window.api.on('multicampaign:complete', handleComplete)
    }

    return function() {
      window.api.off('multicampaign:progress', handleProgress)
      window.api.off('multicampaign:complete', handleComplete)
    }
  }, [])

  async function loadInstances() {
    try {
      var result = await window.api.license.getInstances()
      if (result.success && result.instances) {
        setInstances(result.instances)
        var myInstance = result.instances.find(function(i) { return i.is_mine })
        if (myInstance) {
          setPages(function(prev) {
            return prev.map(function(p) {
              if (p.id === 1 && !p.instanceIp) {
                return Object.assign({}, p, { instanceIp: myInstance.ip_address })
              }
              return p
            })
          })
        }
      } else {
        addToast('Could not load instances: ' + (result.error || 'Unknown error'), 'error')
      }
    } catch (err) {
      addToast('Error loading instances: ' + err.message, 'error')
    }
  }

  function addPage() {
    if (pages.length >= MAX_PAGES) { addToast('Maximum 4 pages allowed', 'error'); return }
    if (!canAddPage()) {
      addToast(
        'Instance limit reached. Your ' + (slots ? slots.planLabel : '') + ' plan allows ' +
        (slots ? slots.maxAllowed : 5) + ' instances total. You cannot add more pages.',
        'error'
      )
      return
    }
    setPages(function(prev) {
      return prev.concat([{
        id:            prev.length + 1,
        contactListId: '',
        contacts:      0,
        smtpAccounts:  [],
        instanceIp:    '',
        status:        'idle',
        sent:          0,
        failed:        0,
        total:         0,
        pageKey:       null,
      }])
    })
  }

  function removePage(pageId) {
    if (pages.length === 1) { addToast('Need at least 1 page', 'error'); return }
    setPages(function(prev) { return prev.filter(function(p) { return p.id !== pageId }) })
  }

  function updatePage(pageId, updates) {
    setPages(function(prev) {
      return prev.map(function(p) { return p.id === pageId ? Object.assign({}, p, updates) : p })
    })
  }

  async function handlePickContacts(pageId) {
    var result = await window.api.dialog.openFile({
      title:      'Select Contacts CSV for Page ' + pageId,
      filters:    [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return
    try {
      var listName = 'MultiCampaign-P' + pageId + '-' + Date.now()
      var imported = await window.api.contacts.importCSV(result.filePaths[0], listName)
      if (imported && imported.total > 0) {
        updatePage(pageId, { contactListId: imported.listId || imported.id || '', contacts: imported.total })
        addToast('Page ' + pageId + ': ' + imported.total + ' contacts loaded', 'success')
      } else {
        addToast('No contacts found in CSV', 'error')
      }
    } catch (err) {
      addToast('Error: ' + err.message, 'error')
    }
  }

  async function handlePickSmtp(pageId) {
    var result = await window.api.dialog.openFile({
      title:      'Select SMTP CSV for Page ' + pageId,
      filters:    [{ name: 'CSV Files', extensions: ['csv', 'txt'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return
    try {
      var parsed = await window.api.smtp.parseCsv(result.filePaths[0])
      if (parsed.success && parsed.accounts.length > 0) {
        updatePage(pageId, { smtpAccounts: parsed.accounts })
        addToast('Page ' + pageId + ': ' + parsed.accounts.length + ' SMTP accounts loaded', 'success')
      } else {
        addToast('No valid SMTP accounts in CSV', 'error')
      }
    } catch (err) {
      addToast('Error: ' + err.message, 'error')
    }
  }

  function canLaunch() {
    if (!template.subject || !template.html_body) return false
    return pages.every(function(p) {
      return p.contactListId && p.smtpAccounts.length > 0 && p.instanceIp
    })
  }

  async function handleLaunchAll() {
    if (!canLaunch()) {
      addToast('Each page needs: contacts CSV, SMTP CSV, and an instance IP', 'error')
      return
    }
    setLaunching(true)

    var launchPromises = pages.map(async function(page) {
      try {
        updatePage(page.id, { status: 'launching' })

        var result = await window.api.sending.startMultiCampaignPage({
          pageId:         page.id,
          contactListId:  page.contactListId,
          subject:        template.subject,
          fromName:       template.fromName,
          html_body:      template.html_body,
          smtpAccounts:   page.smtpAccounts,
          instanceIp:     page.instanceIp,
          instanceToken:  'mailflow-agent-2026',
          campaignPageId: campaignId + '-page' + page.id,
        })

        if (result.success) {
          updatePage(page.id, { status: 'running', total: result.total, pageKey: result.pageKey })
          window.api.license.trackCampaignInstance({
            instanceIp: page.instanceIp,
            campaignId: campaignId,
            pageNumber: page.id,
            purpose:    'multi-campaign-page',
          }).catch(function() {})
          window.api.license.assignPageInstance({
            instanceIp: page.instanceIp,
            purpose:    'multi-campaign-page-' + page.id,
            pageNumber: page.id,
            campaignId: campaignId,
          }).catch(function() {})
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
  }

  const IS = {
    width:'100%', padding:'8px 11px', border:'1px solid var(--bdr2)',
    borderRadius:'var(--rad)', fontSize:13, background:'var(--bg2)',
    color:'var(--txt)', fontFamily:'var(--font)', outline:'none', boxSizing:'border-box'
  }

  var allCompleted = pages.length > 0 && pages.every(function(p) { return p.status === 'completed' })
  var anyRunning   = pages.some(function(p) { return p.status === 'running' || p.status === 'launching' })

  return (
    <div style={{fontFamily:'var(--font)'}}>
      {/* Header */}
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24, flexWrap:'wrap', gap:12}}>
        <div>
          <h2 style={{fontSize:18, fontWeight:700, margin:0, marginBottom:4}}>🚀 Multi-Page Campaign</h2>
          <div style={{fontSize:12, color:'var(--txt3)'}}>
            Send same template via different IPs and recipient lists simultaneously — max 4 pages
          </div>
        </div>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <Button variant="ghost" size="sm" onClick={function() { setActivePage('campaigns') }}>← Back</Button>
          {!anyRunning && pages.length < MAX_PAGES && (
            <Button
              variant="ghost"
              size="sm"
              onClick={addPage}
              disabled={slots && !canAddPage()}
              style={{ opacity: (slots && !canAddPage()) ? 0.5 : 1, cursor: (slots && !canAddPage()) ? 'not-allowed' : 'pointer' }}>
              + Add Page
            </Button>
          )}
          {!anyRunning && !allCompleted && (
            <Button variant="primary" loading={launching} onClick={handleLaunchAll} disabled={!canLaunch()}>
              🚀 Launch All {pages.length} Page{pages.length > 1 ? 's' : ''}
            </Button>
          )}
          {allCompleted && (
            <div style={{padding:'8px 16px', background:'var(--gr-l)', border:'1px solid var(--gr)',
              borderRadius:'var(--rad)', fontSize:13, color:'var(--gr)', fontWeight:600}}>
              ✅ All pages completed!
            </div>
          )}
        </div>
      </div>

      {/* Template — shared */}
      <div style={{background:'var(--bg2)', border:'1px solid var(--bdr)', borderRadius:'var(--rad-l)', padding:20, marginBottom:20}}>
        <div style={{fontWeight:600, fontSize:13, marginBottom:14, display:'flex', alignItems:'center', gap:8}}>
          📝 Email Template
          <span style={{fontSize:11, color:'var(--txt3)', fontWeight:400}}>(shared across all pages)</span>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={{fontSize:12, fontWeight:600, color:'var(--txt2)', display:'block', marginBottom:5}}>Subject Line *</label>
            <input value={template.subject}
              onChange={function(e) { setTemplate(function(t) { return Object.assign({}, t, { subject: e.target.value }) }) }}
              placeholder="Enter subject line..." style={IS} disabled={anyRunning} />
          </div>
          <div>
            <label style={{fontSize:12, fontWeight:600, color:'var(--txt2)', display:'block', marginBottom:5}}>From Name</label>
            <input value={template.fromName}
              onChange={function(e) { setTemplate(function(t) { return Object.assign({}, t, { fromName: e.target.value }) }) }}
              placeholder="Your Company Name" style={IS} disabled={anyRunning} />
          </div>
        </div>
        <div>
          <label style={{fontSize:12, fontWeight:600, color:'var(--txt2)', display:'block', marginBottom:5}}>HTML Body *</label>
          <textarea value={template.html_body}
            onChange={function(e) { setTemplate(function(t) { return Object.assign({}, t, { html_body: e.target.value }) }) }}
            rows={5} placeholder="Paste your HTML email here..."
            style={Object.assign({}, IS, { resize:'vertical', fontFamily:'monospace', fontSize:12 })} disabled={anyRunning} />
        </div>
      </div>

      {/* Slots banner */}
      {slots && (
        <div style={{
          padding: '8px 14px',
          background: slots.remaining === 0 ? 'rgba(239,68,68,0.1)' : 'rgba(21,101,255,0.08)',
          border: '1px solid ' + (slots.remaining === 0 ? '#EF4444' : 'rgba(21,101,255,0.25)'),
          borderRadius: 8,
          fontSize: 12,
          color: slots.remaining === 0 ? '#EF4444' : '#60a5fa',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          {slots.remaining === 0
            ? '⚠️ Instance limit reached. You have used all ' + slots.maxAllowed + ' instance slots on your ' + slots.planLabel + ' plan.'
            : '📊 Instance slots: ' + slots.totalUsed + ' used / ' + slots.maxAllowed + ' total · ' + slots.remaining + ' remaining'
          }
        </div>
      )}

      {/* Page tabs */}
      <div style={{display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center'}}>
        {pages.map(function(p) {
          var tabColor = p.status==='completed'?'var(--gr)':p.status==='failed'?'var(--re)':p.status==='running'||p.status==='launching'?'#F39C12':'var(--txt2)'
          return (
            <button key={p.id} onClick={function() { setActiveTab(p.id) }}
              style={{padding:'8px 18px', borderRadius:'var(--rad)', fontSize:13, cursor:'pointer',
                fontFamily:'var(--font)', fontWeight:activeTab===p.id?700:400,
                background:activeTab===p.id?'var(--pu)':'var(--bg2)',
                color:activeTab===p.id?'#fff':tabColor,
                border:activeTab===p.id?'1px solid var(--pu)':'1px solid var(--bdr)'}}>
              Page {p.id}
              {(p.status==='running'||p.status==='launching') ? ' ⏳' : ''}
              {p.status==='completed' ? ' ✅' : ''}
              {p.status==='failed'    ? ' ❌' : ''}
            </button>
          )
        })}
      </div>

      {/* Active page config */}
      {pages.filter(function(p) { return p.id === activeTab }).map(function(page) {
        var pct       = page.total > 0 ? Math.round((page.sent / page.total) * 100) : 0
        var isRunning = page.status === 'running' || page.status === 'launching'

        return (
          <div key={page.id} style={{background:'var(--bg2)', border:'1px solid var(--bdr)', borderRadius:'var(--rad-l)', padding:20}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
              <div style={{fontWeight:600, fontSize:14}}>
                Page {page.id} Configuration
                {page.instanceIp && (
                  <span style={{marginLeft:10, fontSize:12, color:'var(--gr)', fontWeight:400}}>● {page.instanceIp}</span>
                )}
              </div>
              {!isRunning && pages.length > 1 && page.status === 'idle' && (
                <button onClick={function() { removePage(page.id) }}
                  style={{padding:'5px 10px', background:'#3A1A1A', border:'1px solid var(--re)',
                    borderRadius:'var(--rad)', color:'var(--re)', fontSize:12, cursor:'pointer'}}>
                  Remove Page
                </button>
              )}
            </div>

            {/* 3-column config */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, marginBottom:16}}>

              {/* Recipients */}
              <div style={{background:'var(--bg)', border:'1px solid var(--bdr)', borderRadius:'var(--rad)', padding:14}}>
                <div style={{fontWeight:600, fontSize:12, marginBottom:10, color:'var(--txt2)'}}>👥 Recipients CSV</div>
                <div onClick={isRunning ? null : function() { handlePickContacts(page.id) }}
                  style={{border:'2px dashed var(--bdr2)', borderRadius:'var(--rad)', padding:16,
                    textAlign:'center', cursor:isRunning?'not-allowed':'pointer'}}>
                  {page.contacts > 0 ? (
                    <div>
                      <div style={{fontSize:22, marginBottom:4}}>✅</div>
                      <div style={{fontSize:12, fontWeight:600}}>{page.contacts.toLocaleString()} contacts</div>
                      {!isRunning && <div style={{fontSize:11, color:'var(--txt3)', marginTop:2}}>Click to change</div>}
                    </div>
                  ) : (
                    <div>
                      <div style={{fontSize:24, marginBottom:4}}>📤</div>
                      <div style={{fontSize:12, fontWeight:600}}>Upload CSV</div>
                      <div style={{fontSize:11, color:'var(--txt3)'}}>email, name, address</div>
                    </div>
                  )}
                </div>
              </div>

              {/* SMTP */}
              <div style={{background:'var(--bg)', border:'1px solid var(--bdr)', borderRadius:'var(--rad)', padding:14}}>
                <div style={{fontWeight:600, fontSize:12, marginBottom:10, color:'var(--txt2)'}}>📧 SMTP CSV</div>
                <div onClick={isRunning ? null : function() { handlePickSmtp(page.id) }}
                  style={{border:'2px dashed var(--bdr2)', borderRadius:'var(--rad)', padding:16,
                    textAlign:'center', cursor:isRunning?'not-allowed':'pointer'}}>
                  {page.smtpAccounts.length > 0 ? (
                    <div>
                      <div style={{fontSize:22, marginBottom:4}}>✅</div>
                      <div style={{fontSize:12, fontWeight:600}}>{page.smtpAccounts.length} accounts</div>
                      {!isRunning && <div style={{fontSize:11, color:'var(--txt3)', marginTop:2}}>Click to change</div>}
                    </div>
                  ) : (
                    <div>
                      <div style={{fontSize:24, marginBottom:4}}>📋</div>
                      <div style={{fontSize:12, fontWeight:600}}>Upload SMTP CSV</div>
                      <div style={{fontSize:11, color:'var(--txt3)'}}>email, app_password</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Instance IP */}
              <div style={{background:'var(--bg)', border:'1px solid var(--bdr)', borderRadius:'var(--rad)', padding:14}}>
                <div style={{fontWeight:600, fontSize:12, marginBottom:10, color:'var(--txt2)'}}>🖥 Sending IP</div>
                {isRunning ? (
                  <div style={{padding:'10px', textAlign:'center'}}>
                    <div style={{fontSize:14, fontWeight:700, color:'var(--gr)', fontFamily:'monospace'}}>{page.instanceIp}</div>
                    <div style={{fontSize:11, color:'var(--txt3)', marginTop:4}}>Sending in progress...</div>
                  </div>
                ) : (
                  <InstanceSelector
                    value={page.instanceIp}
                    onChange={function(ip) {
                      // Prevent selecting an IP already used by another page
                      var usedByOtherPage = pages.filter(function(p) {
                        return p.id !== page.id && p.instanceIp === ip
                      }).length > 0
                      if (usedByOtherPage) {
                        addToast('This instance is already selected by another page. Each page must use a different instance.', 'error')
                        return
                      }

                      // Check slot limit for a genuinely new IP selection
                      var prevIp    = page.instanceIp
                      var isNewIp   = ip && ip !== prevIp
                      var hadIp     = !!prevIp
                      if (isNewIp && !hadIp && slots) {
                        var wouldUse = slots.totalUsed + 1
                        if (wouldUse > slots.maxAllowed) {
                          addToast(
                            'Cannot select this instance. Plan limit of ' + slots.maxAllowed + ' reached (' + slots.planLabel + ').',
                            'error'
                          )
                          return
                        }
                      }

                      updatePage(page.id, { instanceIp: ip })
                      loadSlots()
                    }}
                    instances={instances}
                    pageId={page.id}
                    onRefresh={loadInstances}
                    selectedIps={pages.filter(function(p) { return p.id !== page.id }).map(function(p) { return p.instanceIp }).filter(Boolean)}
                  />
                )}
              </div>
            </div>

            {/* Progress */}
            {isRunning && (
              <div style={{marginTop:8}}>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--txt2)', marginBottom:4}}>
                  <span>Sending via {page.instanceIp}...</span>
                  <span>{pct}% — {page.sent}/{page.total}</span>
                </div>
                <div style={{background:'var(--bdr)', borderRadius:4, height:10, overflow:'hidden'}}>
                  <div style={{background:'var(--pu)', height:'100%', borderRadius:4,
                    width:pct+'%', transition:'width 0.5s ease'}} />
                </div>
                <div style={{display:'flex', gap:16, marginTop:8, fontSize:12}}>
                  <span style={{color:'var(--gr)'}}>✅ Sent: {page.sent}</span>
                  <span style={{color:'var(--re)'}}>❌ Failed: {page.failed}</span>
                  <span style={{color:'var(--txt3)'}}>📊 Total: {page.total}</span>
                </div>
              </div>
            )}

            {page.status === 'completed' && (
              <div style={{marginTop:8, padding:'12px 16px', background:'var(--gr-l)',
                border:'1px solid var(--gr)', borderRadius:'var(--rad)', fontSize:13, color:'var(--gr)', fontWeight:600}}>
                ✅ Page {page.id} completed — {page.sent} sent, {page.failed} failed via {page.instanceIp}
              </div>
            )}

            {page.status === 'failed' && (
              <div style={{marginTop:8, padding:'12px 16px', background:'var(--re-l)',
                border:'1px solid var(--re)', borderRadius:'var(--rad)', fontSize:13, color:'var(--re)'}}>
                ❌ Page {page.id} failed: {page.error || 'Unknown error'}
              </div>
            )}
          </div>
        )
      })}

      {/* Summary bar */}
      {pages.some(function(p) { return p.status !== 'idle' }) && (
        <div style={{marginTop:16, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12}}>
          {pages.map(function(p) {
            var pct2 = p.total > 0 ? Math.round((p.sent / p.total) * 100) : 0
            return (
              <div key={p.id} style={{background:'var(--bg2)', border:'1px solid var(--bdr)',
                borderRadius:'var(--rad)', padding:'12px 16px'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
                  <span style={{fontWeight:600, fontSize:13}}>Page {p.id}</span>
                  <span style={{fontSize:11, fontWeight:700,
                    color:p.status==='completed'?'var(--gr)':p.status==='failed'?'var(--re)':p.status==='running'||p.status==='launching'?'#F39C12':'var(--txt3)'}}>
                    {p.status==='completed'?'✅ Done':p.status==='failed'?'❌ Failed':p.status==='running'||p.status==='launching'?'⏳ Running':'⏸ Idle'}
                  </span>
                </div>
                <div style={{fontSize:11, color:'var(--txt3)', marginBottom:6, fontFamily:'monospace'}}>{p.instanceIp || '—'}</div>
                {p.total > 0 && (
                  <div>
                    <div style={{background:'var(--bdr)', borderRadius:3, height:4, overflow:'hidden', marginBottom:4}}>
                      <div style={{background:'var(--pu)', height:'100%', width:pct2+'%', transition:'width 0.5s'}} />
                    </div>
                    <div style={{fontSize:11, color:'var(--txt2)'}}>{p.sent}/{p.total} ({pct2}%)</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
