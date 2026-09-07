/**
 * 界面文案。
 *
 * 为什么手写而不引 i18next / react-intl：
 * 只有两种语言、一百来条文案、没有复数和日期格式需求，
 * 引一个几十 KB 的运行时不划算。这里用 TS 类型保证完整性 ——
 * `Dict` 由中文表推导，英文表必须实现同一套 key，
 * 少一条 typecheck 直接报错，不会出现漏翻后静默显示 undefined。
 *
 * 带参数的文案写成函数而不是模板字符串占位符替换，
 * 同样是为了让类型检查覆盖参数个数与类型。
 */

export type Lang = 'en' | 'zh'

const zh = {
  // ── 头部 ──────────────────────────────────────────────
  tagline: '· 多身份浏览器',
  intro1: '每个身份是一个独立的 ',
  intro2: ' partition，跑在自己的窗口里，登录态互不可见；每个窗口都能被 AI agent 通过 MCP 驱动。',

  // ── 状态条 ────────────────────────────────────────────
  statusLabel: '状态',
  ready: '就绪',
  notReady: '未就绪',
  cdpPort: 'CDP 端口',
  identitiesLabel: '身份',
  identityCount: (total: number, open: number) => `${total} 个 · ${open} 个已打开`,
  agentAccess: 'Agent 接入',
  codexConfigured: 'Codex 已配置',
  notConfigured: '未配置',

  // ── 身份 ──────────────────────────────────────────────
  browserIdentities: '浏览器身份',
  namePlaceholder: '身份名称，如 账号A',
  homeUrlPlaceholder: '主页 URL',
  addIdentity: '添加身份',
  emptyTitle: '还没有身份',
  emptyHint: '填个名字添加第一个。每个身份都有独立的登录态，互不影响。',
  live: '运行中',
  idle: '未打开',
  focus: '聚焦',
  openWindow: '打开窗口',
  close: '关闭',
  remove: '删除',
  targetIdPending: '—（打开窗口后生成）',
  currentPage: '当前页',
  manualSummary: '用 agent-browser 手工操作该身份',
  // 命令块内的注释不做双语：它是贴进终端 / 给 agent 读的技术内容，
  // 英文是这个语境下的通用语言，双语维护两份还容易走样。
  cmdPreferMcp: '# Prefer the bundled MCP (identity lookup and ref lifetime already handled)',
  cmdManual: '# Manual: targetId doubles as a tab ref, so one hop is enough',
  cmdPitfalls: '# Two pitfalls:',
  cmdPitfall1a: '#  · --no-pin-tab is required: --pin-tab triggers Target.createTarget,',
  cmdPitfall1b: '#    which Electron rejects, and the state is sticky enough to poison the session',
  cmdPitfall2a: '#  · An @eN ref only lives inside one process — snapshot and the actions',
  cmdPitfall2b: '#    that use it must go in the same batch',

  // ── Agent 接入 ────────────────────────────────────────
  agentSection: '接入 AI Agent',
  noInstallNeeded1: '你的机器',
  noInstallNeeded2: '无需安装 Node 或 agent-browser',
  noInstallNeeded3: '：MCP 脚本由本应用自带的运行时执行，agent-browser 已随包捆绑。',
  rewriteCodex: '重新写入 Codex 配置',
  installCodex: '一键配置 Codex',
  copyToml: '复制 TOML',
  copyClaude: '复制 Claude 命令',
  copied: '已复制',
  installedCreated: '已创建配置文件',
  installedUpdated: '已更新配置',
  installedUnchanged: '已是最新配置',
  backupNote: '（原文件已备份）',
  restartCodex: ' — 重启 codex 生效',
  installFailed: (e: string) => `失败：${e}`,
  selfServeTitle: '让 agent 自己接入',
  selfServeHint:
    '把下面这段整段发给 Codex 或 Claude Code。它包含配置写法、13 个工具的用途、以及几个实际踩过的坑，agent 读完会自己改配置、重启并验证链路。',
  copyPrompt: '复制这段 prompt',
  copiedGoPaste: '已复制，去粘给 agent',
  detailsSummary: '接入细节与手工配置内容',
  codexConfigRow: 'Codex 配置',
  configured: '已配置',
  mcpScript: 'MCP 脚本',
  missing: '缺失 — ',
  runtime: '运行时',
  loading: '读取中…',

  // ── 运行时 ────────────────────────────────────────────
  runtimeSection: '运行时',
  discoveryFile: '发现文件',
  viewRawTargets: '查看原始 CDP targets',
  refresh: '刷新',
  noTargets: '（无 target）',

  // ── 其他 ──────────────────────────────────────────────
  writeFailed: '写入失败',
  langLabel: '语言'
}

