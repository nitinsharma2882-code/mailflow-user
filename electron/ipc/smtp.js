const { ipcMain, BrowserWindow } = require('electron')
const nodemailer = require('nodemailer')
const { v4: uuid } = require('uuid')
const fs   = require('fs')
const path = require('path')
const db   = require('../../database/db')

// ── Fixed test recipient list ────────────────────────────────────────────────
const TEST_RECIPIENTS = [
  'ajaygoel999@gmail.com',
  'test@chromecompete.com',
  'test@ajaygoel.org',
  'me@dropboxslideshow.com',
  'test@wordzen.com',
  'rajgoel8477@gmail.com',
  'rajanderson8477@gmail.com',
  'rajwilson8477@gmail.com',
  'briansmith8477@gmail.com',
  'oliviasmith8477@gmail.com',
  'ashsmith8477@gmail.com',
  'shellysmith8477@gmail.com',
  'ajay@madsciencekidz.com',
  'ajay2@ctopowered.com',
  'ajay@arena.tec.br',
]

// ── SMTP provider detection ──────────────────────────────────────────────────
function detectSmtpConfig(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase() || ''
  const configs = {
    'gmail.com':        { host: 'smtp.gmail.com',          port: 587, secure: false },
    'googlemail.com':   { host: 'smtp.gmail.com',          port: 587, secure: false },
    'outlook.com':      { host: 'smtp-mail.outlook.com',   port: 587, secure: false },
    'hotmail.com':      { host: 'smtp-mail.outlook.com',   port: 587, secure: false },
    'live.com':         { host: 'smtp-mail.outlook.com',   port: 587, secure: false },
    'msn.com':          { host: 'smtp-mail.outlook.com',   port: 587, secure: false },
    'yahoo.com':        { host: 'smtp.mail.yahoo.com',     port: 587, secure: false },
    'yahoo.co.in':      { host: 'smtp.mail.yahoo.com',     port: 587, secure: false },
    'yahoo.co.uk':      { host: 'smtp.mail.yahoo.com',     port: 587, secure: false },
    'icloud.com':       { host: 'smtp.mail.me.com',        port: 587, secure: false },
    'me.com':           { host: 'smtp.mail.me.com',        port: 587, secure: false },
    'mac.com':          { host: 'smtp.mail.me.com',        port: 587, secure: false },
    'zoho.com':         { host: 'smtp.zoho.com',           port: 587, secure: false },
    'aol.com':          { host: 'smtp.aol.com',            port: 587, secure: false },
    'protonmail.com':   { host: 'smtp.protonmail.ch',      port: 587, secure: false },
    'proton.me':        { host: 'smtp.protonmail.ch',      port: 587, secure: false },
  }
  return configs[domain] || { host: 'smtp.' + domain, port: 587, secure: false }
}

// ── Error categorization ─────────────────────────────────────────────────────
function categorizeError(errMsg) {
  const msg = (errMsg || '').toLowerCase()

  if (msg.includes('535') || msg.includes('authentication') || msg.includes('invalid credentials') ||
      msg.includes('username and password') || msg.includes('auth') || msg.includes('5.7.8')) {
    return { category: 'invalid', label: 'Invalid Credentials' }
  }
  if (msg.includes('daily') || msg.includes('quota') || msg.includes('limit') ||
      msg.includes('exceeded') || msg.includes('4.7.') || msg.includes('too many')) {
    return { category: 'quota', label: 'Quota Exceeded' }
  }
  if (msg.includes('disabled') || msg.includes('suspended') || msg.includes('blocked') ||
      msg.includes('5.7.0') || msg.includes('policy') || msg.includes('not allowed')) {
    return { category: 'disabled', label: 'Account Disabled/Blocked' }
  }
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset')) {
    return { category: 'connection', label: 'Connection Error' }
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('timed out')) {
    return { category: 'timeout', label: 'Connection Timeout' }
  }
  if (msg.includes('tls') || msg.includes('ssl') || msg.includes('certificate')) {
    return { category: 'tls', label: 'TLS/SSL Error' }
  }
  return { category: 'failed', label: 'Send Failed' }
}

