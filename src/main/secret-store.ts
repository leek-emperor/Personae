import { app, safeStorage } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'

/**
 * 敏感信息（当前仅代理密码）的加密存储。
 *
 * 为什么单独一层：身份存档 identities.json 是明文，代理密码不能跟着明文落盘。
 * 用 Electron 自带的 safeStorage —— macOS 走 Keychain、Windows 走 DPAPI，
 * 密文以身份 id 为键存到独立文件 proxy-secrets.json，绝不进 identities.json，
 * 也绝不明文回传给渲染层。
 *
 * 回退：safeStorage 在某些 Linux 桌面环境不可用（isEncryptionAvailable=false）。
 * 此时降级为明文存储，并通过 encrypted 标志让上层据实提示用户，
 * 而不是让「保存密码」这个操作直接失败。
 */

type SecretFile = {
  /** 每条为 base64 编码：加密态是密文的 base64；明文态是 "plain:" + base64(utf8) */
  [identityId: string]: string
}

const PLAIN_PREFIX = 'plain:'

class SecretStore {
  private path = join(app.getPath('userData'), 'proxy-secrets.json')
  private cache: SecretFile | null = null

  private async load(): Promise<SecretFile> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(this.path, 'utf8')
      this.cache = JSON.parse(raw) as SecretFile
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  private async persist(): Promise<void> {
    if (!this.cache) return
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(this.cache, null, 2))
  }

  /** 预加载缓存 —— 供启动时调用，使随后的同步 has/isEncrypted 可靠。 */
  async init(): Promise<void> {
    await this.load()
  }

  /** safeStorage 是否可用（决定密码是加密还是明文落盘） */
  encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /**
   * 存一个身份的代理密码。
   * @returns encrypted 表示是否真正加密（false 说明降级为明文，供界面提示）
   */
  async set(identityId: string, password: string): Promise<{ encrypted: boolean }> {
    const store = await this.load()
    let encrypted = false
    if (this.encryptionAvailable()) {
      try {
        store[identityId] = safeStorage.encryptString(password).toString('base64')
        encrypted = true
      } catch {
        store[identityId] = PLAIN_PREFIX + Buffer.from(password, 'utf8').toString('base64')
      }
    } else {
      store[identityId] = PLAIN_PREFIX + Buffer.from(password, 'utf8').toString('base64')
    }
    await this.persist()
    return { encrypted }
  }

  /** 取回明文密码；无记录返回 null */
  async get(identityId: string): Promise<string | null> {
    const store = await this.load()
    const v = store[identityId]
    if (!v) return null
    try {
      if (v.startsWith(PLAIN_PREFIX)) {
        return Buffer.from(v.slice(PLAIN_PREFIX.length), 'base64').toString('utf8')
      }
      return safeStorage.decryptString(Buffer.from(v, 'base64'))
    } catch (err) {
      console.error(`[secret] 解密失败 (${identityId}):`, err)
      return null
    }
  }

  has(identityId: string): boolean {
    return !!this.cache && identityId in this.cache
  }

  /** 该密文是否为加密态（供界面提示；明文态返回 false） */
  isEncrypted(identityId: string): boolean {
    const v = this.cache?.[identityId]
    return !!v && !v.startsWith(PLAIN_PREFIX)
  }

  async remove(identityId: string): Promise<void> {
    const store = await this.load()
    if (identityId in store) {
      delete store[identityId]
      await this.persist()
    }
  }
}

export const secretStore = new SecretStore()
