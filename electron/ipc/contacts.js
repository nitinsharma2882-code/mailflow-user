const { ipcMain } = require('electron')
const { v4: uuid } = require('uuid')
const fs   = require('fs')
const path = require('path')
const csv  = require('csv-parser')
const XLSX = require('xlsx')
const db   = require('../../database/db')

// Standard field mapping — maps common column names to our standard fields
function mapFields(row) {
  const keys = Object.keys(row)
  const vals = Object.values(row)

  // Email — always required
  const email =
    row.email || row.Email || row.EMAIL || row['e-mail'] || row['E-Mail'] ||
    row['Email Address'] || row['email address'] || vals[0] || ''

  // Name — 2nd priority field
  const name =
    row.name || row.Name || row.NAME || row['Full Name'] || row['full name'] ||
    row.fullname || row.customer || row.Customer || row.contact || vals[1] || ''

  // Address — 3rd priority field
  const address =
    row.address || row.Address || row.ADDRESS ||
    row['Shipping address 1'] || row['shipping_address'] ||
    row.city || row.City || row.location || row.Location || vals[2] || ''

  // Custom field — 4th priority field
  const custom_field =
    row.custom_field || row.custom || row.Custom || row.tag || row.Tag ||
    row.note || row.Note || row.type || row.Type || row.category ||
    row.plan || row.Plan || vals[3] || ''

  return {
    email:        typeof email === 'object'        ? JSON.stringify(email)        : String(email || '').trim().toLowerCase(),
    name:         typeof name === 'object'         ? JSON.stringify(name)         : String(name || '').trim(),
    address:      typeof address === 'object'      ? JSON.stringify(address)      : String(address || '').trim(),
    custom_field: typeof custom_field === 'object' ? JSON.stringify(custom_field) : String(custom_field || '').trim(),
  }
}

function registerContactHandlers() {

  ipcMain.handle('contacts:getLists', () => {
    return db.get().prepare(`
      SELECT * FROM contact_lists ORDER BY created_at DESC
    `).all()
  })

  ipcMain.handle('contacts:getList', (_, id) => {
    return db.get().prepare('SELECT * FROM contact_lists WHERE id = ?').get(id)
  })

  // Return ALL contacts (no limit) for display
  ipcMain.handle('contacts:getPreview', (_, listId, limit = 999999) => {
    return db.get().prepare(`
      SELECT id, email, name, status, custom_fields FROM contacts
      WHERE list_id = ? LIMIT ?
    `).all(listId, limit).map(c => {
      let cf = {}
      try { cf = JSON.parse(c.custom_fields || '{}') } catch {}
      return {
        email:        c.email,
        name:         c.name || cf.name || '',
        address:      cf.address || cf.Address || '',
        custom_field: cf.custom_field || cf.custom || cf.tag || '',
        status:       c.status,
      }
    })
  })

  ipcMain.handle('contacts:importCSV', async (_, filePath, listName) => {
    return new Promise((resolve, reject) => {
      const database = db.get()
      const listId   = uuid()
      const ext      = path.extname(filePath).toLowerCase()

      const processRows = (rawRows) => {
        const contacts = []
        let valid = 0, invalid = 0

        for (const row of rawRows) {
          const mapped  = mapFields(row)
          const email   = mapped.email
          if (!email || !email.includes('@')) continue

          const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          const status  = isValid ? 'valid' : 'invalid'
          if (isValid) valid++; else invalid++

          const customFields = {
            address:      mapped.address,
            custom_field: mapped.custom_field,
          }

          contacts.push({
            id:            uuid(),
            list_id:       listId,
            email,
            name:          mapped.name || null,
            status,
            custom_fields: JSON.stringify(customFields)
          })
        }

        // Insert list
        database.prepare(`
          INSERT INTO contact_lists (id, name, total, valid, invalid, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(listId, listName, contacts.length, valid, invalid)

        // Bulk insert
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

        // Return ALL contacts for display
        const preview = contacts.map(c => {
          const cf = JSON.parse(c.custom_fields || '{}')
          return {
            email:        c.email,
            name:         c.name || '',
            address:      cf.address || '',
            custom_field: cf.custom_field || '',
            status:       c.status,
          }
        })

        resolve({
          listId, listName,
          total: contacts.length,
          valid, invalid,
          preview,
        })
      }

      if (ext === '.csv') {
        const results = []
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end',  () => processRows(results))
          .on('error', reject)
      } else if (ext === '.xlsx' || ext === '.xls') {
        try {
          const workbook = XLSX.readFile(filePath)
          const sheet    = workbook.Sheets[workbook.SheetNames[0]]
          processRows(XLSX.utils.sheet_to_json(sheet))
        } catch (err) { reject(err) }
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