// ── Core: test one SMTP by actually sending an email ────────────────────────
async function testSmtpBySending(smtpConfig, attempt = 1) {
  const start = Date.now()
  const { host, port, email, password } = smtpConfig
  const portNum = parseInt(port) || 587

  console.log('[SMTP Test] Testing: ' + email + ' via ' + host + ':' + portNum + ' (attempt ' + attempt + ')')

  var transporter = null
  try {
    // Build transport config carefully
    var transportConfig = {
      host:              host,
      port:              portNum,
      secure:            portNum === 465,   // only SSL on port 465
      auth:              { user: email, pass: password },
      connectionTimeout: 15000,
      greetingTimeout:   10000,
      socketTimeout:     15000,
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1',  // allow older TLS too
      },
    }

    // Only require TLS on port 587, not 25 or 465
    if (portNum === 587) {
      transportConfig.requireTLS = true
    }

    transporter = nodemailer.createTransport(transportConfig)

    // Step 1: Verify connection + auth
    await transporter.verify()
    const verifyLatency = Date.now() - start
    console.log('[SMTP Test] ✅ Verify OK: ' + email + ' (' + verifyLatency + 'ms)')

    // Step 2: Send test email to one recipient
    const recipient = TEST_RECIPIENTS[Math.floor(Math.random() * TEST_RECIPIENTS.length)]

    await transporter.sendMail({
      from:    '"Mailflow Tester" <' + email + '>',
      to:      recipient,
      subject: 'SMTP Test - Mailflow',
      text:    'This is a test email to verify SMTP functionality. Sent by Mailflow SMTP Tester.',
      html:    '<p>This is a test email to verify SMTP functionality.</p><p>Sent by <strong>Mailflow SMTP Tester</strong>.</p>',
    })

    const latency = Date.now() - start
    transporter.close()

    console.log('[SMTP Test] ✅ Email sent: ' + email + ' → ' + recipient + ' (' + latency + 'ms)')

    return {
      success:   true,
      status:    'working',
      category:  'working',
      label:     'Working',
      message:   'Connected & sent to ' + recipient + ' in ' + latency + 'ms',
      recipient: recipient,
      latency:   latency,
    }

  } catch (err) {
    const latency = Date.now() - start
    if (transporter) { try { transporter.close() } catch {} }

    const errMsg = err.message || 'Unknown error'
    const errCode = err.code || ''
    const { category, label } = categorizeError(errMsg)

    console.log('[SMTP Test] ❌ Failed: ' + email + ' — [' + category + '] ' + errMsg)

    // Retry once on non-auth errors
    if (attempt === 1 && category !== 'invalid' && category !== 'quota' && category !== 'disabled') {
      console.log('[SMTP Test] Retrying ' + email + ' in 2s...')
      await new Promise(r => setTimeout(r, 2000))
      return testSmtpBySending(smtpConfig, 2)
    }

    return {
      success:  false,
      status:   category,
      category: category,
      label:    label,
      message:  errMsg.substring(0, 300),
      latency:  latency,
    }
  }
}

