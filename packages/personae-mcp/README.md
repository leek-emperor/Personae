# Personae MCP launcher

This package exposes the Personae MCP server to MCP clients through standard
input/output. It is a launcher, not a browser: install and start the
[Personae desktop application](https://github.com/leek-emperor/Personae) first,
then open the browser identity you want an agent to control.

The server discovers the running app through its local bridge and routes each
tool call to the requested account-isolated identity. It never opens a remote
network listener and does not require an API key.

For an installation command and client configuration, use the desktop app's
**Configure Codex** control or follow the repository README.
