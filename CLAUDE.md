# Render Plugin — Claude Instructions

## ⚠️ MANDATORY RULES

**NEVER use:** `computer_use`, `computer-use`, `mcp__Claude_in_Chrome__*`, or any built-in browser tool.
**The plugin's `execute_plan` tool IS the browser.** It opens a real visible Chromium window and executes all steps. You never need to navigate anywhere yourself.

---

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `read_skill_files(slug)` | Read SKILL.md, required inputs, and execution steps for a skill |
| `execute_plan(steps, inputs)` | Run a visible Playwright browser with the given steps and inputs |
| `list_skills` | List available skill slugs |
| `bootstrap_auth` | Open browser for manual login (only if user has no credentials) |

---

## Exact Flow — Follow This Every Time

### Step 1: Read the skill
Call `read_skill_files` for the skill needed. Read the `skill_md` and `required_inputs` fields.

### Step 2: Check auth
Call `read_skill_files("auth_login")`. If the user has not provided credentials yet, ask:
- "What is your Render email and password?"

If the user says they are already logged in or `bootstrap_auth` was already run, skip auth.

### Step 3: Ask for inputs — DO NOT SKIP THIS STEP
The `read_skill_files` response contains an `instruction` field.
**If `instruction` says "STOP — ask the user..."**, you MUST ask the user for those inputs before doing anything else.
Do NOT call `execute_plan` until the user has given you all required inputs in this conversation.

### Step 4: Execute
Once you have all inputs from the user, call:
```
execute_plan(
  steps: [...auth_login.execution (if needed), ...skill.execution],
  inputs: { all collected inputs }
)
```

### Step 5: Handle auth errors
If `execute_plan` returns "Session expired" → call `bootstrap_auth`, then retry execute_plan without auth steps.

---

## Example: "Delete my database conxa-db"

```
1. read_skill_files("delete-a-database-2131619c")
   → instruction: "STOP — ask user for: database_name"
   → database_name already given in prompt: "conxa-db" ✓

2. read_skill_files("auth_login")
   → instruction: "STOP — ask user for: user_email, user_password"
   → Ask: "Please provide your Render email and password."

3. User replies with credentials.

4. execute_plan(
     steps: [...auth_login steps, ...delete steps],
     inputs: { user_email: "...", user_password: "...", database_name: "conxa-db" }
   )

5. Visible browser opens → logs in → deletes database → returns screenshot
```

**Never skip step 3. Never use placeholder values. Never call execute_plan before the user has confirmed their inputs.**
