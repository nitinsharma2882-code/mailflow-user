const { ipcMain } = require('electron')
const dns = require('dns').promises
const net = require('net')
const fs = require('fs')
const csv = require('csv-parser')

function registerVerifyHandlers() {

  ipcMain.handle('verify:single', async (_, email) => {
    return verifyEmail(email, { checkMx: true, checkSmtp: false })
  })

  ipcMain.handle('verify:list', async (_, filePath, options) => {
    const emails = await readEmailsFromFile(filePath)
    const results = []

    for (const email of emails) {
      const result = await verifyEmail(email, options)
      results.push(result)
    }

    const valid = results.filter(r => r.status === 'valid').length
    const risky = results.filter(r => r.status === 'risky').length
    const invalid = results.filter(r => r.status === 'invalid').length

    return { results, summary: { total: results.length, valid, risky, invalid } }
  })

  ipcMain.handle('verify:export', async (_, results, type) => {
    const { dialog } = require('electron')
    const filtered = type === 'all' ? results : results.filter(r => r.status === type)

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${type}-emails.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })

    if (!filePath) return { cancelled: true }

    const lines = ['email,status,reason',
      ...filtered.map(r => `${r.email},${r.status},${r.reason || ''}`)
    ]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, count: filtered.length, filePath }
  })
}

async function verifyEmail(email, options = {}) {
  email = email.trim().toLowerCase()

  // Step 1: Syntax check
  const syntaxOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
  if (!syntaxOk) {
    return { email, status: 'invalid', reason: 'Syntax error — invalid email format' }
  }

  const domain = email.split('@')[1]

  // Step 2: MX record check
  if (options.checkMx !== false) {
    try {
      const records = await dns.resolveMx(domain)
      if (!records || records.length === 0) {
        return { email, status: 'risky', reason: 'No MX record found for domain', domain }
      }
      const mx = records.sort((a, b) => a.priority - b.priority)[0].exchange

      // Step 3: Optional SMTP handshake
      if (options.checkSmtp) {
        const smtpResult = await smtpHandshake(email, mx)
        if (!smtpResult.ok) {
          return { email, status: 'risky', reason: smtpResult.reason, domain, mx }
        }
      }

      return { email, status: 'valid', reason: 'MX record found', domain, mx }
    } catch (err) {
      if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
        return { email, status: 'risky', reason: 'Domain does not exist', domain }
      }
      return { email, status: 'risky', reason: `DNS error: ${err.code}`, domain }
    }
  }

  return { email, status: 'valid', reason: 'Syntax valid' }
}

async function smtpHandshake(email, mxHost) {
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mxHost)
    socket.setTimeout(5000)
    let data = ''
    let step = 0

    socket.on('connect', () => {})
    socket.on('data', (chunk) => {
      data += chunk.toString()
      if (step === 0 && data.includes('220')) {
        step = 1; socket.write(`EHLO mailflow.io\r\n`)
      } else if (step === 1 && data.includes('250')) {
        step = 2; socket.write(`MAIL FROM:<verify@mailflow.io>\r\n`)
      } else if (step === 2 && data.includes('250')) {
        step = 3; socket.write(`RCPT TO:<${email}>\r\n`)
      } else if (step === 3) {
        socket.write('QUIT\r\n')
        socket.destroy()
        if (data.includes('250') || data.includes('251')) {
          resolve({ ok: true })
        } else if (data.includes('550') || data.includes('551') || data.includes('553')) {
          resolve({ ok: false, reason: 'Mailbox does not exist' })
        } else {
          resolve({ ok: true }) // Assume valid if uncertain
        }
      }
    })
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: true, reason: 'SMTP timeout' }) })
    socket.on('error', () => resolve({ ok: true, reason: 'SMTP connection error' }))
  })
}

async function readEmailsFromFile(filePath) {
  return new Promise((resolve, reject) => {
    const emails = []
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        const email = row.email || row.Email || row.EMAIL || Object.values(row)[0]
        if (email && email.includes('@')) emails.push(email.trim())
      })
      .on('end', () => resolve(emails))
      .on('error', reject)
  })
}

module.exports = { registerVerifyHandlers, verifyEmail }
