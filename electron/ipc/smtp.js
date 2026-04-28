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
      msg.includes('username and password') || msg.includes('auth') || msg.includes('5.7.8') ||
      msg.includes('invalid login') || msg.includes('bad credentials')) {
    return { category: 'invalid', label: 'Invalid Credentials' }
  }
  if (msg.includes('daily') || msg.includes('quota') || msg.includes('limit exceeded') ||
      msg.includes('too many') || msg.includes('4.7.') || msg.includes('rate')) {
    return { category: 'quota', label: 'Quota Exceeded' }
  }
  if (msg.includes('disabled') || msg.includes('suspended') || msg.includes('blocked') ||
      msg.includes('5.7.0') || msg.includes('policy') || msg.includes('not allowed') ||
      msg.includes('deactivated')) {
    return { category: 'disabled', label: 'Account Disabled/Blocked' }
  }
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset') ||
      msg.includes('network') || msg.includes('socket')) {
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

// ── Core: test one SMTP by actually sending ──────────────────────────────────
async function testSmtpBySending(smtpConfig, attempt) {
  if (!attempt) attempt = 1
  const start = Date.now()
  const { host, port, email, password } = smtpConfig
  const portNum = parseInt(port) || 587

  console.log('[SMTP Test] Testing: ' + email + ' via ' + host + ':' + portNum + ' (attempt ' + attempt + ')')

  var transporter = null
  try {
    var transportConfig = {
      host:              host,
      port:              portNum,
      secure:            portNum === 465,
      auth:              { user: email, pass: password },
      connectionTimeout: 15000,
      greetingTimeout:   10000,
      socketTimeout:     15000,
      tls:               { rejectUnauthorized: false, minVersion: 'TLSv1' },
    }
    if (portNum === 587) transportConfig.requireTLS = true

    transporter = nodemailer.createTransport(transportConfig)
    await transporter.verify()

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
    console.log('[SMTP Test] ✅ Working: ' + email + ' → ' + recipient + ' (' + latency + 'ms)')

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
    const { category, label } = categorizeError(errMsg)
    console.log('[SMTP Test] ❌ ' + category + ': ' + email + ' — ' + errMsg.substring(0, 80))

    if (attempt === 1 && category !== 'invalid' && category !== 'quota' && category !== 'disabled') {
      console.log('[SMTP Test] Retrying ' + email + ' in 2s...')
      await new Promise(function(r) { setTimeout(r, 2000) })
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

// ── Parse CSV ────────────────────────────────────────────────────────────────
function parseSmtpCsv(content) {
  const lines = content.split('\n').map(function(l) { return l.trim() }).filter(function(l) { return l.length > 0 })
  const accounts = []

  for (const line of lines) {
    if (line.toLowerCase().startsWith('email,') || line.toLowerCase().startsWith('host,')) continue
    const parts = line.split(',')
    if (parts.length < 2) continue

    if (parts[0].includes('@')) {
      const email    = parts[0].trim()
      const password = parts.slice(1).join(',').trim().replace(/^"|"$/g, '')
      const smtpConf = detectSmtpConfig(email)
      // Store app_password explicitly so export always has it
      accounts.push({ email, password, app_password: password, ...smtpConf })
    } else if (parts.length >= 3 && parts[2].includes('@')) {
      const password = parts.slice(3).join(',').trim().replace(/^"|"$/g, '')
      accounts.push({
        host:         parts[0].trim(),
        port:         parseInt(parts[1]) || 587,
        email:        parts[2].trim(),
        password:     password,
        app_password: password,
      })
    }
  }

  return accounts
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────
function registerSmtpHandlers() {

  // Single test
  ipcMain.handle('smtp:testSingle', async function(_, config) {
    const { testSmtpConnection } = require('./servers')
    const result = await testSmtpConnection({ type: 'smtp', ...config })
    try {
      db.get().prepare(
        "INSERT INTO smtp_test_results (id, host, port, email, status, details, latency_ms, tested_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run(uuid(), config.host, config.port, config.email,
        result.success ? 'working' : 'failed',
        result.message || result.error, result.latency)
    } catch {}
    return result
  })

  // Bulk test
  ipcMain.handle('smtp:testBulk', async function(_, filePath) {
    const CONCURRENCY = 5
    const results = []

    var fileContent
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

    BrowserWindow.getAllWindows().forEach(function(w) {
      try { w.webContents.send('smtp:bulkProgress', { completed: 0, total: accounts.length, results: [] }) } catch {}
    })

    for (var i = 0; i < accounts.length; i += CONCURRENCY) {
      var batch = accounts.slice(i, i + CONCURRENCY)

      var batchResults = await Promise.all(batch.map(async function(account) {
        try {
          var result = await testSmtpBySending(account)
          return {
            email:        account.email,
            app_password: account.app_password || account.password || '',
            host:         account.host || '',
            port:         account.port || 587,
            status:       result.status,
            category:     result.category,
            label:        result.label,
            message:      result.message,
            recipient:    result.recipient || '',
            latency:      result.latency || 0,
            timestamp:    new Date().toISOString(),
          }
        } catch (unexpectedErr) {
          console.error('[SMTP Bulk] Unexpected error for ' + account.email + ':', unexpectedErr.message)
          return {
            email:        account.email || 'unknown',
            app_password: account.app_password || account.password || '',
            host:         account.host || '',
            port:         account.port || 587,
            status:       'failed',
            category:     'failed',
            label:        'Failed',
            message:      'Unexpected error: ' + (unexpectedErr.message || 'unknown'),
            recipient:    '',
            latency:      0,
            timestamp:    new Date().toISOString(),
          }
        }
      }))

      var validBatchResults = batchResults.filter(function(r) { return r != null && r.email })
      results.push(...validBatchResults)

      if (validBatchResults.length !== batch.length) {
        console.error('[SMTP Bulk] ⚠ Batch mismatch! Expected ' + batch.length + ' got ' + validBatchResults.length)
      }

      BrowserWindow.getAllWindows().forEach(function(w) {
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

    // Safety net — ensure all accounts have a result
    if (results.length < accounts.length) {
      console.error('[SMTP Bulk] Missing results! Got ' + results.length + ' of ' + accounts.length)
      var testedEmails = new Set(results.map(function(r) { return r.email }))
      for (var acc of accounts) {
        if (!testedEmails.has(acc.email)) {
          results.push({
            email:        acc.email,
            app_password: acc.app_password || acc.password || '',
            host:         acc.host || '',
            port:         acc.port || 587,
            status:       'failed',
            category:     'failed',
            label:        'Failed',
            message:      'Account was not tested — possible processing error',
            recipient:    '',
            latency:      0,
            timestamp:    new Date().toISOString(),
          })
        }
      }
    }

    // Save to DB
    try {
      const insert = db.get().prepare(
        "INSERT INTO smtp_test_results (id, host, port, email, status, details, latency_ms, tested_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))"
      )
      db.get().transaction(function() {
        for (const r of results) {
          insert.run(uuid(), r.host || '', r.port || 587, r.email, r.status, r.message, r.latency)
        }
      })()
    } catch (err) {
      console.error('[SMTP Bulk] DB save error:', err.message)
    }

    var summary = {
      total:    results.length,
      working:  results.filter(function(r) { return r.status === 'working' }).length,
      invalid:  results.filter(function(r) { return r.status === 'invalid' }).length,
      quota:    results.filter(function(r) { return r.status === 'quota' }).length,
      disabled: results.filter(function(r) { return r.status === 'disabled' }).length,
      timeout:  results.filter(function(r) { return r.status === 'timeout' || r.status === 'connection' }).length,
      failed:   results.filter(function(r) { return r.status === 'failed' || r.status === 'tls' }).length,
    }

    console.log('[SMTP Bulk] Done. Summary:', summary)
    return { success: true, results, summary }
  })

  // Parse CSV preview
  ipcMain.handle('smtp:parseCsv', async function(_, filePath) {
    try {
      const content  = fs.readFileSync(filePath, 'utf8')
      const accounts = parseSmtpCsv(content)
      return { success: true, accounts, total: accounts.length }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Export results — includes app_password, supports all categories including failed
  ipcMain.handle('smtp:export', async function(_, results, type) {
    const { dialog } = require('electron')

    var filtered
    if (type === 'all') {
      filtered = results
    } else if (type === 'working') {
      filtered = results.filter(function(r) { return r.status === 'working' })
    } else if (type === 'invalid') {
      filtered = results.filter(function(r) { return r.status === 'invalid' })
    } else if (type === 'quota') {
      filtered = results.filter(function(r) { return r.status === 'quota' })
    } else if (type === 'disabled') {
      filtered = results.filter(function(r) { return r.status === 'disabled' })
    } else if (type === 'timeout') {
      filtered = results.filter(function(r) { return r.status === 'timeout' || r.status === 'connection' })
    } else if (type === 'failed') {
      filtered = results.filter(function(r) { return r.status === 'failed' || r.status === 'tls' })
    } else {
      filtered = results.filter(function(r) { return r.status === type || r.category === type })
    }

    if (!filtered || filtered.length === 0) {
      return { success: false, error: 'No data to export for this category' }
    }

    var saveResult = await dialog.showSaveDialog({
      defaultPath: type + '-smtps-' + Date.now() + '.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    })

    if (saveResult.cancelled || !saveResult.filePath) return { cancelled: true }

    var lines = ['email,app_password,status,error_reason,host,port,latency_ms,timestamp']
    filtered.forEach(function(r) {
      var email    = (r.email        || '').replace(/,/g, ' ')
      var password = (r.app_password || '').replace(/,/g, ' ')
      var status   = (r.status       || '')
      var error    = (r.message      || '').replace(/,/g, ' ').replace(/\n/g, ' ').replace(/"/g, "'").substring(0, 300)
      var host     = (r.host         || '').replace(/,/g, ' ')
      var port     = r.port    || 587
      var latency  = r.latency || ''
      var ts       = r.timestamp || ''
      lines.push([email, password, status, '"' + error + '"', host, port, latency, ts].join(','))
    })

    fs.writeFileSync(saveResult.filePath, lines.join('\n'), 'utf8')
    console.log('[SMTP Export] Wrote ' + filtered.length + ' rows to ' + saveResult.filePath)
    return { success: true, count: filtered.length, filePath: saveResult.filePath }
  })
}

// ── Analytics handlers ────────────────────────────────────────────────────────
function registerAnalyticsHandlers() {

  ipcMain.handle('analytics:dashboard', function() {
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
    const serverHealth = database.prepare(
      'SELECT id, name, type, status, sent_today, daily_limit FROM servers ORDER BY created_at DESC'
    ).all()
    return { totals, recent, serverHealth }
  })

  ipcMain.handle('analytics:overview', function(_, period) {
    const database = db.get()
    const days = period === '90days' ? 90 : period === 'alltime' ? 3650 : 30
    return database.prepare(`
      SELECT name, sent_count, open_count, click_count, bounce_count, unsubscribe_count, created_at
      FROM campaigns
      WHERE status = 'sent' AND created_at >= datetime('now', '-' || ? || ' days')
      ORDER BY created_at ASC
    `).all(days)
  })

  ipcMain.handle('analytics:openers', async function(_, campaignId) {
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

  ipcMain.handle('analytics:campaign', function(_, campaignId) {
    const database = db.get()
    const campaign  = database.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId)
    const events    = database.prepare('SELECT type, COUNT(*) as count FROM tracking_events WHERE campaign_id = ? GROUP BY type').all(campaignId)
    return { campaign, events }
  })

  ipcMain.handle('analytics:export', async function(_, period) {
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
      ...campaigns.map(function(c) {
        return '"' + c.name + '",' + c.status + ',' + c.total_recipients + ',' + c.sent_count + ',' +
          c.open_count + ',' + c.click_count + ',' + c.bounce_count + ',' + c.created_at
      })
    ]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, count: campaigns.length }
  })
}

module.exports = { registerSmtpHandlers, registerAnalyticsHandlers }
