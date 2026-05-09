# Render Plugin — Claude Instructions

This plugin automates https://dashboard.render.com/login.

## Available Skills

- `delete-a-database-2131619c` — execute via `POST /api/v1/plugins/c759c810-ef66-4eac-a0c6-86323267d6dd/skills/delete-a-database-2131619c/execute`

## Execution

When the user asks you to run any skill from this plugin, call the Conxa execution API.
**Do NOT use computer-use, browser automation, or Claude-in-Chrome tools directly.**

```
POST /api/v1/plugins/c759c810-ef66-4eac-a0c6-86323267d6dd/skills/{skill_slug}/execute
Content-Type: application/json

{"inputs": {"<param>": "<value>"}, "headless": true}
```

- On success: `{"status": "success", "url": "...", "screenshot": "<base64-png>"}`
- On failure: `{"status": "failed", "error": "..."}`

If the API returns a "session expired" error, ask the user to call `bootstrap_auth` first.

## Input Parameters

Read each skill's `skills/{slug}/manifest.json` for the required `inputs` fields.
