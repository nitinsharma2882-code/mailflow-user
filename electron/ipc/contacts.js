const { ipcMain } = require('electron')
const { v4: uuid } = require('uuid')
const fs = require('fs')
const path = require('path')
const csv = require('csv-parser')
const XLSX = require('xlsx')
const db = require('../../database/db')

function registerContactHandlers() {

  ipcMain.handle('contacts:getLists', () => {
    return db.get().prepare(`
      SELECT * FROM contact_lists ORDER BY created_at DESC
    `).all()
  })

  ipcMain.handle('contacts:getList', (_, id) => {
    const list = db.get().prepare('SELECT * FROM contact_lists WHERE id = ?').get(id)
    return list
  })

  ipcMain.handle('contacts:getPreview', (_, listId, limit = 20) => {
    return db.get().prepare(`
      SELECT * FROM contacts WHERE list_id = ? LIMIT ?
    `).all(listId, limit)
  })

  ipcMain.handle('contacts:importCSV', async (_, filePath, listName) => {
    return new Promise((resolve, reject) => {
      const database = db.get()
      const listId = uuid()
      const ext = path.extname(filePath).toLowerCase()
      let rows = []

      const processRows = (rawRows) => {
        const contacts = []
        let valid = 0, invalid = 0

        for (const row of rawRows) {
          // Detect email field
          const email = row.email || row.Email || row.EMAIL ||
            row['e-mail'] || row['E-Mail'] || Object.values(row)[0]

          if (!email) continue

          const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
          const status = isValid ? 'valid' : 'invalid'
          if (isValid) valid++; else invalid++

          // Extract known fields, put rest in custom_fields
          const { email: _e, Email: _E, name, Name, ...rest } = row
          const customFields = {}
          for (const [k, v] of Object.entries(rest)) {
            if (v && k.toLowerCase() !== 'email') customFields[k] = v
          }

          contacts.push({
            id: uuid(),
            list_id: listId,
            email: email.trim().toLowerCase(),
            name: name || Name || null,
            status,
            custom_fields: JSON.stringify(customFields)
          })
        }

        // Insert list
        database.prepare(`
          INSERT INTO contact_lists (id, name, total, valid, invalid, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(listId, listName, contacts.length, valid, invalid)

        // Bulk insert contacts in a transaction
        const insertContact = database.prepare(`
          INSERT INTO contacts (id, list_id, email, name, status, custom_fields, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `)
        const insertMany = database.transaction((rows) => {
          for (const c of rows) {
            insertContact.run(c.id, c.list_id, c.email, c.name, c.status, c.custom_fields)
          }
        })
        insertMany(contacts)

        // Detect custom field names
        const fieldNames = contacts.length > 0
          ? Object.keys(JSON.parse(contacts[0].custom_fields))
          : []

        resolve({
          listId, listName,
          total: contacts.length,
          valid, invalid,
          fieldNames,
          preview: contacts.slice(0, 5).map(c => ({
            ...c,
            custom_fields: JSON.parse(c.custom_fields)
          }))
        })
      }

      if (ext === '.csv') {
        const results = []
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end', () => processRows(results))
          .on('error', reject)
      } else if (ext === '.xlsx' || ext === '.xls') {
        try {
          const workbook = XLSX.readFile(filePath)
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const data = XLSX.utils.sheet_to_json(sheet)
          processRows(data)
        } catch (err) {
          reject(err)
        }
      } else {
        reject(new Error('Unsupported file type'))
      }
    })
  })

  ipcMain.handle('contacts:deleteList', (_, id) => {
    db.get().prepare('DELETE FROM contact_lists WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('contacts:exportInvalid', async (_, listId) => {
    const { dialog } = require('electron')
    const invalid = db.get().prepare(`
      SELECT email, name, status FROM contacts WHERE list_id = ? AND status != 'valid'
    `).all(listId)

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: 'invalid-emails.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })

    if (!filePath) return { cancelled: true }

    const lines = ['email,name,status', ...invalid.map(r =>
      `${r.email},${r.name || ''},${r.status}`
    )]
    fs.writeFileSync(filePath, lines.join('\n'))
    return { success: true, count: invalid.length, filePath }
  })
}

module.exports = { registerContactHandlers }
