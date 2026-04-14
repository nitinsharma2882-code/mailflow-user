const { ipcMain } = require('electron')
const { v4: uuid } = require('uuid')
const db = require('../../database/db')

function registerTemplateHandlers() {

  ipcMain.handle('templates:getAll', () => {
    return db.get().prepare(`
      SELECT id, name, subject, from_name, variables, created_at, updated_at
      FROM templates ORDER BY updated_at DESC
    `).all()
  })

  ipcMain.handle('templates:getById', (_, id) => {
    return db.get().prepare('SELECT * FROM templates WHERE id = ?').get(id)
  })

  ipcMain.handle('templates:create', (_, data) => {
    const database = db.get()
    const id = uuid()
    const now = new Date().toISOString()

    // Auto-detect variables like {{name}}, {{company}}
    const vars = extractVariables(data.html_body || '')

    database.prepare(`
      INSERT INTO templates (id, name, subject, from_name, html_body, text_body, variables, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.name, data.subject, data.from_name || null,
      data.html_body, data.text_body || null,
      JSON.stringify(vars), now, now
    )

    return { id, ...data, variables: vars, created_at: now }
  })

  ipcMain.handle('templates:update', (_, id, data) => {
    const database = db.get()
    const now = new Date().toISOString()
    const vars = extractVariables(data.html_body || '')

    database.prepare(`
      UPDATE templates SET
        name = ?, subject = ?, from_name = ?,
        html_body = ?, text_body = ?,
        variables = ?, updated_at = ?
      WHERE id = ?
    `).run(
      data.name, data.subject, data.from_name || null,
      data.html_body, data.text_body || null,
      JSON.stringify(vars), now, id
    )

    return { success: true, variables: vars }
  })

  ipcMain.handle('templates:delete', (_, id) => {
    db.get().prepare('DELETE FROM templates WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('templates:duplicate', (_, id) => {
    const database = db.get()
    const original = database.prepare('SELECT * FROM templates WHERE id = ?').get(id)
    if (!original) return { success: false }

    const newId = uuid()
    const now = new Date().toISOString()

    database.prepare(`
      INSERT INTO templates (id, name, subject, from_name, html_body, text_body, variables, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId, `${original.name} (Copy)`, original.subject,
      original.from_name, original.html_body, original.text_body,
      original.variables, now, now
    )

    return { id: newId, success: true }
  })
}

function extractVariables(html) {
  const matches = html.match(/\{\{([^}]+)\}\}/g) || []
  return [...new Set(matches.map(m => m.replace(/[{}]/g, '').trim()))]
}

module.exports = { registerTemplateHandlers, extractVariables }
