const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const rootDir = path.join(__dirname, '..')
const electronPkg = path.join(rootDir, 'node_modules/electron/package.json')
const electronVersion = JSON.parse(fs.readFileSync(electronPkg)).version

console.log(`Electron version detected: ${electronVersion}`)
console.log('Fetching Electron-compatible better-sqlite3 prebuilt binary...\n')

const cmd = [
  'node node_modules/prebuild-install/bin.js',
  `--runtime=electron`,
  `--target=${electronVersion}`,
  `--arch=x64`,
  `--tag-prefix=v`,
  `--download=https://github.com/WiseLibs/better-sqlite3/releases/download`
].join(' ')

try {
  execSync(cmd, {
    stdio: 'inherit',
    cwd: path.join(rootDir, 'node_modules/better-sqlite3')
  })
  console.log('\n✅ Successfully installed Electron-compatible better-sqlite3!')
  console.log('Now run: npm run dev')
} catch(e) {
  console.error('\n❌ Still failed. Run this command manually:')
  console.log(`cd node_modules/better-sqlite3`)
  console.log(`node ../../prebuild-install/bin.js --runtime=electron --target=${electronVersion} --arch=x64`)
}
