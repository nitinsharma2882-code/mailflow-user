// Launcher that ensures ELECTRON_RUN_AS_NODE is unset before starting Electron.
// This variable, when set to 1 (e.g. by some tools), makes Electron run as plain
// Node.js and skip app initialization entirely, which breaks the main process.
const { spawn } = require('child_process')
const electron  = require('electron')

delete process.env.ELECTRON_RUN_AS_NODE
process.env.NODE_ENV = process.env.NODE_ENV || 'development'

const child = spawn(electron, ['.'], { stdio: 'inherit', windowsHide: false })
child.on('close', (code) => process.exit(code ?? 0))
