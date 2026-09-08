import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
type RegistryMetadata = {
  name: string
  version: string
  packages: Array<{
    registryType: string
    identifier: string
    version: string
    transport: { type: string }
  }>
}

type LauncherPackage = {
  name: string
  version: string
  mcpName: string
  bin: Record<string, string>
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8')) as T

test('registry metadata and installable package identify the same versioned MCP server', () => {
  const registry = readJson<RegistryMetadata>('server.json')
  const pkg = readJson<LauncherPackage>('packages/personae-mcp/package.json')

  assert.equal(pkg.mcpName, registry.name)
  assert.equal(pkg.version, registry.version)
  assert.equal(registry.packages.length, 1)
  assert.equal(registry.packages[0].registryType, 'npm')
  assert.equal(registry.packages[0].identifier, pkg.name)
  assert.equal(registry.packages[0].version, pkg.version)
  assert.equal(registry.packages[0].transport.type, 'stdio')
})

test('the npm package exposes the Personae stdio server as its executable', () => {
  const pkg = readJson<LauncherPackage>('packages/personae-mcp/package.json')
  assert.equal(pkg.bin['personae-mcp'], 'mcp-server.mjs')
  assert.match(
    readFileSync(join(root, 'packages/personae-mcp/mcp-server.mjs'), 'utf8'),
    /JSON-RPC over stdio/
  )
})

test('release workflow publishes the launcher before registering it through GitHub OIDC', () => {
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /working-directory: packages\/personae-mcp/)
  assert.match(workflow, /npm publish --access public --provenance/)
  assert.match(workflow, /mcp-publisher login github-oidc/)
  assert.match(workflow, /mcp-publisher publish/)
})

test('release workflow mirrors the launcher to public GitHub Packages', () => {
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(workflow, /packages: write/)
  assert.match(workflow, /npm publish --registry=https:\/\/npm.pkg.github.com/)
  assert.match(workflow, /visibility=public/)
})

test('release workflow skips an existing npm version so it can repair secondary publishing', () => {
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(
    workflow,
    /npm view "\$PACKAGE@\$VERSION" version --registry=https:\/\/registry.npmjs.org/
  )
  assert.match(workflow, /npm version already exists; skipping npm publish/)
})
