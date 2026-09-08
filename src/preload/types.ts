export type ChildWindowState = {
  targetId: string | null
  url: string | null
  title: string | null
}

export type ProxyScheme = 'http' | 'https' | 'socks5'

/** 代理状态（不含密码明文） */
export type ProxyState = {
  scheme: ProxyScheme
  host: string
  port: number
  username?: string
  hasPassword: boolean
  secretEncrypted: boolean
}

/** 设置代理时从界面传入的字段（密码可选，编辑时不重填则不改） */
export type ProxyInput = {
  scheme?: string
  host?: string
  port?: string | number
  username?: string
  password?: string
}

export type ProxyTestResult = { ok: boolean; ip?: string; error?: string }

export type IdentityState = {
  id: string
  name: string
  homeUrl: string
  createdAt: number
  partition: string
  isOpen: boolean
  targetId: string | null
  currentUrl: string | null
  title: string | null
  children: ChildWindowState[]
  proxy: ProxyState | null
}

export type AgentInfo = {
  cdpPort: number | null
  cdpError: string | null
  bridgePort: number
  bridgeUrl: string
  bridgeFile: string
  agentBrowserPath: string
}

export type CdpTarget = {
  id: string
  type: string
  title: string
  url: string
}

export type McpSetupInfo = {
  nodeRuntime: string
  scriptPath: string
  agentBrowser: string
  codexConfigPath: string
  codexToml: string
  claudeCommand: string
  scriptExists: boolean
  codexInstalled: boolean
}

export type InstallResult = {
  ok: boolean
  path: string
  action: 'created' | 'updated' | 'unchanged'
  backup?: string
  error?: string
}

export type Api = {
  identity: {
    list: () => Promise<IdentityState[]>
    add: (name: string, homeUrl?: string) => Promise<IdentityState>
    open: (id: string) => Promise<IdentityState>
    close: (id: string) => Promise<boolean>
    remove: (id: string) => Promise<boolean>
    setProxy: (id: string, input: ProxyInput) => Promise<IdentityState>
    clearProxy: (id: string) => Promise<IdentityState>
    testProxy: (id: string) => Promise<ProxyTestResult>
    onChanged: (cb: () => void) => () => void
  }
  agent: {
    info: () => Promise<AgentInfo>
    targets: () => Promise<{ targets?: CdpTarget[]; error?: string }>
  }
  mcp: {
    info: () => Promise<McpSetupInfo>
    installCodex: () => Promise<InstallResult>
  }
  app: {
    setLanguage: (lang: string) => Promise<void>
    getPopupBlocker: () => Promise<boolean>
    setPopupBlocker: (enabled: boolean) => Promise<boolean>
    onPopupBlocked: (cb: (url: string) => void) => () => void
  }
}
