import type { McpSetupInfo, IdentityState } from '../../preload/types'
import type { Lang } from './i18n'

/**
 * 生成一段可直接粘给 Codex / Claude Code 的接入 prompt。
 *
 * 为什么要有这个东西：
 * 用户装好这个 app 之后，手上通常已经有 codex 或 claude code。但这两个 agent
 * 不会自己知道「本机多了一个可操控的浏览器」。让用户去写 MCP 配置、再解释
 * 13 个工具分别干什么，门槛太高。所以这里把三件事打包成一段自然语言：
 *   1. 怎么把自己连上来（含配置文件路径与完整 TOML / 命令）
 *   2. 连上之后有哪些能力
 *   3. 哪些坑不要踩（这几条都是本项目实际踩过的）
 *
 * 关键设计：prompt 是写给 agent 读的，不是给人读的说明书。所以用
 * 「你现在可以…」「注意…」这种直接指令口吻，并且明确要求它自己去改配置、
 * 自己重启、自己验证 —— 而不是反过来让用户操作。
 *
 * 跟随界面语言：用户会把这段整体复制出去，界面是英文时给一段中文 prompt
 * 会很突兀；而且 agent 用什么语言回复通常跟着 prompt 走。
 */
export function buildAgentPrompt(
  mcp: McpSetupInfo,
  identities: IdentityState[],
  lang: Lang = 'en'
): string {
  return lang === 'zh' ? zhPrompt(mcp, identities) : enPrompt(mcp, identities)
}

function enPrompt(mcp: McpSetupInfo, identities: IdentityState[]): string {
  const names = identities.map((i) => i.name)
  // 身份清单要给具体名字：agent 拿到后能直接把名字填进 identity 参数，
  // 不用先猜一轮。没有身份时给出明确的前置动作。
  const idLine = names.length
    ? `There ${names.length === 1 ? 'is' : 'are'} currently ${names.length} identit${
        names.length === 1 ? 'y' : 'ies'
      }: ${names.map((n) => `"${n}"`).join(', ')}.`
    : `There are no identities yet. I need to click "Add identity" in the Personae window before you can drive anything.`

  return `I'm running a desktop app called Personae on this machine. It's a multi-identity browser: each "identity" is a fully isolated Chromium partition (its own cookies, localStorage and login state) living in its own window. The app exposes an MCP server so you can drive those windows directly.

Please connect yourself to it now.

## 1. How to connect

The MCP server is started with:

  command: ${mcp.nodeRuntime}
  args:    ["${mcp.scriptPath}"]

Note that command is **not** the system node — it's the runtime shipped inside Personae. This machine may have neither Node nor agent-browser installed; that's fine, both are bundled with the app. Do not rewrite it to \`node\` or \`npx\`.

If you are Codex, write this into ${mcp.codexConfigPath} (replace the whole section if a server with the same name already exists):

${mcp.codexToml}

If you are Claude Code, just run:

${mcp.claudeCommand}

After writing the config, restart your own session so the MCP server is picked up, then call \`list_identities\` as a self-check and confirm you can see the identity list. If it reports a connection error, Personae usually isn't running — ask me to start it.

## 2. What you can do once connected

${idLine}

There are 13 tools, all addressed by identity: pass the identity name in the \`identity\` parameter (an id or partition string works too).

Reading:
- \`list_identities\` — list every identity, whether its window is open, its current URL and CDP targetId. **Call this before anything else** — it's the only way to map an identity to a window.
- \`open_identity\` — open or focus an identity's window. Other tools fail outright while the window is closed, so open it first.
- \`snapshot\` — accessibility-tree snapshot of the interactive elements in that identity's window. This is your eyes.
- \`get_text\` — read an element's text, by @eN ref or CSS selector.
- \`get_url\` — read the current URL.
- \`screenshot\` — capture to an absolute path.

Acting:
- \`navigate\` — navigate inside that identity's window. Navigation is confined to the window; it will never spawn a new window or hand off to the system browser.
- \`click\` — click an element. **Prefer passing the readable name** (e.g. "Sign in"); the tool re-snapshots internally to locate it. An @eN ref also works.
- \`fill\` — clear and type text, also locatable by name or label.
- \`press\` — send keys such as Enter, Tab, Control+a.

Advanced:
- \`act\` — run several agent-browser commands against one identity in a single call, with refs staying valid across them. Good for "snapshot → click this → fill that → Enter" sequences.
- \`eval_js\` — run JS inside that identity's window and get the result back. Handy for verifying isolation.
- \`load_skill\` — fetch the command syntax of the bundled agent-browser build. **Call it before hand-writing any command for \`act\`** (see below).

## 3. Pitfalls you need to know

1. **Refs don't survive across calls.** The \`@eN\` numbers a snapshot returns are only valid within that one call. \`click\` and \`fill\` each re-snapshot internally, so you only need to remember what the element is *called* and let the tool find it. If you truly need ref-exact sequential steps, put them in a single \`act\` call.

2. **Run \`load_skill\` before hand-writing agent-browser commands.** Its syntax changes between versions — the \`tab --url\` and \`--pin-tab\` you'll find in online docs don't exist in the build on this machine, so writing from memory will fail.

3. **Use the dedicated tools; don't hunt for windows yourself.** Several identities may sit on the exact same site with identical title and URL, so telling them apart that way will cross wires. \`snapshot\` / \`click\` / \`navigate\` already handle the identity → window mapping.

4. **Isolation is real.** Signing in as identity A does not sign in identity B. That's precisely the point of this app when you need several accounts in parallel — but equally, never expect one identity to see another's session.

5. **The port changes on every launch.** Don't hardcode a CDP port and don't copy \`connect 9222\`-style commands from documentation. The MCP server reads the current port from a discovery file.

Once you're connected, run \`list_identities\` and show me the result so we know the link works.`
}

