#!/usr/bin/env node
/**
 * Keeps the public npm launcher and MCP Registry metadata in lockstep with
 * the desktop application's release version. The launcher deliberately runs
 * the same dependency-free stdio server as the packaged app; it connects to a
 * separately installed, already running Personae application via its bridge.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const registryName = 'io.github.leek-emperor/personae'
const packageName = '@leek-emperor/personae-mcp'
const packageDir = join(root, 'packages', 'personae-mcp')

mkdirSync(packageDir, { recursive: true })
copyFileSync(join(root, 'scripts', 'mcp-server.mjs'), join(packageDir, 'mcp-server.mjs'))
copyFileSync(join(root, 'LICENSE'), join(packageDir, 'LICENSE'))

writeFileSync(
  join(packageDir, 'package.json'),
  JSON.stringify(
    {
      name: packageName,
      version,
      description: 'MCP stdio launcher for a running Personae multi-identity browser.',
      license: 'MIT',
      author: pkg.author,
      repository: pkg.repository,
      homepage: pkg.homepage,
      bugs: pkg.bugs,
      type: 'module',
      mcpName: registryName,
      bin: { 'personae-mcp': 'mcp-server.mjs' },
      files: ['mcp-server.mjs', 'README.md', 'LICENSE'],
      engines: { node: '>=20' },
      keywords: [
        'mcp',
        'model-context-protocol',
        'browser-automation',
        'multi-identity',
        'personae'
      ]
    },
    null,
    2
  ) + '\n'
)

writeFileSync(
  join(root, 'server.json'),
  JSON.stringify(
    {
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
      name: registryName,
      title: 'Personae',
      description:
        'Control specific, already-open account-isolated Personae browser identities with MCP.',
      repository: { url: 'https://github.com/leek-emperor/Personae', source: 'github' },
      version,
      packages: [
        {
          registryType: 'npm',
          identifier: packageName,
          version,
          transport: { type: 'stdio' }
        }
      ]
    },
    null,
    2
  ) + '\n'
)

console.log(`Synced ${packageName} and ${registryName} at v${version}`)
