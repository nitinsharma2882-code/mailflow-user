const { ipcMain, BrowserWindow } = require('electron')
const { v4: uuid } = require('uuid')
const nodemailer = require('nodemailer')
const db = require('../../database/db')
const { getSmtpConfig, isQuotaError } = require('./customSmtp')
const { getTrackingUrl } = require('./tracking')

// Railway tracking server — set this after deploying
const RAILWAY_TRACKING_URL = 'https://mailflow-tracking-server-production.up.railway.app'
const TRACKING_ADMIN_KEY   = 'mailflow-admin-2026'

async function registerJobsWithTrackingServer(jobs) {
  try {
    const url = RAILWAY_TRACKING_URL
    if (!url || url.includes('localhost')) return // skip if not configured

    const payload = jobs.map(j => ({ id: j.id, campaignId: j.campaign_id, email: j.email }))

    const res = await fetch(`${url}/api/jobs/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': TRACKING_ADMIN_KEY },
      body:    JSON.stringify({ jobs: payload }),
    })

    if (res.ok) {
      const data = await res.json()
      console.log(`[Tracking] Registered ${data.registered} jobs with Railway server`)
    }
  } catch (err) {
    console.log('[Tracking] Could not register jobs with Railway server:', err.message)
    // Non-fatal — tracking just won't work for this campaign
  }
}

function getActiveTrackingUrl() {
  // Use Railway if available, else local
  return RAILWAY_TRACKING_URL || getTrackingUrl()
}

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
  const port   = account.port || config?.port || 587
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
    // custom_smtp_list already contains ONLY working accounts (filtered during Step 4 validation)
    // Filter: exclude any that are explicitly marked as not working
    const validAccounts = customSmtpList.filter(a =>
      a.working !== false &&
      a.status !== 'failed' &&
      a.status !== 'invalid' &&
      a.status !== 'quota_exceeded' &&
      a.status !== 'timeout' &&
      a.status !== 'disabled' &&
      a.email &&
      (a.app_password || a.password)  // must have a password
    )

    console.log('[Mailflow] Custom SMTP: ' + validAccounts.length + ' valid of ' + customSmtpList.length + ' total')

    if (validAccounts.length === 0) {
      return {
        success: false,
        error: 'No valid SMTP accounts available. Please go back to Step 4 and validate your SMTP accounts first using the "Test & Validate All SMTP" button.'
      }
    }

    servers = validAccounts.map(buildCustomSmtpServer)
    console.log('[Mailflow] Built ' + servers.length + ' SMTP server configs')
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

  // Register all jobs with Railway tracking server (non-blocking)
  const allJobs = database.prepare(`SELECT id, campaign_id, email FROM email_jobs WHERE campaign_id=?`).all(campaignId)
  registerJobsWithTrackingServer(allJobs).catch(() => {})

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

  return { success: true, totalJobs: contacts.length, smtpCount: servers.length, validSmtp: servers.length }
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

          // ── STRICT: Send email EXACTLY as user wrote it — NO modifications ──
          var fromEmail   = smtpEntry.server.from_email || smtpEntry.server.email || ''
          var fromName    = state.campaign.from_name || ''
          var fromAddress = fromName ? (fromName + ' <' + fromEmail + '>') : fromEmail
          var msgId       = buildMessageId(fromEmail)

          // Only inject tracking pixel — nothing else touched
          var finalHtml = injectTrackingPixel(html, job.id, getActiveTrackingUrl())

          // Plain text: use template text_body if set, else generate from HTML
          var plainText = state.campaign.text_body || generateTextVersion(html)

          await deliverEmail(smtpEntry.server, {
            to:          job.email,
            from:        fromAddress,
            subject:     subject,
            html:        finalHtml,
            text:        plainText,
            attachments: templateAttachments,
            messageId:   msgId,
          })

          // Success
          state.rotation.markSuccess(smtpEntry.id)
          database.prepare(`UPDATE email_jobs SET status='sent', sent_at=datetime('now'), attempts=attempts+1 WHERE id=?`).run(job.id)
          database.prepare(`UPDATE campaigns SET sent_count=sent_count+1, delivered_count=delivered_count+1 WHERE id=?`).run(campaignId)
          if (smtpEntry.server.id && !smtpEntry.server._isCustom) database.prepare(`UPDATE servers SET sent_today=sent_today+1 WHERE id=?`).run(smtpEntry.server.id)
          totalSent++

        } catch (err) {
          var errMsg = err.message || 'Unknown error'
          var errLow = errMsg.toLowerCase()
          console.log('[Mailflow] Send failed for ' + job.email + ': ' + errMsg)

          // Categorize the error
          var isQuota    = isQuotaError(errMsg)
          var isInvalid  = errLow.includes('535') || errLow.includes('authentication') ||
                           errLow.includes('invalid login') || errLow.includes('username and password') ||
                           errLow.includes('bad credentials') || errLow.includes('5.7.8')
          var isDisabled = errLow.includes('disabled') || errLow.includes('suspended') ||
                           errLow.includes('blocked') || errLow.includes('not allowed') || errLow.includes('policy')
          var isBad = isInvalid || isDisabled

          if (isQuota) {
            // Quota exceeded — remove from pool immediately, requeue email
            state.rotation.markFailure(smtpEntry.id, errMsg, true)
            database.prepare("UPDATE email_jobs SET status='pending', server_id=NULL WHERE id=?").run(job.id)
            BrowserWindow.getAllWindows().forEach(w => {
              try { w.webContents.send('sending:smtpQuota', { email: smtpEntry.id, campaignId }) } catch {}
            })
            console.log('[Mailflow] SMTP quota exceeded — removed from pool: ' + smtpEntry.id)
            return
          }

          if (isBad) {
            // Invalid/disabled SMTP — remove from pool immediately, requeue email
            state.rotation.markFailure(smtpEntry.id, errMsg, false)
            database.prepare("UPDATE email_jobs SET status='pending', server_id=NULL WHERE id=?").run(job.id)
            console.log('[Mailflow] SMTP invalid/disabled — removed from pool: ' + smtpEntry.id)
            return
          }

          // Transient error — retry up to 3 times
          var attempts = (job.attempts || 0) + 1
          if (attempts >= 3) {
            // Mark SMTP as having errors but keep in pool
            state.rotation.markFailure(smtpEntry.id, errMsg, false)
            database.prepare("UPDATE email_jobs SET status='failed', attempts=?, error=? WHERE id=?")
              .run(attempts, errMsg.substring(0, 200), job.id)
            database.prepare("UPDATE campaigns SET failed_count=failed_count+1 WHERE id=?").run(campaignId)
          } else {
            // Short retry delay — 30 seconds
            var retryAt = new Date(Date.now() + 30000).toISOString()
            database.prepare("UPDATE email_jobs SET status='retrying', attempts=?, error=?, next_retry_at=? WHERE id=?")
              .run(attempts, errMsg.substring(0, 200), retryAt, job.id)
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

async function sendViaSes(server, mailOptions) {
  var SESModule = require('@aws-sdk/client-ses')
  var SESClient = SESModule.SESClient
  var SendRawEmailCommand = SESModule.SendRawEmailCommand

  var client = new SESClient({
    region: server.region || 'us-east-1',
    credentials: {
      accessKeyId:     (server.api_key || '').trim(),
      secretAccessKey: (server.password || '').trim()
    }
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
  raw += 'Content-Type: multipart/mixed; boundary="' + b + '"' + CRLF
  raw += CRLF
  raw += '--' + b + CRLF
  raw += 'Content-Type: multipart/alternative; boundary="' + ba + '"' + CRLF
  raw += CRLF
  raw += '--' + ba + CRLF
  raw += 'Content-Type: text/plain; charset=UTF-8' + CRLF
  raw += CRLF
  raw += (mailOptions.text || '') + CRLF
  raw += CRLF
  raw += '--' + ba + CRLF
  raw += 'Content-Type: text/html; charset=UTF-8' + CRLF
  raw += CRLF
  raw += (mailOptions.html || '') + CRLF
  raw += CRLF
  raw += '--' + ba + '--' + CRLF

  for (var i = 0; i < atts.length; i++) {
    var att = atts[i]
    if (!att.content) continue
    var ac = typeof att.content === 'string' ? att.content : att.content.toString('base64')
    raw += '--' + b + CRLF
    raw += 'Content-Type: ' + (att.contentType || 'application/octet-stream') + '; name="' + att.filename + '"' + CRLF
    raw += 'Content-Transfer-Encoding: base64' + CRLF
    raw += 'Content-Disposition: attachment; filename="' + att.filename + '"' + CRLF
    raw += CRLF
    raw += ac + CRLF
  }

  raw += '--' + b + '--'

  var cmd = new SendRawEmailCommand({ RawMessage: { Data: Buffer.from(raw) } })

  try {
    return await client.send(cmd)
  } catch (err) {
    if (err.name === 'MessageRejected') throw new Error('SES: Message rejected — verify sender email in AWS')
    if (err.name === 'ThrottlingException') throw new Error('SES: Rate limit exceeded')
    if (err.name === 'SendingPausedException') throw new Error('SES: Sending paused — check AWS console')
    throw err
  }
}

async function deliverEmail(server, mailOptions) {
  if (server.type === 'smtp') {
    var crypto = require('crypto')
    var host = server.host || ''

    var isM365   = host.includes('office365.com') || host.includes('microsoft.com')
    var isOutlook = host.includes('outlook.com')
    var isGmail  = host.includes('gmail.com')
    var isMicrosoft = isM365 || isOutlook

    // ── Transport config ─────────────────────────────────────────
    var portNum  = parseInt(server.port) || 587
    var isSSL    = server.encryption === 'ssl' || portNum === 465
    var isTLS    = !isSSL && portNum === 587  // only require TLS on standard port 587
    var transportConfig = {
      host:               host,
      port:               portNum,
      secure:             isSSL,
      requireTLS:         isTLS,
      auth:               { user: server.email, pass: server.password },
      connectionTimeout:  25000,
      greetingTimeout:    20000,
      socketTimeout:      25000,
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1',
      }
    }

    // M365 specific TLS (Microsoft requires modern TLS)
    if (isMicrosoft) {
      transportConfig.tls.ciphers = [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-GCM-SHA256'
      ].join(':')
    }

    const transporter = nodemailer.createTransport(transportConfig)

    // ── Process attachments ──────────────────────────────────────
    const attachments = await processAttachments(mailOptions.attachments || [])

    // ── Build anti-bot headers ───────────────────────────────────
    var fromEmail  = server.from_email || server.email || ''
    var fromDomain = fromEmail.split('@')[1] || 'mailflow.app'
    var uniqueRef  = crypto.randomBytes(16).toString('hex')
    var msgId      = mailOptions.messageId ||
      ('<' + Date.now().toString(36) + '.' + crypto.randomBytes(8).toString('hex') + '@' + fromDomain + '>')

    var headers = {
      // Core headers — missing any of these = spam signal
      'Message-ID':             msgId,
      'Date':                   new Date().toUTCString(),
      'MIME-Version':           '1.0',
      'X-Entity-Ref-ID':        uniqueRef,

      // Priority signals — tells mail servers this is legitimate
      'X-Priority':             '3',
      'X-MSMail-Priority':      'Normal',
      'Importance':             'Normal',

      // Unsubscribe — required by CAN-SPAM/GDPR, improves trust score
      'List-Unsubscribe':       '<mailto:unsubscribe@' + fromDomain + '>',
      'List-Unsubscribe-Post':  'List-Unsubscribe=One-Click',
      'Precedence':             'bulk',
    }

    // ── Microsoft 365 specific anti-filter headers ───────────────
    if (isMicrosoft) {
      // These headers tell Microsoft's own filters to pass the email
      headers['X-Mailer']                          = 'Microsoft Outlook 16.0.17928.20156'
      headers['X-MS-Exchange-Organization-SCL']    = '-1'  // SCL -1 = bypass junk filter
      headers['X-MS-Has-Attach']                   = attachments.length > 0 ? 'yes' : 'no'
      headers['X-MS-TNEF-Correlator']             = ''
      headers['X-MS-Exchange-Organization-AuthAs'] = 'Internal'
      headers['X-MS-Exchange-Organization-AuthMechanism'] = '04'
      headers['X-Auto-Response-Suppress']          = 'DR, OOF, AutoReply'
      headers['Auto-Submitted']                    = 'auto-generated'
      headers['X-Microsoft-Antispam']              = 'BCL:0;'
      headers['X-Forefront-Antispam-Report']       = 'SFV:NSPM;'
    }

    // ── Gmail specific headers ───────────────────────────────────
    if (isGmail) {
      headers['X-Mailer'] = 'Google Gmail'
      headers['X-Google-DKIM-Signature'] = 'bypass'
    }

    // ── Generic SMTP (non-Microsoft, non-Gmail) ──────────────────
    if (!isMicrosoft && !isGmail) {
      headers['X-Mailer'] = 'Mailflow/2.0'
    }

    var finalOptions = Object.assign({}, mailOptions, {
      headers:     headers,
      messageId:   msgId,
      // Ensure text version always present (missing = spam signal)
      text:        mailOptions.text || generateTextVersion(mailOptions.html || ''),
    })

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
      return await sendViaSes(server, mailOptions)
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

// ── DELIVERABILITY ENGINE ─────────────────────────────────────────
// Makes emails look human-written and bypass spam filters

function generateTextVersion(html) {
  // Convert HTML to clean plain text — required for spam filters
  if (!html) return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function humanizeHtml(html, recipientData) {
  if (!html) return html

  // 1. Add subtle random whitespace variations (looks human-typed)
  var spaces = [' ', '  ', ' ']
  html = html.replace(/(<\/p>)/g, function() {
    return spaces[Math.floor(Math.random() * spaces.length)] + '</p>'
  })

  // 2. Add invisible zero-width characters to break pattern matching
  // (bypasses template fingerprinting used by spam filters)
  var zwChars = ['\u200B', '\u200C', '\u200D', '\uFEFF']
  var insertCount = 0
  html = html.replace(/(\s{2,})/g, function(match) {
    if (insertCount < 5) {
      insertCount++
      return match + zwChars[Math.floor(Math.random() * zwChars.length)]
    }
    return match
  })

  // 3. Add recipient-specific hidden element (unique per email — bypasses duplicate content detection)
  var uniqueId = 'u' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6)
  var hiddenEl = '<div style="display:none;font-size:1px;color:#ffffff;max-height:0;max-width:0;opacity:0;overflow:hidden;">' + uniqueId + '</div>'

  if (html.includes('<body')) {
    html = html.replace('<body', hiddenEl + '<body')
  } else {
    html = hiddenEl + html
  }

  // 4. Add proper email structure if missing
  if (!html.includes('<!DOCTYPE') && !html.includes('<html')) {
    html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body>' + html + '</body></html>'
  }

  // 5. Add unsubscribe link at bottom (required by CAN-SPAM — missing this causes spam)
  var email = recipientData && recipientData.email ? recipientData.email : ''
  var unsubLink = '<div style="text-align:center;margin-top:20px;padding:10px;font-size:11px;color:#888888;font-family:Arial,sans-serif;">' +
    'You are receiving this email because you signed up for our service. ' +
    '<br>To unsubscribe, reply with "unsubscribe" in the subject line.' +
    '</div>'

  if (html.includes('</body>')) {
    html = html.replace('</body>', unsubLink + '</body>')
  } else {
    html = html + unsubLink
  }

  return html
}

function humanizeSubject(subject) {
  if (!subject) return subject
  // Add minor randomization to avoid subject line fingerprinting
  // Spam filters flag identical subjects sent to many people
  var variants = ['', ' ', '  ']
  return subject + variants[Math.floor(Math.random() * variants.length)]
}

function buildMessageId(fromEmail) {
  // Proper Message-ID header — missing this is a spam signal
  var domain = fromEmail && fromEmail.includes('@') ? fromEmail.split('@')[1] : 'mailflow.app'
  return '<' + Date.now().toString(36) + '.' + Math.random().toString(36).substring(2) + '@' + domain + '>'
}

function injectTrackingPixel(html, jobId, trackingDomain) {
  if (!html || !jobId) return html
  const domain = (trackingDomain || 'http://localhost:3001').replace(/\/$/, '')
  // Use unique timestamp to bypass email client caching
  const ts = Date.now()
  const pixel = '<img src="' + domain + '/track/open/' + jobId + '?t=' + ts + '" width="1" height="1" style="display:none !important;border:0;outline:0;max-height:1px;max-width:1px;opacity:0;" alt="" />'
  if (html.includes('</body>')) return html.replace('</body>', pixel + '</body>')
  if (html.includes('</html>')) return html.replace('</html>', pixel + '</html>')
  return html + pixel
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

module.exports = { registerSendingHandlers, deliverEmail }
