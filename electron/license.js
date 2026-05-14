const { app, ipcMain, BrowserWindow } = require('electron')
const crypto = require('crypto')
const os     = require('os')
const path   = require('path')
const fs     = require('fs')
const https  = require('https')
const http   = require('http')

function httpRequest(url, method, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const urlObj  = new URL(url)
    const isHttps = urlObj.protocol === 'https:'
    const mod     = isHttps ? https : http
    const bodyStr = body ? JSON.stringify(body) : null
    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (isHttps ? 443 : 80),
      path:     urlObj.pathname + (urlObj.search || ''),
      method:   method || 'GET',
      headers:  Object.assign(
        { 'Content-Type': 'application/json' },
        bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {},
        extraHeaders || {}
      ),
      rejectUnauthorized: false,
    }
    const req = mod.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          resolve({
            ok:     res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json:   () => JSON.parse(data),
          })
        } catch (e) {
          reject(new Error('Invalid JSON response: ' + data.substring(0, 100)))
        }
      })
    })
    req.on('error',   (e) => reject(new Error('Network error: ' + e.message)))
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout after 15s')) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// Disable TLS verification for Railway
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const LICENSE_SERVER = 'https://mailflow-license-server-production.up.railway.app'
const LICENSE_FILE   = path.join(app ? app.getPath('userData') : '.', 'license.dat')

const SESSION_CHECK_INTERVAL = 30 * 60 * 1000
let sessionCheckTimer = null

function getMacAddress() {
  try {
    const interfaces = os.networkInterfaces()
    const macs = []
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          macs.push(iface.mac)
        }
      }
    }
    return macs.sort().join(',')
  } catch (e) { return '' }
}

function getWindowsGuid() {
  try {
    // Try to read Windows MachineGuid — unique per Windows installation
    const { execSync } = require('child_process')
    const result = execSync(
      'reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid',
      { encoding: 'utf8', timeout: 3000, windowsHide: true }
    )
    const match = result.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/)
    return match ? match[1] : ''
  } catch (e) { return '' }
}

function getHardwareId() {
  const mac      = getMacAddress()
  const winGuid  = getWindowsGuid()
  const data = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0] ? os.cpus()[0].model : '',
    os.totalmem().toString(),
    mac,
    winGuid,
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
    const parts = encrypted.split(':')
    const iv = Buffer.from(parts[0], 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPT_KEY, iv)
    let dec = decipher.update(parts[1], 'hex', 'utf8')
    dec += decipher.final('utf8')
    return JSON.parse(dec)
  } catch (e) { return null }
}

function saveLicense(data) {
  fs.writeFileSync(LICENSE_FILE, encryptData(data), 'utf8')
}

function loadLicense() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null
    return decryptData(fs.readFileSync(LICENSE_FILE, 'utf8'))
  } catch (e) { return null }
}

function clearLicense() {
  try { fs.unlinkSync(LICENSE_FILE) } catch (e) {}
}

// Simple HTTPS POST using Node's built-in https module
function httpPost(endpoint, body) {
  return new Promise(function(resolve, reject) {
    const postData = JSON.stringify(body)
    const options = {
      hostname: 'mailflow-license-server-production.up.railway.app',
      port: 443,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      rejectUnauthorized: false
    }

    const req = https.request(options, function(res) {
      let data = ''
      res.on('data', function(chunk) { data += chunk })
      res.on('end', function() {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('Invalid response from server'))
        }
      })
    })

    req.on('error', function(err) {
      reject(new Error('Connection failed: ' + err.message))
    })

    req.setTimeout(15000, function() {
      req.destroy()
      reject(new Error('Connection timeout — check your internet'))
    })

    req.write(postData)
    req.end()
  })
}

async function validateSession() {
  const local = loadLicense()
  if (!local || !local.key) return

  try {
    const hardwareId = getHardwareId()
    const result = await httpPost('/api/session/validate', {
      licenseKey: local.key,
      hardwareId: hardwareId
    })

    if (!result.valid) {
      clearLicense()
      stopSessionCheck()
      BrowserWindow.getAllWindows().forEach(function(w) {
        try {
          w.webContents.send('license:expired', {
            reason: result.reason,
            error: result.error || 'Your license key has expired. Please enter a valid key to continue.'
          })
        } catch (e) {}
      })
      return
    }

    if (result.expiringSoon && result.daysRemaining !== null) {
      BrowserWindow.getAllWindows().forEach(function(w) {
        try {
          w.webContents.send('license:expiringSoon', {
            daysRemaining: result.daysRemaining,
            expiresAt: result.expiresAt
          })
        } catch (e) {}
      })
    }

    saveLicense(Object.assign({}, local, {
      expiresAt: result.expiresAt,
      daysRemaining: result.daysRemaining,
      lastVerified: new Date().toISOString()
    }))

  } catch (err) {
    console.log('[License] Session check failed:', err.message)
  }
}

