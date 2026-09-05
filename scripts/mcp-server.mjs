#!/usr/bin/env node
/**
 * 多身份浏览器 · MCP server（stdio）
 *
 * 给 codex / claude code 用。做两件 agent-browser 自己做不到的事：
 *   1. 提供「身份(partition) → CDP targetId」映射 —— agent-browser 不认识 partition
 *   2. 封装「切到正确 tab 再操作」的流程 —— 少一步就会操作到别的身份
 *
 * 其余浏览器操作直接转发给捆绑的 agent-browser，不重复实现。
 *
 * ── 零依赖说明 ──────────────────────────────────────────────────────
 * 用户机器上不需要装 Node，也不需要装 agent-browser：
 *   · 运行时：用 app 自带的 Electron 二进制 + ELECTRON_RUN_AS_NODE=1
 *   · agent-browser：路径从 app 写出的 agent-bridge.json 里读，指向 resources/bin/
 *
 * 推荐用应用界面的「一键配置」写入 codex，等价的手工配置为：
 *   [mcp_servers.personae]
 *   command = "/Applications/Personae.app/Contents/MacOS/Personae"
 *   args = ["/Applications/Personae.app/Contents/Resources/mcp-server.mjs"]
 *   [mcp_servers.personae.env]
 *   ELECTRON_RUN_AS_NODE = "1"
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PROTOCOL_VERSION = '2025-06-18'

// ── 发现运行中的 app ────────────────────────────────────────────────
// app 每次启动端口都是随机的，通过固定路径的发现文件定位。
//
// 目录名取自 package.json 的 name（开发期）或 electron-builder 的
// productName（打包后）—— 两者现在都是 Personae，但小写形式也留着：
// macOS 文件系统不区分大小写，Linux 区分，历史目录可能是小写的。
// 更早的项目名同样保留，方便改名后仍能连上还在跑的旧版本。
// 逐个探测，取第一个存在且进程存活的。
const APP_NAME_CANDIDATES = [
  'Personae',
  'personae',
  'MultiIdentityBrowser',
  'multi-identity-browser',
  'el-test'
]

function userDataBase() {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32'
      ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
}

// 环境变量覆盖。PERSONAE_* 是当前前缀，MIB_* 是改名前的旧前缀，
// 保留是为了不破坏已经写好的配置。
function envOverride(name) {
  return process.env[`PERSONAE_${name}`] || process.env[`MIB_${name}`]
}

function bridgeFile() {
  const explicit = envOverride('BRIDGE_FILE')
  if (explicit) return explicit

  const base = userDataBase()
  const custom = envOverride('APP_NAME')
  const names = custom ? [custom, ...APP_NAME_CANDIDATES] : APP_NAME_CANDIDATES

  const found = []
  for (const n of names) {
    const f = join(base, n, 'agent-bridge.json')
    if (existsSync(f)) found.push(f)
  }

  // 优先选进程仍存活的那个。
  //
  // 为什么需要这一步：改过 productName / package.json name 之后，旧目录名下的
  // 发现文件不会被自动清掉。若只按固定顺序取第一个存在的，就可能连到一个
  // 已退出的 app（bridge 端口早已释放），表现为工具全部超时或返回空。
  // 发现文件里记了 pid，用 kill(pid, 0) 做零成本存活探测。
  for (const f of found) {
    try {
      const { pid } = JSON.parse(readFileSync(f, 'utf8'))
      if (typeof pid === 'number') {
        process.kill(pid, 0) // 不发信号，只探测进程是否存在
        return f
      }
    } catch {
      /* 进程已退出或文件损坏，试下一个 */
    }
  }

  // 都不存活时返回第一个存在的（让 readBridge 报出带上下文的错误），
  // 一个都没有则返回首选路径
  return found[0] ?? join(base, names[0], 'agent-bridge.json')
}

