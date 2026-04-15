/**
 * Secure build script:
 * 1. Build React (vite)
 * 2. Obfuscate all Electron main process files
 * 3. Build installer (electron-builder)
 * 4. Restore original files from git
 */

const { execSync } = require('child_process')
const fs   = require('fs')
const path = require('path')

function run(cmd) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') })
}

// Backup original files before obfuscation
const TARGETS = [
  'electron/main.js',
  'electron/preload.js',
  'electron/license.js',
  'electron/ipc/campaigns.js',
  'electron/ipc/contacts.js',
  'electron/ipc/sending.js',
  'electron/ipc/servers.js',
  'electron/ipc/templates.js',
  'electron/ipc/verify.js',
  'electron/ipc/smtp.js',
  'electron/ipc/analytics.js',
  'electron/ipc/customSmtp.js',
]

const ROOT = path.join(__dirname, '..')
const backups = {}

function backupFiles() {
  console.log('\n📦 Backing up original files...')
  for (const t of TARGETS) {
    const fp = path.join(ROOT, t)
    if (fs.existsSync(fp)) {
      backups[t] = fs.readFileSync(fp, 'utf8')
    }
  }
}

function restoreFiles() {
  console.log('\n♻️  Restoring original files...')
  for (const [t, content] of Object.entries(backups)) {
    fs.writeFileSync(path.join(ROOT, t), content, 'utf8')
    console.log(`  ✓ Restored: ${t}`)
  }
}

async function main() {
  try {
    console.log('🚀 Starting secure build...\n')

    // Step 1: Build React
    run('npm run build:react')

    // Step 2: Backup originals
    backupFiles()

    // Step 3: Obfuscate
    run('node scripts/obfuscate.js')

    // Step 4: Build installer
    run('node node_modules/electron-builder/cli.js --win')

    // Step 5: Restore
    restoreFiles()

    console.log('\n🎉 Secure build complete!')
    console.log('📁 Installer: dist-electron\\Mailflow-Setup-1.0.0.exe')

  } catch (err) {
    console.error('\n❌ Build failed:', err.message)
    // Always restore even on failure
    restoreFiles()
    process.exit(1)
  }
}

main()
