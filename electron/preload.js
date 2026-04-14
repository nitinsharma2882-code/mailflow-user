const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  campaigns: {
    getAll:    ()          => ipcRenderer.invoke('campaigns:getAll'),
    getById:   (id)        => ipcRenderer.invoke('campaigns:getById', id),
    create:    (data)      => ipcRenderer.invoke('campaigns:create', data),
    update:    (id, data)  => ipcRenderer.invoke('campaigns:update', id, data),
    delete:    (id)        => ipcRenderer.invoke('campaigns:delete', id),
    getStats:  (id)        => ipcRenderer.invoke('campaigns:getStats', id),
  },
  contacts: {
    getLists:      ()               => ipcRenderer.invoke('contacts:getLists'),
    getList:       (id)             => ipcRenderer.invoke('contacts:getList', id),
    importCSV:     (filePath, name) => ipcRenderer.invoke('contacts:importCSV', filePath, name),
    deleteList:    (id)             => ipcRenderer.invoke('contacts:deleteList', id),
    exportInvalid: (listId)         => ipcRenderer.invoke('contacts:exportInvalid', listId),
    getPreview:    (listId, limit)  => ipcRenderer.invoke('contacts:getPreview', listId, limit),
  },
  servers: {
    getAll:     ()          => ipcRenderer.invoke('servers:getAll'),
    create:     (data)      => ipcRenderer.invoke('servers:create', data),
    update:     (id, data)  => ipcRenderer.invoke('servers:update', id, data),
    delete:     (id)        => ipcRenderer.invoke('servers:delete', id),
    test:       (id)        => ipcRenderer.invoke('servers:test', id),
    testConfig: (config)    => ipcRenderer.invoke('servers:testConfig', config),
  },
  templates: {
    getAll:    ()          => ipcRenderer.invoke('templates:getAll'),
    getById:   (id)        => ipcRenderer.invoke('templates:getById', id),
    create:    (data)      => ipcRenderer.invoke('templates:create', data),
    update:    (id, data)  => ipcRenderer.invoke('templates:update', id, data),
    delete:    (id)        => ipcRenderer.invoke('templates:delete', id),
    duplicate: (id)        => ipcRenderer.invoke('templates:duplicate', id),
  },
  sending: {
    startCampaign:  (id)        => ipcRenderer.invoke('sending:start', id),
    pauseCampaign:  (id)        => ipcRenderer.invoke('sending:pause', id),
    resumeCampaign: (id)        => ipcRenderer.invoke('sending:resume', id),
    cancelCampaign: (id)        => ipcRenderer.invoke('sending:cancel', id),
    sendTest:       (data)      => ipcRenderer.invoke('sending:test', data),
    getQueueStatus: (id)        => ipcRenderer.invoke('sending:queueStatus', id),
    exportResults:  (id, type)  => ipcRenderer.invoke('sending:exportResults', id, type),
  },
  verify: {
    verifyList:    (fp, opts)  => ipcRenderer.invoke('verify:list', fp, opts),
    verifySingle:  (email)     => ipcRenderer.invoke('verify:single', email),
    exportResults: (res, type) => ipcRenderer.invoke('verify:export', res, type),
  },
  smtp: {
    testSingle:    (config)    => ipcRenderer.invoke('smtp:testSingle', config),
    testBulk:      (fp)        => ipcRenderer.invoke('smtp:testBulk', fp),
    exportResults: (res, type) => ipcRenderer.invoke('smtp:export', res, type),
  },
  analytics: {
    getDashboard:     ()      => ipcRenderer.invoke('analytics:dashboard'),
    getCampaignStats: (id)    => ipcRenderer.invoke('analytics:campaign', id),
    getOverview:      (p)     => ipcRenderer.invoke('analytics:overview', p),
    export:           (p)     => ipcRenderer.invoke('analytics:export', p),
  },
  license: {
    check:          ()                         => ipcRenderer.invoke('license:check'),
    activate:       (key)                      => ipcRenderer.invoke('license:activate', key),
    clear:          ()                         => ipcRenderer.invoke('license:clear'),
    getInfo:        ()                         => ipcRenderer.invoke('license:getInfo'),
    getHardwareId:  ()                         => ipcRenderer.invoke('license:getHardwareId'),
    saveActivation: (key, license, hardwareId) => ipcRenderer.invoke('license:saveActivation', key, license, hardwareId),
  },
  dialog: {
    openFile: (opts) => ipcRenderer.invoke('dialog:openFile', opts),
    saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  on: (channel, callback) => {
    const valid = [
      'sending:progress', 'sending:complete', 'sending:error',
      'queue:update', 'campaign:statusChange', 'license:status',
      'update:downloading', 'update:progress'
    ]
    if (valid.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args))
    }
  },
  off: (channel, callback) => ipcRenderer.removeListener(channel, callback),
})