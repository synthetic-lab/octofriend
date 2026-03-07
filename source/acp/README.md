# Octofriend ACP Adapter (MVP)

## TODOs

- [x] Implement `initialize`
- [x] Implement `authenticate` (no-op)
- [x] Implement `session/new`
- [x] Implement `session/set_config_option` for a per-session model selector
- [x] Implement `session/prompt`
- [x] Implement `session/cancel`
- [x] Implement `session/request_permission`
- [x] Implement `session/update` with `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, and `tool_call_update`
- [ ] Implement `session/load`
- [ ] Implement `session/set_mode`
- [ ] Implement `available_commands_update`
- [ ] Implement `usage_update`
- [ ] Support ACP-provided `mcpServers` in `session/new`

## Running

Build first:

```bash
npm run build
```

Run adapter:

```bash
node dist/source/acp/index.js
```

With explicit config:

```bash
node dist/source/acp/index.js --config /absolute/path/to/octofriend.json5
```

## Zed settings examples

Development example (local checkout, no build step):

```json
{
  "agent_servers": {
    "Octofriend ACP (dev)": {
      "type": "custom",
      "command": "npx",
      "args": [
        "tsx",
        "/absolute/path/to/repo/source/acp/index.ts",
        "--config",
        "/absolute/path/to/octofriend.json5"
      ],
      "env": {}
    }
  }
}
```

Production example (built adapter):

```json
{
  "agent_servers": {
    "Octofriend ACP": {
      "type": "custom",
      "command": "node",
      "args": [
        "/absolute/path/to/repo/dist/source/acp/index.js",
        "--config",
        "/absolute/path/to/octofriend.json5"
      ],
      "env": {}
    }
  }
}
```
