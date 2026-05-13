const { ipcMain, BrowserWindow } = require('electron')
const { v4: uuid } = require('uuid')
const nodemailer = require('nodemailer')
const db = require('../../database/db')
const { getSmtpConfig, isQuotaError } = require('./customSmtp')
const { getTrackingUrl } = require('./tracking')
const http  = require('http')
const https = require('https')

function httpRequest(url, method, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const urlObj  = new URL(url)
    const isHttps = urlObj.protocol === 'https:'
    const mod     = isHttps ? https : http
    const bodyStr = body ? JSON.stringify(body) : null
    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (isHttps ? 443 : 80),
      path:     urlObj.pathname + (urlObj.search || ''),
      method:   method || 'GET',
      headers:  Object.assign(
        { 'Content-Type': 'application/json' },
        bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {},
        extraHeaders || {}
      ),
      rejectUnauthorized: false,
    }
    const req = mod.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          resolve({
            ok:     res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json:   () => JSON.parse(data),
          })
        } catch (e) {
          reject(new Error('Invalid JSON response: ' + data.substring(0, 100)))
        }
      })
    })
    req.on('error',   (e) => reject(new Error('Network error: ' + e.message)))
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout after 15s')) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// Railway tracking server — set this after deploying
const RAILWAY_TRACKING_URL = 'https://mailflow-tracking-server-production.up.railway.app'
const TRACKING_ADMIN_KEY   = 'mailflow-admin-2026'

async function registerJobsWithTrackingServer(jobs) {
  try {
    const url = RAILWAY_TRACKING_URL
    if (!url || url.includes('localhost')) return

    const payload = jobs.map(j => ({ id: j.id, campaignId: j.campaign_id, email: j.email }))

    const res = await httpRequest(url + '/api/jobs/register', 'POST', { jobs: payload }, { 'x-admin-key': TRACKING_ADMIN_KEY })

    if (res.ok) {
      const data = res.json()
      console.log(`[Tracking] Registered ${data.registered} jobs with Railway server`)
    }
  } catch (err) {
    console.log('[Tracking] Could not register jobs with Railway server:', err.message)
  }
}

function getActiveTrackingUrl() {
  return RAILWAY_TRACKING_URL || getTrackingUrl()
}

const runningCampaigns = new Map()

const PROVIDER_LIMITS = {
  'gmail.com':        15,
  'googlemail.com':   15,
  'outlook.com':      10,
  'hotmail.com':      10,
  'live.com':         10,
  'msn.com':          10,
  'icloud.com':       10,
  'me.com':           10,
  'mac.com':          10,
  'yahoo.com':        10,
  'yahoo.co.in':      10,
  'zoho.com':         20,
  'default':          10,
}

function getProviderLimit(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase() || ''
  return PROVIDER_LIMITS[domain] || PROVIDER_LIMITS['default']
}

const CAMPAIGN_TEST_EMAILS = [
  'ajaygoel999@gmail.com',
  'rajgoel8477@gmail.com',
  'test@ajaygoel.org',
  'me@dropboxslideshow.com',
]

class SmtpRotationManager {
  constructor(servers) {
    this.pool = servers.map((s, i) => {
      const email = s.email || ''
      const limit = getProviderLimit(email)
      return {
        server:       s,
        id:           email || s.id || `smtp-${i}`,
        status:       'active',
        sentCount:    0,
        errorCount:   0,
        perMinLimit:  limit,
        sentThisMin:  0,
        windowStart:  Date.now(),
      }
    })
    this.index = 0
  }

  _isWithinLimit(entry) {
    const now = Date.now()
    if (now - entry.windowStart >= 60000) {
      entry.sentThisMin = 0
      entry.windowStart = now
    }
    return entry.sentThisMin < entry.perMinLimit
  }

  getNext() {
    const active = this.pool.filter(s => s.status === 'active')
    if (active.length === 0) return null
    if (this.index >= active.length) this.index = 0
    const entry = active[this.index % active.length]
    this.index = (this.index + 1) % active.length
    return entry
  }

  nextAvailableIn() {
    const active = this.pool.filter(s => s.status === 'active')
    if (active.length === 0) return 0
    const now = Date.now()
    let minWait = Infinity
    for (const e of active) {
      if (this._isWithinLimit(e)) return 0
      const wait = 60000 - (now - e.windowStart)
      if (wait < minWait) minWait = wait
    }
    return Math.max(0, minWait)
  }

  markSuccess(id) {
    const e = this.pool.find(s => s.id === id)
    if (e) {
      e.sentCount++
      e.sentThisMin++
      e.errorCount = 0
      console.log(`[SMTP] ${id} sent ${e.sentCount} total (${e.sentThisMin}/${e.perMinLimit} this min)`)
    }
  }

  markFailure(id, error, isQuota) {
    const e = this.pool.find(s => s.id === id)
    if (!e) return
    e.lastError = error
    if (isQuota) {
      e.status = 'quota_exceeded'
      console.log('[SMTP Pool] ' + id + ' quota exceeded — REMOVED from pool')
      this.index = 0
      return
    }
    e.errorCount = (e.errorCount || 0) + 1
    if (e.errorCount >= 3) {
      e.status = 'failed'
      console.log('[SMTP Pool] ' + id + ' failed 3 times — REMOVED from pool')
      this.index = 0
    }
  }

  activeCount() { return this.pool.filter(s => s.status === 'active').length }

  getStats() {
    return {
      active:        this.pool.filter(s => s.status === 'active').length,
      failed:        this.pool.filter(s => s.status === 'failed').length,
      quotaExceeded: this.pool.filter(s => s.status === 'quota_exceeded').length,
      total:         this.pool.length,
      details:       this.pool.map(e => ({
        id:      e.id,
        status:  e.status,
        sent:    e.sentCount,
        thisMin: e.sentThisMin,
        limit:   e.perMinLimit,
      }))
    }
  }
}

