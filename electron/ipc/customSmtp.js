const { ipcMain, BrowserWindow } = require('electron')
const nodemailer = require('nodemailer')

// Session cache — avoid re-testing same SMTP
const smtpCache = new Map()

// Auto-detect SMTP config from email domain
function getSmtpConfig(email) {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return null

  const providers = {
    'gmail.com':        { host: 'smtp.gmail.com',      port: 587, secure: false },
    'googlemail.com':   { host: 'smtp.gmail.com',      port: 587, secure: false },
    'outlook.com':      { host: 'smtp.office365.com',  port: 587, secure: false },
    'hotmail.com':      { host: 'smtp.office365.com',  port: 587, secure: false },
    'live.com':         { host: 'smtp.office365.com',  port: 587, secure: false },
    'msn.com':          { host: 'smtp.office365.com',  port: 587, secure: false },
    'icloud.com':       { host: 'smtp.mail.me.com',    port: 587, secure: false },
    'me.com':           { host: 'smtp.mail.me.com',    port: 587, secure: false },
    'mac.com':          { host: 'smtp.mail.me.com',    port: 587, secure: false },
    'yahoo.com':        { host: 'smtp.mail.yahoo.com', port: 587, secure: false },
    'yahoo.co.in':      { host: 'smtp.mail.yahoo.com', port: 587, secure: false },
    'ymail.com':        { host: 'smtp.mail.yahoo.com', port: 587, secure: false },
    'zoho.com':         { host: 'smtp.zoho.com',       port: 587, secure: false },
    'zohomail.com':     { host: 'smtp.zoho.com',       port: 587, secure: false },
    'aol.com':          { host: 'smtp.aol.com',        port: 587, secure: false },
  }

  return providers[domain] || { host: `smtp.${domain}`, port: 587, secure: false }
}

// Check if error is quota/rate limit related
function isQuotaError(msg) {
  const m = (msg || '').toLowerCase()
  return m.includes('quota') || m.includes('daily limit') || m.includes('too many') ||
         m.includes('rate limit') || m.includes('sending limit') || m.includes('over quota') ||
         m.includes('550 5.4.5') || m.includes('421') || m.includes('452')
}

function isTimeoutError(msg) {
  const m = (msg || '').toLowerCase()
  return m.includes('timeout') || m.includes('timed out') || m.includes('etimedout') || m.includes('econnrefused')
}

function isCredentialError(msg) {
  const m = (msg || '').toLowerCase()
  return m.includes('invalid login') || m.includes('authentication') || m.includes('credentials') ||
         m.includes('535') || m.includes('username and password') || m.includes('bad credentials')
}

// Parse CSV — supports with or without headers, handles spaces in passwords
function parseSmtpCsv(csvText) {
  if (!csvText || !csvText.trim()) return []

  const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []

  // Detect if first line is a header
  const firstCell = lines[0].split(',')[0].trim().toLowerCase()
  const hasHeader  = firstCell === 'email' || firstCell === 'mail' || firstCell === 'user' || firstCell === 'username'
  const dataLines  = hasHeader ? lines.slice(1) : lines

  const results = []
  for (const line of dataLines) {
    const commaIdx = line.indexOf(',')
    if (commaIdx === -1) continue
    const email    = line.substring(0, commaIdx).trim()
    const password = line.substring(commaIdx + 1).trim().replace(/^"|"$/g, '') // strip quotes
    if (email && email.includes('@') && email.includes('.') && password) {
      results.push({ email: email.toLowerCase(), app_password: password })
    }
  }
  return results
}

