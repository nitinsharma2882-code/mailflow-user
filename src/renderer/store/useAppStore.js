import { create } from 'zustand'

export const useAppStore = create((set, get) => ({
  // Current page
  activePage: 'dashboard',
  setActivePage: (page) => set({ activePage: page }),

  // Toast notifications
  toasts: [],
  addToast: (message, type = 'info', duration = 3000) => {
    const id = Date.now() + Math.random()
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    }, duration)
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  // Campaigns
  campaigns: [],
  setCampaigns: (campaigns) => set({ campaigns }),
  updateCampaign: (id, data) => set(s => ({
    campaigns: s.campaigns.map(c => c.id === id ? { ...c, ...data } : c)
  })),

  // Contacts
  contactLists: [],
  setContactLists: (lists) => set({ contactLists: lists }),

  // Servers
  servers: [],
  setServers: (servers) => set({ servers }),

  // Templates
  templates: [],
  setTemplates: (templates) => set({ templates }),

  // Analytics
  analytics: null,
  setAnalytics: (data) => set({ analytics: data }),

  // Loading states
  loading: {},
  setLoading: (key, val) => set(s => ({ loading: { ...s.loading, [key]: val } })),
  isLoading: (key) => get().loading[key] || false,

  // Running campaign progress
  campaignProgress: {},
  setCampaignProgress: (id, data) => set(s => ({
    campaignProgress: { ...s.campaignProgress, [id]: data }
  })),

  // Resend / duplicate campaign prefill
  resendCampaign: null,
  setResendCampaign: (data) => set({ resendCampaign: data }),
  clearResendCampaign: () => set({ resendCampaign: null }),

  // Test campaign history (kept in memory for session, max 10)
  testCampaignHistory: [],
  addTestCampaignToHistory: (entry) => set(s => ({
    testCampaignHistory: [entry, ...s.testCampaignHistory].slice(0, 10)
  })),

  // Reset all user-specific data on license switch
  resetStore: () => set({
    campaigns:           [],
    contactLists:        [],
    servers:             [],
    templates:           [],
    analytics:           null,
    toasts:              [],
    campaignProgress:    {},
    resendCampaign:      null,
    testCampaignHistory: [],
    activePage:          'dashboard',
  }),
}))
