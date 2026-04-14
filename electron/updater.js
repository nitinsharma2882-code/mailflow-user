const { autoUpdater } = require('electron-updater')
const { dialog, BrowserWindow } = require('electron')
const log = require('electron-log')

// Configure logger
autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'info'

// Don't auto-install — ask the user first
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.autoDownload = false

function setupAutoUpdater(mainWindow) {
  // Check for updates silently on startup (after 3 seconds)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      log.error('Update check failed:', err)
    })
  }, 3000)

  // Update available — ask user
  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update available',
      message: `Mailflow ${info.version} is available.`,
      detail: 'A new version has been released. Would you like to download it now?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate()
        // Notify renderer to show download progress
        mainWindow.webContents.send('update:downloading')
      }
    })
  })

  // No update
  autoUpdater.on('update-not-available', () => {
    log.info('App is up to date.')
  })

  // Download progress
  autoUpdater.on('download-progress', (progress) => {
    const msg = `Download speed: ${Math.round(progress.bytesPerSecond / 1024)} KB/s — ${Math.round(progress.percent)}%`
    log.info(msg)
    mainWindow.webContents.send('update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  // Download complete — prompt to restart
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: 'Update downloaded. Restart to apply.',
      detail: `Mailflow ${info.version} has been downloaded. Restart the app now to install it.`,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(false, true)
      }
    })
  })

  // Error
  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err)
  })
}

module.exports = { setupAutoUpdater }
