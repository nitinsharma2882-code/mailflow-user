import React, { useState, useEffect } from 'react'

const PLAN_LABELS = {
  '1day':    '1 Day',
  '7days':   '7 Days',
  '30days':  '30 Days',
  '90days':  '90 Days',
  '365days': '1 Year',
  'lifetime':'Lifetime',
}

export default function ActivationScreen({ onActivated, expiredPlan, expiredMessage }) {
  const [key,     setKey]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [hwId,    setHwId]    = useState('')
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    if (window.api?.license) {
      window.api.license.getHardwareId().then(setHwId)
    }
  }, [])

  async function handleActivate() {
    if (!key.trim()) { setError('Please enter your license key'); return }
    setLoading(true)
    setError('')

    try {
      const result = await window.api.license.activate(key.trim())
      if (result.success) {
        setSuccess(result.license)
        setTimeout(() => onActivated(result.license), 1800)
      } else {
        setError(result.error || 'Invalid license key.')
      }
    } catch {
      setError('Cannot connect to license server. Check your internet connection.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyChange(e) {
    setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))
    setError('')
  }

  // ── Success state ─────────────────────────────────────────────
  if (success) {
    return (
      <div style={outerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, background: '#E8F7EE',
              borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 auto 20px', fontSize: 28
            }}>✓</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#1D7348' }}>
              Activated!
            </h2>
            <p style={{ fontSize: 14, color: '#5A5A72', marginBottom: 8 }}>
              Welcome, <strong>{success.customerName}</strong>
            </p>
            {success.expiresAt ? (
              <div style={{ background: '#F7F7F8', borderRadius: 8, padding: '12px 16px',
                fontSize: 13, color: '#5A5A72', marginTop: 16 }}>
                Plan: <strong>{PLAN_LABELS[success.plan] || success.plan}</strong>
                {' · '}Expires: <strong>{new Date(success.expiresAt).toLocaleDateString()}</strong>
                {' · '}<strong style={{ color: '#4A3AFF' }}>{success.daysRemaining} days remaining</strong>
              </div>
            ) : (
              <div style={{ background: '#EEF0FF', borderRadius: 8, padding: '12px 16px',
                fontSize: 13, color: '#4A3AFF', marginTop: 16, fontWeight: 600 }}>
                🎉 Lifetime license — never expires
              </div>
            )}
            <p style={{ fontSize: 13, color: '#9898B0', marginTop: 16 }}>
              Loading Mailflow...
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={outerStyle}>
      <div style={cardStyle}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{
            width: 42, height: 42, background: '#4A3AFF',
            borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="1" y="4" width="20" height="14" rx="2" stroke="white" strokeWidth="1.5"/>
              <path d="M1 8l10 6 10-6" stroke="white" strokeWidth="1.5"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>Mailflow</div>
            <div style={{ fontSize: 12, color: '#9898B0' }}>Bulk email marketing platform</div>
          </div>
        </div>

        {/* Expired warning */}
        {expiredPlan && (
          <div style={{
            background: '#FDEDEC', border: '1px solid #F5C6C3',
            borderRadius: 8, padding: '12px 14px', marginBottom: 20,
            fontSize: 13, color: '#C0392B', lineHeight: 1.5
          }}>
            <strong>Your license has expired.</strong> Enter a new license key to continue using Mailflow.
          </div>
        )}

        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, letterSpacing: '-0.3px' }}>
          {expiredPlan ? 'Renew your license' : 'Activate your license'}
        </h1>
        <p style={{ fontSize: 14, color: '#5A5A72', marginBottom: 28, lineHeight: 1.6 }}>
          Enter your license key below. You received this after purchasing Mailflow.
        </p>

        {/* Input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#5A5A72',
            display: 'block', marginBottom: 8 }}>
            LICENSE KEY
          </label>
          <input
            type="text"
            value={key}
            onChange={handleKeyChange}
            onKeyDown={e => e.key === 'Enter' && handleActivate()}
            placeholder="MFLOW-XXXXXX-XXXXXX-XXXXXX-XXXXXX"
            spellCheck={false}
            autoFocus
            style={{
              width: '100%', padding: '12px 14px',
              border: `1.5px solid ${error ? '#C0392B' : '#E0E0E8'}`,
              borderRadius: 8, fontSize: 14,
              fontFamily: 'DM Mono, Courier New, monospace',
              letterSpacing: '1px', outline: 'none',
              color: '#0D0D12', background: '#fff',
            }}
          />
          {error && (
            <div style={{ fontSize: 13, color: '#C0392B', marginTop: 8, fontWeight: 500 }}>
              ✕ {error}
            </div>
          )}
        </div>

        {/* Button */}
        <button
          onClick={handleActivate}
          disabled={loading || !key.trim()}
          style={{
            width: '100%', padding: '13px',
            background: loading || !key.trim() ? '#B0B0C0' : '#4A3AFF',
            color: '#fff', border: 'none', borderRadius: 8,
            fontSize: 14, fontWeight: 600,
            cursor: loading || !key.trim() ? 'not-allowed' : 'pointer',
            fontFamily: 'DM Sans, system-ui',
            marginBottom: 20, transition: 'background 0.12s'
          }}
        >
          {loading ? '⏳ Verifying...' : '🔑 Activate Mailflow'}
        </button>

        {/* Plans info */}
        <div style={{ background: '#F7F7F8', borderRadius: 8, padding: '14px',
          marginBottom: 16, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: '#5A5A72', marginBottom: 8 }}>AVAILABLE PLANS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {[
              ['1 Day', 'Trial'],
              ['7 Days', 'Weekly'],
              ['30 Days', 'Monthly'],
              ['90 Days', 'Quarterly'],
              ['1 Year', 'Annual'],
              ['Lifetime', 'Forever'],
            ].map(([duration, label]) => (
              <div key={label} style={{
                background: '#fff', borderRadius: 6, padding: '8px 10px',
                border: '1px solid #E8E8F0', textAlign: 'center'
              }}>
                <div style={{ fontWeight: 600, color: '#0D0D12', fontSize: 13 }}>{duration}</div>
                <div style={{ color: '#9898B0', fontSize: 11 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #F0F0F4', paddingTop: 16,
          fontSize: 12, color: '#9898B0' }}>
          Need a license?{' '}
          <span style={{ color: '#4A3AFF', cursor: 'pointer', fontWeight: 500 }}
            onClick={() => window.api?.shell?.openExternal('mailto:support@mailflow.io')}>
            Contact us
          </span>

          {hwId && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: '#F7F7F8',
              borderRadius: 6, fontSize: 11 }}>
              <span style={{ fontWeight: 600 }}>Machine ID: </span>
              <span style={{ fontFamily: 'monospace' }}>{hwId.substring(0, 20)}...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const outerStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: '100vh', background: '#F7F7F8',
  fontFamily: 'DM Sans, system-ui, sans-serif'
}

const cardStyle = {
  background: '#fff', borderRadius: 16, padding: '40px 36px',
  width: 500, border: '1px solid rgba(0,0,0,0.08)',
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)'
}
