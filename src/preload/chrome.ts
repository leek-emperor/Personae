import { contextBridge, ipcRenderer } from 'electron'

/**
 * 导航栏（chrome）专用 preload。
 *
 * 只暴露导航控制，不暴露任何身份管理或文件能力 —— 这个 preload 运行在
 * 每个身份窗口的顶栏里，权限面越小越好。
 *
 * 注意：内容区（WebContentsView）**不加载任何 preload**，保持第三方页面
 * 环境干净，也避免网页探测到注入。
 */
export type ChromeState = {
  url: string | null
  title: string | null
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  identityName: string | null
  partition: string | null
}

const api = {
  back: () => ipcRenderer.send('chrome:back'),
  forward: () => ipcRenderer.send('chrome:forward'),
  reload: () => ipcRenderer.send('chrome:reload'),
  home: () => ipcRenderer.send('chrome:home'),
  navigate: (input: string) => ipcRenderer.send('chrome:navigate', input),
  /** 主动索取一次当前状态（例如用户按 Esc 取消编辑后恢复地址栏） */
  refresh: () => ipcRenderer.send('chrome:refresh'),
  /** 顶栏加载完成，通知主进程可以开始推状态 */
  ready: () => ipcRenderer.send('chrome:ready'),
  onState: (cb: (s: ChromeState) => void) => {
    ipcRenderer.on('chrome:state', (_e, s: ChromeState) => cb(s))
  }
}

contextBridge.exposeInMainWorld('chromeApi', api)
