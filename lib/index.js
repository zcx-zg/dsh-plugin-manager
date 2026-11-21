/**
 * dsh-plugin-manager — DSH 插件管理插件（host 端）
 *
 * 作用：让模型（以及后续 Web 面板）查看、启用、停用、删除当前 profile 下
 * 已安装的第三方插件。插件列表直接读 profile 的 package.json 与
 * dsh.profile.bundles，和 DSH「插件」页面看到的是同一份数据。
 *
 * 约定（与 DSH 官方插件一致）：
 * - 具名导出 name / inject / apply，由 cordis 加载
 * - cordis.patch.yml 里的 insert.id 必须等于这里的 name
 * - 工具通过 ctx.tools.register 注册，路由通过 ctx.connection.fetch.register 注册
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "dsh-plugin-manager";
export const inject = ["tools", "connection"];

const API_PREFIX = "/api/dsh-plugin-manager";
const MUTATION_HEADER = "x-dsh-plugin-manager";

/* ---------- 路径与配置文件读写 ---------- */

function resolveConfig(config) {
  return {
    // DSH_HOME 优先，其次是 ~/.dsh
    dshHome: config?.dshHome || process.env.DSH_HOME || join(homedir(), ".dsh"),
    // profile 名，浏览器 UI 通常是 web
    profile: config?.profile || process.env.DSH_PROFILE || "web",
    // 关闭后 delete_dsh_plugin 会直接拒绝执行
    allowDelete: config?.allowDelete !== false,
  };
}

function profileDir(settings) {
  return join(settings.dshHome, "profiles", settings.profile);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readProfile(settings) {
  const dir = profileDir(settings);
  const pkgPath = join(dir, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) throw new Error(`读取 profile 失败：${pkgPath}`);
  return { dir, pkgPath, pkg };
}

function writeProfile(pkgPath, pkg) {
  // 统一 2 空格缩进并保留结尾换行，避免把用户的 package.json 改成一整行
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function bundlesOf(pkg) {
  return Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
}

/* ---------- 业务逻辑 ---------- */

function listPlugins(settings, { keyword = "", status = "all" } = {}) {
  const { dir, pkg } = readProfile(settings);
  const deps = pkg.dependencies || {};
  const bundles = bundlesOf(pkg);

  const rows = Object.entries(deps).map(([depName, spec]) => {
    const modPkg = readJson(join(dir, "node_modules", depName, "package.json"), {});
    return {
      name: depName,
      version: modPkg.version || String(spec).replace(/^[^\d]*/, ""),
      description: modPkg.description || "",
      author: typeof modPkg.author === "string" ? modPkg.author : modPkg.author?.name || "",
      enabled: bundles.includes(depName),
      hasClient: Boolean(modPkg.dsh?.client),
    };
  });

  let plugins = rows;
  if (keyword) {
    const q = keyword.toLowerCase();
    plugins = plugins.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q));
  }
  if (status === "enabled") plugins = plugins.filter((p) => p.enabled);
  if (status === "disabled") plugins = plugins.filter((p) => !p.enabled);

  const all = rows.length;
  return {
    profile: settings.profile,
    profileDir: dir,
    total: all,
    enabled: rows.filter((p) => p.enabled).length,
    disabled: rows.filter((p) => !p.enabled).length,
    plugins,
  };
}

function setEnabled(settings, pluginName, enabled) {
  const { pkgPath, pkg } = readProfile(settings);
  const deps = pkg.dependencies || {};
  if (!deps[pluginName]) throw new Error(`插件未安装：${pluginName}`);

  const bundles = bundlesOf(pkg).filter((item) => item !== pluginName);
  if (enabled) bundles.push(pluginName);

  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = bundles;
  writeProfile(pkgPath, pkg);

  return {
    ok: true,
    name: pluginName,
    enabled,
    message: `${enabled ? "已启用" : "已停用"}插件 ${pluginName}；重启 DSH 或重新加载 profile 后生效`,
  };
}

function removePlugin(settings, pluginName) {
  if (!settings.allowDelete) throw new Error("当前配置禁止删除插件（allowDelete=false）");

  const { dir, pkgPath, pkg } = readProfile(settings);
  const deps = pkg.dependencies || {};
  if (!deps[pluginName]) throw new Error(`插件未安装：${pluginName}`);

  delete deps[pluginName];
  pkg.dependencies = deps;
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  pkg.dsh.profile.bundles = bundlesOf(pkg).filter((item) => item !== pluginName);
  writeProfile(pkgPath, pkg);

  // 同步删掉已安装的包目录；pnpm 的 lockfile 会在下次 install 时自动校正
  const modDir = join(dir, "node_modules", pluginName);
  if (existsSync(modDir)) rmSync(modDir, { recursive: true, force: true });

  return {
    ok: true,
    name: pluginName,
    message: `已删除插件 ${pluginName}；建议重启 DSH 让工具与界面同步`,
  };
}

function renderList(result) {
  if (!result.plugins.length) return "（没有符合条件的插件）";
  return result.plugins
    .map((p) => `${p.enabled ? "[已启用]" : "[已停用]"} ${p.name}@${p.version}  ${p.description}`)
    .join("\n");
}

/* ---------- HTTP 路由（供 Web 面板调用） ---------- */

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function runFetch(task) {
  try {
    return jsonResponse({ ok: true, data: task() });
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || String(error) }, 400);
  }
}

