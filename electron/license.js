const { app, ipcMain, net, BrowserWindow } = require('electron')
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const crypto = require('crypto')
const os     = require('os')
const path   = require('path')
const fs     = require('fs')

const LICENSE_SERVER = process.env.LICENSE_SERVER_URL || 'https://mailflow-license-server-production.up.railway.app'
const LICENSE_FILE   = path.join(app ? app.getPath('userData') : '.', 'license.dat')

// Session check interval — every 30 minutes
const SESSION_CHECK_INTERVAL = 30 * 60 * 1000
let sessionCheckTimer = null

function getHardwareId() {
  const data = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || '',
    os.totalmem().toString(),
  ].join('|')
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32)
}

const ENCRYPT_KEY = crypto.createHash('sha256')
  .update('mailflow-license-encryption-key-2026')
  .digest()

function encryptData(data) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPT_KEY, iv)
  let enc = cipher.update(JSON.stringify(data), 'utf8', 'hex')
  enc += cipher.final('hex')
  return iv.toString('hex') + ':' + enc
}

function decryptData(encrypted) {
  try {
    const [ivHex, data] = encrypted.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPT_KEY, iv)
    let dec = decipher.update(data, 'hex', 'utf8')
    dec += decipher.final('utf8')
    return JSON.parse(dec)
  } catch { return null }
}

function saveLicense(data) {
  fs.writeFileSync(LICENSE_FILE, encryptData(data), 'utf8')
}

function loadLicense() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null
    return decryptData(fs.readFileSync(LICENSE_FILE, 'utf8'))
  } catch { return null }
}

function clearLicense() {
  try { fs.unlinkSync(LICENSE_FILE) } catch {}
}

function httpPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${LICENSE_SERVER}${endpoint}`
    const data    = JSON.stringify(body)

    // Parse URL manually — avoids obfuscation issues with URL constructor
    const isHttps   = fullUrl.startsWith('https://')
    const protocol  = isHttps ? 'https:' : 'http:'
    const withoutProto = fullUrl.replace(/^https?:\/\//, '')
    const slashIdx  = withoutProto.indexOf('/')
    const hostPart  = slashIdx === -1 ? withoutProto : withoutProto.substring(0, slashIdx)
    const urlPath   = slashIdx === -1 ? '/' : withoutProto.substring(slashIdx)
    const colonIdx  = hostPart.indexOf(':')
    const hostname  = colonIdx === -1 ? hostPart : hostPart.substring(0, colonIdx)
    const port      = colonIdx === -1 ? (isHttps ? 443 : 80) : parseInt(hostPart.substring(colonIdx + 1))

    const request = net.request({
      method:   'POST',
      protocol: protocol,
      hostname: hostname,
      port:     port,
      path:     urlPath,
    })

    request.setHeader('Content-Type', 'application/json')
    request.setHeader('Content-Length', Buffer.byteLength(data))

    let responseBody = ''
    request.on('response', (response) => {
      response.on('data', (chunk) => { responseBody += chunk.toString() })
      response.on('end', () => {
        try { resolve(JSON.parse(responseBody)) }
        catch (e) { reject(new Error('Invalid server response: ' + responseBody.substring(0, 100))) }
      })
    })
    request.on('error', (err) => reject(new Error('Network error: ' + err.message)))
    request.setTimeout(15000, () => {
      request.abort()
      reject(new Error('Request timeout — check your internet connection'))
    })
    request.write(data)
    request.end()
  })
}

// ── SESSION VALIDATION — runs periodically while app is open ─────
async function validateSession() {
  const local = loadLicense()
  if (!local?.key) return

  try {
    const hardwareId = getHardwareId()
    const result = await httpPost('/api/session/validate', {
      licenseKey: local.key,
      hardwareId
    })

    if (!result.valid) {
      // License expired or revoked during session
      clearLicense()
      stopSessionCheck()

      // Notify all windows
      BrowserWindow.getAllWindows().forEach(w => {
        try {
          w.webContents.send('license:expired', {
            reason: result.reason,
            error:  result.error || 'Your license key has expired. Please enter a valid key to continue.'
          })
        } catch {}
      })

      console.log(`[License] Session invalid: ${result.reason}`)
      return
    }

    // Warn if expiring soon
    if (result.expiringSoon && result.daysRemaining !== null) {
      BrowserWindow.getAllWindows().forEach(w => {
        try {
          w.webContents.send('license:expiringSoon', {
            daysRemaining: result.daysRemaining,
            expiresAt:     result.expiresAt
          })
        } catch {}
      })
    }

    // Update local cache
    saveLicense({
      ...local,
      expiresAt:     result.expiresAt,
      daysRemaining: result.daysRemaining,
      lastVerified:  new Date().toISOString()
    })

  } catch (err) {
    console.log('[License] Session check failed (offline):', err.message)
    // Don't invalidate — user might be offline
  }
}

function startSessionCheck() {
  stopSessionCheck()
  // Check after 5 minutes first time, then every 30 min
  setTimeout(() => {
    validateSession()
    sessionCheckTimer = setInterval(validateSession, SESSION_CHECK_INTERVAL)
  }, 5 * 60 * 1000)
}

function stopSessionCheck() {
  if (sessionCheckTimer) {
    clearInterval(sessionCheckTimer)
    sessionCheckTimer = null
  }
}

// ── CHECK LICENSE ON STARTUP ─────────────────────────────────────
async function checkLicense() {
  const hardwareId = getHardwareId()
  const local      = loadLicense()

  if (!local?.key) return { valid: false, reason: 'no_license' }

  // Local expiry check first (fast)
  if (local.expiresAt && new Date(local.expiresAt) < new Date()) {
    clearLicense()
    return {
      valid: false,
      reason: 'expired',
      error: 'Your license key has expired. Please enter a valid key to continue.',
      expiredAt: local.expiresAt
    }
  }

  try {
    const result = await httpPost('/api/verify', { licenseKey: local.key, hardwareId })

    if (result.success) {
      saveLicense({ ...local, ...result.license, lastVerified: new Date().toISOString() })
      // Start periodic session checks
      startSessionCheck()
      return { valid: true, license: result.license }
    } else {
      if (result.expired) {
        clearLicense()
        return {
          valid: false,
          reason: 'expired',
          error: result.error || 'Your license key has expired. Please enter a valid key to continue.'
        }
      }
      clearLicense()
      return { valid: false, reason: 'invalid', error: result.error }
    }
  } catch (err) {
    // Offline grace period — 24 hours
    if (local.lastVerified) {
      const hoursSince = (Date.now() - new Date(local.lastVerified).getTime()) / (1000 * 60 * 60)
      if (hoursSince <= 24) {
        startSessionCheck()
        return { valid: true, license: local, offline: true }
      }
    }
    return {
      valid: false,
      reason: 'offline',
      error: 'Cannot verify license. Please check your internet connection.'
    }
  }
}

// ── ACTIVATE LICENSE ─────────────────────────────────────────────
async function activateLicense(licenseKey) {
  const hardwareId  = getHardwareId()
  const machineName = os.hostname()

  try {
    const result = await httpPost('/api/activate', { licenseKey, hardwareId, machineName })

    if (result.success) {
      saveLicense({
        key: licenseKey.trim().toUpperCase(),
        ...result.license,
        hardwareId,
        lastVerified: new Date().toISOString()
      })
      startSessionCheck()
      return { success: true, license: result.license }
    }
    return { success: false, error: result.error }
  } catch (err) {
    return { success: false, error: 'Connection failed: ' + err.message }
  }
}

// ── IPC HANDLERS ─────────────────────────────────────────────────
function registerLicenseHandlers() {
  ipcMain.handle('license:check',         () => checkLicense())
  ipcMain.handle('license:activate',      (_, key) => activateLicense(key))
  ipcMain.handle('license:clear',         () => { clearLicense(); stopSessionCheck(); return { success: true } })
  ipcMain.handle('license:getInfo',       () => loadLicense())
  ipcMain.handle('license:getHardwareId', () => getHardwareId())
  ipcMain.handle('license:validateNow',   () => validateSession())
}

module.exports = { checkLicense, activateLicense, registerLicenseHandlers, getHardwareId, stopSessionCheck }
