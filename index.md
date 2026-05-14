# Render Plugin — Skill Index

This file lists every skill available in this plugin. Read it to discover what the plugin can do, then use `read_skill_files` to get execution details for the skill you need.

## Skills

### `delete-a-database-2131619c`
**What it does:** Deletes a PostgreSQL database from the Render dashboard.
**Required inputs:** `database_name` — the exact name of the database (e.g. `conxa-db`)
**Steps overview:** Navigate to dashboard → search for the database → open it → click Delete Database → enter the sudo confirmation command → confirm deletion
**Use when user says:** "delete my database", "remove the database", "drop the postgres db"

---

## Authentication

Authentication is handled automatically by the runtime — no auth skill is needed.
- If `auth/auth.json` contains a valid session → workflow runs logged in immediately
- If the session is missing or expired → a login browser opens automatically → user logs in → session is saved → workflow continues

---

## How to use this index

1. Read this file to identify the right skill slug
2. Call `read_skill_files("<slug>")` to get the full execution plan with recovery data
3. Collect any required inputs from the user
4. Call `execute_plan(steps, inputs)` to run the workflow
