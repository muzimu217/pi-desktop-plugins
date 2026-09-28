/**
 * Theme Forge (io.github.muzimu217.theme-forge) — 给 agent 的 AI 主题工作台。
 *
 * MVP 工具：theme_forge（action 分发）
 *   - apply   ：{ css, label, base?, activate? } → 预检 CSS → pi.themes.upsert
 *               （宿主 sanitizeThemeCss 终审：256KB 上限、禁 url()/导入）→
 *               activate 时 pi.app.setTheme("plugin:<pid>:<id>") 实时换肤 →
 *               应用记录写入插件设置（近 20 条环形历史，供 export 取用）
 *   - list    ：pi.themes.list() → 工坊主题清单
 *   - remove  ：{ themeId } → pi.themes.remove
 *   - reset   ：pi.app.setTheme("system") 一键恢复系统主题
 *   - export  ：{ themeId? } → 从历史取 CSS → pi.clipboard.writeText
 *
 * 安全面：权限最小集 ui.theme + agent.tool.register + clipboard.write；
 * 零出网、零文件访问；只能操作挂在自己插件 id 下的主题；宿主终审 CSS。
 */
"use strict";

const PLUGIN_ID = "io.github.muzimu217.theme-forge";
const THEME_ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MAX_CSS_BYTES = 256 * 1024; // 对齐宿主 THEME_CSS_MAX_BYTES
const HISTORY_LIMIT = 20;
const ACTIONS = ["apply", "list", "remove", "reset", "export"];

function slugifyLabel(label, fallbackSeed) {
  const ascii = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (ascii) return ascii;
  return "forge-" + Number(fallbackSeed ?? Date.now()).toString(36);
}

