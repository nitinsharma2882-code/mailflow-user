const { ipcMain } = require('electron')
const { v4: uuid } = require('uuid')
const nodemailer = require('nodemailer')
const db = require('../../database/db')

function registerServerHandlers() {

  ipcMain.handle('servers:getAll', () => {
    return db.get().prepare(`
      SELECT id, name, type, provider, host, port, email,
             encryption, from_email, from_name, daily_limit,
             per_min_limit, sent_today, status, last_tested,
             region, created_at
      FROM servers ORDER BY created_at DESC
    `).all()
  })

  ipcMain.handle('servers:create', async (_, data) => {
    const database = db.get()
    const id = uuid()

    database.prepare(`
      INSERT INTO servers (
        id, name, type, provider, host, port, email, password,
        encryption, api_key, region, from_email, from_name,
        daily_limit, per_min_limit, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested', datetime('now'))
    `).run(
      id, data.name, data.type, data.provider || null,
      data.host || null, data.port || null, data.email || null,
      data.password || null, data.encryption || 'tls',
      data.api_key || null, data.region || null,
      data.from_email || data.email || null,
      data.from_name || null,
      data.daily_limit || 500, data.per_min_limit || 60
    )

    return { id, ...data }
  })

  ipcMain.handle('servers:update', (_, id, data) => {
    const database = db.get()
    const allowed = ['name','host','port','email','password','encryption',
                     'api_key','region','from_email','from_name',
                     'daily_limit','per_min_limit','status']
    const fields = []
    const values = []

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`)
        values.push(data[key])
      }
    }
    values.push(id)
    database.prepare(`UPDATE servers SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return { success: true }
  })

  ipcMain.handle('servers:delete', (_, id) => {
    db.get().prepare('DELETE FROM servers WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('servers:test', async (_, id) => {
    const database = db.get()
    const server = database.prepare('SELECT * FROM servers WHERE id = ?').get(id)
    if (!server) return { success: false, error: 'Server not found' }

    const result = await testSmtpConnection(server)

    database.prepare(`
      UPDATE servers SET status = ?, last_tested = datetime('now') WHERE id = ?
    `).run(result.success ? 'active' : 'error', id)

    return result
  })

  ipcMain.handle('servers:testConfig', async (_, config) => {
    return testSmtpConnection(config)
  })
}

async function testSmtpConnection(config) {
  const start = Date.now()
  try {
    let transporter

    if (config.type === 'smtp') {
      transporter = nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port),
        secure: config.encryption === 'ssl',
        auth: { user: config.email, pass: config.password },
        connectionTimeout: 8000,
        greetingTimeout: 5000,
      })
    } else if (config.provider === 'ses') {
      // Actually test SES credentials
      return await testSesConnection(config)
    } else {
      return { success: true, latency: Date.now() - start, message: 'API credentials saved — send test email to fully verify' }
    }

    await transporter.verify()
    const latency = Date.now() - start

    return {
      success: true,
      latency,
      message: `Connected in ${latency}ms — ready to send`
    }
  } catch (err) {
    return {
      success: false,
      latency: Date.now() - start,
      error: err.message,
      message: parseSmtpError(err.message)
    }
  }
}

function parseSmtpError(msg) {
  if (msg.includes('535') || msg.includes('auth')) return 'Authentication failed — check email and password'
  if (msg.includes('ECONNREFUSED')) return 'Connection refused — check host and port'
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) return 'Connection timed out — check host/firewall'
  if (msg.includes('ENOTFOUND')) return 'Host not found — check SMTP hostname'
  if (msg.includes('SSL') || msg.includes('TLS')) return 'Encryption error — try switching TLS/SSL'
  return msg
}

async function testSesConnection(config) {
  const start = Date.now()
  try {
    const { SESClient, GetSendQuotaCommand, GetIdentityVerificationAttributesCommand } = require('@aws-sdk/client-ses')

    if (!config.api_key || !config.password) {
      return { success: false, message: 'Access Key ID and Secret Access Key are required' }
    }

    const client = new SESClient({
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId:     config.api_key.trim(),
        secretAccessKey: config.password.trim()
      }
    })

    // Test 1: Check credentials and get quota
    const quota = await client.send(new GetSendQuotaCommand({}))
    const latency = Date.now() - start

    // Test 2: Check if sender email is verified
    if (config.from_email) {
      const verifyResult = await client.send(new GetIdentityVerificationAttributesCommand({
        Identities: [config.from_email]
      }))
      const attrs = verifyResult.VerificationAttributes || {}
      const emailStatus = attrs[config.from_email]?.VerificationStatus

      if (emailStatus !== 'Success') {
        return {
          success: false,
          latency,
          message: `Credentials valid BUT sender email "${config.from_email}" is NOT verified in SES. Please verify it in AWS Console first.`
        }
      }
    }

    return {
      success: true,
      latency,
      message: `SES Connected! Daily quota: ${quota.Max24HourSend?.toLocaleString()} emails · Rate: ${quota.MaxSendRate}/sec`,
      quota: {
        max24Hour:   quota.Max24HourSend,
        maxRate:     quota.MaxSendRate,
        sentLast24h: quota.SentLast24Hours
      }
    }
  } catch (err) {
    const latency = Date.now() - start
    let message = err.message
    if (err.name === 'InvalidClientTokenId' || message.includes('invalid')) {
      message = 'Invalid Access Key ID — check your AWS credentials'
    } else if (err.name === 'SignatureDoesNotMatch' || message.includes('signature')) {
      message = 'Invalid Secret Access Key — check your AWS credentials'
    } else if (message.includes('region') || err.name === 'EndpointError') {
      message = 'Invalid region — check your AWS region (e.g. us-east-1)'
    } else if (message.includes('not authorized') || err.name === 'AccessDenied') {
      message = 'Access denied — ensure IAM user has SES permissions (ses:SendEmail, ses:GetSendQuota)'
    }
    return { success: false, latency, message, error: err.name }
  }
}

// Add SES test as separate IPC handler
const { ipcMain: _ipc2 } = require('electron')
_ipc2.handle('servers:testSes', async (_, config) => {
  return testSesConnection(config)
})

module.exports = { registerServerHandlers, testSmtpConnection, testSesConnection }