// Test single SMTP with timeout — fast fail
async function testSmtpAccount({ email, app_password }) {
  const cacheKey = `${email}:${app_password}`

  // Return cached result if available
  if (smtpCache.has(cacheKey)) {
    return smtpCache.get(cacheKey)
  }

  const config = getSmtpConfig(email)
  if (!config) {
    const result = { email, app_password, working: false, status: 'failed', error: 'Unknown provider' }
    smtpCache.set(cacheKey, result)
    return result
  }

  // Create a promise that rejects after timeout
  const withTimeout = (promise, ms) => {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Connection timeout')), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  const tryConnect = async (host, port, secure) => {
    const transporter = nodemailer.createTransport({
      host, port, secure,
      requireTLS: !secure,
      auth: { user: email, pass: app_password },
      connectionTimeout: 6000,
      socketTimeout:     6000,
      tls: { rejectUnauthorized: false },
    })
    await withTimeout(transporter.verify(), 7000)
    return { host, port, secure }
  }

  // Try configs in order — stop at first success
  const attempts = [
    { host: config.host, port: 587, secure: false },
    { host: config.host, port: 465, secure: true  },
  ]

  for (const attempt of attempts) {
    try {
      const connected = await tryConnect(attempt.host, attempt.port, attempt.secure)
      const result = {
        email, app_password, working: true, status: 'working',
        host: connected.host, port: connected.port, secure: connected.secure
      }
      smtpCache.set(cacheKey, result)
      return result
    } catch (err) {
      const msg = err.message || ''

      if (isQuotaError(msg)) {
        const result = { email, app_password, working: false, status: 'quota_exceeded', error: msg, host: attempt.host, port: attempt.port }
        smtpCache.set(cacheKey, result)
        return result
      }

      if (isCredentialError(msg)) {
        // Credential error — no point trying other ports
        const result = { email, app_password, working: false, status: 'failed', error: 'Invalid credentials', host: attempt.host, port: attempt.port }
        smtpCache.set(cacheKey, result)
        return result
      }

      if (isTimeoutError(msg) && attempt === attempts[attempts.length - 1]) {
        const result = { email, app_password, working: false, status: 'timeout', error: 'Connection timed out', host: attempt.host, port: attempt.port }
        smtpCache.set(cacheKey, result)
        return result
      }
      // Otherwise continue to next attempt
    }
  }

  const result = { email, app_password, working: false, status: 'failed', error: 'Could not connect', host: config.host, port: config.port }
  smtpCache.set(cacheKey, result)
  return result
}

// Parallel validation with concurrency limit
async function validateWithProgress(accounts, concurrency = 8, onProgress) {
  const results = new Array(accounts.length)
  let completed = 0
  let index     = 0

  async function worker() {
    while (index < accounts.length) {
      const i       = index++
      const account = accounts[i]
      results[i]    = await testSmtpAccount(account)
      completed++
      if (onProgress) onProgress(completed, accounts.length, results[i])
    }
  }

  // Run N workers in parallel
  const workers = Array.from({ length: Math.min(concurrency, accounts.length) }, worker)
  await Promise.all(workers)
  return results
}

function registerCustomSmtpHandlers() {
  // Parse CSV instantly
  ipcMain.handle('customSmtp:parseCsv', async (_, csvText) => {
    try {
      const accounts = parseSmtpCsv(csvText)
      if (accounts.length === 0) {
        return { success: false, error: 'No valid accounts found. Format: email,app_password (one per line, no header needed)' }
      }
      return { success: true, accounts }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Validate with parallel processing + real-time progress
  ipcMain.handle('customSmtp:validate', async (_, accounts) => {
    // Clear old cache entries
    smtpCache.clear()

    const wins = BrowserWindow.getAllWindows()

    const results = await validateWithProgress(accounts, 8, (completed, total, latest) => {
      // Emit real-time progress to renderer
      wins.forEach(w => {
        try {
          w.webContents.send('customSmtp:progress', { completed, total, latest })
        } catch {}
      })
    })

    const working       = results.filter(r => r.working)
    const failed        = results.filter(r => !r.working && r.status === 'failed')
    const timeout       = results.filter(r => r.status === 'timeout')
    const quotaExceeded = results.filter(r => r.status === 'quota_exceeded')

    return { success: true, results, working, failed, timeout, quotaExceeded }
  })

  // Export CSV
  ipcMain.handle('customSmtp:exportCsv', async (_, { accounts, filename }) => {
    const { dialog } = require('electron')
    const fs = require('fs')
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: filename || 'smtp-results.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (!filePath) return { cancelled: true }
    const lines = ['email,app_password,host,port,status,error',
      ...accounts.map(a => `${a.email},${a.app_password},${a.host || ''},${a.port || ''},${a.status || (a.working ? 'working' : 'failed')},${a.error || ''}`)
    ]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, filePath }
  })
}

module.exports = { registerCustomSmtpHandlers, getSmtpConfig, parseSmtpCsv, testSmtpAccount, isQuotaError }
