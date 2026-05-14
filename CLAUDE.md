# Render Plugin — Claude Instructions

## ⚠️ MANDATORY RULES

**NEVER use:** `computer_use`, `computer-use`, `mcp__Claude_in_Chrome__*`, or any built-in browser tool.
**The plugin's `execute_plan` tool IS the browser.** It opens a real visible Chromium window and executes all steps. You never need to navigate anywhere yourself.
**NEVER ask the user about authentication.** Never ask "are you logged in?", "do you need to authenticate?", or anything about sessions. Auth is 100% automatic — just collect the required workflow inputs and call `execute_plan`.

---

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `list_skills` | List available skill slugs |
| `read_skill_files(slug)` | Read SKILL.md, required inputs, and execution steps (with recovery data embedded) |
| `execute_plan(steps, inputs)` | Run a visible Playwright browser — auth handled transparently |

---

## Authentication

Authentication is **fully transparent** — it happens automatically before every workflow.

- The runtime checks `auth/auth.json` before executing any workflow
- If a valid session exists → browser opens already logged in → workflow runs
- If no session or session expired → a visible browser opens at the login URL → user logs in manually → session is saved → browser relaunches authenticated → workflow continues automatically
- **Never pass auth steps into `execute_plan`** — login is handled by the runtime, not the workflow

---

## Exact Flow — Follow This Every Time

### Step 1: Discover skills
Read `index.md` (this plugin's skill catalog) to find the right skill for the user's request. Then call `read_skill_files("<slug>")` to get the full execution plan.

### Step 2: Collect inputs — DO NOT SKIP
The `read_skill_files` response has an `instruction` field. If it says **"STOP — ask the user for: X"**, check first whether the user already provided X in their message. If yes, use it directly. If no, ask.

**Examples of extracting inputs from the user's message:**
- "delete my database conxa-db" → `database_name = "conxa-db"` ✓ (no need to ask)
- "delete my database" → ask: "What is the name of the database to delete?"

### Step 3: Execute
```
execute_plan(
  steps: [<execution steps from read_skill_files>],
  inputs: { database_name: "..." }
)
```

Auth is handled internally. If the session is missing or expired, a login browser opens automatically — the user logs in and the workflow continues without any extra steps from you.

---

## Example: "Delete my database conxa-db"

```
1. Read index.md → matches "delete-a-database-2131619c"

2. read_skill_files("delete-a-database-2131619c")
   → required_inputs: ["database_name"]
   → instruction: "STOP — ask user for: database_name"
   → "conxa-db" already given in the user's message ✓ → no need to ask

3. execute_plan(
     steps: [<10 steps from read_skill_files response>],
     inputs: { database_name: "conxa-db" }
   )

4. Runtime checks auth → session valid → authenticated browser opens
   → navigates to dashboard → searches for "conxa-db"
   → clicks it → opens Delete Database dialog → types confirmation
   → confirms → database deleted → returns screenshot
```

**Never use placeholder values. Never call execute_plan before you have all required inputs.**