function startSessionCheck() {
  stopSessionCheck()
  setTimeout(function() {
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

async function checkLicense() {
  const hardwareId = getHardwareId()
  const local = loadLicense()

  if (!local || !local.key) return { valid: false, reason: 'no_license' }

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
    const result = await httpPost('/api/verify', {
      licenseKey: local.key,
      hardwareId: hardwareId
    })

    if (result.success) {
      global._mailflowLicenseKey = local.key
      saveLicense(Object.assign({}, local, result.license, { lastVerified: new Date().toISOString() }))
      startSessionCheck()
      // Auto-fetch assigned instance so campaigns route through agent without needing Dashboard click
      ;(async () => {
        try {
          const inst = await httpPost('/api/user/instance', { licenseKey: local.key })
          if (inst.success && inst.ip) {
            global._mailflowAssignedInstance = {
              ip:         inst.ip,
              instanceId: inst.instanceId,
              agentToken: inst.agentToken || 'mailflow-agent-2026',
              agentPort:  inst.agentPort  || 3000,
              assignedAt: inst.assignedAt,
            }
            console.log('[License] Auto-fetched instance on startup:', inst.ip)
          } else {
            console.log('[License] No instance assigned yet:', inst.error || 'none in pool')
          }
        } catch (err) {
          console.log('[License] Auto-fetch instance failed (non-critical):', err.message)
        }
      })()
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
      error: 'Cannot connect to license server. Check your internet connection.'
    }
  }
}

async function activateLicense(licenseKey) {
  const hardwareId  = getHardwareId()
  const machineName = os.hostname()

  try {
    const result = await httpPost('/api/activate', {
      licenseKey: licenseKey,
      hardwareId: hardwareId,
      machineName: machineName
    })

    if (result.success) {
      const cleanKey = licenseKey.trim().toUpperCase()
      global._mailflowLicenseKey = cleanKey
      saveLicense(Object.assign({
        key: cleanKey,
        hardwareId: hardwareId,
        lastVerified: new Date().toISOString()
      }, result.license))
      startSessionCheck()
      return { success: true, license: result.license }
    }
    return { success: false, error: result.error }
  } catch (err) {
    return { success: false, error: 'Connection failed: ' + err.message }
  }
}

function registerLicenseHandlers() {
  // Pre-load key into global for use in other IPC handlers
  const _existing = loadLicense()
  if (_existing && _existing.key) global._mailflowLicenseKey = _existing.key

  ipcMain.handle('license:check',         function() { return checkLicense() })
  ipcMain.handle('license:activate',      function(_, key) { return activateLicense(key) })
  ipcMain.handle('license:clear',         function() { clearLicense(); stopSessionCheck(); return { success: true } })
  ipcMain.handle('license:getInfo',       function() { return loadLicense() })
  ipcMain.handle('license:getHardwareId', function() { return getHardwareId() })
  ipcMain.handle('license:validateNow',   function() { return validateSession() })
  ipcMain.handle('license:saveActivation', function(_, key, license, hardwareId) {
    try {
      saveLicense(Object.assign({ key, hardwareId }, license, { lastVerified: new Date().toISOString() }))
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('license:getTestAccounts', async function() {
    try {
      const res = await httpRequest(LICENSE_SERVER + '/api/user/test-accounts', 'POST', { licenseKey: global._mailflowLicenseKey || '' })
      if (!res.ok) return { success: false, accounts: [] }
      return res.json()
    } catch (err) {
      return { success: false, accounts: [], error: err.message }
    }
  })

  ipcMain.handle('license:getTestResults', async function(_, sessionId) {
    try {
      const res = await httpRequest(LICENSE_SERVER + '/api/user/test-results/' + sessionId, 'GET')
      if (!res.ok) return { success: false, results: [] }
      return res.json()
    } catch (err) {
      return { success: false, results: [], error: err.message }
    }
  })

  ipcMain.handle('license:getInstance', async function() {
    try {
      const licenseKey = global._mailflowLicenseKey || ''
      if (!licenseKey) return { success: false, error: 'No license key. Activate software first.' }

      console.log('[getInstance] Fetching instance for:', licenseKey.substring(0, 10) + '...')

      const res = await httpRequest(LICENSE_SERVER + '/api/user/instance', 'POST', { licenseKey })
      if (!res.ok) return { success: false, error: 'Server error: ' + res.status }

      const data = res.json()
      console.log('[getInstance] Got:', JSON.stringify(data))

      if (data.success && data.ip) {
        global._mailflowAssignedInstance = {
          ip:         data.ip,
          instanceId: data.instanceId,
          agentToken: data.agentToken || 'mailflow-agent-2026',
          agentPort:  data.agentPort  || 3000,
          assignedAt: data.assignedAt,
        }
        console.log('[getInstance] Agent instance stored:', data.ip)
      }

      return data
    } catch (err) {
      console.log('[getInstance] Error:', err.message)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('license:releaseInstance', async function() {
    try {
      const licenseKey = global._mailflowLicenseKey || ''
      if (!licenseKey) return { success: false, error: 'No license key' }

      const res = await httpRequest(LICENSE_SERVER + '/api/user/instance/release', 'POST', { licenseKey })
      const data = res.json()
      if (data.success) {
        global._mailflowAssignedInstance = null
        console.log('[releaseInstance] Instance released')
      }
      return data
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('license:getInstances', async function() {
    try {
      const licenseKey = global._mailflowLicenseKey || ''
      if (!licenseKey) return { success: false, instances: [], error: 'No license key' }
      const res = await httpRequest(LICENSE_SERVER + '/api/user/instances', 'POST', { licenseKey })
      if (!res.ok) return { success: false, instances: [], error: 'Server error' }
      return res.json()
    } catch (err) {
      return { success: false, instances: [], error: err.message }
    }
  })
}

module.exports = { checkLicense, activateLicense, registerLicenseHandlers, getHardwareId, stopSessionCheck }
