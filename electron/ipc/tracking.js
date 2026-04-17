/**
 * Mailflow Open Tracking Server — port 3001
 * Records email opens via 1x1 tracking pixel
 */
const http = require('http')
const { BrowserWindow } = require('electron')
const { v4: uuid } = require('uuid')

let trackingServer = null
const PORT = 3001

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

const NO_CACHE_HEADERS = {
  'Content-Type':                'image/gif',
  'Content-Length':              PIXEL.length,
  'Cache-Control':               'no-cache, no-store, must-revalidate, private',
  'Pragma':                      'no-cache',
  'Expires':                     '0',
  'X-Content-Type-Options':      'nosniff',
  'Access-Control-Allow-Origin': '*',
}

function startTrackingServer() {
  if (trackingServer) return

  trackingServer = http.createServer(async (req, res) => {
    const match = req.url.match(/^\/track\/open\/([a-zA-Z0-9\-]+)/)

    if (match && req.method === 'GET') {
      const jobId = match[1]
      // Non-blocking — don't await so pixel responds instantly
      setImmediate(() => recordOpen(jobId))
    }

    res.writeHead(200, NO_CACHE_HEADERS)
    res.end(PIXEL)
  })

  trackingServer.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Tracking] Port ${PORT} in use — tracking server already running`)
    } else {
      console.error('[Tracking] Server error:', err.message)
    }
  })

  trackingServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Tracking] Server started on http://localhost:${PORT}`)
  })
}

async function recordOpen(jobId) {
  try {
    const db = require('../../database/db')
    const database = db.get()

    // Get job info first
    const job = database.prepare(
      `SELECT j.id, j.email, j.campaign_id FROM email_jobs j WHERE j.id = ?`
    ).get(jobId)

    if (!job) {
      console.log(`[Tracking] Job not found: ${jobId}`)
      return
    }

    // Check for duplicate (some email clients pre-fetch images)
    const existing = database.prepare(
      `SELECT id FROM tracking_events WHERE job_id = ? AND type = 'open'`
    ).get(jobId)

    if (existing) {
      console.log(`[Tracking] Duplicate open ignored: ${job.email}`)
      return
    }

    const now = new Date().toISOString()

    // Record tracking event
    database.prepare(`
      INSERT INTO tracking_events (id, job_id, campaign_id, type, metadata, created_at)
      VALUES (?, ?, ?, 'open', ?, ?)
    `).run(
      uuid(), jobId, job.campaign_id,
      JSON.stringify({ email: job.email, opened_at: now }),
      now
    )

    // Increment campaign open_count
    database.prepare(
      `UPDATE campaigns SET open_count = open_count + 1 WHERE id = ?`
    ).run(job.campaign_id)

    console.log(`[Tracking] ✅ Open: ${job.email} | campaign: ${job.campaign_id}`)

    // Push real-time update to renderer
    BrowserWindow.getAllWindows().forEach(w => {
      try {
        w.webContents.send('tracking:open', {
          jobId,
          email:      job.email,
          campaignId: job.campaign_id,
          openedAt:   now,
        })
      } catch {}
    })

  } catch (err) {
    console.error('[Tracking] recordOpen error:', err.message)
  }
}

function getTrackingUrl() {
  // Use Railway tracking server if configured, else fallback to local
  return process.env.TRACKING_SERVER_URL || global.TRACKING_SERVER_URL || `http://localhost:${PORT}`
}

function setTrackingServerUrl(url) {
  global.TRACKING_SERVER_URL = url
}

function stopTrackingServer() {
  if (trackingServer) {
    trackingServer.close(() => console.log('[Tracking] Server stopped'))
    trackingServer = null
  }
}

module.exports = { startTrackingServer, stopTrackingServer, getTrackingUrl, setTrackingServerUrl }
