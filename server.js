#!/usr/bin/env node
"use strict";
/**
 * server.js — MCP server for Render.
 *
 * Install via Claude Code: Settings → MCP Servers → Add from GitHub
 * Then ask Claude: "call bootstrap_auth to set up your session"
 */
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PLUGIN_DIR    = path.dirname(require.main.filename);
const CONFIG        = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, "plugin.config.json"), "utf8"));
const AUTH_JSON     = path.join(PLUGIN_DIR, "auth", "auth.json");
const PROTECTED_URL = "https://dashboard.render.com";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function interpolate(value, inputs) {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, k) => String(inputs[k] ?? ""));
}

async function tryLocator(page, sel, timeout) {
  try { await page.locator(sel).waitFor({ state: "visible", timeout: timeout || 4000 }); return true; }
  catch (_) { return false; }
}

const URL_STATE_WAIT_MS = 2000;
const URL_STATE_POLL_MS = 100;

async function waitForUrlState(page, urlState) {
  if (!urlState || !urlState.url_pattern) return;
  const pattern = new RegExp(urlState.url_pattern);
  const deadline = Date.now() + URL_STATE_WAIT_MS;
  let currentUrl = page.url();

  while (Date.now() <= deadline) {
    currentUrl = page.url();
    if (pattern.test(currentUrl)) return;
    await page.waitForTimeout(Math.min(URL_STATE_POLL_MS, Math.max(0, deadline - Date.now())));
  }

  throw new Error(`URL ${currentUrl} does not match expected pattern ${urlState.url_pattern}`);
}

// ─── Recovery embedding ───────────────────────────────────────────────────────

// Merge recovery.json entries into execution steps so runPlan's Layer 1 logic
// can use selector alternatives, fallback text variants, and anchors.
function enrichStepsWithRecovery(steps, recovery) {
  if (!Array.isArray(steps)) return steps;
  const recSteps = (recovery && Array.isArray(recovery.steps)) ? recovery.steps : [];
  return steps.map((step, idx) => {
    const rec = recSteps.find(r => Number(r && r.step_id) === idx + 1);
    if (!rec) return step;
    const sctx = (rec.selector_context && typeof rec.selector_context === "object") ? rec.selector_context : {};
    const fallback = (rec.fallback && typeof rec.fallback === "object") ? rec.fallback : {};
    const textVariants = Array.isArray(fallback.text_variants)
      ? fallback.text_variants.filter(t => typeof t === "string" && t.trim())
      : [];
    const recCandidates = [sctx.primary, ...(Array.isArray(sctx.alternatives) ? sctx.alternatives : [])].filter(Boolean);
    const existingCandidates = Array.isArray(step.candidates) ? step.candidates : [];
    const mergedCandidates = Array.from(new Set([...existingCandidates, ...recCandidates]));
    return {
      ...step,
      candidates: mergedCandidates,
      fallback_selectors: [
        ...(Array.isArray(step.fallback_selectors) ? step.fallback_selectors : []),
        ...textVariants.map(t => `text=${JSON.stringify(t.trim())}`),
      ],
      anchors: Array.isArray(rec.anchors) ? rec.anchors.filter(a => a && typeof a.text === "string" && a.text.trim()) : [],
      _intent: rec.intent || "",
      _visual_ref: rec.visual_ref || "",
    };
  });
}

// ─── Step executor ────────────────────────────────────────────────────────────