function readBridge() {
  const f = bridgeFile()
  if (!existsSync(f)) {
    throw new Error(
      [
        `未找到运行中的应用（缺少发现文件）。`,
        `已查找：`,
        ...APP_NAME_CANDIDATES.map((n) => `  ${join(userDataBase(), n, 'agent-bridge.json')}`),
        ``,
        `请先启动应用，并至少打开一个身份窗口。`,
        `若你的 userData 目录名不在上面，用 PERSONAE_BRIDGE_FILE 指定完整路径。`
      ].join('\n')
    )
  }
  let info
  try {
    info = JSON.parse(readFileSync(f, 'utf8'))
  } catch (err) {
    throw new Error(`发现文件损坏（${f}）：${err.message}`)
  }
  if (!info.bridgeUrl) {
    throw new Error(`发现文件缺少 bridgeUrl，请重启应用。`)
  }
  if (!info.agentBrowserPath || !existsSync(info.agentBrowserPath)) {
    throw new Error(
      `捆绑的 agent-browser 不存在（${info.agentBrowserPath}）。` +
        `开发环境请先执行 pnpm bundle:ab；已打包版本请重新安装。`
    )
  }
  return info
}

async function bridgeGet(path) {
  const { bridgeUrl } = readBridge()
  let res
  try {
    res = await fetch(`${bridgeUrl}${path}`)
  } catch (err) {
    throw new Error(`无法连接应用（${bridgeUrl}）：${err.message}。应用可能已关闭，请重新启动。`)
  }
  if (!res.ok) throw new Error(`bridge ${path} 返回 ${res.status}`)
  return res.json()
}

// ── agent-browser 调用 ──────────────────────────────────────────────
async function ab(sessionName, args, { withCdp = false } = {}) {
  const { agentBrowserPath, cdpPort, skillsDir } = readBridge()
  const full = ['--session', sessionName]
  if (withCdp) {
    if (!cdpPort) throw new Error('CDP 端口尚未就绪，请确认应用已完全启动')
    full.push('--cdp', String(cdpPort))
  }
  // 显式关掉 pin-tab 的粘性。
  //
  // 必要性（实测）：--pin-tab 会触发 `Target.createTarget`，Electron 不支持该
  // CDP 方法，报 "CDP error (Target.createTarget): Not supported"。
  // 而 pin 状态是**粘性的**，一旦某个 session 用过 --pin-tab 就会持久写入
  // session 状态，`close --all` 也清不掉，之后所有命令都失败。
  // 所以每次都显式传 --no-pin-tab，保证不受历史状态影响。
  full.push('--no-pin-tab')
  full.push(...args)

  // 显式指定 skills 目录：agent-browser 默认从二进制位置向上查找 skills/，
  // 可能撞到无关项目的同名目录（实测踩过）
  const env = { ...process.env }
  if (skillsDir) env.AGENT_BROWSER_SKILLS_DIR = skillsDir

  try {
    const { stdout, stderr } = await execFileAsync(agentBrowserPath, full, {
      maxBuffer: 12 * 1024 * 1024,
      timeout: 60_000,
      env
    })
    return (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '')
  } catch (err) {
    const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n')
    throw new Error(`agent-browser ${full.join(' ')} 失败:\n${detail}`)
  }
}

/**
 * 读取捆绑的官方 skill 内容。
 *
 * 不带 --session / --cdp，因为 skills 是纯本地内容输出，不需要连浏览器。
 */
async function abSkills(args) {
  const { agentBrowserPath, skillsDir } = readBridge()
  const env = { ...process.env }
  if (skillsDir) env.AGENT_BROWSER_SKILLS_DIR = skillsDir

  try {
    const { stdout } = await execFileAsync(agentBrowserPath, ['skills', ...args], {
      maxBuffer: 12 * 1024 * 1024,
      timeout: 30_000,
      env
    })
    return stdout || ''
  } catch (err) {
    const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n')
    throw new Error(`agent-browser skills ${args.join(' ')} 失败:\n${detail}`)
  }
}

/**
 * 在「同一个 agent-browser 进程」里按顺序执行多条命令。
 *
 * 为什么必需：ref（@eN）只在单个 agent-browser 进程内有效 —— 每次 execFile 都是
 * 新进程，上一次 snapshot 建立的 ref 表随进程退出而消失，之后 click @e5 会报
 * "Unknown ref"。batch 把 snapshot 和后续动作放进同一进程，ref 才可用。
 */
