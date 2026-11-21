# dsh-plugin-manager

在 DeepSeek Harness (DSH) 里管理**已下载的插件**：查看列表、启用、停用、删除。
安装方式与插件市场的插件完全一致（npm 包 + `dsh.profile.bundles` 挂载 + `dsh.client` 浏览器端），
装上后会出现在 DSH 的「插件」页，在「设置」里多一个**插件管理**页，并可以在对话中直接调用管理工具。

## 安装

直接从 GitHub 装进 profile（浏览器 UI 一般是 `web`）：

```powershell
dsh plugin --profile web add github:zcx-zg/dsh-plugin-manager
```

装完重启 DSH，插件会自动挂载（`cordis.patch.yml` 负责这一层）。

开发或离线环境也可以走本地目录 / tgz：

```powershell
# 本地目录，改完不用重新打包
dsh plugin --profile web add .\dsh-plugin-manager

# 或先打包再安装
npm pack
dsh plugin --profile web add .\dsh-plugin-manager-0.2.0.tgz
```

卸载：

```powershell
dsh plugin --profile web remove dsh-plugin-manager
```

## 权限与兼容性

| 项 | 说明 |
| --- | --- |
| 文件访问 | 读写 profile 目录下的 `package.json` 与 `node_modules`（启用/停用/删除插件） |
| 删除行为 | 删除插件会移除依赖声明与 `node_modules` 目录，不可撤销；调用前经 DSH 审批 |
| 网络 | 无。插件本身不发起任何外部请求，数据不出本机 |
| DSH 版本 | `>=0.2.2-rc.1 <0.3.0-0` |
| Node | `^22.19.0 \|\| >=24.0.0` |
| 界面 | 需要 `web` profile（注册 `settings.section` 槽位） |

## 界面

浏览器端 `lib/client.js` 通过 `ctx.slots.register({ name: "settings.section" })` 注册一个
**插件管理**设置页，布局与「技能」页一致：

- 标题 + 说明，右上角统计（profile / 总数 / 已启用 / 已停用）
- 分段页签：全部 / 已启用 / 已停用
- 搜索框 + 刷新
- 插件行：首字母图标、包名、版本、状态、`含界面`/`仅 Host` 标签、说明、开关、删除
- 删除前弹出确认框；操作结果以 toast 反馈

开关直接写 profile 的 `dsh.profile.bundles`，删除同时清掉 `node_modules` 目录，
二者与「插件」页管理的是同一份数据。

## 模型可调用的工具

| 工具 | 作用 |
| --- | --- |
| `list_dsh_plugins` | 列出已安装插件，支持关键词与启用状态过滤 |
| `enable_dsh_plugin` | 启用插件（写入 `dsh.profile.bundles`） |
| `disable_dsh_plugin` | 停用插件（从 bundles 移除，保留文件，可随时恢复） |
| `delete_dsh_plugin` | 彻底删除插件（依赖 + bundles + node_modules），调用前会弹审批 |

对话示例：

- “我现在装了哪些插件？”
- “把 dsh-better-sidebar 停用”
- “删除 dsh-plugin-wallpaper-engine”

## Web 接口

插件同时注册了三条路由，供后续面板或脚本复用（读的是同一份 profile 数据）：

```
GET  /api/dsh-plugin-manager/state
POST /api/dsh-plugin-manager/toggle   { "name": "...", "enabled": false }
POST /api/dsh-plugin-manager/delete   { "name": "..." }
```

写操作要求请求头 `x-dsh-plugin-manager: 1` 且 `content-type: application/json`。

## 配置

在 DSH 的「插件」页打开本插件详情即可编辑（宿主 `plugins.bundle.config` 槽位）：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `profile` | `web` | 管理哪个 profile |
| `dshHome` | `~/.dsh` | DSH 数据目录 |
| `allowDelete` | `true` | 设为 `false` 时禁止删除插件 |

## 实现说明

- 插件列表 = profile `package.json` 的 `dependencies`，启用状态 = `dsh.profile.bundles` 是否包含该项，与 DSH「插件」页同源。
- 启用/停用只改 `bundles`，属于可逆操作；删除才会动依赖和文件。
- 所有写操作都会保留 `package.json` 原有缩进风格（2 空格）与其余字段。
- `delete_dsh_plugin` 通过 `tools/pre-execute` 接入 DSH 审批，模型不能静默删插件。
- 浏览器端按 DSH 客户端模块约定用 `window.__ModuleLoader__.load({ id, factory })` 包装；
  `package.json` 的 `dsh.client`（`platform: "web"`）与 `exports["./client"]` 让 DSH 自动加载它。