// ── Parse CSV — supports both formats ───────────────────────────────────────
// Format 1 (simple): email,app_password (no header)
// Format 2 (full):   host,port,email,password,encryption (with header)
function parseSmtpCsv(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const accounts = []

  for (const line of lines) {
    // Skip header rows
    if (line.toLowerCase().startsWith('email,') || line.toLowerCase().startsWith('host,')) continue

    const parts = line.split(',')
    if (parts.length < 2) continue

    // Detect format by checking if first part looks like an email
    if (parts[0].includes('@')) {
      // Format: email,app_password
      const email    = parts[0].trim()
      // App passwords may have spaces — rejoin remaining parts
      const password = parts.slice(1).join(',').trim().replace(/^"|"$/g, '')
      const smtpConf = detectSmtpConfig(email)
      accounts.push({ email, password, ...smtpConf })
    } else if (parts.length >= 3 && parts[2].includes('@')) {
      // Format: host,port,email,password
      accounts.push({
        host:     parts[0].trim(),
        port:     parseInt(parts[1]) || 587,
        email:    parts[2].trim(),
        password: parts.slice(3).join(',').trim().replace(/^"|"$/g, ''),
      })
    }
  }

  return accounts
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────
function registerSmtpHandlers() {

  // Single SMTP test — connection only (fast)
  ipcMain.handle('smtp:testSingle', async (_, config) => {
    const { testSmtpConnection } = require('./servers')
    const result = await testSmtpConnection({ type: 'smtp', ...config })
    try {
      db.get().prepare(`
        INSERT INTO smtp_test_results (id, host, port, email, status, details, latency_ms, tested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(uuid(), config.host, config.port, config.email,
        result.success ? 'working' : 'failed',
        result.message || result.error, result.latency)
    } catch {}
    return result
  })

  // Bulk SMTP test — sends real emails, reports progress
  ipcMain.handle('smtp:testBulk', async (_, filePath) => {
    const CONCURRENCY = 5  // test 5 at a time
    const results = []

    // Read and parse the CSV file
    let fileContent
    try {
      fileContent = fs.readFileSync(filePath, 'utf8')
    } catch (err) {
      return { success: false, error: 'Cannot read file: ' + err.message }
    }

    const accounts = parseSmtpCsv(fileContent)
    if (accounts.length === 0) {
      return { success: false, error: 'No valid SMTP accounts found in CSV. Format: email,app_password' }
    }

    console.log('[SMTP Bulk] Testing ' + accounts.length + ' accounts...')

    // Emit start event
    BrowserWindow.getAllWindows().forEach(w => {
      try { w.webContents.send('smtp:bulkProgress', { completed: 0, total: accounts.length, results: [] }) } catch {}
    })

    // Process in parallel batches
    for (var i = 0; i < accounts.length; i += CONCURRENCY) {
      var batch = accounts.slice(i, i + CONCURRENCY)

      var batchResults = await Promise.all(batch.map(async (account) => {
        var result = await testSmtpBySending(account)
        return {
          email:     account.email,
          host:      account.host,
          port:      account.port,
          status:    result.status,
          category:  result.category,
          label:     result.label,
          message:   result.message,
          recipient: result.recipient || '',
          latency:   result.latency,
          timestamp: new Date().toISOString(),
        }
      }))

      results.push(...batchResults)

      // Emit progress after each batch
      BrowserWindow.getAllWindows().forEach(w => {
        try {
          w.webContents.send('smtp:bulkProgress', {
            completed: results.length,
            total:     accounts.length,
            results:   [...results],
          })
        } catch {}
      })

      console.log('[SMTP Bulk] Progress: ' + results.length + '/' + accounts.length)
    }

    // Save results to DB
    try {
      const insert = db.get().prepare(`
        INSERT INTO smtp_test_results (id, host, port, email, status, details, latency_ms, tested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      db.get().transaction(() => {
        for (const r of results) {
          insert.run(uuid(), r.host || '', r.port || 587, r.email, r.status, r.message, r.latency)
        }
      })()
    } catch (err) {
      console.error('[SMTP Bulk] DB save error:', err.message)
    }

    var summary = {
      total:    results.length,
      working:  results.filter(r => r.status === 'working').length,
      invalid:  results.filter(r => r.status === 'invalid').length,
      quota:    results.filter(r => r.status === 'quota').length,
      disabled: results.filter(r => r.status === 'disabled').length,
      timeout:  results.filter(r => r.status === 'timeout' || r.status === 'connection').length,
      failed:   results.filter(r => r.status === 'failed').length,
    }

    console.log('[SMTP Bulk] Done. Summary:', summary)
    return { success: true, results, summary }
  })

  // Parse CSV without testing (preview accounts)
  ipcMain.handle('smtp:parseCsv', async (_, filePath) => {
    try {
      const content  = fs.readFileSync(filePath, 'utf8')
      const accounts = parseSmtpCsv(content)
      return { success: true, accounts, total: accounts.length }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Export results to CSV
  ipcMain.handle('smtp:export', async (_, results, type) => {
    const { dialog } = require('electron')
    var filtered = type === 'all' ? results : results.filter(r => r.status === type || r.category === type)

    var { filePath } = await dialog.showSaveDialog({
      defaultPath: type + '-smtps-' + Date.now() + '.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    })

    if (!filePath) return { cancelled: true }

    var lines = [
      'email,host,port,status,category,error_reason,recipient_tested,latency_ms,timestamp',
      ...filtered.map(r =>
        [r.email, r.host||'', r.port||587, r.status, r.category||r.status,
         '"' + (r.message||'').replace(/"/g, "'") + '"',
         r.recipient||'', r.latency||'', r.timestamp||''].join(',')
      )
    ]

    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, count: filtered.length, filePath }
  })
}

// ── Analytics handlers ────────────────────────────────────────────────────────
function registerAnalyticsHandlers() {

  ipcMain.handle('analytics:dashboard', () => {
    const database = db.get()
    const totals = database.prepare(`
      SELECT
        SUM(sent_count) as total_sent,
        SUM(delivered_count) as total_delivered,
        SUM(open_count) as total_opens,
        SUM(click_count) as total_clicks,
        SUM(bounce_count) as total_bounces,
        SUM(failed_count) as total_failed,
        COUNT(*) as total_campaigns
      FROM campaigns WHERE status != 'draft'
    `).get()
    const recent = database.prepare(`
      SELECT c.*, cl.name as list_name, t.name as template_name
      FROM campaigns c
      LEFT JOIN contact_lists cl ON c.contact_list_id = cl.id
      LEFT JOIN templates t ON c.template_id = t.id
      ORDER BY c.created_at DESC LIMIT 5
    `).all()
    const serverHealth = database.prepare(`
      SELECT id, name, type, status, sent_today, daily_limit FROM servers ORDER BY created_at DESC
    `).all()
    return { totals, recent, serverHealth }
  })

  ipcMain.handle('analytics:overview', (_, period) => {
    const database = db.get()
    const days = period === '90days' ? 90 : period === 'alltime' ? 3650 : 30
    return database.prepare(`
      SELECT name, sent_count, open_count, click_count, bounce_count, unsubscribe_count, created_at
      FROM campaigns
      WHERE status = 'sent' AND created_at >= datetime('now', ? || ' days')
      ORDER BY created_at ASC
    `).all('-' + days)
  })

  ipcMain.handle('analytics:openers', async (_, campaignId) => {
    const database = db.get()
    const campaign = database.prepare('SELECT sent_count, open_count, total_recipients FROM campaigns WHERE id = ?').get(campaignId)
    const RAILWAY_URL = 'https://mailflow-tracking-server-production.up.railway.app'
    const ADMIN_KEY   = 'mailflow-admin-2026'
    var openers   = []
    var openCount = campaign?.open_count || 0

    try {
      const res = await fetch(RAILWAY_URL + '/api/campaign/' + campaignId + '/openers', {
        headers: { 'x-admin-key': ADMIN_KEY }
      })
      if (res.ok) {
        const data = await res.json()
        openers   = data.openers || []
        openCount = data.openCount || openCount
        if (openCount > (campaign?.open_count || 0)) {
          database.prepare('UPDATE campaigns SET open_count = ? WHERE id = ?').run(openCount, campaignId)
        }
      }
    } catch (err) {
      openers = database.prepare(`
        SELECT DISTINCT json_extract(te.metadata, '$.email') as email, te.created_at as opened_at
        FROM tracking_events te WHERE te.campaign_id = ? AND te.type = 'open'
        ORDER BY te.created_at DESC
      `).all(campaignId)
    }

    return {
      openers,
      total:     campaign?.total_recipients || 0,
      sent:      campaign?.sent_count || 0,
      openCount,
      openRate:  campaign?.sent_count > 0
        ? ((openCount / campaign.sent_count) * 100).toFixed(1) : '0.0'
    }
  })

  ipcMain.handle('analytics:campaign', (_, campaignId) => {
    const database = db.get()
    const campaign  = database.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId)
    const events    = database.prepare(`SELECT type, COUNT(*) as count FROM tracking_events WHERE campaign_id = ? GROUP BY type`).all(campaignId)
    return { campaign, events }
  })

  ipcMain.handle('analytics:export', async (_, period) => {
    const { dialog } = require('electron')
    const database   = db.get()
    const campaigns  = database.prepare(`
      SELECT name, status, total_recipients, sent_count, open_count, click_count, bounce_count, created_at
      FROM campaigns WHERE status = 'sent'
    `).all()
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: 'analytics-report.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (!filePath) return { cancelled: true }
    const lines = [
      'campaign,status,recipients,sent,opens,clicks,bounces,date',
      ...campaigns.map(c =>
        '"' + c.name + '",' + c.status + ',' + c.total_recipients + ',' + c.sent_count + ',' +
        c.open_count + ',' + c.click_count + ',' + c.bounce_count + ',' + c.created_at
      )
    ]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, count: campaigns.length }
  })
}

module.exports = { registerSmtpHandlers, registerAnalyticsHandlers }
