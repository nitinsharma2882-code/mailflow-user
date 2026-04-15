const { contextBridge, ipcRenderer } = require('electron')

// Expose safe IPC API to renderer
contextBridge.exposeInMainWorld('api', {
  // Campaigns
  campaigns: {
    getAll: () => ipcRenderer.invoke('campaigns:getAll'),
    getById: (id) => ipcRenderer.invoke('campaigns:getById', id),
    create: (data) => ipcRenderer.invoke('campaigns:create', data),
    update: (id, data) => ipcRenderer.invoke('campaigns:update', id, data),
    delete: (id) => ipcRenderer.invoke('campaigns:delete', id),
    getStats: (id) => ipcRenderer.invoke('campaigns:getStats', id),
  },

  // Contacts
  contacts: {
    getLists: () => ipcRenderer.invoke('contacts:getLists'),
    getList: (id) => ipcRenderer.invoke('contacts:getList', id),
    importCSV: (filePath, listName) => ipcRenderer.invoke('contacts:importCSV', filePath, listName),
    deleteList: (id) => ipcRenderer.invoke('contacts:deleteList', id),
    exportInvalid: (listId) => ipcRenderer.invoke('contacts:exportInvalid', listId),
    getPreview: (listId, limit) => ipcRenderer.invoke('contacts:getPreview', listId, limit),
  },

  // Servers
  servers: {
    getAll: () => ipcRenderer.invoke('servers:getAll'),
    create: (data) => ipcRenderer.invoke('servers:create', data),
    update: (id, data) => ipcRenderer.invoke('servers:update', id, data),
    delete: (id) => ipcRenderer.invoke('servers:delete', id),
    test: (id) => ipcRenderer.invoke('servers:test', id),
    testConfig: (config) => ipcRenderer.invoke('servers:testConfig', config),
  },

  // Templates
  templates: {
    getAll: () => ipcRenderer.invoke('templates:getAll'),
    getById: (id) => ipcRenderer.invoke('templates:getById', id),
    create: (data) => ipcRenderer.invoke('templates:create', data),
    update: (id, data) => ipcRenderer.invoke('templates:update', id, data),
    delete: (id) => ipcRenderer.invoke('templates:delete', id),
    duplicate: (id) => ipcRenderer.invoke('templates:duplicate', id),
  },

  // Sending engine
  sending: {
    startCampaign: (campaignId) => ipcRenderer.invoke('sending:start', campaignId),
    pauseCampaign: (campaignId) => ipcRenderer.invoke('sending:pause', campaignId),
    resumeCampaign: (campaignId) => ipcRenderer.invoke('sending:resume', campaignId),
    cancelCampaign: (campaignId) => ipcRenderer.invoke('sending:cancel', campaignId),
    sendTest: (data) => ipcRenderer.invoke('sending:test', data),
    getQueueStatus: (campaignId) => ipcRenderer.invoke('sending:queueStatus', campaignId),
    exportResults: (campaignId, type) => ipcRenderer.invoke('sending:exportResults', campaignId, type),
  },

  // Email verification
  verify: {
    verifyList: (filePath, options) => ipcRenderer.invoke('verify:list', filePath, options),
    verifySingle: (email) => ipcRenderer.invoke('verify:single', email),
    exportResults: (results, type) => ipcRenderer.invoke('verify:export', results, type),
  },

  // SMTP testing
  smtp: {
    testSingle: (config) => ipcRenderer.invoke('smtp:testSingle', config),
    testBulk: (filePath) => ipcRenderer.invoke('smtp:testBulk', filePath),
    exportResults: (results, type) => ipcRenderer.invoke('smtp:export', results, type),
  },

  // Analytics
  analytics: {
    getDashboard: () => ipcRenderer.invoke('analytics:dashboard'),
    getCampaignStats: (campaignId) => ipcRenderer.invoke('analytics:campaign', campaignId),
    getOverview: (period) => ipcRenderer.invoke('analytics:overview', period),
    export: (period) => ipcRenderer.invoke('analytics:export', period),
  },


  // Custom SMTP
  customSmtp: {
    parseCsv:  (csvText)  => ipcRenderer.invoke('customSmtp:parseCsv', csvText),
    validate:  (accounts) => ipcRenderer.invoke('customSmtp:validate', accounts),
    exportCsv: (data)     => ipcRenderer.invoke('customSmtp:exportCsv', data),
  },

  // License
  license: {
    check:          ()                         => ipcRenderer.invoke('license:check'),
    activate:       (key)                      => ipcRenderer.invoke('license:activate', key),
    clear:          ()                         => ipcRenderer.invoke('license:clear'),
    getInfo:        ()                         => ipcRenderer.invoke('license:getInfo'),
    getHardwareId:  ()                         => ipcRenderer.invoke('license:getHardwareId'),
    saveActivation: (key, license, hardwareId) => ipcRenderer.invoke('license:saveActivation', key, license, hardwareId),
  },
  // File dialogs
  dialog: {
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  },

  // Shell
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // Listen for events from main process
  on: (channel, callback) => {
    const validChannels = [
      'sending:progress', 'sending:complete', 'sending:error',
      'queue:update', 'campaign:statusChange'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args))
    }
  },

  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback)
  }
})
