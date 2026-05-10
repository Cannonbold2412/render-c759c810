# Render Plugin — Claude Instructions

## ⚠️ MANDATORY RULES

**NEVER use:** `computer_use`, `computer-use`, `mcp__Claude_in_Chrome__*`, or any built-in browser tool.
**ALWAYS use:** This plugin's MCP tools. `execute_plan` opens a real visible Chromium browser and runs all steps — you do not need any other browser tool.

---

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `list_skills` | List available skills |
| `read_skill_files(slug)` | Returns skill_md, execution steps, and recovery data |
| `execute_plan(steps, inputs)` | Runs a visible Playwright browser, executes all steps, returns screenshot |
| `bootstrap_auth` | Opens browser for user to log in manually (only if session expired and no credentials) |

---

## Available Skills

- `auth_login` — automates login with email + password
- `delete-a-database-2131619c` — deletes a database by name

---

## Execution Flow

When the user asks you to do something, follow this exact order:

### 1. Read the skill
Call `read_skill_files` for the relevant skill(s). Read the `skill_md` field — it tells you exactly what inputs are required and what the skill does.

### 2. Ask for inputs
Based on the `skill_md`, ask the user for any required inputs you don't already have.
- For delete: ask for `database_name` if not already given
- For login: ask for `user_email` and `user_password` if credentials are needed

### 3. Execute
Call `execute_plan` with the merged steps and collected inputs.

The plugin auto-detects if the user is not logged in. If not authenticated, it will automatically run the login steps before the main skill. So:
- If you have the user's credentials → include auth_login steps at the start of the plan
- If you don't have credentials → call `bootstrap_auth` first, then execute without auth steps

### 4. Handle failures
If `execute_plan` returns an error, re-read the skill files, adjust the plan, and retry.

---

## Example: "Delete my database conxa-db"

```
1. Call read_skill_files("delete-a-database-2131619c")
   → Read skill_md: needs {{database_name}} ✓ (already given: "conxa-db")

2. Call read_skill_files("auth_login")
   → Read skill_md: needs {{user_email}}, {{user_password}}
   → Ask user: "What is your Render email and password?"

3. Once user provides credentials:
   Call execute_plan(
     steps: [...auth_login.execution, ...delete.execution],
     inputs: {
       user_email: "user@example.com",
       user_password: "secret",
       database_name: "conxa-db"
     }
   )

4. Visible browser opens → logs in → finds database → deletes it → closes
5. Return screenshot confirming deletion
```

If user says "I'm already logged in" or `bootstrap_auth` was already run → skip auth_login steps, execute delete steps only:
```
execute_plan(
  steps: [...delete.execution],
  inputs: { database_name: "conxa-db" }
)
```