async function abBatch(sessionName, commands, { withCdp = true } = {}) {
  return ab(sessionName, ['batch', ...commands], { withCdp })
}

async function resolveIdentity(identity) {
  const { identities } = await bridgeGet('/identities')
  const hit = identities.find(
    (i) => i.id === identity || i.name === identity || i.partition === identity
  )
  if (!hit) {
    const names = identities.map((i) => `${i.name}(${i.id})`).join(', ') || '（无）'
    throw new Error(`找不到身份「${identity}」。当前身份: ${names}`)
  }
  if (!hit.isOpen || !hit.targetId) {
    throw new Error(`身份「${hit.name}」窗口未打开，请先在应用里打开它（或调用 open_identity）。`)
  }
  return hit
}

/**
 * 把身份解析成 agent-browser 可用的 tab ref。
 *
 * agent-browser 0.36+ 的 `tab list --json` 输出 `targetId`，并且 **targetId 本身
 * 就能直接当 tab ref 使用**（`tab <targetId>`），一步命中，无需遍历。
 *
 * 而主进程侧的 targetId 由 `Target.getTargetInfo` 取得，是权威值，
 * 经 bridge 暴露给这里。两边对上，身份定位就是一次字符串传递。
 *
 * 为什么不靠 title/url：多个身份常打开同一站点，两者完全相同。
 * 为什么不靠 index：CDP target 顺序与 tab index 顺序不一致，不能推算。
 */
function tabRefOf(hit) {
  if (!hit.targetId) {
    throw new Error(
      `身份「${hit.name}」还没有 targetId。\n` +
        `请先在应用里打开该身份的窗口（或用 open_identity 工具），再重试。`
    )
  }
  return hit.targetId
}

