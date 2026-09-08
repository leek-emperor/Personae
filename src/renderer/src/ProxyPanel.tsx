import { useState } from 'react'
import type { ProxyState, ProxyTestResult, ProxyInput } from '../../preload/types'
import type { Dict } from './i18n'

/**
 * 单个身份的代理设置面板。
 *
 * 拆成独立组件，避免 App.tsx 里每个身份卡片都塞一堆本地表单状态。
 * 设计约束：
 *   · 密码永远不从主进程回传，所以编辑已有代理时密码框留空表示「不改」；
 *     用 hasPassword 提示「已保存」而不是回填明文。
 *   · 测试连接结果内联显示，不打断表单。
 */
export function ProxyPanel({
  t,
  proxy,
  busy,
  onSave,
  onClear,
  onTest
}: {
  t: Dict
  proxy: ProxyState | null
  busy: boolean
  onSave: (input: ProxyInput) => Promise<void>
  onClear: () => Promise<void>
  onTest: () => Promise<ProxyTestResult>
}): React.JSX.Element {
  const [scheme, setScheme] = useState(proxy?.scheme ?? 'http')
  const [host, setHost] = useState(proxy?.host ?? '')
  const [port, setPort] = useState(proxy?.port ? String(proxy.port) : '')
  const [username, setUsername] = useState(proxy?.username ?? '')
  const [password, setPassword] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ProxyTestResult | null>(null)

  const save = async (): Promise<void> => {
    setResult(null)
    const input: ProxyInput = { scheme, host, port, username }
    // 密码留空 = 保持原有；填了才提交
    if (password) input.password = password
    await onSave(input)
    setPassword('')
  }

  const clear = async (): Promise<void> => {
    setResult(null)
    await onClear()
    setScheme('http')
    setHost('')
    setPort('')
    setUsername('')
    setPassword('')
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await onTest())
    } catch (e) {
      setResult({ ok: false, error: String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <details className="proxy-panel">
      <summary>
        {t.proxySummary}
        {proxy ? (
          <span className="proxy-current">
            {' '}
            · {proxy.scheme}://{proxy.host}:{proxy.port}
          </span>
        ) : (
          <span className="dim"> · {t.proxyNone}</span>
        )}
      </summary>

      <div className="proxy-form">
        <div className="row">
          <select
            value={scheme}
            onChange={(e) => setScheme(e.target.value as ProxyState['scheme'])}
            aria-label={t.proxyScheme}
          >
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </select>
          <input
            placeholder={t.proxyHost}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            style={{ flex: 2 }}
          />
          <input
            placeholder={t.proxyPort}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            style={{ width: 76 }}
          />
        </div>
        <div className="row">
          <input
            placeholder={t.proxyUser}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password"
            placeholder={proxy?.hasPassword ? t.proxyPassKept : t.proxyPass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <p className="proxy-hint">{t.proxyPasteHint}</p>
        {proxy?.hasPassword && !proxy.secretEncrypted && (
          <p className="proxy-warn">{t.proxyPlaintextWarn}</p>
        )}

        <div className="row">
          <button className="primary" disabled={busy || !host || !port} onClick={() => void save()}>
            {t.proxySave}
          </button>
          <button
            className="ghost"
            disabled={busy || !proxy || testing}
            onClick={() => void test()}
          >
            {testing ? t.proxyTesting : t.proxyTest}
          </button>
          {proxy && (
            <button className="danger" disabled={busy} onClick={() => void clear()}>
              {t.proxyClear}
            </button>
          )}
        </div>

        {result && (
          <div className={result.ok ? 'note ok' : 'note bad-note'}>
            {result.ok ? t.proxyTestOk(result.ip ?? '?') : t.proxyTestFail(result.error ?? '')}
          </div>
        )}
      </div>
    </details>
  )
}
