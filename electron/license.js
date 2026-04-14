const { app, ipcMain, net } = require('electron')
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const crypto = require('crypto')
const os     = require('os')
const path   = require('path')
const fs     = require('fs')

const LICENSE_SERVER = process.env.LICENSE_SERVER_URL || 'https://mailflow-license-server-production.up.railway.app'
const LICENSE_FILE   = path.join(app ? app.getPath('userData') : '.', 'license.dat')

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
    const url = `${LICENSE_SERVER}${endpoint}`
    const data = JSON.stringify(body)

    const request = net.request({
      method: 'POST',
      url: url,
    })

    request.setHeader('Content-Type', 'application/json')
    request.setHeader('Content-Length', Buffer.byteLength(data))

    let responseBody = ''

    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseBody += chunk.toString()
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(responseBody))
        } catch (e) {
          reject(new Error('Invalid server response: ' + responseBody))
        }
      })
    })

    request.on('error', (err) => {
      reject(new Error('Network error: ' + err.message))
    })

    request.write(data)
    request.end()
  })
}

async function checkLicense() {
  const hardwareId = getHardwareId()
  const local      = loadLicense()

  if (!local?.key) return { valid: false, reason: 'no_license' }

  if (local.expiresAt && new Date(local.expiresAt) < new Date()) {
    clearLicense()
    return {
      valid: false,
      reason: 'expired',
      error: 'Your license has expired. Enter a new key to continue.',
      expiredAt: local.expiresAt
    }
  }

  try {
    const result = await httpPost('/api/verify', { licenseKey: local.key, hardwareId })
    if (result.success) {
      saveLicense({ ...local, ...result.license, lastVerified: new Date().toISOString() })
      return { valid: true, license: result.license }
    } else {
      if (result.expired) { clearLicense(); return { valid: false, reason: 'expired', error: result.error } }
      clearLicense()
      return { valid: false, reason: 'invalid', error: result.error }
    }
  } catch (err) {
    if (local.lastVerified) {
      const hoursSince = (Date.now() - new Date(local.lastVerified).getTime()) / (1000 * 60 * 60)
      if (hoursSince <= 24) return { valid: true, license: local, offline: true }
    }
    return { valid: false, reason: 'offline', error: 'Cannot verify license. Error: ' + err.message }
  }
}

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
  } catch (err) {
    return { success: false, error: 'Connection failed: ' + err.message }
  }
}

function registerLicenseHandlers() {
  ipcMain.handle('license:check',         () => checkLicense())
  ipcMain.handle('license:activate',      (_, key) => activateLicense(key))
  ipcMain.handle('license:clear',         () => { clearLicense(); return { success: true } })
  ipcMain.handle('license:getInfo',       () => loadLicense())
  ipcMain.handle('license:getHardwareId', () => getHardwareId())
  ipcMain.handle('license:saveActivation', (_, key, license, hardwareId) => {
    saveLicense({ key, ...license, hardwareId, lastVerified: new Date().toISOString() })
    return { success: true }
  })
}

module.exports = { checkLicense, activateLicense, registerLicenseHandlers, getHardwareId }