/** 英文表必须覆盖中文表的每一个 key，否则 typecheck 失败。 */
export type Dict = typeof zh

const en: Dict = {
  tagline: '· multi-identity browser',
  intro1: 'Each identity is its own ',
  intro2:
    ' partition running in its own window, with fully isolated login state. Every window can be driven by an AI agent over MCP.',

  statusLabel: 'Status',
  ready: 'Ready',
  notReady: 'Not ready',
  cdpPort: 'CDP port',
  identitiesLabel: 'Identities',
  identityCount: (total: number, open: number) => `${total} total · ${open} open`,
  agentAccess: 'Agent access',
  codexConfigured: 'Codex configured',
  notConfigured: 'Not configured',

  browserIdentities: 'Browser identities',
  namePlaceholder: 'Identity name, e.g. Work',
  homeUrlPlaceholder: 'Home URL',
  addIdentity: 'Add identity',
  emptyTitle: 'No identities yet',
  emptyHint:
    'Enter a name to add your first one. Each identity keeps its own login state, fully isolated from the others.',
  live: 'live',
  idle: 'idle',
  focus: 'Focus',
  openWindow: 'Open window',
  close: 'Close',
  remove: 'Remove',
  targetIdPending: '— (created once the window opens)',
  currentPage: 'Current page',
  manualSummary: 'Drive this identity manually with agent-browser',
  cmdPreferMcp: '# Prefer the bundled MCP (identity lookup and ref lifetime already handled)',
  cmdManual: '# Manual: targetId doubles as a tab ref, so one hop is enough',
  cmdPitfalls: '# Two pitfalls:',
  cmdPitfall1a: '#  · --no-pin-tab is required: --pin-tab triggers Target.createTarget,',
  cmdPitfall1b: '#    which Electron rejects, and the state is sticky enough to poison the session',
  cmdPitfall2a: '#  · An @eN ref only lives inside one process — snapshot and the actions',
  cmdPitfall2b: '#    that use it must go in the same batch',

  agentSection: 'Connect an AI agent',
  noInstallNeeded1: 'Your machine ',
  noInstallNeeded2: 'needs neither Node nor agent-browser',
  noInstallNeeded3:
    ': the MCP script runs on the runtime shipped with this app, and agent-browser is bundled.',
  rewriteCodex: 'Rewrite Codex config',
  installCodex: 'Configure Codex',
  copyToml: 'Copy TOML',
  copyClaude: 'Copy Claude command',
  copied: 'Copied',
  installedCreated: 'Config file created',
  installedUpdated: 'Config updated',
  installedUnchanged: 'Already up to date',
  backupNote: ' (original backed up)',
  restartCodex: ' — restart codex to apply',
  installFailed: (e: string) => `Failed: ${e}`,
  selfServeTitle: 'Let the agent connect itself',
  selfServeHint:
    'Send the whole block below to Codex or Claude Code. It covers the config format, what the 13 tools do, and several pitfalls hit in practice. The agent will edit its own config, restart, and verify the connection.',
  copyPrompt: 'Copy this prompt',
  copiedGoPaste: 'Copied — paste it to your agent',
  detailsSummary: 'Connection details and manual config',
  codexConfigRow: 'Codex config',
  configured: 'Configured',
  mcpScript: 'MCP script',
  missing: 'missing — ',
  runtime: 'Runtime',
  loading: 'Loading…',

  runtimeSection: 'Runtime',
  discoveryFile: 'Discovery file',
  viewRawTargets: 'View raw CDP targets',
  refresh: 'Refresh',
  noTargets: '(no targets)',

  writeFailed: 'Write failed',
  langLabel: 'Language'
}

export const DICTS: Record<Lang, Dict> = { en, zh }

const STORAGE_KEY = 'personae.lang'

/**
 * 语言选择。
 *
 * 只认用户显式选过的值，不做系统语言探测 —— 这是个面向英文开发者社区的
 * 开源项目，英文是它的默认语言。按系统语言自动切会让中文环境的开发者
 * 拿到和 README、issue、文档都不一致的界面，也让项目截图随机器而变。
 * 想要中文点一下右上角就行，选择会被记住。
 */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'zh') return saved
  } catch {
    // localStorage 在某些沙箱 / 隐私模式下会抛异常，不能让它挡住启动
  }
  return 'en'
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // 同上：存不进去只是下次不记得，不该影响本次切换
  }
}
