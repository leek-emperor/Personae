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
  }
}
