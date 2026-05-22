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

// Fire-and-forget log — never blocks, never throws
function fireLog(endpoint, data) {
  setImmediate(function() {
    const licenseKey = global._mailflowLicenseKey || ''
    httpRequest(LICENSE_SERVER + endpoint, 'POST', Object.assign({ licenseKey }, data))
      .catch(function() {})
  })
}
global._freqmailLog = fireLog

if (!global._mailflowInstanceMap) {
  global._mailflowInstanceMap = new Map()
}

function broadcastInstanceChanged(instanceData) {
  BrowserWindow.getAllWindows().forEach(function(w) {
    try { w.webContents.send('instance:changed', { ip: instanceData ? instanceData.ip : null }) } catch {}
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
      global._mailflowLicenseKey    = local.key
      global._mailflowCustomerName  = result.license?.customerName  || result.license?.customer_name  || result.license?.name  || global._mailflowCustomerName  || ''
      global._mailflowCustomerEmail = result.license?.customerEmail || result.license?.customer_email || result.license?.email || global._mailflowCustomerEmail || ''
      saveLicense(Object.assign({}, local, result.license, { lastVerified: new Date().toISOString() }))
      startSessionCheck()
      // Restore existing instance assignment on startup (does NOT auto-assign a new one)
      ;(async () => {
        try {
          const inst = await httpPost('/api/user/instance/current', { licenseKey: local.key })
          if (inst.success && inst.ip) {
            const instanceData = {
              ip:         inst.ip,
              instanceId: inst.instanceId,
              agentToken: inst.agentToken || 'mailflow-agent-2026',
              agentPort:  inst.agentPort  || 3000,
              assignedAt: inst.assignedAt,
            }
            global._mailflowInstanceMap.set(local.key, instanceData)
            global._mailflowAssignedInstance = instanceData
            broadcastInstanceChanged(instanceData)
            console.log('[License] Restored existing instance on startup:', inst.ip)
          } else {
            console.log('[License] No existing instance to restore:', inst.error || 'none assigned')
          }
        } catch (err) {
          console.log('[License] Instance restore on startup failed (non-critical):', err.message)
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
      const cleanKey   = licenseKey.trim().toUpperCase()
      const prevLicense = loadLicense()
      const prevKey     = prevLicense && prevLicense.key ? prevLicense.key.trim().toUpperCase() : null
      const isSwitched  = prevKey && prevKey !== cleanKey

      if (isSwitched) {
        // Different user — clear their local DB tables so no data bleeds across
        try {
          const { get: getDb } = require('../database/db')
          const db = getDb()
          if (db) {
            db.prepare('DELETE FROM campaigns').run()
            db.prepare('DELETE FROM contacts').run()
            db.prepare('DELETE FROM contact_lists').run()
            db.prepare('DELETE FROM templates').run()
            db.prepare('DELETE FROM email_jobs').run()
            db.prepare('DELETE FROM servers').run()
            console.log('[License] Cleared local DB for license switch:', prevKey, '->', cleanKey)
          }
        } catch (dbErr) {
          console.log('[License] DB clear on switch failed (non-critical):', dbErr.message)
        }

        // Clear any cached instance belonging to the previous user
        if (global._mailflowInstanceMap) global._mailflowInstanceMap.clear()
        global._mailflowAssignedInstance = null

        // Notify renderer to reset its in-memory state
        BrowserWindow.getAllWindows().forEach(function(w) {
          try { w.webContents.send('license:switched', { prevKey, newKey: cleanKey }) } catch {}
        })
      }

      global._mailflowLicenseKey    = cleanKey
      global._mailflowCustomerName  = result.license?.customerName  || result.license?.customer_name  || result.license?.name  || ''
      global._mailflowCustomerEmail = result.license?.customerEmail || result.license?.customer_email || result.license?.email || ''
      saveLicense(Object.assign({
        key: cleanKey,
        hardwareId: hardwareId,
        lastVerified: new Date().toISOString()
      }, result.license))
      startSessionCheck()
      fireLog('/api/log/activity', { event: 'license_activated', details: 'Activated on ' + machineName, hardware_id: hardwareId })
      return { success: true, license: result.license }
    }
    return { success: false, error: result.error }
  } catch (err) {
    return { success: false, error: 'Connection failed: ' + err.message }
  }
}

function registerLicenseHandlers() {
  // Pre-load key + customer info into globals for use in other IPC handlers
  const _existing = loadLicense()
  if (_existing && _existing.key) {
    global._mailflowLicenseKey    = _existing.key
    global._mailflowCustomerName  = _existing.customerName  || _existing.customer_name  || _existing.name  || ''
    global._mailflowCustomerEmail = _existing.customerEmail || _existing.customer_email || _existing.email || ''
  }

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
        const instanceData = {
          ip:         data.ip,
          instanceId: data.instanceId,
          agentToken: data.agentToken || 'mailflow-agent-2026',
          agentPort:  data.agentPort  || 3000,
          assignedAt: data.assignedAt,
        }
        global._mailflowInstanceMap.set(licenseKey, instanceData)
        global._mailflowAssignedInstance = instanceData
        broadcastInstanceChanged(instanceData)
        fireLog('/api/log/activity', { event: 'instance_assigned', details: 'Instance assigned: ' + data.ip, hardware_id: getHardwareId() })
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

      const res  = await httpRequest(LICENSE_SERVER + '/api/user/instance/release', 'POST', { licenseKey })
      const data = res.json()

      if (data.success) {
        global._mailflowInstanceMap.delete(licenseKey)
        global._mailflowAssignedInstance = null
        broadcastInstanceChanged(null)
        console.log('[Release] Instance released, cleared assignment')
        fireLog('/api/log/activity', { event: 'instance_released', details: 'Instance released', hardware_id: getHardwareId() })
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

  ipcMain.handle('license:trackCampaignInstance', async function(_, data) {
    try {
      const licenseKey = global._mailflowLicenseKey || ''
      if (!licenseKey) return { success: false, error: 'No license key' }
      const res = await httpRequest(LICENSE_SERVER + '/api/user/campaign-instance', 'POST', {
        licenseKey,
        instanceIp:  data.instanceIp,
        instanceId:  data.instanceId  || '',
        campaignId:  data.campaignId  || '',
        pageNumber:  data.pageNumber  || 1,
        purpose:     data.purpose     || 'campaign',
      })
      return res.json()
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('license:updateCampaignInstance', async function(_, data) {
    try {
      const licenseKey = global._mailflowLicenseKey || ''
      if (!licenseKey) return { success: false, error: 'No license key' }
      const res = await httpRequest(LICENSE_SERVER + '/api/user/campaign-instance/update', 'POST', {
        licenseKey,
        instanceIp:  data.instanceIp,
        campaignId:  data.campaignId  || '',
        pageNumber:  data.pageNumber  || 1,
        status:      data.status      || 'completed',
      })
      return res.json()
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('license:getPlan', async function() {
    try {
      const licenseKey = global._mailflowLicenseKey || ''
      if (!licenseKey) return { success: false, error: 'No license key' }
      const res = await httpRequest(LICENSE_SERVER + '/api/user/plan', 'POST', { licenseKey })
      if (!res.ok) return { success: false, error: 'Server error' }
      const data = await res.json()
      if (data.success && data.plan) {
        const correctLimits = { basic: 5, standard: 10, premium: 20 }
        const correct = correctLimits[data.plan]
        if (correct && (!data.max_instances || data.max_instances < correct)) {
          data.max_instances = correct
        }
      }
      return data
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('license:assignPageInstance', async function(_, data) {
    try {
      const licenseKey = global._mailflowLicenseKey || ''
      if (!licenseKey) return { success: false, error: 'No license key' }
      const res = await httpRequest(LICENSE_SERVER + '/api/user/instance/assign-page', 'POST', {
        licenseKey,
        instanceIp:  data.instanceIp,
        purpose:     data.purpose    || 'page',
        pageNumber:  data.pageNumber || 1,
        campaignId:  data.campaignId || '',
      })
      return res.json()
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('license:getSlots', async function() {
    try {
      const licenseKey = global._mailflowLicenseKey || ''
      if (!licenseKey) return { success: false, remaining: 0, totalUsed: 0, maxAllowed: 0 }
      const res  = await httpRequest(LICENSE_SERVER + '/api/user/instance/slots', 'POST', { licenseKey })
      const data = await res.json()
      return data
    } catch (err) {
      return { success: false, error: err.message, remaining: 0 }
    }
  })

  ipcMain.handle('license:getCustomerInfo', function() {
    return {
      name:  global._mailflowCustomerName  || '',
      email: global._mailflowCustomerEmail || '',
      key:   global._mailflowLicenseKey    || '',
    }
  })

  ipcMain.handle('email:verify', async function(event, emails) {
    try {
      if (!emails || !Array.isArray(emails)) return { success: false, results: [] }

      const dns = require('dns').promises

      const TYPO_DOMAINS = {
        'gmai.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com',
        'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com',
        'gmail.om': 'gmail.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com',
        'yahoo.co': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
        'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
      }

      const VALID_TLDS = [
        'com','net','org','edu','gov','io','co','info','biz','me','app','dev','ai',
        'uk','us','ca','au','in','de','fr','jp','br','ru','cn','es','it','nl','pl',
        'se','no','dk','fi','be','ch','at','nz','sg','hk','ae','sa','za','ng','ke',
        'gh','mx','ar','cl','co.uk','co.in','co.au','co.nz','com.au','com.br',
        'com.mx','com.ar','org.uk','net.au',
      ]

      function validateEmailFormat(email) {
        if (!email || typeof email !== 'string') return { valid: false, reason: 'Empty email' }
        email = email.trim().toLowerCase()
        const parts = email.split('@')
        if (parts.length !== 2) return { valid: false, reason: 'Invalid format — missing or multiple @ symbols' }
        const localPart  = parts[0]
        const domainPart = parts[1]
        if (!localPart || localPart.length === 0) return { valid: false, reason: 'Empty username before @' }
        if (localPart.length > 64)               return { valid: false, reason: 'Username too long' }
        if (!domainPart.includes('.'))            return { valid: false, reason: 'Invalid domain — no dot found' }
        const domainParts = domainPart.split('.')
        for (const part of domainParts) {
          if (!part || part.length === 0) return { valid: false, reason: 'Invalid domain — double dots or leading/trailing dot' }
        }
        const tld  = domainParts[domainParts.length - 1]
        const tld2 = domainParts.length >= 3 ? domainParts[domainParts.length - 2] + '.' + tld : null
        if (tld.length < 2)         return { valid: false, reason: 'Invalid TLD — too short: .' + tld }
        if (!/^[a-z]+$/.test(tld))  return { valid: false, reason: 'Invalid TLD — contains non-letter characters' }
        if (!VALID_TLDS.includes(tld) && !(tld2 && VALID_TLDS.includes(tld2))) {
          return { valid: false, reason: 'Unknown or invalid TLD: .' + tld }
        }
        const typoSuggestion = TYPO_DOMAINS[domainPart]
        if (typoSuggestion) {
          return { valid: false, reason: 'Possible typo in domain: ' + domainPart, suggestion: localPart + '@' + typoSuggestion }
        }
        if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
          return { valid: false, reason: 'Invalid email format' }
        }
        return { valid: true, reason: 'Format valid' }
      }

      async function checkMxRecord(domain) {
        try {
          const records = await dns.resolveMx(domain)
          return records && records.length > 0
        } catch { return false }
      }

      const results   = []
      const batchSize = 10

      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize)
        const batchResults = await Promise.all(batch.map(async function(email) {
          const trimmed     = (email || '').trim().toLowerCase()
          const formatCheck = validateEmailFormat(trimmed)
          if (!formatCheck.valid) {
            return { email: trimmed, valid: false, reason: formatCheck.reason, suggestion: formatCheck.suggestion || null, mxChecked: false }
          }
          const domain = trimmed.split('@')[1]
          const hasMx  = await checkMxRecord(domain)
          return { email: trimmed, valid: hasMx, reason: hasMx ? 'Valid — domain accepts email' : 'Domain does not accept email (no MX record)', mxChecked: true }
        }))
        results.push(...batchResults)
      }

      const validCount   = results.filter(function(r) { return r.valid }).length
      const invalidCount = results.filter(function(r) { return !r.valid }).length
      return { success: true, results, total: results.length, valid: validCount, invalid: invalidCount }
    } catch (err) {
      return { success: false, error: err.message, results: [] }
    }
  })
}

module.exports = { checkLicense, activateLicense, registerLicenseHandlers, getHardwareId, stopSessionCheck }
