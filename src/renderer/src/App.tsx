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
import { DICTS, detectLang, saveLang, type Lang } from './i18n'

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
  const [lang, setLang] = useState<Lang>(detectLang)

  const t = DICTS[lang]

  /**
   * 语言状态要同时反映到 <html lang> —— 它影响拼写检查、字体回退，
   * 以及屏幕阅读器用哪种语言朗读。
   * 顶栏是独立文档（chrome.html），走主进程转发，见 setLanguage。
   */
  const switchLang = useCallback((next: Lang) => {
    setLang(next)
    saveLang(next)
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
    void window.api.app.setLanguage(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    void window.api.app.setLanguage(lang)
  }, [lang])

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
      if (!r.ok) setErr(r.error ?? t.writeFailed)
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
  const prompt = mcp ? buildAgentPrompt(mcp, identities, lang) : ''

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
            Personae <em>{t.tagline}</em>
          </h1>
          <p className="sub">
            {t.intro1}
            <code>persist:</code>
            {t.intro2}
          </p>
        </div>

        {/* 语言切换放在头部右上：它是全局设置，不属于任何一个功能区 */}
        <div className="langswitch" role="group" aria-label={t.langLabel}>
          <button
            className={lang === 'en' ? 'on' : ''}
            onClick={() => switchLang('en')}
            aria-pressed={lang === 'en'}
          >
            EN
          </button>
          <button
            className={lang === 'zh' ? 'on' : ''}
            onClick={() => switchLang('zh')}
            aria-pressed={lang === 'zh'}
          >
            中
          </button>
        </div>
      </header>

      {/* 顶部状态条：一眼确认系统是否就绪，不必展开任何面板 */}
      <div className="statusbar">
        <div className="stat">
          <b>{t.statusLabel}</b>
          <span>
            <i className={`pulse ${ready ? '' : 'off'}`} />
            {ready ? t.ready : t.notReady}
          </span>
        </div>
        <div className="stat">
          <b>{t.cdpPort}</b>
          <span>{port ?? '—'}</span>
        </div>
        <div className="stat">
          <b>{t.identitiesLabel}</b>
          <span>{t.identityCount(identities.length, openCount)}</span>
        </div>
        <div className="stat">
          <b>{t.agentAccess}</b>
          <span>{mcp?.codexInstalled ? t.codexConfigured : t.notConfigured}</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* ── 身份 ───────────────────────────────────────────── */}
      <section className="card">
        <h2>
          {t.browserIdentities}
          <span className="count">{identities.length}</span>
        </h2>

        <div className="row" style={{ marginBottom: identities.length ? 14 : 0 }}>
          <input
            placeholder={t.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <input
            placeholder={t.homeUrlPlaceholder}
            value={homeUrl}
            onChange={(e) => setHomeUrl(e.target.value)}
            style={{ flex: 1.3 }}
          />
          <button className="primary" onClick={() => void add()}>
            {t.addIdentity}
          </button>
        </div>

        {identities.length === 0 ? (
          <div className="empty">
            <b>{t.emptyTitle}</b>
            {t.emptyHint}
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
                        {it.isOpen ? t.live : t.idle}
                      </span>
                    </div>
                    <div className="row">
                      <button
                        className="primary"
                        disabled={busy === it.id}
                        onClick={() => void act(it.id, () => window.api.identity.open(it.id))}
                      >
                        {it.isOpen ? t.focus : t.openWindow}
                      </button>
                      <button
                        className="ghost"
                        disabled={!it.isOpen || busy === it.id}
                        onClick={() => void act(it.id, () => window.api.identity.close(it.id))}
                      >
                        {t.close}
                      </button>
                      <button
                        className="danger"
                        disabled={busy === it.id}
                        onClick={() => void act(it.id, () => window.api.identity.remove(it.id))}
                      >
                        {t.remove}
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
                            <span className="dim">{t.targetIdPending}</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th>{t.currentPage}</th>
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
                      <summary>{t.manualSummary}</summary>
                      <pre className="cmd">
                        {[
                          t.cmdPreferMcp,
                          ``,
                          t.cmdManual,
                          `"${bin}" --session ${sessionName} --cdp ${port ?? '<port>'} \\`,
                          `  --no-pin-tab batch "tab ${it.targetId}" "snapshot -i"`,
                          ``,
                          t.cmdPitfalls,
                          t.cmdPitfall1a,
                          t.cmdPitfall1b,
                          t.cmdPitfall2a,
                          t.cmdPitfall2b
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
        <h2>{t.agentSection}</h2>
        {mcp ? (
          <>
            <p className="hint">
              {t.noInstallNeeded1}
              <strong>{t.noInstallNeeded2}</strong>
              {t.noInstallNeeded3}
            </p>

            <div className="row">
              <button
                className="primary"
                disabled={busy === 'mcp'}
                onClick={() => void installCodex()}
              >
                {mcp.codexInstalled ? t.rewriteCodex : t.installCodex}
              </button>
              <button className="ghost" onClick={() => void copy('toml', mcp.codexToml)}>
                {t.copyToml}
              </button>
              <button className="ghost" onClick={() => void copy('claude', mcp.claudeCommand)}>
                {t.copyClaude}
              </button>
              {(copied === 'toml' || copied === 'claude') && (
                <span className="copied">{t.copied}</span>
              )}
            </div>

            {installed && (
              <div className={installed.ok ? 'note ok' : 'note bad-note'}>
                {installed.ok
                  ? `${
                      installed.action === 'created'
                        ? t.installedCreated
                        : installed.action === 'updated'
                          ? t.installedUpdated
                          : t.installedUnchanged
                    }${installed.backup ? t.backupNote : ''}${t.restartCodex}`
                  : t.installFailed(String(installed.error))}
              </div>
            )}

            {/* 本项目最独特的部分：一段能让 agent 自己接入、自己理解能力边界的 prompt */}
            <div className="agent-block">
              <h3>{t.selfServeTitle}</h3>
              <p>{t.selfServeHint}</p>
              <pre className="prompt">{prompt}</pre>
              <div className="row">
                <button className="primary" onClick={() => void copy('prompt', prompt)}>
                  {t.copyPrompt}
                </button>
                {copied === 'prompt' && <span className="copied">{t.copiedGoPaste}</span>}
              </div>
            </div>

            <details>
              <summary>{t.detailsSummary}</summary>
              <table className="kv" style={{ marginTop: 10 }}>
                <tbody>
                  <tr>
                    <th>{t.codexConfigRow}</th>
                    <td>
                      {mcp.codexInstalled ? (
                        <span className="ok-txt">{t.configured}</span>
                      ) : (
                        <span className="dim">{t.notConfigured}</span>
                      )}{' '}
                      <code className="path">{mcp.codexConfigPath}</code>
                    </td>
                  </tr>
                  <tr>
                    <th>{t.mcpScript}</th>
                    <td>
                      {mcp.scriptExists ? '' : <span className="bad">{t.missing}</span>}
                      <code className="path">{mcp.scriptPath}</code>
                    </td>
                  </tr>
                  <tr>
                    <th>{t.runtime}</th>
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
          <p className="dim">{t.loading}</p>
        )}
      </section>

      {/* ── 运行时诊断 ─────────────────────────────────────── */}
      <section className="card">
        <h2>{t.runtimeSection}</h2>
        {info ? (
          <table className="kv">
            <tbody>
              <tr>
                <th>{t.cdpPort}</th>
                <td>
                  {port ? (
                    <code>{port}</code>
                  ) : (
                    <span className="bad">
                      {t.notReady} {info.cdpError ? `— ${info.cdpError}` : ''}
                    </span>
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
                <th>{t.discoveryFile}</th>
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
          <p className="dim">{t.loading}</p>
        )}
        <div className="row">
          <button className="ghost" onClick={() => void loadTargets()}>
            {t.viewRawTargets}
          </button>
          <button className="ghost" onClick={() => void refresh()}>
            {t.refresh}
          </button>
        </div>
        {targets && (
          <pre className="targets">
            {targets.length
              ? targets.map((t) => `[${t.type}] ${t.id}\n  ${t.title}\n  ${t.url}`).join('\n\n')
              : t.noTargets}
          </pre>
        )}
      </section>
    </div>
  )
}

export default App
