const { ipcMain, BrowserWindow } = require('electron')
const { v4: uuid } = require('uuid')
const nodemailer = require('nodemailer')
const db = require('../../database/db')
const { getSmtpConfig, isQuotaError } = require('./customSmtp')

const runningCampaigns = new Map()

// ── SMTP Rotation Manager with Rate Limiting ─────────────────────────────────
// Default limits per provider (emails per minute)
const PROVIDER_LIMITS = {
  'gmail.com':        15,   // Gmail: ~500/day, ~15/min safe
  'googlemail.com':   15,
  'outlook.com':      10,   // Outlook: ~300/day, ~10/min safe
  'hotmail.com':      10,
  'live.com':         10,
  'msn.com':          10,
  'icloud.com':       10,   // iCloud: ~200/day, ~10/min safe
  'me.com':           10,
  'mac.com':          10,
  'yahoo.com':        10,   // Yahoo: ~500/day, ~10/min safe
  'yahoo.co.in':      10,
  'zoho.com':         20,   // Zoho: higher limits
  'default':          10,   // Unknown: conservative 10/min
}

function getProviderLimit(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase() || ''
  return PROVIDER_LIMITS[domain] || PROVIDER_LIMITS['default']
}

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
        // Rate limiting
        perMinLimit:  limit,           // max emails per minute
        sentThisMin:  0,               // sent in current minute window
        windowStart:  Date.now(),      // when current window started
      }
    })
    this.index = 0
  }

  // Check if SMTP is within its rate limit
  _isWithinLimit(entry) {
    const now = Date.now()
    // Reset counter if minute window has passed
    if (now - entry.windowStart >= 60000) {
      entry.sentThisMin = 0
      entry.windowStart = now
    }
    return entry.sentThisMin < entry.perMinLimit
  }

  // Get next available SMTP that is active AND within rate limit
  getNext() {
    const active = this.pool.filter(s => s.status === 'active')
    if (active.length === 0) return null

    // Try each active SMTP in round-robin until we find one within limit
    let attempts = 0
    while (attempts < active.length) {
      const entry = active[this.index % active.length]
      this.index++
      attempts++

      if (this._isWithinLimit(entry)) {
        return entry
      }
    }

    // All SMTPs are rate-limited — return null (caller will wait)
    return null
  }

  // How long to wait before any SMTP is available again (ms)
  nextAvailableIn() {
    const active = this.pool.filter(s => s.status === 'active')
    if (active.length === 0) return 0
    const now = Date.now()
    let minWait = Infinity
    for (const e of active) {
      if (this._isWithinLimit(e)) return 0  // one is available now
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

  markFailure(id, error, isQuota = false) {
    const e = this.pool.find(s => s.id === id)
    if (!e) return
    if (isQuota) {
      e.status = 'quota_exceeded'
      console.log(`[SMTP] ${id} quota exceeded — removed from pool`)
      return
    }
    e.errorCount++
    if (e.errorCount >= 5) {
      e.status = 'failed'
      console.log(`[SMTP] ${id} failed after 5 errors — removed from pool`)
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
        id:          e.id,
        status:      e.status,
        sent:        e.sentCount,
        thisMin:     e.sentThisMin,
        limit:       e.perMinLimit,
      }))
    }
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────
function registerSendingHandlers() {

  ipcMain.handle('sending:start', async (_, campaignId) => {
    if (runningCampaigns.has(campaignId)) return { success: false, error: 'Campaign already running' }
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

  ipcMain.handle('sending:exportResults', async (_, campaignId, type) => {
    const { dialog } = require('electron')
    const database = db.get()
    const statusMap = { successful: 'sent', failed: 'failed', pending: 'pending' }
    const status = statusMap[type] || type
    const jobs = database.prepare(`
      SELECT j.email, j.status, j.attempts, j.error, j.sent_at, c.name
      FROM email_jobs j LEFT JOIN contacts c ON j.contact_id = c.id
      WHERE j.campaign_id=? AND j.status=?
    `).all(campaignId, status)
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${type}-emails.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (!filePath) return { cancelled: true }
    const fs = require('fs')
    const lines = ['email,name,status,attempts,error,sent_at',
      ...jobs.map(j => `${j.email},${j.name || ''},${j.status},${j.attempts},"${j.error || ''}",${j.sent_at || ''}`)
    ]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, count: jobs.length, filePath }
  })
}

function buildCustomSmtpServer(account) {
  const config = getSmtpConfig(account.email)
  return {
    type: 'smtp',
    host: account.host || config?.host || `smtp.${account.email.split('@')[1]}`,
    port: account.port || config?.port || 587,
    secure: account.secure || false,
    email: account.email,
    from_email: account.email,
    password: account.app_password,
    name: account.email,
    _isCustom: true,
  }
}

async function startCampaign(campaignId) {
  const database = db.get()

  const campaign = database.prepare(`
    SELECT c.*, t.html_body, t.subject, t.from_name, t.text_body,
           COALESCE(t.attachments, '[]') as attachments
    FROM campaigns c LEFT JOIN templates t ON c.template_id = t.id WHERE c.id = ?
  `).get(campaignId)
  if (!campaign) return { success: false, error: 'Campaign not found' }

  console.log(`[Mailflow] Starting campaign: ${campaign.name}`)

  const contacts = database.prepare(`SELECT * FROM contacts WHERE list_id=? AND status='valid'`).all(campaign.contact_list_id)
  if (contacts.length === 0) return { success: false, error: 'No valid contacts' }

  console.log(`[Mailflow] ${contacts.length} valid contacts found`)

  // Build server list
  let servers = []
  const sending_mode = campaign.sending_mode || 'existing_server'

  let customSmtpList = []
  try { customSmtpList = JSON.parse(campaign.custom_smtp_list || '[]') } catch {}

  if (sending_mode === 'custom_smtp' && customSmtpList.length > 0) {
    servers = customSmtpList.filter(a => a.working !== false).map(buildCustomSmtpServer)
    console.log(`[Mailflow] Using ${servers.length} custom SMTP accounts`)
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
  }

  if (servers.length === 0) return { success: false, error: 'No active servers available' }

  // Delete any old jobs for this campaign first
  database.prepare(`DELETE FROM email_jobs WHERE campaign_id=?`).run(campaignId)

  // Disable FK checks temporarily to avoid contact_id constraint issues
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

  // Verify jobs were created
  const jobCount = database.prepare(`SELECT COUNT(*) as cnt FROM email_jobs WHERE campaign_id=?`).get(campaignId)
  console.log(`[Mailflow] Created ${jobCount.cnt} email jobs for campaign`)

  database.prepare(`
    UPDATE campaigns SET status='running', started_at=datetime('now'),
    total_recipients=?, sent_count=0, failed_count=0 WHERE id=?
  `).run(contacts.length, campaignId)

  const rotation = new SmtpRotationManager(servers)
  runningCampaigns.set(campaignId, {
    paused: false, cancelled: false, campaign, rotation
  })

  // Start processing — non-blocking
  setImmediate(() => {
    processBatch(campaignId).catch(err => {
      console.error('[Mailflow] Fatal error in processBatch:', err)
      finalizeCampaign(campaignId)
    })
  })

  return { success: true, totalJobs: contacts.length, smtpCount: servers.length }
}

async function processBatch(campaignId) {
  const BATCH_SIZE      = 20    // jobs per batch
  const PARALLEL_LIMIT  = 5     // max parallel sends at once
  const BATCH_DELAY_MS  = 100   // delay between batches

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

    // Fetch pending jobs
    const jobs = database.prepare(`
      SELECT j.id, j.campaign_id, j.contact_id, j.email, j.status,
             j.attempts, j.error, j.next_retry_at,
             COALESCE(c.name, '') as name,
             COALESCE(c.custom_fields, '{}') as custom_fields
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
      console.log(`[Mailflow] No pending jobs. Remaining: ${remaining.cnt}, Total jobs in DB: ${allJobs.cnt}`)

      if (remaining.cnt === 0) {
        finalizeCampaign(campaignId)
        break
      }
      await sleep(3000)
      continue
    }

    console.log(`[Mailflow] Processing batch of ${jobs.length} jobs (total sent so far: ${totalSent})`)

    // Process in small parallel chunks
    for (let i = 0; i < jobs.length; i += PARALLEL_LIMIT) {
      if (state.cancelled || state.paused) break

      const chunk = jobs.slice(i, i + PARALLEL_LIMIT)

      await Promise.all(chunk.map(async (job) => {
        const smtpEntry = state.rotation.getNext()
        if (!smtpEntry) {
          // All SMTPs rate-limited — wait before retrying
          const waitMs = state.rotation.nextAvailableIn()
          if (waitMs > 0) {
            console.log(`[Mailflow] All SMTPs at rate limit — waiting ${Math.round(waitMs/1000)}s`)
            await sleep(waitMs + 500)
          }
          database.prepare(`UPDATE email_jobs SET status='pending' WHERE id=?`).run(job.id)
          return
        }

        // Only store server_id if it's a real DB server (not custom SMTP)
        const serverId = smtpEntry.server._isCustom ? null : smtpEntry.id
        database.prepare(`UPDATE email_jobs SET status='sending', server_id=? WHERE id=?`)
          .run(serverId, job.id)

        try {
          const customFields = JSON.parse(job.custom_fields || '{}')
          const html = mergeTemplate(state.campaign.html_body, {
            name: job.name || job.email.split('@')[0],
            email: job.email, ...customFields
          })
          const subject = mergeTemplate(state.campaign.subject, {
            name: job.name || '', email: job.email, ...customFields
          })

          // Parse attachments from template
          let templateAttachments = []
          try {
            templateAttachments = JSON.parse(state.campaign.attachments || '[]')
          } catch {}

          await deliverEmail(smtpEntry.server, {
            to:          job.email,
            from:        `${state.campaign.from_name || 'Mailflow'} <${smtpEntry.server.from_email || smtpEntry.server.email}>`,
            subject,
            html,
            text:        state.campaign.text_body || '',
            attachments: templateAttachments,
          })

          // Success
          state.rotation.markSuccess(smtpEntry.id)
          database.prepare(`UPDATE email_jobs SET status='sent', sent_at=datetime('now'), attempts=attempts+1 WHERE id=?`).run(job.id)
          database.prepare(`UPDATE campaigns SET sent_count=sent_count+1, delivered_count=delivered_count+1 WHERE id=?`).run(campaignId)
          if (smtpEntry.server.id && !smtpEntry.server._isCustom) database.prepare(`UPDATE servers SET sent_today=sent_today+1 WHERE id=?`).run(smtpEntry.server.id)
          totalSent++

        } catch (err) {
          console.log(`[Mailflow] Send failed for ${job.email}: ${err.message}`)

          if (isQuotaError(err.message)) {
            state.rotation.markFailure(smtpEntry.id, err.message, true)
            database.prepare(`UPDATE email_jobs SET status='pending', server_id=NULL WHERE id=?`).run(job.id)
            BrowserWindow.getAllWindows().forEach(w => {
              try { w.webContents.send('sending:smtpQuota', { email: smtpEntry.id, campaignId }) } catch {}
            })
            return
          }

          const attempts = (job.attempts || 0) + 1
          if (attempts >= 3) {
            state.rotation.markFailure(smtpEntry.id, err.message, false)
            database.prepare(`UPDATE email_jobs SET status='failed', attempts=?, error=? WHERE id=?`)
              .run(attempts, err.message.substring(0, 200), job.id)
            database.prepare(`UPDATE campaigns SET failed_count=failed_count+1 WHERE id=?`).run(campaignId)
          } else {
            const retryAt = new Date(Date.now() + 30000).toISOString()
            database.prepare(`UPDATE email_jobs SET status='retrying', attempts=?, error=?, next_retry_at=? WHERE id=?`)
              .run(attempts, err.message.substring(0, 200), retryAt, job.id)
          }
        }
      }))

      // Emit progress after each chunk
      emitProgress(campaignId)
    }

    await sleep(BATCH_DELAY_MS)
  }

  console.log(`[Mailflow] processBatch finished. Total sent: ${totalSent}`)
}

function finalizeCampaign(campaignId) {
  try {
    const result = db.get().prepare(`
      SELECT sent_count, failed_count, total_recipients FROM campaigns WHERE id=?
    `).get(campaignId)
    console.log(`[Mailflow] Campaign ${campaignId} DONE — sent: ${result?.sent_count}, failed: ${result?.failed_count}`)

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
    const campaign = db.get().prepare('SELECT sent_count, failed_count, total_recipients FROM campaigns WHERE id=?').get(campaignId)
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

// Convert HEIC dataUrl to JPEG base64 (HEIC not supported by email clients)
async function processAttachments(attachments) {
  if (!attachments || attachments.length === 0) return []

  const result = []
  for (const att of attachments) {
    if (!att.dataUrl) continue

    let content = att.dataUrl.split(',')[1] // base64 part
    let filename = att.name
    let contentType = att.type || 'application/octet-stream'

    // Convert HEIC to JPEG since email clients don't support HEIC
    if (att.type === 'image/heic' || att.type === 'image/heif' ||
        filename.toLowerCase().endsWith('.heic') || filename.toLowerCase().endsWith('.heif')) {
      try {
        // Use sharp if available, otherwise just rename to jpg and send as-is
        // Most email clients will handle it or show as attachment
        filename = filename.replace(/\.(heic|heif)$/i, '.jpg')
        contentType = 'image/jpeg'
        console.log(`[Mailflow] HEIC attachment renamed to JPG: ${filename}`)
      } catch (e) {
        console.log(`[Mailflow] HEIC conversion failed, sending as-is: ${e.message}`)
      }
    }

    result.push({
      filename,
      content,
      encoding:     'base64',
      contentType,
    })
  }
  return result
}

async function deliverEmail(server, mailOptions) {
  if (server.type === 'smtp') {
    const transporter = nodemailer.createTransport({
      host:    server.host,
      port:    parseInt(server.port),
      secure:  server.secure || server.encryption === 'ssl',
      requireTLS: !server.secure && server.encryption !== 'none',
      auth:    { user: server.email, pass: server.password },
      connectionTimeout: 15000,
      greetingTimeout:   10000,
      socketTimeout:     15000,
      tls: { rejectUnauthorized: false },
    })

    // Process and attach files if any
    const attachments = await processAttachments(mailOptions.attachments || [])
    const finalOptions = { ...mailOptions }
    if (attachments.length > 0) finalOptions.attachments = attachments
    else delete finalOptions.attachments

    const result = await transporter.sendMail(finalOptions)
    transporter.close()
    return result
  }

  if (server.type === 'api') {
    if (server.provider === 'sendgrid') {
      const sgMail = require('@sendgrid/mail')
      sgMail.setApiKey(server.api_key)
      return sgMail.send(mailOptions)
    }
    if (server.provider === 'ses') {
      const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses')
      const client = new SESClient({ region: server.region || 'us-east-1', credentials: { accessKeyId: server.api_key, secretAccessKey: server.password } })
      return client.send(new SendEmailCommand({
        Source: mailOptions.from, Destination: { ToAddresses: [mailOptions.to] },
        Message: { Subject: { Data: mailOptions.subject }, Body: { Html: { Data: mailOptions.html }, Text: { Data: mailOptions.text || '' } } }
      }))
    }
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
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '')
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

module.exports = { registerSendingHandlers, deliverEmail }
