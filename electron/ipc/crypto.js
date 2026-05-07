const crypto = require('crypto')

const APP_SECRET = 'mailflow-app-secret-key-2026-xyz'
const KEY = crypto.createHash('sha256').update(APP_SECRET).digest()

function encryptCredential(plaintext) {
  if (!plaintext) return ''
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

function decryptCredential(ivEncrypted) {
  if (!ivEncrypted || !ivEncrypted.includes(':')) return ivEncrypted
  try {
    const [ivHex, encHex] = ivEncrypted.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, iv)
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()])
    return decrypted.toString('utf8')
  } catch {
    return ivEncrypted
  }
}

module.exports = { encryptCredential, decryptCredential }
