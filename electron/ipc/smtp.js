const { ipcMain } = require('electron')
const { testSmtpConnection } = require('./servers')
const { v4: uuid } = require('uuid')
const fs = require('fs')
const csv = require('csv-parser')
const db = require('../../database/db')

function registerSmtpHandlers() {

  ipcMain.handle('smtp:testSingle', async (_, config) => {
    const result = await testSmtpConnection({ type: 'smtp', ...config })
    // Save result
    db.get().prepare(`
      INSERT INTO smtp_test_results (id, host, port, email, status, details, latency_ms, tested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(uuid(), config.host, config.port, config.email,
      result.success ? 'working' : 'failed',
      result.message || result.error, result.latency)

    return result
  })

  ipcMain.handle('smtp:testBulk', async (_, filePath) => {
    const smtps = await readSmtpList(filePath)
    const results = []

    // Test in parallel batches of 10
    const BATCH = 10
    for (let i = 0; i < smtps.length; i += BATCH) {
      const batch = smtps.slice(i, i + BATCH)
      const batchResults = await Promise.all(batch.map(async (s) => {
        const r = await testSmtpConnection({ type: 'smtp', ...s })
        return {
          host: s.host, port: s.port, email: s.email,
          status: r.success ? 'working' : 'failed',
          details: r.message || r.error,
          latency: r.latency
        }
      }))
      results.push(...batchResults)
    }

    // Save all results
    const insert = db.get().prepare(`
      INSERT INTO smtp_test_results (id, host, port, email, status, details, latency_ms, tested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    const insertAll = db.get().transaction(() => {
      for (const r of results) {
        insert.run(uuid(), r.host, r.port, r.email, r.status, r.details, r.latency)
      }
    })
    insertAll()

    return {
      results,
      summary: {
        total: results.length,
        working: results.filter(r => r.status === 'working').length,
        failed: results.filter(r => r.status === 'failed').length,
      }
    }
  })

  ipcMain.handle('smtp:export', async (_, results, type) => {
    const { dialog } = require('electron')
    const filtered = type === 'all' ? results : results.filter(r => r.status === type)

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${type}-smtps.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })

    if (!filePath) return { cancelled: true }

    const lines = ['host,port,email,status,details,latency_ms',
      ...filtered.map(r =>
        `${r.host},${r.port},${r.email},${r.status},"${r.details || ''}",${r.latency || ''}`
      )
    ]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, count: filtered.length }
  })
}

async function readSmtpList(filePath) {
  return new Promise((resolve, reject) => {
    const smtps = []
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        smtps.push({
          host: row.host || row.Host,
          port: parseInt(row.port || row.Port || 587),
          email: row.email || row.Email,
          password: row.password || row.Password || row.pass,
          encryption: row.encryption || row.ssl || 'tls'
        })
      })
      .on('end', () => resolve(smtps))
      .on('error', reject)
  })
}

function registerAnalyticsHandlers() {

  ipcMain.handle('analytics:dashboard', () => {
    const database = db.get()

    const totals = database.prepare(`
      SELECT
        SUM(sent_count) as total_sent,
        SUM(delivered_count) as total_delivered,
        SUM(open_count) as total_opens,
        SUM(click_count) as total_clicks,
        SUM(bounce_count) as total_bounces,
        SUM(failed_count) as total_failed,
        COUNT(*) as total_campaigns
      FROM campaigns WHERE status != 'draft'
    `).get()

    const recent = database.prepare(`
      SELECT c.*, cl.name as list_name, t.name as template_name
      FROM campaigns c
      LEFT JOIN contact_lists cl ON c.contact_list_id = cl.id
      LEFT JOIN templates t ON c.template_id = t.id
      ORDER BY c.created_at DESC LIMIT 5
    `).all()

    const serverHealth = database.prepare(`
      SELECT id, name, type, status, sent_today, daily_limit
      FROM servers ORDER BY created_at DESC
    `).all()

    return { totals, recent, serverHealth }
  })

  ipcMain.handle('analytics:overview', (_, period) => {
    const database = db.get()
    const days = period === '90days' ? 90 : period === 'alltime' ? 3650 : 30

    const campaigns = database.prepare(`
      SELECT name, sent_count, open_count, click_count, bounce_count,
             unsubscribe_count, created_at
      FROM campaigns
      WHERE status = 'sent' AND created_at >= datetime('now', ? || ' days')
      ORDER BY created_at ASC
    `).all(`-${days}`)

    return campaigns
  })

  ipcMain.handle('analytics:openers', async (_, campaignId) => {
    const database = db.get()

    const campaign = database.prepare(
      'SELECT sent_count, open_count, total_recipients FROM campaigns WHERE id = ?'
    ).get(campaignId)

    // Try Railway tracking server first
    const RAILWAY_URL  = 'https://mailflow-tracking-server-production.up.railway.app'
    const ADMIN_KEY    = 'mailflow-admin-2026'
    let openers = []
    let openCount = campaign?.open_count || 0

    try {
      const res = await fetch(`${RAILWAY_URL}/api/campaign/${campaignId}/openers`, {
        headers: { 'x-admin-key': ADMIN_KEY }
      })
      if (res.ok) {
        const data = await res.json()
        openers   = data.openers || []
        openCount = data.openCount || openCount

        // Sync open_count back to local DB
        if (openCount > (campaign?.open_count || 0)) {
          database.prepare('UPDATE campaigns SET open_count = ? WHERE id = ?').run(openCount, campaignId)
        }
        console.log(`[Analytics] Got ${openers.length} openers from Railway for campaign ${campaignId}`)
      }
    } catch (err) {
      console.log('[Analytics] Railway unreachable, using local DB:', err.message)
      // Fallback to local tracking_events
      openers = database.prepare(`
        SELECT DISTINCT
          json_extract(te.metadata, '$.email') as email,
          te.created_at as opened_at
        FROM tracking_events te
        WHERE te.campaign_id = ? AND te.type = 'open'
        ORDER BY te.created_at DESC
      `).all(campaignId)
    }

    return {
      openers,
      total:     campaign?.total_recipients || 0,
      sent:      campaign?.sent_count || 0,
      openCount,
      openRate:  campaign?.sent_count > 0
        ? ((openCount / campaign.sent_count) * 100).toFixed(1)
        : '0.0'
    }
  })

  ipcMain.handle('analytics:campaign', (_, campaignId) => {
    const database = db.get()
    const campaign = database.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId)
    const events = database.prepare(`
      SELECT type, COUNT(*) as count FROM tracking_events
      WHERE campaign_id = ? GROUP BY type
    `).all(campaignId)
    return { campaign, events }
  })

  ipcMain.handle('analytics:export', async (_, period) => {
    const { dialog } = require('electron')
    const database = db.get()

    const campaigns = database.prepare(`
      SELECT name, status, total_recipients, sent_count,
             open_count, click_count, bounce_count, created_at
      FROM campaigns WHERE status = 'sent'
    `).all()

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: 'analytics-report.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })

    if (!filePath) return { cancelled: true }

    const lines = [
      'campaign,status,recipients,sent,opens,clicks,bounces,date',
      ...campaigns.map(c =>
        `"${c.name}",${c.status},${c.total_recipients},${c.sent_count},${c.open_count},${c.click_count},${c.bounce_count},${c.created_at}`
      )
    ]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, count: campaigns.length }
  })
}

module.exports = { registerSmtpHandlers, registerAnalyticsHandlers }