function registerSendingHandlers() {

  ipcMain.handle('sending:start', async (_, campaignId) => {
    console.log('[Mailflow] sending:start called for campaign:', campaignId)
    console.log('[Mailflow] Active campaigns:', runningCampaigns.size)

    const existing = runningCampaigns.get(campaignId)
    if (existing && existing.paused === false && existing.cancelled === false) {
      console.log('[Mailflow] Campaign already actively running, skipping')
      return { success: false, error: 'Campaign already running' }
    }
    if (existing) {
      console.log('[Mailflow] Cleaning up stale campaign state before restart')
      runningCampaigns.delete(campaignId)
    }

    return startCampaign(campaignId)
  })

  ipcMain.handle('sending:pause', (_, campaignId) => {
    const state = runningCampaigns.get(campaignId)
    if (state) { state.paused = true; db.get().prepare(`UPDATE campaigns SET status='paused' WHERE id=?`).run(campaignId) }
    return { success: true }
  })

  ipcMain.handle('sending:resume', (_, campaignId) => {
    const state = runningCampaigns.get(campaignId)
    if (state) {
      state.paused = false
      db.get().prepare(`UPDATE campaigns SET status='running' WHERE id=?`).run(campaignId)
      processBatch(campaignId)
    }
    return { success: true }
  })

  ipcMain.handle('sending:cancel', (_, campaignId) => {
    const state = runningCampaigns.get(campaignId)
    if (state) { state.cancelled = true; runningCampaigns.delete(campaignId) }
    db.get().prepare(`UPDATE campaigns SET status='cancelled' WHERE id=?`).run(campaignId)
    return { success: true }
  })

  ipcMain.handle('sending:test', async (_, { campaignId, testEmails, serverId, customSmtpAccount }) => {
    const database = db.get()
    const campaign = database.prepare(`
      SELECT c.*, t.html_body, t.subject, t.from_name
      FROM campaigns c LEFT JOIN templates t ON c.template_id = t.id WHERE c.id = ?
    `).get(campaignId)
    if (!campaign) return { success: false, error: 'Campaign not found' }

    let server = customSmtpAccount
      ? buildCustomSmtpServer(customSmtpAccount)
      : database.prepare('SELECT * FROM servers WHERE id = ?').get(serverId)
    if (!server) return { success: false, error: 'No server available' }

    const results = []
    for (const email of testEmails) {
      try {
        await deliverEmail(server, {
          to: email, subject: `[TEST] ${campaign.subject}`,
          html: campaign.html_body,
          from: `${campaign.from_name || 'Mailflow'} <${server.from_email || server.email}>`,
        })
        results.push({ email, success: true })
      } catch (err) {
        results.push({ email, success: false, error: err.message })
      }
    }
    return { success: true, results }
  })

  ipcMain.handle('sending:queueStatus', (_, campaignId) => {
    const database = db.get()
    const stats = database.prepare(`SELECT status, COUNT(*) as count FROM email_jobs WHERE campaign_id=? GROUP BY status`).all(campaignId)
    const map = {}
    stats.forEach(s => { map[s.status] = s.count })
    const state = runningCampaigns.get(campaignId)
    return {
      pending: map.pending || 0, sending: map.sending || 0,
      sent: map.sent || 0, failed: map.failed || 0, retrying: map.retrying || 0,
      total: Object.values(map).reduce((a, b) => a + b, 0),
      smtp: state?.rotation?.getStats() || {},
    }
  })

  // ── FIXED: Export CSV with real data ─────────────────────────────────────
  ipcMain.handle('sending:exportResults', async (_, campaignId, type) => {
    const { dialog } = require('electron')
    const fs = require('fs')
    const database = db.get()

    // Map type to actual DB status
    const statusMap = { successful: 'sent', failed: 'failed', pending: 'pending' }
    const status = statusMap[type] || type

    // Fetch real data with contact info
    const jobs = database.prepare(`
      SELECT j.id, j.email, j.status, j.attempts, j.error, j.sent_at,
             c.name, c.address, c.custom_fields
      FROM email_jobs j
      LEFT JOIN contacts c ON j.contact_id = c.id
      WHERE j.campaign_id=? AND j.status=?
      ORDER BY j.created_at ASC
    `).all(campaignId, status)

    console.log('[Export] Found', jobs.length, 'rows for status:', status)

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${type}-emails-${Date.now()}.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    })
    if (!filePath) return { cancelled: true }

    const lines = ['email,name,address,status,attempts,error_reason,sent_at']
    jobs.forEach(j => {
      const name    = (j.name    || '').replace(/,/g, ' ')
      const address = (j.address || '').replace(/,/g, ' ')
      const error   = (j.error   || '').replace(/,/g, ' ').replace(/\n/g, ' ').substring(0, 200)
      lines.push([j.email, name, address, j.status, j.attempts || 0, error, j.sent_at || ''].join(','))
    })

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
    return { success: true, count: jobs.length, filePath }
  })

  // Workaround: contacts.js is obfuscated — expose getPreviewFull from here
  ipcMain.handle('contacts:getPreviewFull', (_, listId, limit = 200) => {
    const database = db.get()
    return database.prepare(`
      SELECT email, name, address, unique_id, status FROM contacts
      WHERE list_id = ? LIMIT ?
    `).all(listId, limit)
  })

  ipcMain.handle('sending:testCampaign', async (_, campaignData) => {
    const { html, subject, fromName, fromEmail, serverConfig, customSmtpAccount, awsConfig } = campaignData
    let server
    if (awsConfig && awsConfig.accessKeyId) {
      const { decryptCredential } = require('./crypto')
      const rawKey    = awsConfig.accessKeyId    || ''
      const rawSecret = awsConfig.secretAccessKey || ''
      const accessKeyId      = rawKey.includes(':')    ? decryptCredential(rawKey)    : rawKey
      const secretAccessKey  = rawSecret.includes(':') ? decryptCredential(rawSecret) : rawSecret
      server = { type: 'api', provider: 'ses', api_key: accessKeyId, password: secretAccessKey,
                 region: awsConfig.region || 'us-east-1', from_email: awsConfig.fromEmail, email: awsConfig.fromEmail }
    } else if (customSmtpAccount) {
      server = buildCustomSmtpServer(customSmtpAccount)
    } else if (serverConfig) {
      server = serverConfig
    } else {
      return { success: false, error: 'No server configured' }
    }
    const results = []
    for (const testEmail of CAMPAIGN_TEST_EMAILS) {
      const startTime = Date.now()
      try {
        const finalHtml    = html || '<p>Test email from Mailflow</p>'
        const finalSubject = subject || 'Test Campaign Email'
        const fromAddr = fromName
          ? `${fromName} <${fromEmail || server.from_email || server.email}>`
          : (fromEmail || server.from_email || server.email || '')
        await deliverEmail(server, {
          to: testEmail, from: fromAddr,
          subject: '[TEST] ' + finalSubject, html: finalHtml,
          text: finalHtml.replace(/<[^>]+>/g, ''),
        })
        results.push({ email: testEmail, status: 'sent', latency: Date.now() - startTime })
      } catch (err) {
        results.push({ email: testEmail, status: 'failed', error: err.message, latency: Date.now() - startTime })
      }
    }
    const sent   = results.filter(r => r.status === 'sent').length
    const failed = results.filter(r => r.status === 'failed').length
    return { success: true, results, sent, failed, total: results.length }
  })

  ipcMain.handle('sending:runTestCampaign', async (_, campaignData) => {
    const { subject, fromName, html, sendMode, serverId, smtpEmail, smtpPass, awsKey, awsSecret, awsRegion, awsFrom, csvAccounts } = campaignData
    const database = db.get()

    const LICENSE_SERVER_URL = 'https://mailflow-license-server-production.up.railway.app'

    // Fetch test accounts from license server
    let testEmails = []
    try {
      const res = await httpRequest(LICENSE_SERVER_URL + '/api/user/test-accounts', 'POST', { licenseKey: global._mailflowLicenseKey || '' })
      if (res.ok) {
        const data = res.json()
        testEmails = (data.accounts || []).map(a => a.email)
      }
    } catch (err) {
      console.log('[TestCampaign] Could not fetch test accounts:', err.message)
    }

    if (testEmails.length === 0) {
      return { success: false, error: 'No test accounts available. Ask admin to configure test accounts.' }
    }

    // Build server config
    let server
    if (sendMode === 'aws_ses') {
      server = { type: 'api', provider: 'ses', api_key: awsKey, password: awsSecret, region: awsRegion || 'us-east-1', from_email: awsFrom, email: awsFrom }
    } else if (sendMode === 'custom_smtp') {
      server = buildCustomSmtpServer({ email: smtpEmail, app_password: smtpPass })
    } else if (sendMode === 'csv_smtp') {
      if (!csvAccounts || csvAccounts.length === 0) return { success: false, error: 'No SMTP accounts in CSV' }
      server = buildCustomSmtpServer(csvAccounts[0])
    } else {
      server = database.prepare('SELECT * FROM servers WHERE id = ?').get(serverId)
    }

    if (!server) return { success: false, error: 'No server configured' }

    const sessionId   = require('crypto').randomBytes(8).toString('hex')
    const fromEmail   = server.from_email || server.email || ''
    const fromAddress = fromName ? `${fromName} <${fromEmail}>` : fromEmail

    // Send to all test accounts
    const results = []
    for (const testEmail of testEmails) {
      const start = Date.now()
      try {
        await deliverEmail(server, {
          to:      testEmail,
          from:    fromAddress,
          subject: '[INBOX TEST] ' + subject,
          html:    html,
          text:    html.replace(/<[^>]+>/g, ''),
          headers: { 'X-Mailflow-Test-Session': sessionId },
        })
        results.push({ email: testEmail, status: 'sent', latency: Date.now() - start })
        console.log('[TestCampaign] ✅ Sent to', testEmail)
      } catch (err) {
        results.push({ email: testEmail, status: 'failed', error: err.message, latency: Date.now() - start })
        console.log('[TestCampaign] ❌ Failed:', testEmail, err.message)
      }
    }

    // Register session with license server for IMAP checking
    try {
      await httpRequest(LICENSE_SERVER_URL + '/api/user/test-sessions', 'POST', {
        sessionId,
        subject:    '[INBOX TEST] ' + subject,
        sentTo:     results.filter(r => r.status === 'sent').map(r => r.email),
        licenseKey: global._mailflowLicenseKey || '',
      })
    } catch (err) {
      console.log('[TestCampaign] Could not register session:', err.message)
    }

    return {
      success:  true,
      sessionId,
      results,
      sent:   results.filter(r => r.status === 'sent').length,
      failed: results.filter(r => r.status === 'failed').length,
      total:  results.length,
    }
  })
}

