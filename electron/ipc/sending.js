const { ipcMain, BrowserWindow } = require('electron')
const { v4: uuid } = require('uuid')
const nodemailer = require('nodemailer')
const db = require('../../database/db')
const { getSmtpConfig } = require('./customSmtp')

// In-memory queue state per campaign
const runningCampaigns = new Map()

function registerSendingHandlers() {

  ipcMain.handle('sending:start', async (_, campaignId) => {
    if (runningCampaigns.has(campaignId)) {
      return { success: false, error: 'Campaign already running' }
    }
    return startCampaign(campaignId)
  })

  ipcMain.handle('sending:pause', (_, campaignId) => {
    const state = runningCampaigns.get(campaignId)
    if (state) {
      state.paused = true
      db.get().prepare(`UPDATE campaigns SET status = 'paused' WHERE id = ?`).run(campaignId)
    }
    return { success: true }
  })

  ipcMain.handle('sending:resume', (_, campaignId) => {
    const state = runningCampaigns.get(campaignId)
    if (state) {
      state.paused = false
      db.get().prepare(`UPDATE campaigns SET status = 'running' WHERE id = ?`).run(campaignId)
      processBatch(campaignId)
    }
    return { success: true }
  })

  ipcMain.handle('sending:cancel', (_, campaignId) => {
    const state = runningCampaigns.get(campaignId)
    if (state) {
      state.cancelled = true
      runningCampaigns.delete(campaignId)
    }
    db.get().prepare(`UPDATE campaigns SET status = 'cancelled' WHERE id = ?`).run(campaignId)
    return { success: true }
  })

  ipcMain.handle('sending:test', async (_, { campaignId, testEmails, serverId, customSmtpAccount }) => {
    const database = db.get()
    const campaign = database.prepare(`
      SELECT c.*, t.html_body, t.subject, t.from_name
      FROM campaigns c
      LEFT JOIN templates t ON c.template_id = t.id
      WHERE c.id = ?
    `).get(campaignId)

    if (!campaign) return { success: false, error: 'Campaign not found' }

    let server = null
    if (customSmtpAccount) {
      // Use custom SMTP for test
      server = buildCustomSmtpServer(customSmtpAccount)
    } else {
      server = database.prepare('SELECT * FROM servers WHERE id = ?').get(serverId)
    }

    if (!server) return { success: false, error: 'No server available' }

    const results = []
    for (const email of testEmails) {
      try {
        await deliverEmail(server, {
          to: email,
          subject: `[TEST] ${campaign.subject}`,
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
    const stats = database.prepare(`
      SELECT status, COUNT(*) as count FROM email_jobs
      WHERE campaign_id = ? GROUP BY status
    `).all(campaignId)

    const map = {}
    stats.forEach(s => { map[s.status] = s.count })
    return {
      pending:  map.pending  || 0,
      sending:  map.sending  || 0,
      sent:     map.sent     || 0,
      failed:   map.failed   || 0,
      retrying: map.retrying || 0,
      total: Object.values(map).reduce((a, b) => a + b, 0)
    }
  })

  ipcMain.handle('sending:exportResults', async (_, campaignId, type) => {
    const { dialog } = require('electron')
    const database = db.get()

    const statusMap = { successful: 'sent', failed: 'failed', pending: 'pending' }
    const status = statusMap[type] || type

    const jobs = database.prepare(`
      SELECT j.email, j.status, j.attempts, j.error, j.sent_at,
             c.name, c.email as contact_email
      FROM email_jobs j
      LEFT JOIN contacts c ON j.contact_id = c.id
      WHERE j.campaign_id = ? AND j.status = ?
    `).all(campaignId, status)

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${type}-emails.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })

    if (!filePath) return { cancelled: true }

    const fs = require('fs')
    const lines = ['email,name,status,attempts,error,sent_at',
      ...jobs.map(j =>
        `${j.email},${j.name || ''},${j.status},${j.attempts},${j.error || ''},${j.sent_at || ''}`
      )
    ]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, count: jobs.length, filePath }
  })
}

// Build a server object from a custom SMTP account
function buildCustomSmtpServer(account) {
  const config = getSmtpConfig(account.email)
  return {
    type: 'smtp',
    host: config?.host || `smtp.${account.email.split('@')[1]}`,
    port: config?.port || 587,
    encryption: config?.encryption || 'tls',
    email: account.email,
    from_email: account.email,
    password: account.app_password,
    name: account.email,
  }
}

async function startCampaign(campaignId) {
  const database = db.get()

  const campaign = database.prepare(`
    SELECT c.*, t.html_body, t.subject, t.from_name, t.text_body
    FROM campaigns c
    LEFT JOIN templates t ON c.template_id = t.id
    WHERE c.id = ?
  `).get(campaignId)

  if (!campaign) return { success: false, error: 'Campaign not found' }

  // Get contacts
  const contacts = database.prepare(`
    SELECT * FROM contacts WHERE list_id = ? AND status = 'valid'
  `).all(campaign.contact_list_id)

  if (contacts.length === 0) return { success: false, error: 'No valid contacts' }

  let servers = []

  // Check if custom SMTP mode
  const sending_mode = campaign.sending_mode || 'existing_server'
  const customSmtpList = campaign.custom_smtp_list
    ? JSON.parse(campaign.custom_smtp_list)
    : []

  if (sending_mode === 'custom_smtp' && customSmtpList.length > 0) {
    // Build server objects from custom SMTP accounts
    servers = customSmtpList
      .filter(a => a.working !== false)
      .map(a => buildCustomSmtpServer(a))
  } else {
    // Use existing configured servers
    const serverIds = JSON.parse(campaign.server_ids || '[]')
    servers = serverIds.length > 0
      ? database.prepare(`SELECT * FROM servers WHERE id IN (${serverIds.map(() => '?').join(',')}) AND status = 'active'`).all(...serverIds)
      : database.prepare(`SELECT * FROM servers WHERE status = 'active'`).all()
  }

  if (servers.length === 0) return { success: false, error: 'No active servers available' }

  // Create email jobs in bulk
  const insertJob = database.prepare(`
    INSERT INTO email_jobs (id, campaign_id, contact_id, email, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', datetime('now'))
  `)

  const createJobs = database.transaction(() => {
    for (const contact of contacts) {
      insertJob.run(uuid(), campaignId, contact.id, contact.email)
    }
  })
  createJobs()

  // Update campaign status
  database.prepare(`
    UPDATE campaigns SET
      status = 'running',
      started_at = datetime('now'),
      total_recipients = ?
    WHERE id = ?
  `).run(contacts.length, campaignId)

  // Store running state
  runningCampaigns.set(campaignId, {
    paused: false,
    cancelled: false,
    servers,
    serverIndex: 0,
    campaign,
  })

  // Start async processing (non-blocking)
  processBatch(campaignId).catch(console.error)

  return { success: true, totalJobs: contacts.length }
}

async function processBatch(campaignId) {
  const BATCH_SIZE = 50
  const DELAY_MS   = 200

  const state = runningCampaigns.get(campaignId)
  if (!state) return

  const database = db.get()

  while (true) {
    if (state.cancelled) break
    if (state.paused) return

    const jobs = database.prepare(`
      SELECT j.*, c.name, c.custom_fields
      FROM email_jobs j
      LEFT JOIN contacts c ON j.contact_id = c.id
      WHERE j.campaign_id = ? AND j.status IN ('pending','retrying')
        AND (j.next_retry_at IS NULL OR j.next_retry_at <= datetime('now'))
      LIMIT ?
    `).all(campaignId, BATCH_SIZE)

    if (jobs.length === 0) {
      const remaining = database.prepare(`
        SELECT COUNT(*) as cnt FROM email_jobs
        WHERE campaign_id = ? AND status NOT IN ('sent','failed')
      `).get(campaignId)

      if (remaining.cnt === 0) {
        finalizeCampaign(campaignId)
        break
      }
      await sleep(5000)
      continue
    }

    for (const job of jobs) {
      if (state.cancelled || state.paused) break

      // Round-robin server selection
      const server = state.servers[state.serverIndex % state.servers.length]
      state.serverIndex++

      database.prepare(`UPDATE email_jobs SET status = 'sending', server_id = ? WHERE id = ?`)
        .run(server.id || server.email, job.id)

      try {
        const customFields = JSON.parse(job.custom_fields || '{}')
        const mergedHtml = mergeTemplate(state.campaign.html_body, {
          name:  job.name || job.email.split('@')[0],
          email: job.email,
          ...customFields
        })

        await deliverEmail(server, {
          to:      job.email,
          from:    `${state.campaign.from_name || 'Mailflow'} <${server.from_email || server.email}>`,
          subject: mergeTemplate(state.campaign.subject, {
            name: job.name || '', email: job.email, ...customFields
          }),
          html: mergedHtml,
          text: state.campaign.text_body || '',
        })

        database.prepare(`
          UPDATE email_jobs SET status = 'sent', sent_at = datetime('now') WHERE id = ?
        `).run(job.id)

        database.prepare(`
          UPDATE campaigns SET sent_count = sent_count + 1, delivered_count = delivered_count + 1
          WHERE id = ?
        `).run(campaignId)

        // Only update sent_today for DB servers (not custom SMTP)
        if (server.id) {
          database.prepare(`UPDATE servers SET sent_today = sent_today + 1 WHERE id = ?`).run(server.id)
        }

      } catch (err) {
        const attempts    = job.attempts + 1
        const maxAttempts = job.max_attempts || 3

        if (attempts >= maxAttempts) {
          database.prepare(`
            UPDATE email_jobs SET status = 'failed', attempts = ?, error = ? WHERE id = ?
          `).run(attempts, err.message, job.id)

          database.prepare(`
            UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?
          `).run(campaignId)
        } else {
          const retryAt = new Date(Date.now() + 60000).toISOString()
          database.prepare(`
            UPDATE email_jobs SET
              status = 'retrying', attempts = ?,
              error = ?, next_retry_at = ?
            WHERE id = ?
          `).run(attempts, err.message, retryAt, job.id)
        }
      }

      emitProgress(campaignId)
      await sleep(DELAY_MS)
    }
  }
}

function finalizeCampaign(campaignId) {
  db.get().prepare(`
    UPDATE campaigns SET
      status = 'sent',
      completed_at = datetime('now')
    WHERE id = ?
  `).run(campaignId)

  runningCampaigns.delete(campaignId)

  const wins = BrowserWindow.getAllWindows()
  wins.forEach(w => w.webContents.send('campaign:statusChange', campaignId, 'sent'))
}

function emitProgress(campaignId) {
  const database = db.get()
  const campaign = database.prepare(
    'SELECT sent_count, failed_count, total_recipients FROM campaigns WHERE id = ?'
  ).get(campaignId)

  const wins = BrowserWindow.getAllWindows()
  wins.forEach(w => w.webContents.send('sending:progress', { campaignId, ...campaign }))
}

async function deliverEmail(server, mailOptions) {
  if (server.type === 'smtp') {
    const transporter = nodemailer.createTransport({
      host:    server.host,
      port:    parseInt(server.port),
      secure:  server.encryption === 'ssl',
      requireTLS: server.encryption === 'tls',
      auth:    { user: server.email, pass: server.password },
      connectionTimeout: 10000,
      socketTimeout: 10000,
    })
    return transporter.sendMail(mailOptions)
  }

  if (server.type === 'api') {
    if (server.provider === 'sendgrid') {
      const sgMail = require('@sendgrid/mail')
      sgMail.setApiKey(server.api_key)
      return sgMail.send(mailOptions)
    }
    if (server.provider === 'ses') {
      const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses')
      const client = new SESClient({
        region: server.region || 'us-east-1',
        credentials: { accessKeyId: server.api_key, secretAccessKey: server.password }
      })
      return client.send(new SendEmailCommand({
        Source: mailOptions.from,
        Destination: { ToAddresses: [mailOptions.to] },
        Message: {
          Subject: { Data: mailOptions.subject },
          Body: { Html: { Data: mailOptions.html }, Text: { Data: mailOptions.text || '' } }
        }
      }))
    }
    if (server.provider === 'mailgun') {
      const formData = require('form-data')
      const Mailgun  = require('mailgun.js')
      const mg       = new Mailgun(formData)
      const client   = mg.client({ username: 'api', key: server.api_key })
      return client.messages.create(server.region || 'mailgun.org', {
        from: mailOptions.from, to: mailOptions.to,
        subject: mailOptions.subject, html: mailOptions.html
      })
    }
  }
  throw new Error(`Unsupported server type: ${server.type}/${server.provider}`)
}

function mergeTemplate(template, data) {
  if (!template) return ''
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { registerSendingHandlers, deliverEmail }
