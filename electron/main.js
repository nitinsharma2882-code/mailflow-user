const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const isDev = process.env.NODE_ENV === 'development'

const { registerCampaignHandlers }  = require('./ipc/campaigns')
const { registerContactHandlers }   = require('./ipc/contacts')
const { registerServerHandlers }    = require('./ipc/servers')
const { registerTemplateHandlers }  = require('./ipc/templates')
const { registerSendingHandlers }   = require('./ipc/sending')
const { registerVerifyHandlers }    = require('./ipc/verify')
const { registerSmtpHandlers }      = require('./ipc/smtp')
const { registerAnalyticsHandlers } = require('./ipc/analytics')
const { registerCustomSmtpHandlers } = require('./ipc/customSmtp')
const { registerLicenseHandlers, checkLicense } = require('./license')
const { startTrackingServer, stopTrackingServer } = require('./ipc/tracking')
const db = require('../database/db')

let mainWindow
let licenseValid = isDev

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    title: 'Mailflow'
  })

  // Allow fetch to license server + tracking server
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; connect-src 'self' https://mailflow-license-server-production.up.railway.app https: http://localhost:3001; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: http://localhost:3001 https:;"
        ]
      }
    })
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('license:status', { valid: licenseValid })
    })
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  db.initialize()

  // Start tracking server for open tracking
  startTrackingServer()

  registerCampaignHandlers()
  registerContactHandlers()
  registerServerHandlers()
  registerTemplateHandlers()
  registerSendingHandlers()
  registerVerifyHandlers()
  registerSmtpHandlers()
  registerAnalyticsHandlers()
  registerCustomSmtpHandlers()
  registerLicenseHandlers()

  ipcMain.handle('dialog:openFile', async (_, options) => {
    return dialog.showOpenDialog(mainWindow, options)
  })
  ipcMain.handle('dialog:saveFile', async (_, options) => {
    return dialog.showSaveDialog(mainWindow, options)
  })
  ipcMain.handle('shell:openExternal', (_, url) => {
    shell.openExternal(url)
  })

  if (!isDev) {
    try {
      const result = await checkLicense()
      licenseValid = result.valid
    } catch {
      licenseValid = false
    }
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopTrackingServer()
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
})