function buildCustomSmtpServer(account) {
  const config = getSmtpConfig(account.email)
  const port   = account.port || config?.port || 587
  console.log(`[buildCustomSmtpServer] email=${account.email} host=${account.host || config?.host} passLen=${(account.app_password||account.password||'').length}`)
  return {
    type:         'smtp',
    host:         account.host || config?.host || ('smtp.' + account.email.split('@')[1]),
    port:         port,
    secure:       account.secure || port === 465,
    encryption:   port === 465 ? 'ssl' : 'tls',
    email:        account.email,
    from_email:   account.email,
    password:     account.app_password || account.password || '',
    name:         account.email,
    daily_limit:  500,
    per_min_limit: 15,
    _isCustom:    true,
  }
}

async function startCampaign(campaignId) {
  console.log('[Mailflow] Active campaigns:', runningCampaigns.size)
  const database = db.get()

  const campaign = database.prepare(`
    SELECT c.*, t.html_body, t.subject, t.from_name, t.text_body,
           COALESCE(t.attachments, '[]') as attachments
    FROM campaigns c LEFT JOIN templates t ON c.template_id = t.id WHERE c.id = ?
  `).get(campaignId)
  if (!campaign) return { success: false, error: 'Campaign not found' }

  const contacts = database.prepare("SELECT * FROM contacts WHERE list_id=? AND status='valid'").all(campaign.contact_list_id)
  if (contacts.length === 0) return { success: false, error: 'No valid contacts' }

  // ── CHECK IF USER HAS AN ASSIGNED AGENT INSTANCE ────────────────
  const assignedInstance = global._mailflowAssignedInstance
  if (assignedInstance && assignedInstance.ip && assignedInstance.agentToken) {
    console.log('[Mailflow] Agent instance detected:', assignedInstance.ip)
    console.log('[Mailflow] Routing campaign through agent...')
    return startCampaignViaAgent(campaignId, campaign, contacts, assignedInstance)
  }
  // ── NO AGENT — SEND LOCALLY AS BEFORE ───────────────────────────
  console.log('[Mailflow] No agent assigned — sending locally')
  return startCampaignLocal(campaignId, campaign, contacts, database)
}

