import { useCallback, useEffect, useState } from 'react'
import type {
  AgentInfo,
  CdpTarget,
  IdentityState,
  InstallResult,
  McpSetupInfo
} from '../../preload/types'

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

  return (
    <div className="wrap">
      <header>
        <h1>Personae · 多身份浏览器</h1>
        <p className="sub">
          每个身份 = 独立 <code>persist:</code> partition = 一个 BrowserWindow（CDP{' '}
          <code>type=page</code>），跳转限制在窗口内
        </p>
      </header>

      <section className="card">
        <h2>接入信息</h2>
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
                  <code>{info.bridgeUrl}/info</code>
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
          <button onClick={() => void loadTargets()}>查看原始 CDP targets</button>
          <button onClick={() => void refresh()}>刷新</button>
        </div>
        {targets && (
          <pre className="targets">
            {targets.length
              ? targets.map((t) => `[${t.type}] ${t.id}\n  ${t.title}\n  ${t.url}`).join('\n\n')
              : '（无 target）'}
          </pre>
        )}
      </section>

      <section className="card">
        <h2>接入 Codex / Claude Code</h2>
        {mcp ? (
          <>
            <p className="hint">
              用户机器<strong>无需安装 Node 或 agent-browser</strong>：MCP 脚本由本应用自带的
              运行时执行，agent-browser 已随包捆绑。
            </p>
            <table className="kv">
              <tbody>
                <tr>
                  <th>Codex 配置</th>
                  <td>
                    {mcp.codexInstalled ? (
                      <span className="ok-txt">✓ 已配置</span>
                    ) : (
                      <span className="dim">未配置</span>
                    )}
                    {'  '}
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

            <div className="row">
              <button
                className="primary"
                disabled={busy === 'mcp'}
                onClick={() => void installCodex()}
              >
                {mcp.codexInstalled ? '重新写入 Codex 配置' : '一键配置 Codex'}
              </button>
              <button onClick={() => void navigator.clipboard.writeText(mcp.codexToml)}>
                复制 TOML
              </button>
              <button onClick={() => void navigator.clipboard.writeText(mcp.claudeCommand)}>
                复制 Claude 命令
              </button>
            </div>

            {installed && (
              <div className={installed.ok ? 'note ok' : 'note bad-note'}>
                {installed.ok
                  ? `✓ ${
                      installed.action === 'created'
                        ? '已创建配置文件'
                        : installed.action === 'updated'
                          ? '已更新配置'
                          : '配置已是最新'
                    }${installed.backup ? `（原文件已备份）` : ''} — 重启 codex 生效`
                  : `✗ ${installed.error}`}
              </div>
            )}

            <details>
              <summary>手工配置内容</summary>
              <pre className="cmd">{mcp.codexToml}</pre>
              <pre className="cmd">{mcp.claudeCommand}</pre>
            </details>
          </>
        ) : (
          <p className="dim">读取中…</p>
        )}
      </section>

      <section className="card">
        <h2>添加身份</h2>
        <div className="row">
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
            style={{ flex: 1.2 }}
          />
          <button className="primary" onClick={() => void add()}>
            添加
          </button>
        </div>
      </section>

      {err && <div className="err">{err}</div>}

      <section className="card">
        <h2>身份列表（{identities.length}）</h2>
        {identities.length === 0 && <p className="dim">还没有身份，先添加一个。</p>}
        <div className="list">
          {identities.map((it) => {
            const sessionName = `identity_${it.id}`
            return (
              <div key={it.id} className={`item ${it.isOpen ? 'open' : ''}`}>
                <div className="item-head">
                  <div>
                    <span className={`dot ${it.isOpen ? 'on' : ''}`} />
                    <strong>{it.name}</strong>
                    <span className="dim"> · {it.isOpen ? '已打开' : '未打开'}</span>
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
                        {it.currentUrl ? (
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
                    <summary>agent-browser 操作该身份</summary>
                    <pre className="cmd">
                      {[
                        `# 推荐：直接用配套 MCP（已封装身份定位与 ref 生命周期）`,
                        `#   node scripts/mcp-server.mjs`,
                        ``,
                        `# 手工操作：targetId 可直接当 tab ref，一步命中`,
                        `"${bin}" --session ${sessionName} --cdp ${port ?? '<port>'} \\`,
                        `  --no-pin-tab batch "tab ${it.targetId}" "snapshot -i"`,
                        ``,
                        `# 两个坑：`,
                        `#  · --no-pin-tab 不可省：--pin-tab 触发 Target.createTarget，`,
                        `#    Electron 不支持，且状态粘性会持久污染 session`,
                        `#  · @eN ref 只在单个进程内有效，snapshot 与后续动作`,
                        `#    必须放进同一个 batch`,
                        `"${bin}" --session ${sessionName} --cdp ${port ?? '<port>'} \\`,
                        `  --no-pin-tab batch "tab ${it.targetId}" "snapshot -i" "click @e1"`
                      ].join('\n')}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export default App
