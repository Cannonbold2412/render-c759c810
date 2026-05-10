# Render Plugin — Claude Instructions

## ⚠️ MANDATORY RULES — READ FIRST

You have a Playwright automation engine built into this plugin. **You do NOT need a web browser. You do NOT need computer-use. You do NOT need Chrome.** The plugin's `execute_plan` tool IS the browser — it opens a visible Chromium window and runs all steps automatically.

**FORBIDDEN — never call these:**
- `computer_use` / `computer-use`
- `mcp__Claude_in_Chrome__*`
- Any screenshot, navigate, or click tool that is NOT from this plugin
- Asking the user to manually open a browser or click anything

**REQUIRED — always use these plugin tools:**
- `list_skills` → `read_skill_files` → `execute_plan`

If you catch yourself thinking "I need a browser to do this" — stop. Call `execute_plan`. The plugin opens the browser for you.

---

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `bootstrap_auth` | Opens visible browser for user to log in manually. Run once if session expired. |
| `list_skills` | Returns all available skills with slugs |
| `read_skill_files(slug)` | Returns execution steps + recovery data for a skill |
| `execute_plan(steps, inputs)` | **Runs a visible Playwright browser, executes all steps, returns screenshot** |
| `auth_login(user_email, user_password)` | Automated login shortcut |
| `delete_a_database_2131619c(database_name)` | Delete a database shortcut |

---

## Available Skills

- `auth_login` — inputs: `user_email`, `user_password`
- `delete-a-database-2131619c` — inputs: `database_name`

---

## Execution Flow

When the user asks you to do something on https://dashboard.render.com:

### Step 1: Collect Required Inputs
Before calling anything, identify what inputs are needed.
- For delete: need `database_name`
- For login: need `user_email`, `user_password` (or use `bootstrap_auth` for manual login)
Ask the user for any missing inputs upfront.

### Step 2: Load Skill Steps
Call `read_skill_files` for each needed skill:
```
read_skill_files(slug: "auth_login")
read_skill_files(slug: "delete-a-database-2131619c")
```

### Step 3: Merge and Execute
Combine all steps into one array (login steps first), then call:
```
execute_plan(
  steps: [...auth_login steps, ...delete steps],
  inputs: {"user_email": "...", "user_password": "...", "database_name": "conxa-db"}
)
```
The plugin opens a **visible** Chromium browser, runs every step with auto-recovery, then closes and returns a screenshot.

### Step 4: Handle Auth Errors
If `execute_plan` returns *"Session expired"*:
→ Call `bootstrap_auth` (user logs in manually in the visible browser)
→ Then retry `execute_plan` (skip auth_login steps this time)

---

## Complete Example: "Delete my database conxa-db"

1. Ask user for Render email + password (or check if they want manual login via `bootstrap_auth`)
2. Call `read_skill_files("auth_login")` → get 5 login steps
3. Call `read_skill_files("delete-a-database-2131619c")` → get 9 delete steps
4. Call `execute_plan(steps=[...5 login steps, ...9 delete steps], inputs={"user_email": "user@example.com", "user_password": "secret", "database_name": "conxa-db"})`
5. Visible browser opens → logs in → navigates to database → deletes it → closes
6. Return screenshot confirming deletion

**Do NOT ask the user to do anything in a browser. The plugin handles it all.**