async function sendViaAgent(agentIp, agentPort, agentToken, jobData) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(jobData)
    const options = {
      hostname: agentIp,
      port:     agentPort || 3000,
      path:     '/send',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-agent-token':  agentToken || 'mailflow-agent-2026',
      },
      timeout: 30000,
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('Invalid response from agent')) }
      })
    })
    req.on('error',   reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Agent connection timeout')) })
    req.write(body)
    req.end()
  })
}

async function getAgentStatus(agentIp, agentPort, agentToken, jobId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: agentIp,
      port:     agentPort || 3000,
      path:     '/status/' + jobId,
      method:   'GET',
      headers:  { 'x-agent-token': agentToken || 'mailflow-agent-2026' },
      timeout:  10000,
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error('Invalid response')) }
      })
    })
    req.on('error',   reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.end()
  })
}

async function startCampaignViaAgent(campaignId, campaign, contacts, instance) {
  const database   = db.get()
  const agentIp    = instance.ip
  const agentPort  = instance.agentPort  || 3000
  const agentToken = instance.agentToken || 'mailflow-agent-2026'
  const jobId      = campaignId + '-' + Date.now()

  let smtpCsv  = null
  let smtpList = null
  const sending_mode = campaign.sending_mode || 'existing_server'
  let customSmtpList = []
  try { customSmtpList = JSON.parse(campaign.custom_smtp_list || '[]') } catch {}

  if (sending_mode === 'custom_smtp' && customSmtpList.length > 0) {
    const validAccounts = customSmtpList.filter(a => a.email && (a.app_password || a.password) && a.working !== false)
    smtpCsv = validAccounts.map(a => a.email + ',' + (a.app_password || a.password)).join('\n')
  } else {
    let serverIds = campaign.server_ids || '[]'
    try { serverIds = JSON.parse(serverIds) } catch { serverIds = [] }
    if (serverIds.length > 0) {
      const servers = database.prepare('SELECT * FROM servers WHERE id IN (' + serverIds.map(() => '?').join(',') + ')').all(...serverIds)
      smtpList = servers.filter(s => s.type === 'smtp').map(s => ({
        email:    s.email,
        password: s.password,
        host:     s.host,
        port:     s.port || 587,
      }))
    }
  }

  if ((!smtpCsv || smtpCsv.length === 0) && (!smtpList || smtpList.length === 0)) {
    return { success: false, error: 'No SMTP accounts available for agent sending' }
  }

  database.prepare("UPDATE campaigns SET status='running', started_at=datetime('now'), total_recipients=?, sent_count=0, failed_count=0 WHERE id=?")
    .run(contacts.length, campaignId)

  runningCampaigns.set(campaignId, {
    paused: false, cancelled: false,
    mode: 'agent', agentIp, agentPort, agentToken, jobId,
    campaign, totalContacts: contacts.length
  })

  try {
    const result = await sendViaAgent(agentIp, agentPort, agentToken, {
      jobId,
      contacts:  contacts.map(c => ({ email: c.email, name: c.name || '', address: c.address || '', unique_id: c.unique_id || '' })),
      subject:   campaign.subject   || '',
      fromName:  campaign.from_name || '',
      htmlBody:  campaign.html_body || '',
      textBody:  campaign.text_body || '',
      smtpCsv,
      smtpList,
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Agent rejected the job' }
    }

    console.log('[Mailflow] Job sent to agent:', agentIp, 'jobId:', jobId)
    pollAgentProgress(campaignId, agentIp, agentPort, agentToken, jobId)

    return { success: true, totalJobs: contacts.length, smtpCount: smtpList?.length || 0, mode: 'agent', agentIp }
  } catch (err) {
    console.error('[Mailflow] Agent connection failed:', err.message)
    console.log('[Mailflow] Falling back to local sending...')
    return startCampaignLocal(campaignId, campaign, contacts, database)
  }
}

async function pollAgentProgress(campaignId, agentIp, agentPort, agentToken, jobId) {
  const database = db.get()
  const POLL_INTERVAL = 3000

  const poll = async () => {
    const state = runningCampaigns.get(campaignId)
    if (!state || state.cancelled) return

    try {
      const status = await getAgentStatus(agentIp, agentPort, agentToken, jobId)

      database.prepare("UPDATE campaigns SET sent_count=?, failed_count=? WHERE id=?")
        .run(status.sent || 0, status.failed || 0, campaignId)

      BrowserWindow.getAllWindows().forEach(w => {
        try {
          w.webContents.send('sending:progress', {
            campaignId,
            sent_count:       status.sent   || 0,
            failed_count:     status.failed || 0,
            total_recipients: status.total  || 0,
            open_count:       0,
            mode:             'agent',
            agentIp,
          })
        } catch {}
      })

      if (status.status === 'completed' || status.status === 'stopped') {
        finalizeCampaign(campaignId)
        return
      }

      setTimeout(poll, POLL_INTERVAL)
    } catch (err) {
      console.error('[Mailflow] Poll error:', err.message)
      setTimeout(poll, POLL_INTERVAL * 2)
    }
  }

  setTimeout(poll, POLL_INTERVAL)
}

async function startCampaignLocal(campaignId, campaign, contacts, database) {
  console.log(`[Mailflow] Starting campaign: ${campaign.name}`)
  console.log(`[Mailflow] ${contacts.length} valid contacts found`)

  let servers = []
  const sending_mode = campaign.sending_mode || 'existing_server'

  let customSmtpList = []
  try { customSmtpList = JSON.parse(campaign.custom_smtp_list || '[]') } catch {}

  if (sending_mode === 'aws_ses') {
    const { decryptCredential } = require('./crypto')
    const rawKey = campaign.aws_access_key || ''
    const rawSecret = campaign.aws_secret_key || ''
    const accessKeyId = rawKey.includes(':') ? decryptCredential(rawKey) : rawKey
    const secretAccessKey = rawSecret.includes(':') ? decryptCredential(rawSecret) : rawSecret

    if (!accessKeyId || !secretAccessKey) {
      return { success: false, error: 'AWS SES credentials missing' }
    }
    servers = [{
      type:         'api',
      provider:     'ses',
      api_key:      accessKeyId,
      password:     secretAccessKey,
      region:       campaign.aws_region || 'us-east-1',
      from_email:   campaign.aws_sender_email || '',
      email:        campaign.aws_sender_email || '',
      name:         'AWS SES',
      daily_limit:  50000,
      per_min_limit: 14,
      _isCustom:    false,
    }]
    console.log(`[Mailflow] AWS SES mode — region: ${campaign.aws_region || 'us-east-1'}, sender: ${campaign.aws_sender_email}`)
  } else if (sending_mode === 'custom_smtp' && customSmtpList.length > 0) {
    const validAccounts = customSmtpList.filter(a =>
      a.working !== false &&
      a.status !== 'failed' &&
      a.status !== 'invalid' &&
      a.status !== 'quota_exceeded' &&
      a.status !== 'timeout' &&
      a.status !== 'disabled' &&
      a.email &&
      (a.app_password || a.password)
    )

    console.log('[Mailflow] Custom SMTP: ' + validAccounts.length + ' valid of ' + customSmtpList.length + ' total')

    if (validAccounts.length === 0) {
      return {
        success: false,
        error: 'No valid SMTP accounts available. Please go back to Step 4 and validate your SMTP accounts first.'
      }
    }

    servers = validAccounts.map(buildCustomSmtpServer)
    console.log('[Mailflow] Built ' + servers.length + ' SMTP server configs')
    servers.forEach((s, i) => console.log(`  [server ${i}] email=${s.email} host=${s.host} port=${s.port} passLen=${(s.password||'').length}`))
  } else {
    let serverIds = campaign.server_ids || '[]'
    if (typeof serverIds === 'string') { try { serverIds = JSON.parse(serverIds) } catch { serverIds = [] } }
    if (!Array.isArray(serverIds)) serverIds = []

    if (serverIds.length > 0) {
      servers = database.prepare(`SELECT * FROM servers WHERE id IN (${serverIds.map(() => '?').join(',')}) AND status='active'`).all(...serverIds)
    } else {
      servers = database.prepare(`SELECT * FROM servers WHERE status='active'`).all()
    }
    console.log(`[Mailflow] Using ${servers.length} configured servers`)
    servers.forEach((s, i) => console.log(`  [server ${i}] email=${s.email} host=${s.host} port=${s.port} passLen=${(s.password||'').length}`))
  }

  if (servers.length === 0) return { success: false, error: 'No active servers available' }

  // Delete old jobs first
  database.prepare(`DELETE FROM email_jobs WHERE campaign_id=?`).run(campaignId)
  database.pragma('foreign_keys = OFF')

  const insertJob = database.prepare(`
    INSERT INTO email_jobs (id, campaign_id, contact_id, email, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', datetime('now'))
  `)

  database.transaction(() => {
    for (const c of contacts) {
      insertJob.run(uuid(), campaignId, c.id, c.email)
    }
  })()

  database.pragma('foreign_keys = ON')

  const jobCount = database.prepare(`SELECT COUNT(*) as cnt FROM email_jobs WHERE campaign_id=?`).get(campaignId)
  console.log(`[Mailflow] Created ${jobCount.cnt} email jobs`)

  const allJobs = database.prepare(`SELECT id, campaign_id, email FROM email_jobs WHERE campaign_id=?`).all(campaignId)
  registerJobsWithTrackingServer(allJobs.slice(0, 1000)).catch(() => {})

  database.prepare(`
    UPDATE campaigns SET status='running', started_at=datetime('now'),
    total_recipients=?, sent_count=0, failed_count=0 WHERE id=?
  `).run(contacts.length, campaignId)

  const rotation = new SmtpRotationManager(servers)
  runningCampaigns.set(campaignId, { paused: false, cancelled: false, campaign, rotation })

  setImmediate(() => {
    processBatch(campaignId).catch(err => {
      console.error('[Mailflow] Fatal error in processBatch:', err)
      finalizeCampaign(campaignId)
    })
  })

  return { success: true, totalJobs: contacts.length, smtpCount: servers.length, validSmtp: servers.length }
}

async function processBatch(campaignId) {
  const BATCH_SIZE     = 10
  const PARALLEL_LIMIT = 5
  const BATCH_DELAY_MS = 100

  const state = runningCampaigns.get(campaignId)
  if (!state) { console.log('[Mailflow] No state found, stopping'); return }

  const database = db.get()
  let totalSent = 0

  console.log(`[Mailflow] processBatch started for campaign ${campaignId}`)

  while (true) {
    if (state.cancelled) { console.log('[Mailflow] Campaign cancelled'); break }
    if (state.paused)    { console.log('[Mailflow] Campaign paused'); return }

    if (state.rotation.activeCount() === 0) {
      console.log('[Mailflow] All SMTPs exhausted')
      finalizeCampaign(campaignId)
      break
    }

    const jobs = database.prepare(`
      SELECT j.id, j.campaign_id, j.contact_id, j.email, j.status,
             j.attempts, j.error, j.next_retry_at,
             COALESCE(c.name, '') as name,
             COALESCE(c.address, '') as address,
             COALESCE(c.custom_fields, '{}') as custom_fields,
             COALESCE(c.unique_id, '') as unique_id
      FROM email_jobs j
      LEFT JOIN contacts c ON j.contact_id = c.id
      WHERE j.campaign_id=? AND j.status IN ('pending','retrying')
        AND (j.next_retry_at IS NULL OR j.next_retry_at <= datetime('now'))
      ORDER BY j.created_at ASC LIMIT ?
    `).all(campaignId, BATCH_SIZE)

    if (jobs.length === 0) {
      const remaining = database.prepare(`
        SELECT COUNT(*) as cnt FROM email_jobs
        WHERE campaign_id=? AND status NOT IN ('sent','failed')
      `).get(campaignId)

      const allJobs = database.prepare(`SELECT COUNT(*) as cnt FROM email_jobs WHERE campaign_id=?`).get(campaignId)
      console.log(`[Mailflow] No pending jobs. Remaining: ${remaining.cnt}, Total: ${allJobs.cnt}`)

      if (remaining.cnt === 0) {
        finalizeCampaign(campaignId)
        break
      }
      await sleep(3000)
      continue
    }

    console.log(`[Mailflow] Processing batch of ${jobs.length} jobs (total sent: ${totalSent})`)

    for (let i = 0; i < jobs.length; i += PARALLEL_LIMIT) {
      if (state.cancelled || state.paused) break
      const chunk = jobs.slice(i, i + PARALLEL_LIMIT)

      const stats = state.rotation.getStats()
      console.log(`[Pool] ${stats.active}/${stats.total} SMTPs active (${stats.failed} failed, ${stats.quotaExceeded} quota)`)

      await Promise.all(chunk.map(async (job) => {
        const smtpEntry = state.rotation.getNext()
        if (!smtpEntry) {
          const waitMs = state.rotation.nextAvailableIn()
          if (waitMs > 0) {
            console.log(`[Mailflow] All SMTPs at rate limit — waiting ${Math.round(waitMs/1000)}s`)
            await sleep(waitMs + 500)
          }
          database.prepare(`UPDATE email_jobs SET status='pending' WHERE id=?`).run(job.id)
          return
        }

        console.log(`[Send] Starting ${job.id} → ${job.email} via ${smtpEntry.id}`)
        const sendStart = Date.now()
        const serverId = smtpEntry.server._isCustom ? null : smtpEntry.id
        database.prepare(`UPDATE email_jobs SET status='sending', server_id=? WHERE id=?`).run(serverId, job.id)

        try {
          const customFields = JSON.parse(job.custom_fields || '{}')

          const recipientData = {
            name:    job.name    || job.email.split('@')[0] || '',
            email:   job.email   || '',
            address: job.address || '',
            st:      job.address || '',
            id:      job.unique_id || '',
          }

          const html    = mergeTemplate(state.campaign.html_body, recipientData)
          const subject = mergeTemplate(state.campaign.subject,   recipientData)

          let templateAttachments = []
          try {
            const rawAtts = JSON.parse(state.campaign.attachments || '[]')
            if (Array.isArray(rawAtts) && rawAtts.length > 0) {
              templateAttachments = await processAttachments(rawAtts)
            }
          } catch(e) {
            console.log('[Send] attachment parse error, sending without attachments:', e.message)
            templateAttachments = []
          }

          const fromEmail   = smtpEntry.server.from_email || smtpEntry.server.email || ''
          const fromName    = state.campaign.from_name || ''
          const fromAddress = fromName ? `${fromName} <${fromEmail}>` : fromEmail

          if (!fromEmail) {
            console.error('[Send] ❌ fromEmail is empty — cannot send. Check server config.')
            database.prepare("UPDATE email_jobs SET status='failed', error='fromEmail is empty' WHERE id=?").run(job.id)
            database.prepare("UPDATE campaigns SET failed_count=failed_count+1 WHERE id=?").run(campaignId)
            return
          }

          const finalHtml   = injectTrackingPixel(html, job.id, getActiveTrackingUrl())
          const plainText   = state.campaign.text_body || generateTextVersion(html)

          const result = await deliverEmail(smtpEntry.server, {
            to:          job.email,
            from:        fromAddress,
            subject:     subject,
            html:        finalHtml,
            text:        plainText,
            attachments: templateAttachments,
          })

          if (!result) throw new Error('deliverEmail returned null — no response from transport')

          state.rotation.markSuccess(smtpEntry.id)
          database.prepare(`UPDATE email_jobs SET status='sent', sent_at=datetime('now'), attempts=attempts+1 WHERE id=?`).run(job.id)
          database.prepare(`UPDATE campaigns SET sent_count=sent_count+1, delivered_count=delivered_count+1 WHERE id=?`).run(campaignId)
          if (smtpEntry.server.id && !smtpEntry.server._isCustom) database.prepare(`UPDATE servers SET sent_today=sent_today+1 WHERE id=?`).run(smtpEntry.server.id)
          totalSent++
          console.log(`[Send] ✅ Sent ${job.email} in ${Date.now() - sendStart}ms`)

        } catch (err) {
          var errMsg = err.message || 'Unknown error'
          var errLow = errMsg.toLowerCase()

          var isQuota    = isQuotaError(errMsg)
          var isInvalid  = errLow.includes('535') || errLow.includes('authentication') ||
                           errLow.includes('invalid login') || errLow.includes('username and password') ||
                           errLow.includes('bad credentials') || errLow.includes('5.7.8')
          var isDisabled = errLow.includes('disabled') || errLow.includes('suspended') ||
                           errLow.includes('blocked') || errLow.includes('not allowed') || errLow.includes('policy')

          var category = isQuota ? 'quota' : isInvalid ? 'auth' : isDisabled ? 'disabled' : 'error'
          console.log(`[Send] ❌ Failed ${job.email} — ${category}: ${errMsg.substring(0, 120)}`)

          if (isQuota) {
            state.rotation.markFailure(smtpEntry.id, errMsg, true)
            database.prepare(`UPDATE email_jobs SET status='pending', server_id=NULL, attempts=0 WHERE id=?`).run(job.id)
            console.log('[Send] Requeued ' + job.email + ' — quota exceeded on ' + smtpEntry.id)
            BrowserWindow.getAllWindows().forEach(w => {
              try { w.webContents.send('sending:smtpQuota', { email: smtpEntry.id, campaignId }) } catch {}
            })
            return
          }

          if (isInvalid || isDisabled) {
            state.rotation.markFailure(smtpEntry.id, errMsg, false)
            database.prepare(`UPDATE email_jobs SET status='pending', server_id=NULL WHERE id=?`).run(job.id)
            return
          }

          var attempts = (job.attempts || 0) + 1
          if (attempts >= 3) {
            state.rotation.markFailure(smtpEntry.id, errMsg, false)
            database.prepare(`UPDATE email_jobs SET status='failed', attempts=?, error=? WHERE id=?`)
              .run(attempts, errMsg.substring(0, 200), job.id)
            database.prepare(`UPDATE campaigns SET failed_count=failed_count+1 WHERE id=?`).run(campaignId)
          } else {
            var retryAt = new Date(Date.now() + 30000).toISOString()
            database.prepare(`UPDATE email_jobs SET status='retrying', attempts=?, error=?, next_retry_at=? WHERE id=?`)
              .run(attempts, errMsg.substring(0, 200), retryAt, job.id)
          }
        }
      }))

      emitProgress(campaignId)
      // Yield event loop between chunks to keep Electron responsive
      await new Promise(resolve => setImmediate(resolve))
    }

    await sleep(BATCH_DELAY_MS)
  }

  console.log(`[Mailflow] processBatch finished. Total sent: ${totalSent}`)
}

function finalizeCampaign(campaignId) {
  try {
    const result = db.get().prepare(`SELECT sent_count, failed_count, total_recipients FROM campaigns WHERE id=?`).get(campaignId)
    console.log(`[Campaign] DONE — sent ${result?.sent_count}, failed ${result?.failed_count} of total ${result?.total_recipients}`)
    db.get().prepare(`UPDATE campaigns SET status='sent', completed_at=datetime('now') WHERE id=?`).run(campaignId)
    runningCampaigns.delete(campaignId)
    BrowserWindow.getAllWindows().forEach(w => {
      try { w.webContents.send('campaign:statusChange', campaignId, 'sent') } catch {}
    })
  } catch (err) {
    console.error('[Mailflow] finalizeCampaign error:', err)
  }
}

function emitProgress(campaignId) {
  try {
    const campaign = db.get().prepare('SELECT sent_count, failed_count, open_count, total_recipients FROM campaigns WHERE id=?').get(campaignId)
    const state    = runningCampaigns.get(campaignId)
    if (!campaign) return
    BrowserWindow.getAllWindows().forEach(w => {
      try {
        w.webContents.send('sending:progress', {
          campaignId, ...campaign,
          smtp: state?.rotation?.getStats() || {}
        })
      } catch {}
    })
  } catch {}
}

async function processAttachments(attachments) {
  if (!attachments || attachments.length === 0) return []
  const result = []
  for (const att of attachments) {
    if (!att.dataUrl) continue
    let content = att.dataUrl.split(',')[1]
    let filename = att.name
    let contentType = att.type || 'application/octet-stream'
    if (att.type === 'image/heic' || att.type === 'image/heif' ||
        filename.toLowerCase().endsWith('.heic') || filename.toLowerCase().endsWith('.heif')) {
      filename = filename.replace(/\.(heic|heif)$/i, '.jpg')
      contentType = 'image/jpeg'
    }
    result.push({ filename, content, encoding: 'base64', contentType })
  }
  return result
}

async function sendViaSes(server, mailOptions) {
  var SESModule = require('@aws-sdk/client-ses')
  var SESClient = SESModule.SESClient
  var SendRawEmailCommand = SESModule.SendRawEmailCommand
  var client = new SESClient({
    region: server.region || 'us-east-1',
    credentials: { accessKeyId: (server.api_key || '').trim(), secretAccessKey: (server.password || '').trim() }
  })
  var atts = mailOptions.attachments || []
  var CRLF = '\r\n'
  var b  = 'mlfw' + Date.now()
  var ba = b + 'alt'
  var raw = ''
  raw += 'From: ' + mailOptions.from + CRLF
  raw += 'To: ' + mailOptions.to + CRLF
  raw += 'Subject: ' + mailOptions.subject + CRLF
  raw += 'MIME-Version: 1.0' + CRLF
  raw += 'Content-Type: multipart/mixed; boundary="' + b + '"' + CRLF + CRLF
  raw += '--' + b + CRLF
  raw += 'Content-Type: multipart/alternative; boundary="' + ba + '"' + CRLF + CRLF
  raw += '--' + ba + CRLF + 'Content-Type: text/plain; charset=UTF-8' + CRLF + CRLF
  raw += (mailOptions.text || '') + CRLF + CRLF
  raw += '--' + ba + CRLF + 'Content-Type: text/html; charset=UTF-8' + CRLF + CRLF
  raw += (mailOptions.html || '') + CRLF + CRLF
  raw += '--' + ba + '--' + CRLF
  for (var i = 0; i < atts.length; i++) {
    var att = atts[i]
    if (!att.content) continue
    var ac = typeof att.content === 'string' ? att.content : att.content.toString('base64')
    raw += '--' + b + CRLF
    raw += 'Content-Type: ' + (att.contentType || 'application/octet-stream') + '; name="' + att.filename + '"' + CRLF
    raw += 'Content-Transfer-Encoding: base64' + CRLF
    raw += 'Content-Disposition: attachment; filename="' + att.filename + '"' + CRLF + CRLF
    raw += ac + CRLF
  }
  raw += '--' + b + '--'
  try {
    return await client.send(new SendRawEmailCommand({ RawMessage: { Data: Buffer.from(raw) } }))
  } catch (err) {
    if (err.name === 'MessageRejected') throw new Error('SES: Message rejected — verify sender email')
    if (err.name === 'ThrottlingException') throw new Error('SES: Rate limit exceeded')
    throw err
  }
}

async function deliverEmail(server, mailOptions) {
  console.log(`[deliverEmail] type=${server.type} host=${server.host} email=${server.email} passLen=${(server.password||'').length}`)
  if (server.type === 'smtp') {
    var crypto = require('crypto')
    var host = server.host || ''
    var isM365    = host.includes('office365.com') || host.includes('microsoft.com')
    var isOutlook = host.includes('outlook.com')
    var isGmail   = host.includes('gmail.com')
    var isMicrosoft = isM365 || isOutlook
    var portNum = parseInt(server.port) || 587
    var isSSL   = server.encryption === 'ssl' || portNum === 465
    var isTLS   = !isSSL && portNum === 587
    var transportConfig = {
      host: host, port: portNum, secure: isSSL, requireTLS: isTLS,
      auth: { user: server.email, pass: server.password },
      debug: true, logger: true,
      connectionTimeout: 25000, greetingTimeout: 20000, socketTimeout: 25000,
      tls: { rejectUnauthorized: false, minVersion: 'TLSv1' }
    }
    if (isMicrosoft) {
      transportConfig.tls.ciphers = [
        'TLS_AES_256_GCM_SHA384','TLS_CHACHA20_POLY1305_SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384','ECDHE-RSA-AES128-GCM-SHA256'
      ].join(':')
    }
    const transporter = nodemailer.createTransport(transportConfig)
    const attachments = mailOptions.attachments || []
    var fromEmail  = server.from_email || server.email || ''
    var fromDomain = fromEmail.split('@')[1] || 'mailflow.app'
    var uniqueRef  = crypto.randomBytes(16).toString('hex')
    var msgId      = mailOptions.messageId || ('<' + Date.now().toString(36) + '.' + crypto.randomBytes(8).toString('hex') + '@' + fromDomain + '>')
    var headers = {
      'Message-ID': msgId, 'Date': new Date().toUTCString(), 'MIME-Version': '1.0',
      'X-Entity-Ref-ID': uniqueRef, 'X-Priority': '3', 'X-MSMail-Priority': 'Normal', 'Importance': 'Normal',
      'List-Unsubscribe': '<mailto:unsubscribe@' + fromDomain + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Precedence': 'bulk',
    }
    if (isMicrosoft) {
      headers['X-Mailer'] = 'Microsoft Outlook 16.0.17928.20156'
      headers['X-MS-Exchange-Organization-SCL'] = '-1'
      headers['X-MS-Has-Attach'] = attachments.length > 0 ? 'yes' : 'no'
      headers['X-MS-TNEF-Correlator'] = ''
      headers['X-MS-Exchange-Organization-AuthAs'] = 'Internal'
      headers['X-MS-Exchange-Organization-AuthMechanism'] = '04'
      headers['X-Auto-Response-Suppress'] = 'DR, OOF, AutoReply'
      headers['Auto-Submitted'] = 'auto-generated'
      headers['X-Microsoft-Antispam'] = 'BCL:0;'
      headers['X-Forefront-Antispam-Report'] = 'SFV:NSPM;'
    }
    if (isGmail) { headers['X-Mailer'] = 'Google Gmail'; headers['X-Google-DKIM-Signature'] = 'bypass' }
    if (!isMicrosoft && !isGmail) headers['X-Mailer'] = 'Mailflow/2.0'
    const mailPayload = {
      from:    mailOptions.from,
      to:      mailOptions.to,
      subject: mailOptions.subject,
      html:    mailOptions.html,
      text:    mailOptions.text || generateTextVersion(mailOptions.html || ''),
      headers: headers,
    }
    if (attachments.length > 0) mailPayload.attachments = attachments
    const result = await transporter.sendMail(mailPayload)
    console.log(`[deliverEmail] sendMail result: ${JSON.stringify({ messageId: result.messageId, response: result.response, accepted: result.accepted, rejected: result.rejected })}`)
    if (result.rejected && result.rejected.length > 0) {
      throw new Error('Recipient rejected by SMTP server: ' + result.rejected.join(', '))
    }
    if (!result.accepted || result.accepted.length === 0) {
      throw new Error('Email not accepted by SMTP server. Response: ' + result.response)
    }
    transporter.close()
    return result
  }
  if (server.type === 'api') {
    if (server.provider === 'sendgrid') {
      const sgMail = require('@sendgrid/mail')
      sgMail.setApiKey(server.api_key)
      return sgMail.send(mailOptions)
    }
    if (server.provider === 'ses') return await sendViaSes(server, mailOptions)
    if (server.provider === 'mailgun') {
      const formData = require('form-data')
      const Mailgun  = require('mailgun.js')
      const mg = new Mailgun(formData)
      const client = mg.client({ username: 'api', key: server.api_key })
      return client.messages.create(server.region || 'mailgun.org', {
        from: mailOptions.from, to: mailOptions.to, subject: mailOptions.subject, html: mailOptions.html
      })
    }
  }
  throw new Error(`Unsupported server type: ${server.type}/${server.provider}`)
}

function mergeTemplate(template, data) {
  if (!template) return ''
  return template
    .replace(/\{\{name\}\}/gi,  data.name    || '')
    .replace(/\{\{email\}\}/gi, data.email   || '')
    .replace(/\{\{st\}\}/gi,    data.address || data.st || '')
    .replace(/\{\{id\}\}/gi,    data.id || '')
    .replace(/\{\{[^}]+\}\}/g,  '')
}

function generateTextVersion(html) {
  if (!html) return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n').replace(/<\/li>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim()
}

function buildMessageId(fromEmail) {
  var domain = fromEmail && fromEmail.includes('@') ? fromEmail.split('@')[1] : 'mailflow.app'
  return '<' + Date.now().toString(36) + '.' + Math.random().toString(36).substring(2) + '@' + domain + '>'
}

function injectTrackingPixel(html, jobId, trackingUrl) {
  if (!html || !jobId) return html
  if (!trackingUrl || !trackingUrl.startsWith('http')) return html
  const pixel = '<img src="' + trackingUrl + '/track/open/' + jobId + '" width="1" height="1" style="display:none" alt="" />'
  if (html.includes('</body>')) return html.replace('</body>', pixel + '</body>')
  if (html.includes('</html>')) return html.replace('</html>', pixel + '</html>')
  return html + pixel
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

module.exports = { registerSendingHandlers, deliverEmail }
