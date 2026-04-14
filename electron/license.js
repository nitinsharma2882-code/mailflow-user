const { app, ipcMain } = require('electron')
const crypto = require('crypto')
const os     = require('os')
const path   = require('path')
const fs     = require('fs')

// ── CONFIG — set this to your Railway URL after deploying ─────────
const LICENSE_SERVER = process.env.LICENSE_SERVER_URL || 'https://your-license-server.railway.app'
const LICENSE_FILE   = path.join(app ? app.getPath('userData') : '.', 'license.dat')

// ── Hardware fingerprint ─────────────────────────────────────────
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

// ── Local encrypted storage ──────────────────────────────────────
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

// ── HTTP helper ──────────────────────────────────────────────────
function httpPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const http  = require('http')
    const url   = new URL(`${LICENSE_SERVER}${endpoint}`)
    const data  = JSON.stringify(body)
    const lib   = url.protocol === 'https:' ? https : http

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 10000
    }, (res) => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch { reject(new Error('Invalid server response')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => reject(new Error('Timeout')))
    req.write(data)
    req.end()
  })
}

// ── Check license (called on every startup) ──────────────────────
async function checkLicense() {
  const hardwareId = getHardwareId()
  const local      = loadLicense()

  if (!local?.key) return { valid: false, reason: 'no_license' }

  // First check local expiry (fast path, no network needed)
  if (local.expiresAt && new Date(local.expiresAt) < new Date()) {
    clearLicense()
    return {
      valid: false,
      reason: 'expired',
      error: 'Your license has expired. Enter a new key to continue.',
      expiredAt: local.expiresAt
    }
  }

  // Online verification
  try {
    const result = await httpPost('/api/verify', { licenseKey: local.key, hardwareId })

    if (result.success) {
      // Refresh local cache
      saveLicense({
        ...local,
        ...result.license,
        lastVerified: new Date().toISOString()
      })
      return { valid: true, license: result.license }
    } else {
      // Server says invalid/expired — clear and lock
      if (result.expired) {
        clearLicense()
        return { valid: false, reason: 'expired', error: result.error }
      }
      clearLicense()
      return { valid: false, reason: 'invalid', error: result.error }
    }
  } catch {
    // Offline fallback — allow up to 24 hours without verification
    if (local.lastVerified) {
      const hoursSince = (Date.now() - new Date(local.lastVerified).getTime()) / (1000 * 60 * 60)
      if (hoursSince <= 24) {
        return { valid: true, license: local, offline: true }
      }
    }
    return {
      valid: false,
      reason: 'offline',
      error: 'Cannot verify license. Please connect to the internet.'
    }
  }
}

// ── Activate new key ─────────────────────────────────────────────
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
      return { success: true, license: result.license }
    }
    return { success: false, error: result.error }
  } catch {
    return { success: false, error: 'Cannot connect to license server. Check your internet.' }
  }
}

// ── IPC handlers ─────────────────────────────────────────────────
function registerLicenseHandlers() {
  ipcMain.handle('license:check',         () => checkLicense())
  ipcMain.handle('license:activate',      (_, key) => activateLicense(key))
  ipcMain.handle('license:clear',         () => { clearLicense(); return { success: true } })
  ipcMain.handle('license:getInfo',       () => loadLicense())
  ipcMain.handle('license:getHardwareId', () => getHardwareId())
}

module.exports = { checkLicense, activateLicense, registerLicenseHandlers, getHardwareId }