async function executeStep(page, step, inputs) {
  const type  = step.type;
  const raw   = step.selector || step.css_selector || (step.target && step.target.css) || "";
  const sel   = interpolate(raw, inputs);

  if (type === "wait") { await page.waitForTimeout(Number(step.ms) || 1000); return; }
  if (type === "navigate") {
    await page.goto(interpolate(step.url || "", inputs), { timeout: 30000, waitUntil: "domcontentloaded" });
    return;
  }
  if (type === "scroll") {
    if (sel) { await page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {}); }
    else      { await page.evaluate(`window.scrollBy(${Number(step.delta_x)||0}, ${Number(step.delta_y)||0})`); }
    return;
  }
  if (type === "fill" || type === "type") {
    await page.locator(sel).first().fill(interpolate(step.value || "", inputs), { timeout: 15000 });
    return;
  }
  if (type === "click") {
    try { await page.locator(sel).first().click({ timeout: 15000 }); return; }
    catch (err) {
      if (String(err).includes("intercepts pointer events")) {
        try { await page.locator(sel).last().click({ timeout: 10000 }); return; } catch (_) {}
      }
      throw err;
    }
  }
  if (type === "select") {
    await page.locator(sel).first().selectOption(interpolate(step.value || "", inputs), { timeout: 15000 });
    return;
  }
  if (type === "focus") {
    if (sel) {
      try {
        await page.locator(sel).first().click({ timeout: 5000 });
      } catch (_) {
        await page.locator(sel).first().focus({ timeout: 10000 }).catch(() => {});
      }
    }
    return;
  }
  if (type === "check") {
    const pattern = interpolate(step.pattern || step.check_pattern || "", inputs);
    if (pattern && !new RegExp(pattern).test(page.url()))
      throw new Error(`URL check failed: ${page.url()} does not match ${pattern}`);
    return;
  }
  // Unknown type — skip
}

async function runSkill(page, skillDir, inputs) {
  const execPath = path.join(skillDir, "execution.json");
  if (!fs.existsSync(execPath)) throw new Error(`execution.json not found in ${skillDir}`);
  const exec  = JSON.parse(fs.readFileSync(execPath, "utf8"));
  const steps = Array.isArray(exec) ? exec
              : Array.isArray(exec.steps) ? exec.steps
              : Array.isArray(exec.execution_plan) ? exec.execution_plan : [];

  const recoveryPath = path.join(skillDir, "recovery.json");
  const recovery = fs.existsSync(recoveryPath)
    ? JSON.parse(fs.readFileSync(recoveryPath, "utf8"))
    : { steps: [] };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      if (step.url_state && step.url_state.before && step.url_state.before.url_pattern) {
        await waitForUrlState(page, step.url_state.before);
      }
      await executeStep(page, step, inputs);
      if (step.url_state && step.url_state.after && step.url_state.after.url_pattern) {
        await waitForUrlState(page, step.url_state.after);
      }
    } catch (err) {
      if (String(err.message || err).includes("expected pattern")) {
        throw new Error(`Step ${step.id || i} (${step.type}) failed: ${err.message}`);
      }
      // Attempt fallback selectors from recovery.json
      const stepNumber = i + 1;
      const rec = (recovery.steps || []).find(r =>
        (step.id && r.id === step.id) || Number(r.step_id) === stepNumber
      );
      let recovered = false;
      if (rec) {
        const selectorContext = rec.selector_context && typeof rec.selector_context === "object" ? rec.selector_context : {};
        const fallback = rec.fallback && typeof rec.fallback === "object" ? rec.fallback : {};
        const anchors = Array.isArray(rec.anchors) ? rec.anchors : [];
        const candidates = Array.from(new Set([
          ...(Array.isArray(rec.fallback_selectors) ? rec.fallback_selectors : []),
          ...(Array.isArray(rec.candidates) ? rec.candidates : []),
          ...(typeof selectorContext.primary === "string" ? [selectorContext.primary] : []),
          ...(Array.isArray(selectorContext.alternatives) ? selectorContext.alternatives : []),
          ...(Array.isArray(fallback.text_variants) ? fallback.text_variants.map(t => `text=${JSON.stringify(String(t).trim())}`) : []),
          ...anchors
            .filter(a => a && typeof a.text === "string" && a.text.trim())
            .map(a => `text=${JSON.stringify(a.text.trim())}`),
        ].filter(Boolean)));
        for (const cand of candidates) {
          if (await tryLocator(page, cand, 3000)) {
            try {
              await executeStep(page, { ...step, selector: cand }, inputs);
              if (step.url_state && step.url_state.after && step.url_state.after.url_pattern) {
                await waitForUrlState(page, step.url_state.after);
              }
              recovered = true;
              break;
            }
            catch (_) {}
          }
        }
      }
      if (!recovered) throw new Error(`Step ${step.id || i} (${step.type}) failed: ${err.message}`);
    }
  }
}

