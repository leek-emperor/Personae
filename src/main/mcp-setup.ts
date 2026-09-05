import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir, copyFile } from 'fs/promises'
import { homedir } from 'os'
import { agentBrowserPath } from './agent-bridge'

/**
 * 零依赖的 agent 接入配置。
 *
 * 核心问题：用户装了 codex，但机器上可能**没有 Node**，也没有 agent-browser。
 *
 * 两个依赖各自的解法：
 *   1. agent-browser  → 已捆绑在 resources/bin/，路径由 agentBrowserPath() 给出
 *   2. MCP 脚本的运行时 → 用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE=1），
 *      即 process.execPath 本身就是一个完整的 Node 22 运行时，用户无需另装
 *
 * 于是 codex 的配置写成：
 *   command = "<app 的 Electron 可执行文件>"
 *   args    = ["<mcp-server.mjs 绝对路径>"]
 *   env     = { ELECTRON_RUN_AS_NODE = "1" }
 */

export type McpSetupInfo = {
  /** 用作 command 的可执行文件（打包后即 app 自身的二进制） */
  nodeRuntime: string
  /** MCP 脚本绝对路径 */
  scriptPath: string
  /** 捆绑的 agent-browser 路径 */
  agentBrowser: string
  /** codex 配置文件路径 */
  codexConfigPath: string
  /** 要写入的 TOML 片段 */
  codexToml: string
  /** claude code 的等价命令 */
  claudeCommand: string
  /** 脚本是否就位 */
  scriptExists: boolean
}

const SERVER_KEY = 'multi_identity_browser'

/**
 * MCP 脚本的落盘位置。
 *
 * 打包后 scripts/ 不在 asar 里（electron-builder 的 files 规则排除了源码），
 * 因此把脚本作为 extraResource 放到 resources/ 下；开发期回落到项目目录。
 */
export function mcpScriptPath(): string {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'mcp-server.mjs'),
        join(process.resourcesPath, 'scripts', 'mcp-server.mjs')
      ]
    : [join(app.getAppPath(), 'scripts', 'mcp-server.mjs')]

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]
}

/**
 * 用作 MCP command 的运行时。
 *
 * 打包后 process.execPath 是 app 自己的二进制，配合 ELECTRON_RUN_AS_NODE=1
 * 就是一个可用的 Node，不依赖用户环境。
 */
export function nodeRuntimePath(): string {
  return process.execPath
}

export function codexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  return join(codexHome, 'config.toml')
}

function tomlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildCodexToml(): string {
  const runtime = tomlEscape(nodeRuntimePath())
  const script = tomlEscape(mcpScriptPath())
  return [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = "${runtime}"`,
    `args = ["${script}"]`,
    `startup_timeout_sec = 20`,
    `tool_timeout_sec = 120`,
    ``,
    `[mcp_servers.${SERVER_KEY}.env]`,
    // 让 app 的二进制以纯 Node 模式运行脚本，而不是启动 GUI
    `ELECTRON_RUN_AS_NODE = "1"`
  ].join('\n')
}

export function getMcpSetupInfo(): McpSetupInfo {
  const script = mcpScriptPath()
  const runtime = nodeRuntimePath()
  return {
    nodeRuntime: runtime,
    scriptPath: script,
    agentBrowser: agentBrowserPath(),
    codexConfigPath: codexConfigPath(),
    codexToml: buildCodexToml(),
    claudeCommand: `claude mcp add ${SERVER_KEY} --env ELECTRON_RUN_AS_NODE=1 -- "${runtime}" "${script}"`,
    scriptExists: existsSync(script)
  }
}

/**
 * 把配置写入 codex 的 config.toml。
 *
 * 幂等：若已存在同名 server 段，整段替换而不是重复追加。
 * 写入前备份原文件，避免破坏用户既有配置。
 */
export async function installCodexConfig(): Promise<{
  ok: boolean
  path: string
  action: 'created' | 'updated' | 'unchanged'
  backup?: string
  error?: string
}> {
  const path = codexConfigPath()
  const block = buildCodexToml()

  try {
    await mkdir(join(path, '..'), { recursive: true })

    let existing = ''
    let fileExists = false
    try {
      existing = await readFile(path, 'utf8')
      fileExists = true
    } catch {
      // 首次创建
    }

    if (fileExists && existing.includes(block.trim())) {
      return { ok: true, path, action: 'unchanged' }
    }

    let backup: string | undefined
    if (fileExists) {
      backup = `${path}.bak-${Date.now()}`
      await copyFile(path, backup)
    }

    let next: string
    const header = `[mcp_servers.${SERVER_KEY}]`

    if (fileExists && existing.includes(header)) {
      // 整段替换：从本 server 的 header 到下一个顶层 [ 段之前
      const lines = existing.split('\n')
      const start = lines.findIndex((l) => l.trim() === header)
      let end = lines.length
      for (let i = start + 1; i < lines.length; i++) {
        const t = lines[i].trim()
        // 下一个顶层段（排除本 server 自己的子表 [mcp_servers.multi_identity_browser.*]）
        if (t.startsWith('[') && !t.startsWith(`[mcp_servers.${SERVER_KEY}`)) {
          end = i
          break
        }
      }
      next = [...lines.slice(0, start), block, '', ...lines.slice(end)].join('\n')
    } else {
      const sep = fileExists && existing.trim() ? '\n\n' : ''
      next = `${existing.trimEnd()}${sep}${block}\n`
    }

    await writeFile(path, next, 'utf8')
    return { ok: true, path, action: fileExists ? 'updated' : 'created', backup }
  } catch (err) {
    return {
      ok: false,
      path,
      action: 'unchanged',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** 检查 codex 配置里是否已经装了本 server */
export async function isCodexConfigured(): Promise<boolean> {
  try {
    const raw = await readFile(codexConfigPath(), 'utf8')
    return raw.includes(`[mcp_servers.${SERVER_KEY}]`)
  } catch {
    return false
  }
}
