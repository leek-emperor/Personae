import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  identity: {
    list: () => ipcRenderer.invoke('identity:list'),
    add: (name: string, homeUrl?: string) => ipcRenderer.invoke('identity:add', name, homeUrl),
    open: (id: string) => ipcRenderer.invoke('identity:open', id),
    close: (id: string) => ipcRenderer.invoke('identity:close', id),
    remove: (id: string) => ipcRenderer.invoke('identity:remove', id),
    onChanged: (cb: () => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('identity:changed', handler)
      return () => ipcRenderer.removeListener('identity:changed', handler)
    }
  },
  agent: {
    info: () => ipcRenderer.invoke('agent:info'),
    targets: () => ipcRenderer.invoke('agent:targets')
  },
  mcp: {
    info: () => ipcRenderer.invoke('mcp:info'),
    installCodex: () => ipcRenderer.invoke('mcp:installCodex')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
