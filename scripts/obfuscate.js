const JavaScriptObfuscator = require('javascript-obfuscator')
const fs   = require('fs')
const path = require('path')

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

const OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
}

console.log('🔒 Obfuscating Electron main process files...\n')

let success = 0
let failed  = 0

for (const target of TARGETS) {
  const filePath = path.join(__dirname, '..', target)
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠ Skipped (not found): ${target}`)
    continue
  }

  try {
    const code       = fs.readFileSync(filePath, 'utf8')
    const obfuscated = JavaScriptObfuscator.obfuscate(code, OPTIONS)
    fs.writeFileSync(filePath, obfuscated.getObfuscatedCode(), 'utf8')
    console.log(`  ✓ Obfuscated: ${target}`)
    success++
  } catch (err) {
    console.log(`  ✕ Failed: ${target} — ${err.message}`)
    failed++
  }
}

console.log(`\n✅ Done — ${success} obfuscated, ${failed} failed`)