/** 转义 batch 命令里的双引号参数 */
function q(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 对指定身份执行一组动作。
 *
 * 统一在一个 batch 里做：切到该身份的 tab → (可选) snapshot 建立 ref → 执行动作。
 *
 * 为什么必须同一个 batch：ref（@eN）只在单个 agent-browser 进程内有效。
 * 每次 execFile 都是新进程，上一次 snapshot 建立的 ref 表随进程退出消失，
 * 之后 `click @e5` 会报 "Unknown ref"。所以 needsRef 的动作必须自带 snapshot。
 *
 * 不使用 --pin-tab：它会触发 `Target.createTarget`，而 Electron 不支持该 CDP
 * 方法（实测报 "CDP error (Target.createTarget): Not supported"）。
 * 本项目靠权威 targetId 定位，本来也不依赖 pin 的粘性。
 */
async function runOnIdentity(hit, actions, { needsRef = false } = {}) {
  const ref = tabRefOf(hit)
  const cmds = [`tab ${ref}`]
  if (needsRef) cmds.push('snapshot -i --compact')
  cmds.push(...actions)
  const out = await abBatch(hit.sessionName, cmds)
  return { out, ref }
}

/** 从 batch 输出里剥掉前置的 snapshot 段，只留动作结果 */
function tailAfterSnapshot(out) {
  const lines = out.split('\n')
  // snapshot 输出都是 "- xxx" / "  - xxx" 形式，找最后一个这样的行之后的内容
  let last = -1
  lines.forEach((l, i) => {
    if (/^\s*-\s/.test(l)) last = i
  })
  return lines
    .slice(last + 1)
    .join('\n')
    .trim()
}

// ── 工具定义 ────────────────────────────────────────────────────────
const tools = [
  {
    name: 'load_skill',
    description:
      'Load agent-browser 官方命令语法说明，内容随本机捆绑的二进制版本，保证 flag 真实存在。' +
      '**在用 act 工具手写 agent-browser 命令前必须先调用本工具** —— ' +
      '它的语法在版本间会变（本机版本就没有网上文档里的 `tab --url` 和 `--pin-tab`），凭记忆猜必然失败。' +
      '注意：本 app 的多身份窗口应优先用 snapshot/click/fill/navigate 等专用工具操作，' +
      '它们已处理好「身份→窗口」定位；只有需要专用工具没覆盖的能力时才手写命令。',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description:
            '可选：只关心某方面时填关键词过滤，如 snapshot / click / tab / eval / screenshot / batch。留空返回全部语法。'
        }
      },
      additionalProperties: false
    },
    handler: async ({ section }) => {
      // 必须带 --full：不带的话 SKILL.md 主体刻意不含任何命令语法，
      // 真正的 commands.md / snapshot-refs.md 等在 references/ 里（实测差别是 0 行 vs 106 行）
      const full = await abSkills(['get', 'core', '--full'])
      let version = ''
      try {
        // --version 输出形如 "agent-browser 0.25.4"，只取版本号部分
        version = (await abSkills(['--version'])).trim().split(/\s+/).pop() ?? ''
      } catch {
        // 版本号取不到不影响语法内容
      }

      const header =
        `[agent-browser${version ? ' v' + version : ''} 官方语法 · 与本机捆绑二进制一致]\n` +
        `注意：本 app 的 CDP 端口是动态分配的，且多个身份窗口 title/url 可能完全相同，\n` +
        `所以不要照抄文档里的 "connect 9222" / "open -a ... --remote-debugging-port" 等启动步骤，\n` +
        `身份定位请交给本 MCP 的专用工具（snapshot / click / fill / navigate / act）。\n\n`

      const blocks = full.split(/\n(?=#{2,3} )/)

      if (!section) {
        // 全量约 5 万字符，对上下文太重。默认只给目录 + 提示，让 agent 按需取。
        const toc = blocks
          .map((b) => b.split('\n')[0].trim())
          .filter((t) => t.startsWith('#'))
          .map((t) => '  ' + t.replace(/^#+\s*/, ''))
          .join('\n')
        return (
          header +
          `完整语法约 ${Math.round(full.length / 1000)}k 字符，已按段落索引。\n` +
          `用 load_skill({section:"关键词"}) 取具体段落，例如 section:"snapshot" / "click" / "batch"。\n\n` +
          `可用段落：\n${toc}\n\n` +
          `确实需要全文时用 section:"*"。`
        )
      }

      if (section === '*') return header + full

      const kw = section.toLowerCase()
      const hits = blocks.filter((b) => b.toLowerCase().includes(kw))
      if (!hits.length) {
        return (
          `未找到与「${section}」相关的段落。可用段落标题：\n` +
          blocks
            .map((b) => b.split('\n')[0].trim())
            .filter((t) => t.startsWith('#'))
            .map((t) => '  ' + t.replace(/^#+\s*/, ''))
            .join('\n')
        )
      }
      return header + hits.join('\n')
    }
  },
  {
    name: 'list_identities',
    description:
      '列出所有浏览器身份（partition）及其 CDP targetId、是否已打开、当前页面。任何操作前先调用此工具确认身份状态 —— 这是把 partition 对应到 CDP target 的唯一途径。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { identities } = await bridgeGet('/identities')
      if (!identities.length) return '当前没有任何身份，请在应用界面添加。'
      return identities
        .map(
          (i) =>
            `${i.isOpen ? '●' : '○'} ${i.name}\n` +
            `  id:        ${i.id}\n` +
            `  partition: ${i.partition}\n` +
            `  targetId:  ${i.targetId ?? '—（未打开）'}\n` +
            `  url:       ${i.url ?? '—'}`
        )
        .join('\n\n')
    }
  },
  {
    name: 'open_identity',
    description:
      '打开（或聚焦）指定身份的浏览器窗口。窗口打开后才会生成 targetId，agent 才能操作它。',
    inputSchema: {
      type: 'object',
      properties: { identity: { type: 'string', description: '身份 id 或名称' } },
      required: ['identity'],
      additionalProperties: false
    },
    handler: async ({ identity }) => {
      const { identities } = await bridgeGet('/identities')
      const hit = identities.find((i) => i.id === identity || i.name === identity)
      if (!hit) throw new Error(`找不到身份「${identity}」`)
      const r = await bridgeGet(`/open?id=${encodeURIComponent(hit.id)}`)
      const s = r.identity
      return `已打开「${s.name}」\n  partition: ${s.partition}\n  targetId:  ${s.targetId}\n  url:       ${s.currentUrl}`
    }
  },
  {
    name: 'snapshot',
    description:
      '读取指定身份窗口的可交互元素快照（accessibility tree + @eN refs）。会自动定位到该身份的窗口，不会读到别的身份。注意：ref 只在单次调用内有效，click/fill 等工具会各自重新 snapshot，因此你只需把「元素的可读名称」记住，让后续工具自己按名称定位；若要按 ref 操作，请用 act 工具在一次调用内完成。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string', description: '身份 id 或名称' },
        compact: { type: 'boolean', description: '精简输出，默认 true' }
      },
      required: ['identity'],
      additionalProperties: false
    },
    handler: async ({ identity, compact = true }) => {
      const hit = await resolveIdentity(identity)
      const cmd = compact ? 'snapshot -i --compact' : 'snapshot -i'
      const { out } = await runOnIdentity(hit, [cmd])
      return `[身份 ${hit.name}]\n\n${out}`
    }
  },
  {
    name: 'navigate',
    description:
      '在指定身份的窗口内导航到 URL。跳转被限制在该窗口内，不会新开窗口或外跳系统浏览器。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        url: { type: 'string' }
      },
      required: ['identity', 'url'],
      additionalProperties: false
    },
    handler: async ({ identity, url }) => {
      const hit = await resolveIdentity(identity)
      const { out } = await runOnIdentity(hit, [`open ${q(url)}`])
      return `[身份 ${hit.name}] 已导航到 ${url}\n${out.trim()}`
    }
  },
  {
    name: 'click',
    description:
      '点击指定身份窗口中的元素。按元素可读名称定位（推荐），或直接给 @eN ref —— 本工具内部会先重新 snapshot 再点击，所以 ref 用的是最新一次快照的编号。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        ref: { type: 'string', description: '@eN 形式的元素 ref' },
        text: { type: 'string', description: '元素可读文本，如「百度一下」；与 ref 二选一' }
      },
      required: ['identity'],
      additionalProperties: false
    },
    handler: async ({ identity, ref, text }) => {
      if (!ref && !text) throw new Error('需要提供 ref 或 text 之一')
      const hit = await resolveIdentity(identity)
      const action = ref ? `click ${ref}` : `find text ${q(text)} click`
      const { out } = await runOnIdentity(hit, [action], { needsRef: !!ref })
      return `[身份 ${hit.name}] 已点击 ${ref ?? text}\n${tailAfterSnapshot(out) || out.trim()}`
    }
  },
  {
    name: 'fill',
    description:
      '清空并填入文本。按元素可读名称/label 定位（推荐），或给 @eN ref（内部会先重新 snapshot）。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        ref: { type: 'string', description: '@eN 形式的元素 ref' },
        label: { type: 'string', description: '输入框的 label 或占位文本；与 ref 二选一' },
        text: { type: 'string', description: '要填入的内容' }
      },
      required: ['identity', 'text'],
      additionalProperties: false
    },
    handler: async ({ identity, ref, label, text }) => {
      if (!ref && !label) throw new Error('需要提供 ref 或 label 之一')
      const hit = await resolveIdentity(identity)
      const action = ref ? `fill ${ref} ${q(text)}` : `find label ${q(label)} fill ${q(text)}`
      const { out } = await runOnIdentity(hit, [action], { needsRef: !!ref })
      return `[身份 ${hit.name}] 已填入「${text}」\n${tailAfterSnapshot(out) || out.trim()}`
    }
  },
  {
    name: 'press',
    description: '发送按键，如 Enter、Tab、Control+a。作用于该身份窗口当前焦点。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        key: { type: 'string' }
      },
      required: ['identity', 'key'],
      additionalProperties: false
    },
    handler: async ({ identity, key }) => {
      const hit = await resolveIdentity(identity)
      const { out } = await runOnIdentity(hit, [`press ${key}`])
      return `[身份 ${hit.name}] 已按下 ${key}\n${out.trim()}`
    }
  },
  {
    name: 'act',
    description:
      '在一次调用内对同一身份连续执行多个 agent_browser 命令，ref 在这些命令之间有效。适合「snapshot → 点这个 → 填那个 → 回车」这种多步流程。命令用 agent_browser 语法，如 ["snapshot -i", "fill @e35 关键词", "press Enter"]。会自动前置 tab 切换。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'agent_browser 命令字符串数组，按顺序在同一进程内执行'
        }
      },
      required: ['identity', 'commands'],
      additionalProperties: false
    },
    handler: async ({ identity, commands }) => {
      const hit = await resolveIdentity(identity)
      const { out } = await runOnIdentity(hit, commands)
      return `[身份 ${hit.name}]\n${out}`
    }
  },
  {
    name: 'get_text',
    description: '读取元素文本。可传 @eN ref（内部会先重新 snapshot）或 CSS 选择器。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        ref: { type: 'string', description: '@eN ref 或 CSS 选择器' }
      },
      required: ['identity', 'ref'],
      additionalProperties: false
    },
    handler: async ({ identity, ref }) => {
      const hit = await resolveIdentity(identity)
      const needsRef = ref.startsWith('@')
      const { out } = await runOnIdentity(hit, [`get text ${q(ref)}`], { needsRef })
      return tailAfterSnapshot(out) || out.trim()
    }
  },
  {
    name: 'get_url',
    description: '读取该身份窗口当前的 URL。',
    inputSchema: {
      type: 'object',
      properties: { identity: { type: 'string' } },
      required: ['identity'],
      additionalProperties: false
    },
    handler: async ({ identity }) => {
      const hit = await resolveIdentity(identity)
      const { out } = await runOnIdentity(hit, ['get url'])
      return `[身份 ${hit.name}] ${out.trim()}`
    }
  },
  {
    name: 'screenshot',
    description: '截图指定身份的窗口，保存到给定绝对路径。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        path: { type: 'string', description: '输出文件绝对路径，.png' }
      },
      required: ['identity', 'path'],
      additionalProperties: false
    },
    handler: async ({ identity, path }) => {
      const hit = await resolveIdentity(identity)
      const { out } = await runOnIdentity(hit, [`screenshot ${q(path)}`])
      return `[身份 ${hit.name}] 截图已保存: ${path}\n${out.trim()}`
    }
  },
  {
    name: 'eval_js',
    description: '在指定身份窗口内执行 JavaScript 并返回结果。用于读取页面状态、验证隔离等。',
    inputSchema: {
      type: 'object',
      properties: {
        identity: { type: 'string' },
        expression: { type: 'string' }
      },
      required: ['identity', 'expression'],
      additionalProperties: false
    },
    handler: async ({ identity, expression }) => {
      const hit = await resolveIdentity(identity)
      const { out } = await runOnIdentity(hit, [`eval ${q(expression)}`])
      return `[身份 ${hit.name}] ${out.trim()}`
    }
  }
]

// ── JSON-RPC over stdio ─────────────────────────────────────────────
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(req) {
  const { id, method, params } = req

  if (method === 'initialize') {
    ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'personae', version: '0.1.0' }
    })
    return
  }

  if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return

  if (method === 'tools/list') {
    ok(id, {
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema
      }))
    })
    return
  }

  if (method === 'tools/call') {
    const tool = tools.find((t) => t.name === params?.name)
    if (!tool) {
      fail(id, -32602, `未知工具: ${params?.name}`)
      return
    }
    try {
      const text = await tool.handler(params.arguments ?? {})
      ok(id, { content: [{ type: 'text', text: String(text) }] })
    } catch (err) {
      // 业务错误用 isError 返回，让模型能看到并自行纠正
      ok(id, {
        content: [{ type: 'text', text: `错误: ${err.message}` }],
        isError: true
      })
    }
    return
  }

  if (id !== undefined) fail(id, -32601, `不支持的方法: ${method}`)
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let req
    try {
      req = JSON.parse(line)
    } catch {
      continue
    }
    handle(req).catch((err) => {
      if (req?.id !== undefined) fail(req.id, -32603, err.message)
    })
  }
})

process.stdin.on('end', () => process.exit(0))