function zhPrompt(mcp: McpSetupInfo, identities: IdentityState[]): string {
  const names = identities.map((i) => i.name)
  const idLine = names.length
    ? `当前已存在 ${names.length} 个身份：${names.map((n) => `「${n}」`).join('、')}。`
    : `当前还没有任何身份。用户需要先在 Personae 界面里点「添加身份」，你才能操作。`

  return `我本机运行着一个叫 Personae 的桌面应用。它是一个多身份浏览器：每个「身份」是一个完全隔离的 Chromium partition（独立 cookie / localStorage / 登录态），跑在各自的窗口里。这个应用暴露了一个 MCP server，让你可以直接驱动这些窗口。

请你现在帮我把自己接上去。

## 一、接入方式

MCP server 的启动命令是：

  command: ${mcp.nodeRuntime}
  args:    ["${mcp.scriptPath}"]

注意 command 不是系统的 node —— 它是 Personae 自带的运行时。这台机器上可能根本没装 Node，也没装 agent-browser，但都不影响，两者都随应用捆绑。请不要把它改成 \`node\` 或 \`npx\`。

如果你是 Codex，请把下面这段写进 ${mcp.codexConfigPath}（已有同名 server 段就整段替换）：

${mcp.codexToml}

如果你是 Claude Code，直接执行：

${mcp.claudeCommand}

写完之后请重启你自己的会话让 MCP 生效，然后调用 \`list_identities\` 自检，确认能看到身份列表。如果报错说连不上，通常是 Personae 没在运行 —— 让我先把它打开。

## 二、连上之后你能做什么

${idLine}

工具一共 13 个，全部按「身份」寻址：每个工具的 \`identity\` 参数填身份名称即可（也接受 id 或 partition 字符串）。

浏览与读取：
- \`list_identities\` — 列出所有身份、是否已打开、当前 URL、CDP targetId。**任何操作前先调用它**，这是把身份对应到窗口的唯一途径。
- \`open_identity\` — 打开或聚焦某个身份的窗口。窗口没打开时其他工具会直接报错，所以先开。
- \`snapshot\` — 读该身份窗口的可交互元素快照（accessibility tree）。这是你的「眼睛」。
- \`get_text\` — 读某个元素的文本，接受 @eN ref 或 CSS 选择器。
- \`get_url\` — 读当前 URL。
- \`screenshot\` — 截图到指定绝对路径。

操作：
- \`navigate\` — 在该身份窗口内跳转。跳转被限制在窗口内，不会新开窗口或外跳系统浏览器。
- \`click\` — 点击元素。**推荐直接给元素的可读名称**（比如「登录」），工具内部会自己重新 snapshot 定位；也可以给 @eN ref。
- \`fill\` — 清空并填入文本，同样支持按名称或 label 定位。
- \`press\` — 发按键，如 Enter、Tab、Control+a。

进阶：
- \`act\` — 在一次调用里对同一身份连续跑多条 agent-browser 命令，ref 在这些命令之间保持有效。适合「snapshot → 点这个 → 填那个 → 回车」这种连续流程。
- \`eval_js\` — 在该身份窗口里执行 JS 并取回结果。验证隔离性很好用。
- \`load_skill\` — 取本机捆绑版本的 agent-browser 官方命令语法。**在用 \`act\` 手写命令前必须先调用它**（见下）。

## 三、几个必须知道的坑

1. **ref 不能跨调用复用。** snapshot 返回的 \`@eN\` 编号只在单次调用内有效。\`click\` / \`fill\` 内部都会各自重新 snapshot，所以你只需要记住「元素叫什么」，让工具自己按名称找。要严格按 ref 连续操作，就把它们放进同一个 \`act\` 调用。

2. **手写 agent-browser 命令前先 \`load_skill\`。** 它的命令语法在版本之间会变，网上文档里的 \`tab --url\` 和 \`--pin-tab\` 在本机这个版本里根本不存在，凭记忆写必然失败。

3. **优先用专用工具，不要自己找窗口。** 多个身份可能停在完全相同的网站上，title 和 URL 一模一样，靠它们区分身份会串。\`snapshot\` / \`click\` / \`navigate\` 这些工具已经处理好「身份 → 窗口」的映射，走它们就不会错。

4. **身份之间是真隔离。** 在身份 A 登录不会让身份 B 也登录。需要多账号并行的场景（比如同时操作两个账号做对比），这正是这个应用存在的理由；但反过来，不要指望在一个身份里拿到另一个身份的登录态。

5. **端口每次启动都变。** 不要硬编码任何 CDP 端口，也不要照抄文档里 \`connect 9222\` 那类命令。MCP server 会自己去发现文件里读当前端口。

接好之后请先跑一次 \`list_identities\` 把结果给我看，确认链路通了。`
}
