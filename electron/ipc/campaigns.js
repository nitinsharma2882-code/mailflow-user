const { ipcMain } = require('electron')
const { v4: uuid } = require('uuid')
const db = require('../../database/db')

function registerCampaignHandlers() {

  ipcMain.handle('campaigns:getAll', () => {
    const database = db.get()
    return database.prepare(`
      SELECT c.*,
        cl.name as list_name,
        t.name as template_name
      FROM campaigns c
      LEFT JOIN contact_lists cl ON c.contact_list_id = cl.id
      LEFT JOIN templates t ON c.template_id = t.id
      ORDER BY c.created_at DESC
    `).all()
  })

  ipcMain.handle('campaigns:getById', (_, id) => {
    const database = db.get()
    const campaign = database.prepare(`
      SELECT c.*,
        cl.name as list_name,
        t.name as template_name, t.subject, t.html_body, t.from_name
      FROM campaigns c
      LEFT JOIN contact_lists cl ON c.contact_list_id = cl.id
      LEFT JOIN templates t ON c.template_id = t.id
      WHERE c.id = ?
    `).get(id)
    return campaign
  })

  ipcMain.handle('campaigns:create', (_, data) => {
    const database = db.get()
    const id = uuid()
    const now = new Date().toISOString()

    database.prepare(`
      INSERT INTO campaigns (
        id, name, status, contact_list_id, template_id,
        server_ids, sending_mode, scheduled_at,
        total_recipients, settings, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.name, data.status || 'draft',
      data.contact_list_id || null, data.template_id || null,
      JSON.stringify(data.server_ids || []),
      data.sending_mode || 'auto',
      data.scheduled_at || null,
      data.total_recipients || 0,
      JSON.stringify(data.settings || {}),
      now, now
    )

    return { id, ...data, created_at: now }
  })

  ipcMain.handle('campaigns:update', (_, id, data) => {
    const database = db.get()
    const fields = []
    const values = []

    const allowed = [
      'name','status','contact_list_id','template_id',
      'sending_mode','scheduled_at','total_recipients',
      'sent_count','delivered_count','failed_count',
      'open_count','click_count','bounce_count','unsubscribe_count',
      'started_at','completed_at'
    ]

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`)
        values.push(data[key])
      }
    }

    if (data.server_ids !== undefined) {
      fields.push('server_ids = ?')
      values.push(JSON.stringify(data.server_ids))
    }
    if (data.settings !== undefined) {
      fields.push('settings = ?')
      values.push(JSON.stringify(data.settings))
    }

    fields.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)

    database.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return { success: true }
  })

  ipcMain.handle('campaigns:delete', (_, id) => {
    const database = db.get()
    database.prepare('DELETE FROM campaigns WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('campaigns:getStats', (_, id) => {
    const database = db.get()

    const campaign = database.prepare('SELECT * FROM campaigns WHERE id = ?').get(id)
    if (!campaign) return null

    const jobStats = database.prepare(`
      SELECT status, COUNT(*) as count
      FROM email_jobs WHERE campaign_id = ?
      GROUP BY status
    `).all(id)

    const trackingStats = database.prepare(`
      SELECT type, COUNT(*) as count
      FROM tracking_events WHERE campaign_id = ?
      GROUP BY type
    `).all(id)

    const jobMap = {}
    jobStats.forEach(r => { jobMap[r.status] = r.count })

    const trackMap = {}
    trackingStats.forEach(r => { trackMap[r.type] = r.count })

    return {
      campaign,
      jobs: jobMap,
      tracking: trackMap,
      openRate: campaign.sent_count > 0
        ? ((trackMap.open || 0) / campaign.sent_count * 100).toFixed(1) : 0,
      clickRate: campaign.sent_count > 0
        ? ((trackMap.click || 0) / campaign.sent_count * 100).toFixed(1) : 0,
    }
  })
}

module.exports = { registerCampaignHandlers }
