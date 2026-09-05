import { useCallback, useEffect, useState } from 'react'
import type {
  AgentInfo,
  CdpTarget,
  IdentityState,
  InstallResult,
  McpSetupInfo
} from '../../preload/types'
import { buildAgentPrompt } from './agent-prompt'
import { identityColor } from '../../shared/colors'

/**
 * 从 URL 取 host 用于展示。
 * 必须容错：currentUrl 可能是 about:blank、data: 或加载中途的残缺值，
 * 直接 new URL() 抛异常会让整个渲染树崩掉。
 */
function hostOf(url: string): string | null {
  try {
    const h = new URL(url).host
    return h || null
  } catch {
    return null
  }
}

function App(): React.JSX.Element {
  const [identities, setIdentities] = useState<IdentityState[]>([])
  const [info, setInfo] = useState<AgentInfo | null>(null)
  const [mcp, setMcp] = useState<McpSetupInfo | null>(null)
  const [installed, setInstalled] = useState<InstallResult | null>(null)
  const [targets, setTargets] = useState<CdpTarget[] | null>(null)
  const [name, setName] = useState('')
  const [homeUrl, setHomeUrl] = useState('https://www.baidu.com')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [list, i, m] = await Promise.all([
        window.api.identity.list(),
        window.api.agent.info(),
        window.api.mcp.info()
      ])
      setIdentities(list)
      setInfo(i)
      setMcp(m)
    } catch (e) {
      setErr(String(e))
    }
  }, [])

  useEffect(() => {
    // refresh 是 async，所有 setState 都发生在 await 之后（微任务里），
    // 并非同步级联渲染；这里的规则告警是对 async 调用的误判。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    return window.api.identity.onChanged(() => void refresh())
  }, [refresh])

  /** 复制 + 2 秒后自动消失的反馈。key 用来区分是哪个按钮被点了。 */
  const copy = async (key: string, text: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
  }

  const add = async (): Promise<void> => {
    setErr(null)
    try {
      await window.api.identity.add(name, homeUrl)
      setName('')
    } catch (e) {
      setErr(String(e))
    }
  }

  const act = async (id: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(id)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const loadTargets = async (): Promise<void> => {
    const r = await window.api.agent.targets()
    if (r.error) setErr(r.error)
    setTargets(r.targets ?? null)
  }

  const installCodex = async (): Promise<void> => {
    setBusy('mcp')
    setErr(null)
    try {
      const r = await window.api.mcp.installCodex()
      setInstalled(r)
      if (!r.ok) setErr(r.error ?? '写入失败')
      await refresh()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
    }
  }

  const bin = info?.agentBrowserPath ?? 'agent-browser'
  const port = info?.cdpPort ?? null
  const ready = port !== null
  const openCount = identities.filter((i) => i.isOpen).length
  const prompt = mcp ? buildAgentPrompt(mcp, identities) : ''

  return (
    <div className="wrap">
      <header className="masthead">
        {/* logo 的三张阶梯卡片，用 CSS 复刻 */}
        <div className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div>
          <h1>
            Personae <em>· 多身份浏览器</em>
          </h1>
          <p className="sub">
            每个身份是一个独立的 <code>persist:</code> partition，跑在自己的窗口里，
            登录态互不可见；每个窗口都能被 AI agent 通过 MCP 驱动。
          </p>
        </div>
      </header>

      {/* 顶部状态条：一眼确认系统是否就绪，不必展开任何面板 */}
      <div className="statusbar">
        <div className="stat">
          <b>状态</b>
          <span>
            <i className={`pulse ${ready ? '' : 'off'}`} />
            {ready ? '就绪' : '未就绪'}
          </span>
        </div>
        <div className="stat">
          <b>CDP 端口</b>
          <span>{port ?? '—'}</span>
        </div>
        <div className="stat">
          <b>身份</b>
          <span>
            {identities.length} 个 · {openCount} 个已打开
          </span>
        </div>
        <div className="stat">
          <b>Agent 接入</b>
          <span>{mcp?.codexInstalled ? 'Codex 已配置' : '未配置'}</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* ── 身份 ───────────────────────────────────────────── */}
      <section className="card">
        <h2>
          浏览器身份
          <span className="count">{identities.length}</span>
        </h2>

        <div className="row" style={{ marginBottom: identities.length ? 14 : 0 }}>
          <input
            placeholder="身份名称，如 账号A"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <input
            placeholder="主页 URL"
            value={homeUrl}
            onChange={(e) => setHomeUrl(e.target.value)}
            style={{ flex: 1.3 }}
          />
          <button className="primary" onClick={() => void add()}>
            添加身份
          </button>
        </div>

        {identities.length === 0 ? (
          <div className="empty">
            <b>还没有身份</b>
            填个名字添加第一个。每个身份都有独立的登录态，互不影响。
          </div>
        ) : (
          <div className="list">
            {identities.map((it, idx) => {
              const sessionName = `identity_${it.id}`
              // 颜色取自共享色板，和该身份窗口顶栏的色点是同一个值 ——
              // 用户切窗口时靠颜色就能认出自己在哪个身份里。
              const color = identityColor(idx)
              return (
                <div
                  key={it.id}
                  className={`item ${it.isOpen ? 'open' : ''}`}
                  style={{ '--idc': color } as React.CSSProperties}
                >
                  <div className="item-head">
                    <div className="id-name">
                      <span className={`dot ${it.isOpen ? 'on' : ''}`} />
                      <strong>{it.name}</strong>
                      <span className={`badge ${it.isOpen ? 'on' : ''}`}>
                        {it.isOpen ? 'live' : 'idle'}
                      </span>
                    </div>
                    <div className="row">
                      <button
                        className="primary"
                        disabled={busy === it.id}
                        onClick={() => void act(it.id, () => window.api.identity.open(it.id))}
                      >
                        {it.isOpen ? '聚焦' : '打开窗口'}
                      </button>
                      <button
                        className="ghost"
                        disabled={!it.isOpen || busy === it.id}
                        onClick={() => void act(it.id, () => window.api.identity.close(it.id))}
                      >
                        关闭
                      </button>
                      <button
                        className="danger"
                        disabled={busy === it.id}
                        onClick={() => void act(it.id, () => window.api.identity.remove(it.id))}
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <table className="kv small">
                    <tbody>
                      <tr>
                        <th>partition</th>
                        <td>
                          <code>{it.partition}</code>
                        </td>
                      </tr>
                      <tr>
                        <th>targetId</th>
                        <td>
                          {it.targetId ? (
                            <code>{it.targetId}</code>
                          ) : (
                            <span className="dim">—（打开窗口后生成）</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th>当前页</th>
                        <td className="ellip">
                          {it.title ? (
                            <>
                              {it.title}
                              {it.currentUrl && hostOf(it.currentUrl) && (
                                <span className="dim"> · {hostOf(it.currentUrl)}</span>
                              )}
                            </>
                          ) : it.currentUrl ? (
                            <code>{it.currentUrl}</code>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {it.isOpen && it.targetId && (
                    <details>
                      <summary>用 agent-browser 手工操作该身份</summary>
                      <pre className="cmd">
                        {[
                          `# 推荐：直接用配套 MCP（已封装身份定位与 ref 生命周期）`,
                          ``,
                          `# 手工操作：targetId 可直接当 tab ref，一步命中`,
                          `"${bin}" --session ${sessionName} --cdp ${port ?? '<port>'} \\`,
                          `  --no-pin-tab batch "tab ${it.targetId}" "snapshot -i"`,
                          ``,
                          `# 两个坑：`,
                          `#  · --no-pin-tab 不可省：--pin-tab 触发 Target.createTarget，`,
                          `#    Electron 不支持，且状态粘性会持久污染 session`,
                          `#  · @eN ref 只在单个进程内有效，snapshot 与后续动作`,
                          `#    必须放进同一个 batch`
                        ].join('\n')}
                      </pre>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Agent 接入 ─────────────────────────────────────── */}
      <section className="card">
        <h2>接入 AI Agent</h2>
        {mcp ? (
          <>
            <p className="hint">
              你的机器<strong>无需安装 Node 或 agent-browser</strong>：MCP 脚本由本应用自带的
              运行时执行，agent-browser 已随包捆绑。
            </p>

            <div className="row">
              <button
                className="primary"
                disabled={busy === 'mcp'}
                onClick={() => void installCodex()}
              >
                {mcp.codexInstalled ? '重新写入 Codex 配置' : '一键配置 Codex'}
              </button>
              <button className="ghost" onClick={() => void copy('toml', mcp.codexToml)}>
                复制 TOML
              </button>
              <button className="ghost" onClick={() => void copy('claude', mcp.claudeCommand)}>
                复制 Claude 命令
              </button>
              {(copied === 'toml' || copied === 'claude') && <span className="copied">已复制</span>}
            </div>

            {installed && (
              <div className={installed.ok ? 'note ok' : 'note bad-note'}>
                {installed.ok
                  ? `已${
                      installed.action === 'created'
                        ? '创建配置文件'
                        : installed.action === 'updated'
                          ? '更新配置'
                          : '是最新配置'
                    }${installed.backup ? `（原文件已备份）` : ''} — 重启 codex 生效`
                  : `失败：${installed.error}`}
              </div>
            )}

            {/* 本项目最独特的部分：一段能让 agent 自己接入、自己理解能力边界的 prompt */}
            <div className="agent-block">
              <h3>让 agent 自己接入</h3>
              <p>
                把下面这段整段发给 Codex 或 Claude Code。它包含配置写法、13 个工具的用途、
                以及几个实际踩过的坑，agent 读完会自己改配置、重启并验证链路。
              </p>
              <pre className="prompt">{prompt}</pre>
              <div className="row">
                <button className="primary" onClick={() => void copy('prompt', prompt)}>
                  复制这段 prompt
                </button>
                {copied === 'prompt' && <span className="copied">已复制，去粘给 agent</span>}
              </div>
            </div>

            <details>
              <summary>接入细节与手工配置内容</summary>
              <table className="kv" style={{ marginTop: 10 }}>
                <tbody>
                  <tr>
                    <th>Codex 配置</th>
                    <td>
                      {mcp.codexInstalled ? (
                        <span className="ok-txt">已配置</span>
                      ) : (
                        <span className="dim">未配置</span>
                      )}{' '}
                      <code className="path">{mcp.codexConfigPath}</code>
                    </td>
                  </tr>
                  <tr>
                    <th>MCP 脚本</th>
                    <td>
                      {mcp.scriptExists ? '' : <span className="bad">缺失 — </span>}
                      <code className="path">{mcp.scriptPath}</code>
                    </td>
                  </tr>
                  <tr>
                    <th>运行时</th>
                    <td>
                      <code className="path">{mcp.nodeRuntime}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
              <pre className="cmd">{mcp.codexToml}</pre>
              <pre className="cmd">{mcp.claudeCommand}</pre>
            </details>
          </>
        ) : (
          <p className="dim">读取中…</p>
        )}
      </section>

      {/* ── 运行时诊断 ─────────────────────────────────────── */}
      <section className="card">
        <h2>运行时</h2>
        {info ? (
          <table className="kv">
            <tbody>
              <tr>
                <th>CDP 端口</th>
                <td>
                  {port ? (
                    <code>{port}</code>
                  ) : (
                    <span className="bad">未就绪 {info.cdpError ? `— ${info.cdpError}` : ''}</span>
                  )}
                </td>
              </tr>
              <tr>
                <th>Bridge</th>
                <td>
                  <code className="path">{info.bridgeUrl}/info</code>
                </td>
              </tr>
              <tr>
                <th>发现文件</th>
                <td>
                  <code className="path">{info.bridgeFile}</code>
                </td>
              </tr>
              <tr>
                <th>agent-browser</th>
                <td>
                  <code className="path">{info.agentBrowserPath}</code>
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="dim">读取中…</p>
        )}
        <div className="row">
          <button className="ghost" onClick={() => void loadTargets()}>
            查看原始 CDP targets
          </button>
          <button className="ghost" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        {targets && (
          <pre className="targets">
            {targets.length
              ? targets.map((t) => `[${t.type}] ${t.id}\n  ${t.title}\n  ${t.url}`).join('\n\n')
              : '（无 target）'}
          </pre>
        )}
      </section>
    </div>
  )
}

export default App
