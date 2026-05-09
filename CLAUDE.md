# Render C759C810 Plugin — Claude Instructions

You are orchestrating an automation plugin. Read this file to understand what skills are available, what each skill does, and how to combine them to fulfil user requests.

## Plugin Structure

- `plugin.json` — machine-readable manifest listing all skills and auth config
- `auth/auth.json` — saved browser session (restored before every skill run)
- `auth/login/` — login skill, runs automatically if session expires
- `skills/{name}/SKILL.md` — step-by-step description of each skill
- `skills/{name}/execution.json` — machine-executable actions
- `skills/{name}/recovery.json` — fallback strategies for self-healing
- `execution/executor.js` — universal runner, pass `--skill <name>` to execute

## Available Skills

### `auth_login`

Render login

Read `skills/auth_login/SKILL.md` for the full step-by-step breakdown.

## Orchestration Rules

1. Authentication is handled automatically — do not include login steps in your plan.
2. Read each relevant `SKILL.md` before deciding the execution order.
3. Ask the user for any required inputs before starting execution.
4. If a skill fails, the self-healing system will attempt recovery — wait for the outcome before replanning.
5. Skills can be composed sequentially; pass outputs of one skill as inputs to the next where applicable.
