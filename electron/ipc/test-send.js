const nodemailer = require('nodemailer')

async function testDirectSend() {
  // CHANGE THESE VALUES FOR TESTING
  const EMAIL    = 'YOUR_GMAIL@gmail.com'
  const PASSWORD = 'YOUR_APP_PASSWORD'
  const TO       = 'test@gmail.com'

  console.log('[TEST] Creating transporter...')
  const transporter = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false,
    requireTLS: true,
    auth: { user: EMAIL, pass: PASSWORD },
    debug: true,
    logger: true,
    connectionTimeout: 15000,
    greetingTimeout:   10000,
    tls: { rejectUnauthorized: false }
  })

  console.log('[TEST] Verifying...')
  try {
    await transporter.verify()
    console.log('[TEST] ✅ Verify passed')
  } catch(e) {
    console.log('[TEST] ❌ Verify failed:', e.message)
    return
  }

  console.log('[TEST] Sending...')
  try {
    const result = await transporter.sendMail({
      from:    EMAIL,
      to:      TO,
      subject: 'Mailflow Direct Test',
      text:    'This is a direct test email from Mailflow diagnostic.',
      html:    '<p>This is a <b>direct test</b> email from Mailflow diagnostic.</p>',
    })
    console.log('[TEST] ✅ Result:', JSON.stringify(result))
    console.log('[TEST] Message ID:', result.messageId)
    console.log('[TEST] Accepted:', result.accepted)
    console.log('[TEST] Rejected:', result.rejected)
    console.log('[TEST] Response:', result.response)
  } catch(e) {
    console.log('[TEST] ❌ Send failed:', e.message)
  }

  transporter.close()
}

testDirectSend()
