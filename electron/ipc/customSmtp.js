const { ipcMain } = require('electron')
const nodemailer = require('nodemailer')

// Auto-detect SMTP config from email domain
function getSmtpConfig(email) {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return null

  const providers = {
    'gmail.com':        { host: 'smtp.gmail.com',      port: 587, encryption: 'tls' },
    'googlemail.com':   { host: 'smtp.gmail.com',      port: 587, encryption: 'tls' },
    'outlook.com':      { host: 'smtp.office365.com',  port: 587, encryption: 'tls' },
    'hotmail.com':      { host: 'smtp.office365.com',  port: 587, encryption: 'tls' },
    'live.com':         { host: 'smtp.office365.com',  port: 587, encryption: 'tls' },
    'msn.com':          { host: 'smtp.office365.com',  port: 587, encryption: 'tls' },
    'icloud.com':       { host: 'smtp.mail.me.com',    port: 587, encryption: 'tls' },
    'me.com':           { host: 'smtp.mail.me.com',    port: 587, encryption: 'tls' },
    'mac.com':          { host: 'smtp.mail.me.com',    port: 587, encryption: 'tls' },
    'yahoo.com':        { host: 'smtp.mail.yahoo.com', port: 587, encryption: 'tls' },
    'yahoo.co.in':      { host: 'smtp.mail.yahoo.com', port: 587, encryption: 'tls' },
    'zoho.com':         { host: 'smtp.zoho.com',       port: 587, encryption: 'tls' },
  }

  return providers[domain] || { host: `smtp.${domain}`, port: 587, encryption: 'tls' }
}

// Parse CSV text into array of { email, app_password }
// Supports files WITH or WITHOUT header row
function parseSmtpCsv(csvText) {
  const lines = csvText.trim().split('\n').filter(l => l.trim())
  if (lines.length === 0) return []

  // Check if first line is a header or actual data
  const firstLine = lines[0].split(',').map(c => c.trim())
  const firstCell = firstLine[0].toLowerCase()
  const hasHeader = firstCell.includes('email') || firstCell.includes('mail') || firstCell === 'user'

  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines
    .map(line => {
      // Split only on FIRST comma — passwords may contain spaces (e.g. "nzqu nvgl pofv bklt")
      const commaIdx = line.indexOf(',')
      if (commaIdx === -1) return null
      const email    = line.substring(0, commaIdx).trim()
      const password = line.substring(commaIdx + 1).trim()
      return { email, app_password: password }
    })
    .filter(r => r && r.email && r.email.includes('@') && r.app_password)
}

// Test a single SMTP account
async function testSmtpAccount({ email, app_password }) {
  const config = getSmtpConfig(email)
  if (!config) return { email, working: false, error: 'Unknown provider' }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false,
      requireTLS: true,
      auth: { user: email, pass: app_password },
      connectionTimeout: 8000,
      socketTimeout: 8000,
    })
    await transporter.verify()
    return { email, app_password, working: true, ...config }
  } catch (err) {
    return { email, app_password, working: false, error: err.message, ...config }
  }
}

function registerCustomSmtpHandlers() {
  // Parse uploaded CSV text
  ipcMain.handle('customSmtp:parseCsv', async (_, csvText) => {
    try {
      const accounts = parseSmtpCsv(csvText)
      return { success: true, accounts }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Validate all SMTP accounts
  ipcMain.handle('customSmtp:validate', async (_, accounts) => {
    const results = []
    for (const account of accounts) {
      const result = await testSmtpAccount(account)
      results.push(result)
    }
    const working = results.filter(r => r.working)
    const failed  = results.filter(r => !r.working)
    return { success: true, results, working, failed }
  })

  // Export working/failed as CSV
  ipcMain.handle('customSmtp:exportCsv', async (_, { accounts, filename }) => {
    const { dialog } = require('electron')
    const fs = require('fs')

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: filename || 'smtp-results.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (!filePath) return { cancelled: true }

    const lines = ['email,app_password,host,port,status,error',
      ...accounts.map(a =>
        `${a.email},${a.app_password},${a.host || ''},${a.port || ''},${a.working ? 'working' : 'failed'},${a.error || ''}`
      )
    ]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, filePath }
  })
}

module.exports = { registerCustomSmtpHandlers, getSmtpConfig, parseSmtpCsv, testSmtpAccount }