async function runPlan(page, steps, inputs, startFrom = 0) {
  for (let i = startFrom; i < steps.length; i++) {
    const step = steps[i];
    try {
      if (step.url_state && step.url_state.before && step.url_state.before.url_pattern) {
        await waitForUrlState(page, step.url_state.before);
      }
      await executeStep(page, step, inputs);
      if (step.url_state && step.url_state.after && step.url_state.after.url_pattern) {
        await waitForUrlState(page, step.url_state.after);
      }
    } catch (err) {
      const sel = interpolate(step.selector || step.css_selector || (step.target && step.target.css) || "", inputs);
      // Layer 1: step-embedded alternative selectors
      const candidates = Array.from(new Set([
        ...(Array.isArray(step.fallback_selectors) ? step.fallback_selectors : []),
        ...(Array.isArray(step.candidates) ? step.candidates : []),
        ...(Array.isArray(step.anchors) ? step.anchors.filter(a => a && typeof a.text === "string").map(a => `text=${JSON.stringify(a.text.trim())}`) : []),
        ...(Array.isArray(step.fallback_text_variants) ? step.fallback_text_variants.map(t => `text=${JSON.stringify(String(t).trim())}`) : []),
      ].filter(Boolean)));

      let recovered = false;
      // Layer 2: try each candidate selector
      for (const cand of candidates) {
        if (await tryLocator(page, cand, 3000)) {
          try {
            await executeStep(page, { ...step, selector: cand }, inputs);
            if (step.url_state && step.url_state.after && step.url_state.after.url_pattern) {
              await waitForUrlState(page, step.url_state.after);
            }
            recovered = true;
            break;
          } catch (_) {}
        }
      }
      // Layer 3: derive text selector from step value or label
      if (!recovered) {
        const textHints = [step.value, step.label, step.aria_label].filter(v => v && typeof v === "string" && v.length < 60);
        for (const hint of textHints) {
          const textSel = `text=${JSON.stringify(hint.trim())}`;
          if (await tryLocator(page, textSel, 3000)) {
            try {
              await executeStep(page, { ...step, selector: textSel }, inputs);
              recovered = true;
              break;
            } catch (_) {}
          }
        }
      }
      // Layer 4: modal-scoped click — dialogs intercept pointer events on the backdrop button
      if (!recovered && step.type === "click" && sel) {
        const modalContainers = ['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', ".modal"];
        for (const container of modalContainers) {
          const scoped = `${container} ${sel}`;
          if (await tryLocator(page, scoped, 2000)) {
            try {
              await executeStep(page, { ...step, selector: scoped }, inputs);
              if (step.url_state && step.url_state.after && step.url_state.after.url_pattern) {
                await waitForUrlState(page, step.url_state.after);
              }
              recovered = true;
              break;
            } catch (_) {}
          }
          if (recovered) break;
        }
      }
      if (!recovered) {
        const e = new Error(`Step ${i + 1} (${step.type}) failed: ${err.message}`);
        e.failedAt = i;
        e.failedStep = step;
        throw e;
      }
    }
  }
}

// ─── Session management ───────────────────────────────────────────────────────

function isAuthenticated(page) {
  try {
    const u = new URL(page.url());
    // Authenticated = on Render dashboard, NOT on the login page
    return u.hostname === new URL(PROTECTED_URL).hostname && !u.pathname.startsWith("/login");
  } catch (_) { return false; }
}

