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

  ipcMain.handle('servers:testSes', async (_, config) => {
    return testSesConnection(config)
  })
}

async function testSmtpConnection(config) {
  const start = Date.now()
  try {
    if (config.provider === 'ses') return await testSesConnection(config)

    if (config.type !== 'smtp') {
      return { success: true, latency: Date.now() - start, message: 'API credentials saved — send test email to verify' }
    }

    var isM365 = config.host && (
      config.host.includes('office365.com') ||
      config.host.includes('outlook.com') ||
      config.host.includes('microsoft.com')
    )

    var tlsConfig = isM365
      ? { rejectUnauthorized: false, minVersion: 'TLSv1.2' }
      : { rejectUnauthorized: false }

    const transporter = nodemailer.createTransport({
      host:               config.host,
      port:               parseInt(config.port),
      secure:             config.encryption === 'ssl',
      requireTLS:         isM365 ? true : config.encryption !== 'none',
      auth:               { user: config.email, pass: config.password },
      connectionTimeout:  12000,
      greetingTimeout:    8000,
      tls:                tlsConfig,
    })

    await transporter.verify()
    transporter.close()
    const latency = Date.now() - start

    var msg = 'Connected in ' + latency + 'ms — ready to send'
    if (isM365) msg = 'Microsoft 365 connected in ' + latency + 'ms ✓'

    return { success: true, latency, message: msg }

  } catch (err) {
    return {
      success: false,
      latency: Date.now() - start,
      error:   err.message,
      message: parseSmtpError(err.message, config.host)
    }
  }
}

function parseSmtpError(msg, host) {
  var isM365 = host && (host.includes('office365') || host.includes('outlook') || host.includes('microsoft'))
  if (msg.includes('535') || msg.includes('auth') || msg.includes('5.7.3')) {
    if (isM365) return 'M365 Auth failed — Check: (1) SMTP AUTH enabled in M365 admin, (2) Correct password or App Password if MFA on'
    return 'Authentication failed — check email and password/app password'
  }
  if (msg.includes('5.7.57') || msg.includes('SMTP AUTH')) return 'M365: SMTP AUTH not enabled — Go to admin.microsoft.com → Users → Enable Authenticated SMTP'
  if (msg.includes('ECONNREFUSED')) return 'Connection refused — check host and port'
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) return 'Connection timed out — check host/firewall settings'
  if (msg.includes('ENOTFOUND')) return 'Host not found — check SMTP hostname'
  if (msg.includes('SSL') || msg.includes('TLS')) return 'Encryption error — ensure TLS is selected for port 587'
  if (msg.includes('certificate')) return 'SSL certificate error — try disabling certificate validation'
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

module.exports = { registerServerHandlers, testSmtpConnection, testSesConnection }