function validateMutation(req) {
  // 与官方插件一致：写操作要求自定义头 + 同源 + JSON
  if (req.headers.get(MUTATION_HEADER) !== "1") return "缺少请求标记";
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return "content-type 必须是 application/json";
  return null;
}

function buildRoutes(settings) {
  return [
    {
      path: `${API_PREFIX}/state`,
      methods: ["GET", "HEAD"],
      fetch: () => runFetch(() => listPlugins(settings)),
    },
    {
      path: `${API_PREFIX}/toggle`,
      methods: ["POST"],
      fetch: async (req) => {
        const invalid = validateMutation(req);
        if (invalid) return jsonResponse({ ok: false, error: invalid }, 400);
        const body = await req.json().catch(() => ({}));
        return runFetch(() => setEnabled(settings, body.name, Boolean(body.enabled)));
      },
    },
    {
      path: `${API_PREFIX}/delete`,
      methods: ["POST"],
      fetch: async (req) => {
        const invalid = validateMutation(req);
        if (invalid) return jsonResponse({ ok: false, error: invalid }, 400);
        const body = await req.json().catch(() => ({}));
        return runFetch(() => removePlugin(settings, body.name));
      },
    },
  ];
}

/* ---------- cordis 入口 ---------- */

export function apply(ctx, config) {
  const settings = resolveConfig(config);

  // 1) 注册模型可调用的工具
  ctx.effect(
    () =>
      ctx.tools.register({
        name: "list_dsh_plugins",
        description:
          "列出当前 DSH profile 中已安装的第三方插件，包含启用状态、版本和描述。可按关键词与状态过滤。",
        parameters: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "按插件名或描述过滤，留空表示全部" },
            status: { type: "string", enum: ["all", "enabled", "disabled"], description: "启用状态过滤" },
          },
          additionalProperties: false,
        },
        output: {
          schema: { type: "object" },
          render: (_args, value) => [{ type: "text", text: renderList(value) }],
        },
        async execute(args = {}) {
          return listPlugins(settings, args);
        },
        presentCall() {
          return { card: "generic", title: "List DSH plugins", kind: "read" };
        },
      }),
    "dsh-plugin-manager: list_dsh_plugins"
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: "enable_dsh_plugin",
        description: "启用一个已安装的 DSH 插件（写入 profile 的 dsh.profile.bundles）。",
        parameters: {
          type: "object",
          properties: { name: { type: "string", description: "插件包名，例如 dsh-better-sidebar" } },
          required: ["name"],
          additionalProperties: false,
        },
        output: {
          schema: { type: "object" },
          render: (_args, value) => [{ type: "text", text: value.message }],
        },
        async execute(args) {
          return setEnabled(settings, args.name, true);
        },
      }),
    "dsh-plugin-manager: enable_dsh_plugin"
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: "disable_dsh_plugin",
        description: "停用一个已安装的 DSH 插件（从 profile 的 dsh.profile.bundles 中移除，但保留安装文件）。",
        parameters: {
          type: "object",
          properties: { name: { type: "string", description: "插件包名" } },
          required: ["name"],
          additionalProperties: false,
        },
        output: {
          schema: { type: "object" },
          render: (_args, value) => [{ type: "text", text: value.message }],
        },
        async execute(args) {
          return setEnabled(settings, args.name, false);
        },
      }),
    "dsh-plugin-manager: disable_dsh_plugin"
  );

  ctx.effect(
    () =>
      ctx.tools.register({
        name: "delete_dsh_plugin",
        description:
          "彻底删除一个已安装的 DSH 插件：从 profile 依赖与 bundles 中移除，并删除 node_modules 下的包目录。不可恢复。",
        parameters: {
          type: "object",
          properties: { name: { type: "string", description: "要删除的插件包名" } },
          required: ["name"],
          additionalProperties: false,
        },
        output: {
          schema: { type: "object" },
          render: (_args, value) => [{ type: "text", text: value.message }],
        },
        async execute(args) {
          return removePlugin(settings, args.name);
        },
      }),
    "dsh-plugin-manager: delete_dsh_plugin"
  );

  // 2) 删除属于破坏性操作，交给 DSH 的审批机制询问用户
  ctx.on("tools/pre-execute", (exec, next) => {
    const toolName = exec?.name ?? exec?.toolName ?? exec?.call?.name;
    if (toolName !== "delete_dsh_plugin") return next();
    return Promise.resolve({
      kind: "ask",
      reason: `Delete plugin ${exec?.arguments?.name ?? ""} permanently?`,
      displayReason: {
        en: "This removes the plugin from the profile and deletes its installed files. It cannot be undone.",
        zh: "该操作会把插件从 profile 中移除并删除已安装文件，无法恢复。",
      },
    });
  });

  // 3) 注册 HTTP 路由，供后续 Web 面板读取同一份数据
  ctx.effect(() => {
    const api = ctx.connection?.fetch;
    if (!api?.register) {
      ctx.logger?.warn?.("dsh-plugin-manager: 缺少 connection.fetch，Web 接口未注册");
      return () => {};
    }
    const disposers = buildRoutes(settings).map((route) =>
      api.register({
        path: route.path,
        methods: route.methods,
        requestBody: route.requestBody ?? "buffered",
        fetch: route.fetch,
      })
    );
    return () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          // 卸载时忽略单个路由清理失败
        }
      }
    };
  }, "dsh-plugin-manager: API routes");
}