/** 工具侧预检：只挡明显越界并给可读错误；宿主 sanitizeThemeCss 终审。 */
function preflightCss(css) {
  const value = String(css ?? "");
  if (!value.trim()) return "CSS is empty — generate at least one rule.";
  if (Buffer.byteLength(value, "utf8") > MAX_CSS_BYTES) {
    return `CSS is too large (${Buffer.byteLength(value, "utf8")} bytes); the host limit is ${MAX_CSS_BYTES} bytes.`;
  }
  if (/url\s*\(/i.test(value)) {
    return "url() is not allowed in runtime themes (the host refuses undeclared asset references). Use plain colours, gradients and variable overrides only.";
  }
  if (/@import/i.test(value)) {
    return "@import is not allowed in runtime themes.";
  }
  return null;
}

function fullThemeId(themeId) {
  return `plugin:${PLUGIN_ID}:${themeId}`;
}

function pushHistory(history, entry) {
  const next = [entry, ...history.filter((h) => h.id !== entry.id)];
  return next.slice(0, HISTORY_LIMIT);
}

function buildApplySummary(themeId, label, base, activated) {
  const lines = [
    `Theme applied: "${label}" (id: ${themeId}, base: ${base}).`,
    activated
      ? "The whole app has been re-themed live — look around and tell me what to adjust, or say the word and I will restore the system theme (action: reset)."
      : "It is registered but not activated; call apply again with activate=true, or switch to it from Settings.",
  ];
  return lines.join(" ");
}

async function executeThemeForge(args /* , ctx */) {
  const pi = globalThis.pi;
  if (!pi || !pi.themes || !pi.app) throw new Error("theme-forge: host theme API unavailable");
  const action = args && typeof args.action === "string" ? args.action : "";
  if (!ACTIONS.includes(action)) {
    throw new Error(`theme_forge: unknown action "${action}" — expected one of ${ACTIONS.join(", ")}.`);
  }

  if (action === "apply") {
    const css = typeof args.css === "string" ? args.css : "";
    const problem = preflightCss(css);
    if (problem) throw new Error(`theme_forge apply: ${problem}`);
    const label = String(args.label ?? "").trim() || "Forged theme";
    const base = args.base === "light" ? "light" : "dark";
    const activate = args.activate !== false;
    const themeId = slugifyLabel(label, Date.now());
    if (!THEME_ID_RE.test(themeId)) {
      throw new Error(`theme_forge apply: generated theme id "${themeId}" is invalid.`);
    }
    await pi.themes.upsert({ id: themeId, label, base, css });
    if (activate) await pi.app.setTheme(fullThemeId(themeId));
    // 应用历史存插件设置（近 20 条），供 export 取用
    try {
      const settings = (await pi.plugin.getSettings()) || {};
      const history = Array.isArray(settings.history) ? settings.history : [];
      await pi.plugin.setSettings({
        history: pushHistory(history, { id: themeId, label, base, css, at: new Date().toISOString() }),
      });
    } catch (e) {
      /* 历史记录失败不影响应用本身 */
    }
    return {
      content: [
        { type: "text", text: buildApplySummary(themeId, label, base, activate) },
      ],
    };
  }

  if (action === "list") {
    const rows = await pi.themes.list();
    const mine = rows.filter((r) => r && String(r.id).startsWith(`plugin:${PLUGIN_ID}:`));
    if (mine.length === 0) {
      return { content: [{ type: "text", text: "No forged themes yet — call apply with a CSS block and a label." }] };
    }
    const lines = mine.map(
      (r) => `- ${r.label} (id: ${r.themeId}, base: ${r.base})`,
    );
    return { content: [{ type: "text", text: `Forged themes:\n${lines.join("\n")}` }] };
  }

  if (action === "remove") {
    const themeId = String(args.themeId ?? "").trim();
    if (!themeId) throw new Error("theme_forge remove: themeId is required (see the list action).");
    await pi.themes.remove(themeId);
    return { content: [{ type: "text", text: `Removed theme "${themeId}". If it was active the app falls back to the previous theme; reset restores the system theme.` }] };
  }

  if (action === "reset") {
    await pi.app.setTheme("system");
    return { content: [{ type: "text", text: "Restored the system theme preference." }] };
  }

  // export：从历史取 CSS → 剪贴板
  const themeId = String(args.themeId ?? "").trim();
  const settings = (await pi.plugin.getSettings()) || {};
  const history = Array.isArray(settings.history) ? settings.history : [];
  const entry = themeId
    ? history.find((h) => h.id === themeId)
    : history[0];
  if (!entry || !entry.css) {
    throw new Error(
      themeId
        ? `theme_forge export: no recorded CSS for "${themeId}" — only themes applied in this plugin's history can be exported.`
        : "theme_forge export: history is empty — apply a theme first.",
    );
  }
  await pi.clipboard.writeText(entry.css);
  return {
    content: [
      { type: "text", text: `Copied the CSS of "${entry.label}" (id: ${entry.id}, ${Buffer.byteLength(entry.css, "utf8")} bytes) to the clipboard.` },
    ],
  };
}

const TOOL_DESCRIPTION =
  "Generate and apply a live theme to the whole app from a natural-language description. " +
  "Actions: apply (css + label + base[light|dark] + activate[default true] — creates or updates a theme and re-themes the app instantly), " +
  "list (forged themes), remove (themeId), reset (restore the system theme), export (copy a theme's CSS to the clipboard). " +
  "Write theme CSS as variable overrides layered on the chosen base palette (light/dark); " +
  "url() and @import are refused. Iterate on the user's feedback; export only when the user is satisfied.";

async function onLoad() {
  const pi = globalThis.pi;
  if (!pi) throw new Error("theme-forge: globalThis.pi missing at onLoad");
  await pi.agent.registerTool({
    name: "theme_forge",
    description: TOOL_DESCRIPTION,
    risk: "medium",
    planSafeActions: ["list"],
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ACTIONS, description: "Which theme_forge operation to run." },
        css: { type: "string", description: "apply only: theme CSS, variable overrides layered on the base palette." },
        label: { type: "string", description: "apply only: human-readable theme name." },
        base: { type: "string", enum: ["light", "dark"], description: "apply only: base palette. Default dark." },
        activate: { type: "boolean", description: "apply only: switch the app to the theme immediately. Default true." },
        themeId: { type: "string", description: "remove/export only: the theme id from the list action." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: executeThemeForge,
  });
}

async function onUnload() {
  try {
    const pi = globalThis.pi;
    if (pi && pi.agent) await pi.agent.unregisterTool("theme_forge");
  } catch (e) {
    /* 宿主卸载流程会一并回收工具 */
  }
}

module.exports = {
  onLoad,
  onUnload,
  executeThemeForge,
  _internal: {
    PLUGIN_ID,
    THEME_ID_RE,
    MAX_CSS_BYTES,
    HISTORY_LIMIT,
    ACTIONS,
    slugifyLabel,
    preflightCss,
    fullThemeId,
    pushHistory,
    buildApplySummary,
  },
};