async function getAuthContext(headless) {
  // ── Phase 1: Try stored session ─────────────────────────────────────────
  if (fs.existsSync(AUTH_JSON)) {
    let stored;
    try { stored = JSON.parse(fs.readFileSync(AUTH_JSON, "utf8")); } catch (_) {}
    if (stored) {
      const browser = await chromium.launch({ headless: headless !== false });
      const context = await browser.newContext({ storageState: stored });
      const page    = await context.newPage();
      await page.goto(PROTECTED_URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      if (isAuthenticated(page)) {
        await page.close();
        console.error("[auth] Session restored from auth.json");
        return { browser, context };
      }
      await browser.close();
      console.error("[auth] Stored session expired — starting manual login");
    }
  } else {
    console.error("[auth] No auth.json — starting manual login");
  }

  // ── Phase 2: Open visible browser, wait for user to log in ──────────────
  console.error("[auth] Opening login browser — waiting for user to authenticate...");
  const loginBrowser = await chromium.launch({ headless: false });
  const loginCtx     = await loginBrowser.newContext();
  const loginPage    = await loginCtx.newPage();
  await loginPage.goto(CONFIG.target_url, { waitUntil: "domcontentloaded", timeout: 30000 });

  try {
    await loginPage.waitForURL(
      url => url.href.startsWith(PROTECTED_URL) && !url.href.includes("/login"),
      { timeout: 300000 }
    );
  } catch (_) {
    await loginBrowser.close();
    throw new Error("Authentication timed out after 5 minutes. Please try again.");
  }

  // ── Phase 3: Save session ────────────────────────────────────────────────
  const state = await loginCtx.storageState();
  fs.mkdirSync(path.dirname(AUTH_JSON), { recursive: true });
  fs.writeFileSync(AUTH_JSON, JSON.stringify(state, null, 2));
  console.error("[auth] Session saved to auth.json — closing login browser");
  await loginBrowser.close();

  // ── Phase 4: Relaunch with authenticated session ─────────────────────────
  console.error("[auth] Relaunching authenticated browser...");
  const browser = await chromium.launch({ headless: headless !== false });
  const context = await browser.newContext({ storageState: state });
  const page    = await context.newPage();
  await page.goto(PROTECTED_URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!isAuthenticated(page)) {
    await browser.close();
    throw new Error("Authenticated navigation failed after login — unexpected error.");
  }
  await page.close();
  console.error("[auth] Authenticated context ready");
  return { browser, context };
}

// ─── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: CONFIG.id, version: CONFIG.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [
    {
      name: "list_skills",
      description: "List all available Render skills with their required inputs. Call this once to plan, then call execute_plan immediately. Never call read_skill_files in normal flow.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "execute_plan",
      description: "Run one or more Render skills in sequence in a single browser session. Auth is 100% automatic — never ask about login. Call immediately once inputs are ready. Format: { skills: [{ slug, inputs }] }. Single: { skills: [{ slug: 'delete-a-database-2131619c', inputs: { database_name: 'conxa-db' } }] }. Multi: { skills: [{ slug: 'deploy-service', inputs: {...} }, { slug: 'delete-a-database-2131619c', inputs: {...} }] }. On failure: a screenshot is returned — inspect it visually (Layer 4), fix execution.json, then retry with resume_from set to the failed step index shown in the error.",
      inputSchema: {
        type: "object",
        properties: {
          skills: {
            type: "array",
            description: "Ordered list of skills to run",
            items: {
              type: "object",
              properties: {
                slug: { type: "string", description: "Skill slug from list_skills" },
                inputs: { type: "object", description: "Input values for this skill" },
              },
              required: ["slug"],
            },
          },
          resume_from: {
            type: "integer",
            description: "0-based step index to resume from. Skips steps before this index. Use after fixing execution.json to retry without repeating successful steps.",
          },
        },
        required: ["skills"],
      },
    },
    {
      name: "read_skill_files",
      description: "DEBUG ONLY — inspect raw execution steps and recovery data for a skill. Do not use in normal workflows.",
      inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
    },
  ];
  console.error(`[ListTools] Registering ${tools.length} tools: ${tools.map(t => t.name).join(", ")}`);
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ── list_skills ───────────────────────────────────────────────────────────
  if (name === "list_skills") {
    const skills = (CONFIG.skills || []).map(skill => {
      const iPath = path.join(PLUGIN_DIR, skill.path, "input.json");
      const mPath = path.join(PLUGIN_DIR, skill.path, "manifest.json");
      let requiredInputs = [];
      let inputProps = {};
      let description = skill.slug;
      if (fs.existsSync(iPath)) {
        try {
          const s = JSON.parse(fs.readFileSync(iPath, "utf8"));
          requiredInputs = s.required || [];
          inputProps = s.properties || {};
        } catch (_) {}
      }
      if (fs.existsSync(mPath)) {
        try { description = JSON.parse(fs.readFileSync(mPath, "utf8")).description || description; } catch (_) {}
      }
      return { slug: skill.slug, description, required_inputs: requiredInputs, inputs: inputProps };
    });
    console.error(`[list_skills] Returning ${skills.length} skills`);
    const out = [
      "RULES: auth automatic, no confirmations, no read_skill_files.",
      "FLOW: list_skills → ask for any missing inputs → execute_plan({ skills: [{ slug, inputs }] })",
      "",
      "SKILLS:",
      JSON.stringify(skills, null, 2),
    ].join("\n");
    return { content: [{ type: "text", text: out }] };
  }

  // ── read_skill_files ─────────────────────────────────────────────────────
  if (name === "read_skill_files") {
    const slugArg = (args && args.slug) ? String(args.slug) : "";
    console.error(`[read_skill_files] Looking for skill: ${slugArg}`);
    const skill = (CONFIG.skills || []).find(s => s.slug === slugArg || s.slug === slugArg.replace(/_/g, "-") || s.slug === slugArg.replace(/-/g, "_"));
    if (!skill) {
      console.error(`[read_skill_files] Skill not found. Available: ${(CONFIG.skills || []).map(s => s.slug).join(", ")}`);
      return { content: [{ type: "text", text: `Skill not found: ${slugArg}. Use list_skills to see available skills.` }] };
    }
    const skillDir = path.join(PLUGIN_DIR, skill.path);
    const execPath = path.join(skillDir, "execution.json");
    const recPath  = path.join(skillDir, "recovery.json");
    const mdPath   = path.join(skillDir, "SKILL.md");
    const iPath    = path.join(skillDir, "input.json");
    const inputSchema = fs.existsSync(iPath) ? JSON.parse(fs.readFileSync(iPath, "utf8")) : null;
    const requiredInputs = inputSchema && inputSchema.required ? inputSchema.required : [];
    const rawExecution = fs.existsSync(execPath) ? JSON.parse(fs.readFileSync(execPath, "utf8")) : null;
    const rawRecovery  = fs.existsSync(recPath)  ? JSON.parse(fs.readFileSync(recPath,  "utf8")) : null;
    const rawSteps = Array.isArray(rawExecution) ? rawExecution
                   : (rawExecution && Array.isArray(rawExecution.steps)) ? rawExecution.steps : [];
    const enrichedSteps = enrichStepsWithRecovery(rawSteps, rawRecovery);
    const result = {
      slug: skill.slug,
      skill_md:       fs.existsSync(mdPath)   ? fs.readFileSync(mdPath, "utf8") : null,
      required_inputs: requiredInputs,
      instruction:    requiredInputs.length > 0
        ? `STOP — ask the user to provide these inputs before calling execute_plan: ${requiredInputs.join(", ")}`
        : "No inputs required. You may call execute_plan directly.",
      execution: enrichedSteps,
      recovery:  rawRecovery,
    };
    console.error(`[read_skill_files] Found ${skill.slug}: ${result.execution ? result.execution.length + " steps" : "no execution.json"}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  // ── execute_plan ─────────────────────────────────────────────────────────
  if (name === "execute_plan") {
    const skillRuns = (args && Array.isArray(args.skills)) ? args.skills : [];
    if (skillRuns.length === 0)
      return { content: [{ type: "text", text: "execute_plan: provide { skills: [{ slug, inputs }] }" }] };

    // Resolve each slug to enriched steps
    const resolved = [];
    for (const run of skillRuns) {
      const slug = String(run.slug || "");
      const inputs = (run.inputs && typeof run.inputs === "object") ? run.inputs : {};
      const skill = (CONFIG.skills || []).find(s =>
        s.slug === slug || s.slug === slug.replace(/_/g, "-") || s.slug === slug.replace(/-/g, "_")
      );
      if (!skill) return { content: [{ type: "text", text: `Skill not found: ${slug}. Call list_skills to see available skills.` }] };
      const skillDir = path.join(PLUGIN_DIR, skill.path);
      const rawExec  = fs.existsSync(path.join(skillDir, "execution.json"))
        ? JSON.parse(fs.readFileSync(path.join(skillDir, "execution.json"), "utf8")) : null;
      const rawRec   = fs.existsSync(path.join(skillDir, "recovery.json"))
        ? JSON.parse(fs.readFileSync(path.join(skillDir, "recovery.json"), "utf8")) : null;
      const rawSteps = Array.isArray(rawExec) ? rawExec
        : (rawExec && Array.isArray(rawExec.steps)) ? rawExec.steps : [];
      resolved.push({ steps: enrichStepsWithRecovery(rawSteps, rawRec), inputs, slug });
    }

    let _browser, _context;
    try {
      ({ browser: _browser, context: _context } = await getAuthContext(false));
    } catch (authErr) {
      return { content: [{ type: "text", text: String(authErr) }] };
    }

    const resumeFrom = (Number.isInteger(args.resume_from) && args.resume_from > 0)
      ? args.resume_from : 0;

    const page = await _context.newPage();
    try {
      for (let si = 0; si < resolved.length; si++) {
        const { steps, inputs, slug } = resolved[si];
        const startAt = si === 0 ? resumeFrom : 0;
        console.error(`[execute_plan] Running ${slug} (${steps.length} steps, starting at ${startAt})...`);
        await runPlan(page, steps, inputs, startAt);
      }
      const state = await _context.storageState();
      fs.mkdirSync(path.dirname(AUTH_JSON), { recursive: true });
      fs.writeFileSync(AUTH_JSON, JSON.stringify(state, null, 2));
      const shot = await page.screenshot({ type: "png" }).catch(() => null);
      const url  = page.url();
      await _browser.close();
      console.error(`[execute_plan] Done. URL: ${url}`);
      const content = [{ type: "text", text: `Done. URL: ${url}` }];
      if (shot) content.push({ type: "image", data: shot.toString("base64"), mimeType: "image/png" });
      return { content };
    } catch (err) {
      const shot = await page.screenshot({ type: "png" }).catch(() => null);
      const url  = page.url();
      await _browser.close().catch(() => {});
      const failedAt = typeof err.failedAt === "number" ? err.failedAt : null;
      const hint = failedAt !== null
        ? `\n\nFailed at step ${failedAt + 1} (0-based index: ${failedAt}).\nLayer 3+4 recovery: look at the screenshot to see the page state, identify the correct selector, edit execution.json step ${failedAt + 1}, then call execute_plan again with resume_from: ${failedAt}.`
        : "";
      console.error(`[execute_plan] Failed: ${err.message}`);
      const content = [{ type: "text", text: `Execution failed: ${err.message}${hint}\nPage URL at failure: ${url}` }];
      if (shot) content.push({ type: "image", data: shot.toString("base64"), mimeType: "image/png" });
      return { content };
    }
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
});

const _skillFlagIdx = process.argv.indexOf("--run-skill");
if (_skillFlagIdx !== -1) {
  // ── CLI execution mode ────────────────────────────────────────────────────
  const _skillSlug  = process.argv[_skillFlagIdx + 1];
  const _inputsIdx  = process.argv.indexOf("--inputs");
  const _inputs     = _inputsIdx !== -1 ? JSON.parse(process.argv[_inputsIdx + 1]) : {};
  const _headless   = process.argv.includes("--headless");

  const _skill = (CONFIG.skills || []).find(s => s.slug === _skillSlug);
  if (!_skill) {
    process.stdout.write(JSON.stringify({ status: "failed", error: `Skill not found: ${_skillSlug}` }));
    process.exit(1);
  }

  getAuthContext(_headless).then(async ({ browser, context }) => {
    const page = await context.newPage();
    try {
      await runSkill(page, path.join(PLUGIN_DIR, _skill.path), _inputs);
      const url  = page.url();
      const shot = await page.screenshot({ type: "png" }).catch(() => null);
      const state = await context.storageState();
      fs.mkdirSync(path.dirname(AUTH_JSON), { recursive: true });
      fs.writeFileSync(AUTH_JSON, JSON.stringify(state, null, 2));
      await browser.close();
      process.stdout.write(JSON.stringify({
        status: "success",
        url,
        screenshot: shot ? shot.toString("base64") : null,
      }));
      process.exit(0);
    } catch (err) {
      await browser.close().catch(() => {});
      process.stdout.write(JSON.stringify({ status: "failed", error: String(err) }));
      process.exit(1);
    }
  }).catch(err => {
    process.stdout.write(JSON.stringify({ status: "failed", error: String(err) }));
    process.exit(1);
  });
} else {
  // ── MCP server mode (default) ─────────────────────────────────────────────
  const transport = new StdioServerTransport();
  server.connect(transport);
}
