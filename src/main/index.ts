import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { enableCdp, discoverCdpPort, listTargets } from './cdp'
import { identityManager, DEFAULT_HOME } from './identity'
import {
  startAgentBridge,
  stopAgentBridge,
  bridgePort,
  bridgeFilePath,
  agentBrowserPath,
  refreshBridgeFile
} from './agent-bridge'
import { getMcpSetupInfo, installCodexConfig, isCodexConfigured } from './mcp-setup'

// 必须在 app ready 之前开启 CDP —— 命令行 switch 只在启动时生效
enableCdp()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 控制台窗口自身的外链走系统浏览器（它不是身份窗口，不受单 target 约束）
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('identity:list', () => identityManager.list())

  ipcMain.handle('identity:add', async (_e, name: string, homeUrl?: string) => {
    return identityManager.add(name, homeUrl || DEFAULT_HOME)
  })

  ipcMain.handle('identity:open', async (_e, id: string) => {
    const state = await identityManager.openWindow(id)
    refreshBridgeFile()
    return state
  })

  ipcMain.handle('identity:close', (_e, id: string) => {
    identityManager.closeWindow(id)
    return true
  })

  ipcMain.handle('identity:remove', async (_e, id: string) => {
    await identityManager.remove(id)
    return true
  })

  ipcMain.handle('agent:info', async () => {
    let cdpPort: number | null = null
    let cdpError: string | null = null
    try {
      cdpPort = await discoverCdpPort(3000)
    } catch (err) {
      cdpError = err instanceof Error ? err.message : String(err)
    }
    return {
      cdpPort,
      cdpError,
      bridgePort: bridgePort(),
      bridgeUrl: `http://127.0.0.1:${bridgePort()}`,
      bridgeFile: bridgeFilePath(),
      agentBrowserPath: agentBrowserPath()
    }
  })

  ipcMain.handle('agent:targets', async () => {
    try {
      return { targets: await listTargets() }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── MCP 一键配置：用户无需装 Node / agent-browser ──────────────
  ipcMain.handle('mcp:info', async () => ({
    ...getMcpSetupInfo(),
    codexInstalled: await isCodexConfigured()
  }))

  ipcMain.handle('mcp:installCodex', () => installCodexConfig())
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await identityManager.load()

  // 身份状态变化 → 通知渲染层 + 刷新给外部 agent 的发现文件
  identityManager.onChange(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('identity:changed')
    }
    refreshBridgeFile()
  })

  registerIpc()
  // 身份窗口顶栏的导航 IPC（后退/前进/刷新/主页/地址栏）
  identityManager.registerChromeIpc()
  createWindow()

  try {
    await startAgentBridge()
  } catch (err) {
    console.error('[main] agent bridge 启动失败:', err)
  }

  // 打印一次接入信息，方便直接复制给 codex
  try {
    const port = await discoverCdpPort(8000)
    console.log(`\n[mib] CDP 端口: ${port}`)
    console.log(`[mib] Agent Bridge: http://127.0.0.1:${bridgePort()}/info`)
    console.log(`[mib] 发现文件: ${bridgeFilePath()}`)
    console.log(`[mib] agent-browser: ${agentBrowserPath()}\n`)
  } catch (err) {
    console.error('[main] CDP 端口发现失败:', err)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // 关掉身份窗口与 bridge，避免留下孤儿进程/端口
  identityManager.closeAll()
  stopAgentBridge()
})
