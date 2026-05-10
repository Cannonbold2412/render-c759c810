# Render Plugin — Claude Instructions

## ⚠️ CRITICAL EXECUTION RULES

**NEVER use any of these tools:**
- `mcp__Claude_in_Chrome__*` (Chrome MCP browser tools)
- `computer_use` or `computer-use`
- Any built-in browser navigation or screenshot tools

**ALWAYS use this plugin's MCP tools to execute browser automation.**

---

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `bootstrap_auth` | Open browser for user to log in and save session |
| `list_skills` | List all available skills with metadata |
| `read_skill_files(slug)` | Get execution.json + recovery.json for a skill |
| `execute_plan(steps, inputs)` | Run a merged multi-skill plan via Playwright |
| Individual skill tools | Shortcut to run a single skill directly |

---

## Available Skills

- `delete-a-database-2131619c`

---

## Execution Flow

When the user asks you to do something on https://dashboard.render.com/login:

### Step 1: Identify Skills
Determine which skills are needed from the list above.
Example: "Delete my database" → needs: `bootstrap_auth` (if not authed) + `delete_database`

### Step 2: Load Skill Data
For each required skill, call:
```
read_skill_files(slug: "<skill-slug>")
```
This returns `execution` (steps array) and `recovery` (per-step fallbacks).

### Step 3: Merge into a Plan
Combine the steps from all skills into ONE sequence:
- Login steps come first
- Remove duplicate navigation (if multiple skills navigate to the same page, keep only one)
- Annotate each step with its recovery info from the recovery data
- Inject `{{input_key}}` placeholders with actual user-provided values

### Step 4: Execute the Plan
Call:
```
execute_plan(steps: [...merged steps...], inputs: {"key": "value"})
```
The plugin will run a visible Playwright browser and execute all steps.

### Step 5: Handle Failures
If `execute_plan` returns an error:
- Check the error message for which step failed
- Reload the skill files with `read_skill_files`
- Adjust the plan (different selector, different sequence)
- Call `execute_plan` again with the fixed plan

---

## Authentication

If you get: *"Session expired. Ask Claude to call bootstrap_auth first."*
→ Call `bootstrap_auth` (opens a visible browser for the user to log in)
→ Once the user logs in and the browser closes, call `execute_plan` again

---

## Input Parameters

When calling `read_skill_files`, the response includes each step's `inputs` field.
Look for `{{key}}` placeholders in `value` fields — those are the required inputs to inject.
