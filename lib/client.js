/**
 * dsh-plugin-manager — 浏览器端（DSH Web UI）
 *
 * 与 host 端 lib/index.js 使用同一份数据：通过 /api/dsh-plugin-manager/* 路由
 * 读取 profile 中已安装的插件，并执行启用 / 停用 / 删除。
 *
 * 打包约定（与官方及第三方客户端插件一致）：
 * window.__ModuleLoader__.load({ id, factory }) —— 工厂里返回 cordis 插件对象，
 * 由 dsh-client-modules 在对应 Loader 行激活时物化。
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var h = React.createElement;

    var API = "/api/dsh-plugin-manager";
    var MUTATION_HEADERS = {
      "content-type": "application/json",
      "x-dsh-plugin-manager": "1",
    };
    var NS = "dsh-plugin-manager";

    /* ---------- 文案 ---------- */

    var DICT = {
      zh: {
        title: "插件管理",
        desc: "查看、启用、停用或删除当前 profile 中已安装的插件。",
        tabAll: "全部",
        tabEnabled: "已启用",
        tabDisabled: "已停用",
        statTotal: "共 {count} 个",
        statEnabled: "{count} 个已启用",
        statDisabled: "{count} 个已停用",
        search: "搜索插件名或描述",
        refresh: "刷新",
        empty: "没有符合条件的插件",
        emptyAll: "当前 profile 还没有安装第三方插件",
        loading: "正在读取插件列表…",
        failed: "读取失败：{error}",
        retry: "重试",
        enable: "启用",
        disable: "停用",
        remove: "删除",
        on: "已启用",
        off: "已停用",
        client: "含界面",
        hostOnly: "仅 Host",
        deleteTitle: "删除插件",
        deleteBody: "将从 profile 依赖、bundles 与 node_modules 中移除 {name}，无法恢复。",
        deleteConfirm: "确认删除",
        cancel: "取消",
        working: "处理中…",
        profileLabel: "Profile",
      },
      en: {
        title: "Plugin manager",
        desc: "Review, enable, disable or remove plugins installed in the current profile.",
        tabAll: "All",
        tabEnabled: "Enabled",
        tabDisabled: "Disabled",
        statTotal: "{count} total",
        statEnabled: "{count} enabled",
        statDisabled: "{count} disabled",
        search: "Search name or description",
        refresh: "Refresh",
        empty: "No plugins match this filter",
        emptyAll: "No third-party plugins installed in this profile",
        loading: "Reading installed plugins…",
        failed: "Failed to load: {error}",
        retry: "Retry",
        enable: "Enable",
        disable: "Disable",
        remove: "Remove",
        on: "Enabled",
        off: "Disabled",
        client: "Has UI",
        hostOnly: "Host only",
        deleteTitle: "Remove plugin",
        deleteBody: "Removes {name} from the profile dependencies, bundles and node_modules. This cannot be undone.",
        deleteConfirm: "Remove",
        cancel: "Cancel",
        working: "Working…",
        profileLabel: "Profile",
      },
    };

    function detectLang() {
      var lang = "";
      try {
        lang = (document.documentElement.getAttribute("lang") || navigator.language || "").toLowerCase();
      } catch {
        lang = "";
      }
      return lang.indexOf("zh") === 0 ? "zh" : "en";
    }

    function makeT() {
      var lang = detectLang();
      var dict = DICT[lang] || DICT.en;
      return function t(key, vars) {
        var text = dict[key] != null ? dict[key] : DICT.en[key] != null ? DICT.en[key] : key;
        if (vars) {
          text = text.replace(/\{(\w+)\}/g, function (_m, name) {
            return vars[name] == null ? "" : String(vars[name]);
          });
        }
        return text;
      };
    }

    /* ---------- 样式 ---------- */

    var CSS = `
.dshpm-root{display:flex;flex-direction:column;gap:14px;font:13px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--dsh-text-primary,inherit);padding:2px 0 24px}
.dshpm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dshpm-title{font-size:16px;font-weight:600;margin:0}
.dshpm-desc{margin:2px 0 0;color:var(--dsh-text-secondary,rgba(127,127,127,.95));font-size:12px}
.dshpm-stats{display:flex;gap:8px;flex-wrap:wrap}
.dshpm-stat{padding:4px 10px;border-radius:999px;background:var(--dsh-surface-2,rgba(127,127,127,.1));font-size:12px;color:var(--dsh-text-secondary,rgba(127,127,127,.95))}
.dshpm-stat b{color:var(--dsh-text-primary,inherit);font-weight:600}
.dshpm-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dshpm-tabs{display:inline-flex;padding:3px;gap:2px;border-radius:8px;background:var(--dsh-surface-2,rgba(127,127,127,.1))}
.dshpm-tab{appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;padding:4px 12px;border-radius:6px;cursor:pointer;opacity:.72}
.dshpm-tab:hover{opacity:1}
.dshpm-tab[data-active="true"]{background:var(--dsh-surface-1,rgba(127,127,127,.22));opacity:1;font-weight:600}
.dshpm-search{flex:1 1 180px;min-width:140px;height:28px;padding:0 10px;border-radius:7px;border:1px solid var(--dsh-border,rgba(127,127,127,.28));background:transparent;color:inherit;font:inherit;font-size:12px;outline:none}
.dshpm-search:focus{border-color:var(--dsh-accent,#4d6bfe)}
.dshpm-btn{appearance:none;font:inherit;font-size:12px;height:28px;padding:0 12px;border-radius:7px;border:1px solid var(--dsh-border,rgba(127,127,127,.28));background:transparent;color:inherit;cursor:pointer}
.dshpm-btn:hover{background:var(--dsh-surface-2,rgba(127,127,127,.1))}
.dshpm-btn:disabled{opacity:.5;cursor:default}
.dshpm-group-title{font-size:12px;font-weight:600;color:var(--dsh-text-secondary,rgba(127,127,127,.95));margin:2px 0 0}
.dshpm-list{display:flex;flex-direction:column;border:1px solid var(--dsh-border,rgba(127,127,127,.22));border-radius:10px;overflow:hidden;background:var(--dsh-surface-1,rgba(127,127,127,.04))}
.dshpm-row{display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--dsh-border,rgba(127,127,127,.18))}
.dshpm-row:first-child{border-top:0}
.dshpm-row[data-off="true"]{opacity:.62}
.dshpm-avatar{width:30px;height:30px;flex:0 0 30px;border-radius:8px;display:grid;place-items:center;font-weight:600;font-size:13px;background:var(--dsh-surface-3,rgba(127,127,127,.18));color:var(--dsh-text-secondary,inherit);text-transform:uppercase}
.dshpm-main{flex:1 1 auto;min-width:0}
.dshpm-name{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-weight:600;font-size:13px;word-break:break-all}
.dshpm-chip{font-size:10px;font-weight:500;padding:1px 6px;border-radius:999px;background:var(--dsh-surface-3,rgba(127,127,127,.18));color:var(--dsh-text-secondary,inherit)}
.dshpm-chip[data-kind="on"]{background:rgba(46,160,67,.16);color:#2ea043}
.dshpm-sub{margin-top:2px;font-size:12px;color:var(--dsh-text-secondary,rgba(127,127,127,.95));overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dshpm-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.dshpm-del{appearance:none;border:0;background:transparent;color:var(--dsh-text-secondary,rgba(127,127,127,.95));font:inherit;font-size:12px;padding:4px 6px;border-radius:6px;cursor:pointer;opacity:0;transition:opacity .12s}
.dshpm-row:hover .dshpm-del,.dshpm-del:focus-visible{opacity:1}
.dshpm-del:hover{color:#e5534b;background:rgba(229,83,75,.12)}
.dshpm-switch{position:relative;width:34px;height:19px;border-radius:999px;border:0;cursor:pointer;background:rgba(127,127,127,.35);transition:background .15s;padding:0;flex:0 0 auto}
.dshpm-switch[data-on="true"]{background:#2ea043}
.dshpm-switch:disabled{opacity:.5;cursor:default}
.dshpm-knob{position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:transform .15s}
.dshpm-switch[data-on="true"] .dshpm-knob{transform:translateX(15px)}
.dshpm-empty{padding:36px 16px;text-align:center;color:var(--dsh-text-secondary,rgba(127,127,127,.95));font-size:12px}
.dshpm-error{margin:0;padding:12px 14px;border-radius:9px;background:rgba(229,83,75,.1);color:#e5534b;font-size:12px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.dshpm-mask{position:fixed;inset:0;background:rgba(0,0,0,.42);display:grid;place-items:center;z-index:60;padding:20px}
.dshpm-modal{width:min(400px,100%);border-radius:12px;background:var(--dsh-surface-1,#1f2023);border:1px solid var(--dsh-border,rgba(127,127,127,.3));padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.4);color:var(--dsh-text-primary,#eee)}
.dshpm-modal h3{margin:0 0 8px;font-size:14px}
.dshpm-modal p{margin:0 0 16px;font-size:12px;color:var(--dsh-text-secondary,rgba(200,200,200,.8));word-break:break-all}
.dshpm-modal-actions{display:flex;justify-content:flex-end;gap:8px}
.dshpm-danger{background:#e5534b;border-color:#e5534b;color:#fff}
.dshpm-danger:hover{background:#d1453d}
.dshpm-toast{position:sticky;bottom:8px;align-self:center;padding:7px 14px;border-radius:999px;background:var(--dsh-surface-1,#1f2023);border:1px solid var(--dsh-border,rgba(127,127,127,.3));font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.24)}
`;

    var styleInstalled = false;
    function ensureStyle() {
      if (styleInstalled) return;
      styleInstalled = true;
      try {
        var el = document.createElement("style");
        el.setAttribute("data-dsh-plugin-manager", "");
        el.textContent = CSS;
        document.head.appendChild(el);
      } catch {
        styleInstalled = false;
      }
    }

    /* ---------- HTTP ---------- */

    async function readState() {
      var res = await fetch(API + "/state", { headers: { accept: "application/json" }, cache: "no-store" });
      var payload = await res.json();
      if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || ("HTTP " + res.status));
      return payload.data;
    }

    async function mutate(action, body) {
      var res = await fetch(API + "/" + action, {
        method: "POST",
        headers: MUTATION_HEADERS,
        body: JSON.stringify(body),
      });
      var payload = await res.json();
      if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || ("HTTP " + res.status));
      return payload.data;
    }

    /* ---------- 组件 ---------- */

    function Avatar(props) {
      var letter = String(props.name || "?").replace(/^@/, "").charAt(0);
      return h("div", { className: "dshpm-avatar" }, letter);
    }

    function Switch(props) {
      return h(
        "button",
        {
          type: "button",
          className: "dshpm-switch",
          "data-on": props.checked ? "true" : "false",
          role: "switch",
          "aria-checked": props.checked ? "true" : "false",
          "aria-label": props.label,
          disabled: props.disabled,
          onClick: props.onClick,
        },
        h("span", { className: "dshpm-knob" })
      );
    }

    function Row(props) {
      var p = props.plugin;
      var t = props.t;
      return h(
        "div",
        { className: "dshpm-row", "data-off": p.enabled ? "false" : "true" },
        h(Avatar, { name: p.name }),
        h(
          "div",
          { className: "dshpm-main" },
          h(
            "div",
            { className: "dshpm-name" },
            p.name,
            h("span", { className: "dshpm-chip" }, "v" + p.version),
            h("span", { className: "dshpm-chip", "data-kind": p.enabled ? "on" : "off" }, p.enabled ? t("on") : t("off")),
            h("span", { className: "dshpm-chip" }, p.hasClient ? t("client") : t("hostOnly"))
          ),
          p.description ? h("div", { className: "dshpm-sub", title: p.description }, p.description) : null
        ),
        h(
          "div",
          { className: "dshpm-actions" },
          h(
            "button",
            {
              type: "button",
              className: "dshpm-del",
              title: t("remove") + " " + p.name,
              disabled: props.busy,
              onClick: function () {
                props.onRemove(p);
              },
            },
            t("remove")
          ),
          h(Switch, {
            checked: p.enabled,
            disabled: props.busy,
            label: (p.enabled ? t("disable") : t("enable")) + " " + p.name,
            onClick: function () {
              props.onToggle(p);
            },
          })
        )
      );
    }

    function ConfirmDialog(props) {
      var t = props.t;
      return h(
        "div",
        { className: "dshpm-mask", role: "presentation", onClick: props.onCancel },
        h(
          "div",
          {
            className: "dshpm-modal",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": t("deleteTitle"),
            onClick: function (event) {
              event.stopPropagation();
            },
          },
          h("h3", null, t("deleteTitle")),
          h("p", null, t("deleteBody", { name: props.plugin.name })),
          h(
            "div",
            { className: "dshpm-modal-actions" },
            h("button", { type: "button", className: "dshpm-btn", onClick: props.onCancel }, t("cancel")),
            h(
              "button",
              {
                type: "button",
                className: "dshpm-btn dshpm-danger",
                disabled: props.busy,
                onClick: props.onConfirm,
              },
              props.busy ? t("working") : t("deleteConfirm")
            )
          )
        )
      );
    }

    function Panel(props) {
      var t = (props && typeof props.t === "function" && props.t) || makeT();

      var stateHook = React.useState({ phase: "loading", data: null, error: "" });
      var state = stateHook[0];
      var setState = stateHook[1];

      var tabHook = React.useState("all");
      var tab = tabHook[0];
      var setTab = tabHook[1];

      var queryHook = React.useState("");
      var query = queryHook[0];
      var setQuery = queryHook[1];

      var busyHook = React.useState("");
      var busy = busyHook[0];
      var setBusy = busyHook[1];

      var pendingHook = React.useState(null);
      var pending = pendingHook[0];
      var setPending = pendingHook[1];

      var toastHook = React.useState("");
      var toast = toastHook[0];
      var setToast = toastHook[1];

      var alive = React.useRef(true);

      var load = React.useCallback(
        function () {
          return readState().then(
            function (data) {
              if (!alive.current) return;
              setState({ phase: "ready", data: data, error: "" });
            },
            function (error) {
              if (!alive.current) return;
              setState(function (prev) {
                return { phase: prev.data ? "ready" : "error", data: prev.data, error: String(error.message || error) };
              });
            }
          );
        },
        []
      );

      React.useEffect(
        function () {
          ensureStyle();
          alive.current = true;
          load();
          var timer = setInterval(load, 20000);
          return function () {
            alive.current = false;
            clearInterval(timer);
          };
        },
        [load]
      );

      React.useEffect(
        function () {
          if (!toast) return;
          var timer = setTimeout(function () {
            setToast("");
          }, 3200);
          return function () {
            clearTimeout(timer);
          };
        },
        [toast]
      );

      function afterMutation(name, message) {
        setBusy("");
        setToast(message || "");
        return load();
      }

      function onToggle(plugin) {
        if (busy) return;
        setBusy(plugin.name);
        mutate("toggle", { name: plugin.name, enabled: !plugin.enabled }).then(
          function (data) {
            return afterMutation(plugin.name, data && data.message);
          },
          function (error) {
            setBusy("");
            setToast(String(error.message || error));
          }
        );
      }

      function onRemove(plugin) {
        setPending(plugin);
      }

      function confirmRemove() {
        if (!pending || busy) return;
        var name = pending.name;
        setBusy(name);
        mutate("delete", { name: name }).then(
          function (data) {
            setPending(null);
            return afterMutation(name, data && data.message);
          },
          function (error) {
            setPending(null);
            setBusy("");
            setToast(String(error.message || error));
          }
        );
      }

      var data = state.data;
      var all = (data && data.plugins) || [];
      var list = all.filter(function (p) {
        if (tab === "enabled" && !p.enabled) return false;
        if (tab === "disabled" && p.enabled) return false;
        if (query) {
          var q = query.toLowerCase();
          return (p.name + " " + (p.description || "")).toLowerCase().indexOf(q) !== -1;
        }
        return true;
      });

      var children = [];

      children.push(
        h(
          "div",
          { className: "dshpm-head", key: "head" },
          h(
            "div",
            null,
            h("h2", { className: "dshpm-title" }, t("title")),
            h("p", { className: "dshpm-desc" }, t("desc"))
          ),
          data
            ? h(
                "div",
                { className: "dshpm-stats" },
                h("span", { className: "dshpm-stat" }, t("profileLabel") + " " + data.profile),
                h("span", { className: "dshpm-stat" }, t("statTotal", { count: data.total })),
                h("span", { className: "dshpm-stat" }, t("statEnabled", { count: data.enabled })),
                h("span", { className: "dshpm-stat" }, t("statDisabled", { count: data.disabled }))
              )
            : null
        )
      );

      children.push(
        h(
          "div",
          { className: "dshpm-toolbar", key: "toolbar" },
          h(
            "div",
            { className: "dshpm-tabs", role: "tablist" },
            [
              ["all", t("tabAll")],
              ["enabled", t("tabEnabled")],
              ["disabled", t("tabDisabled")],
            ].map(function (item) {
              return h(
                "button",
                {
                  key: item[0],
                  type: "button",
                  role: "tab",
                  className: "dshpm-tab",
                  "data-active": tab === item[0] ? "true" : "false",
                  "aria-selected": tab === item[0] ? "true" : "false",
                  onClick: function () {
                    setTab(item[0]);
                  },
                },
                item[1]
              );
            })
          ),
          h("input", {
            className: "dshpm-search",
            type: "search",
            placeholder: t("search"),
            value: query,
            onChange: function (event) {
              setQuery(event.target.value);
            },
          }),
          h(
            "button",
            {
              type: "button",
              className: "dshpm-btn",
              onClick: function () {
                load();
              },
            },
            t("refresh")
          )
        )
      );

      if (state.phase === "loading") {
        children.push(h("div", { className: "dshpm-empty", key: "loading" }, t("loading")));
      } else if (state.phase === "error") {
        children.push(
          h(
            "div",
            { className: "dshpm-error", key: "error" },
            h("span", null, t("failed", { error: state.error })),
            h(
              "button",
              {
                type: "button",
                className: "dshpm-btn",
                onClick: function () {
                  setState({ phase: "loading", data: null, error: "" });
                  load();
                },
              },
              t("retry")
            )
          )
        );
      } else if (!list.length) {
        children.push(h("div", { className: "dshpm-empty", key: "empty" }, all.length ? t("empty") : t("emptyAll")));
      } else {
        children.push(
          h(
            "div",
            { className: "dshpm-list", key: "list" },
            list.map(function (plugin) {
              return h(Row, {
                key: plugin.name,
                plugin: plugin,
                t: t,
                busy: busy === plugin.name,
                onToggle: onToggle,
                onRemove: onRemove,
              });
            })
          )
        );
      }

      if (toast) children.push(h("div", { className: "dshpm-toast", key: "toast" }, toast));
      if (pending) {
        children.push(
          h(ConfirmDialog, {
            key: "confirm",
            plugin: pending,
            t: t,
            busy: busy === pending.name,
            onCancel: function () {
              setPending(null);
            },
            onConfirm: confirmRemove,
          })
        );
      }

      return h("div", { className: "dshpm-root" }, children);
    }

    /* ---------- cordis 入口 ---------- */

    function apply(ctx) {
      ctx.effect(
        function () {
          // 该槽位由设置面板声明，必须先 inject 再 register，
          // 否则注册发生在槽位声明之前会被丢弃。
          var dispose = ctx.slots.inject("settings.section", function () {
            return ctx.slots.register(
              {
                name: "settings.section",
                id: NS,
                order: 26,
                label: function () {
                  return makeT()("title");
                },
              },
              Panel
            );
          });
          return typeof dispose === "function" ? dispose : function () {};
        },
        "dsh-plugin-manager: settings.section"
      );
    }

    module.exports.name = NS;
    module.exports.inject = ["slots"];
    module.exports.apply = apply;
    return module.exports;
  },
});
