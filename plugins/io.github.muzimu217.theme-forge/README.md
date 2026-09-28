# Theme Forge

An **AI theme workbench** for PI-Desktop: describe the look you want in one sentence, and the agent generates theme CSS and applies it to the whole app **live** — instant preview, iterate on feedback, export the CSS when you're satisfied.

```
你：换个暖色调的主题，橙色点缀，别太刺眼
         │
         ▼
   agent 生成主题 CSS（变量覆盖，叠在明/暗底色上）
         │
         ▼
   theme_forge.apply ──► pi.themes.upsert（宿主消毒终审）
         │                       │
         ▼                       ▼
   pi.app.setTheme ──► 整个应用实时换肤，无需重启
         │
         ▼
   「标题再亮一点」→ 同名重投即更新 ──► 满意后 export 导出 CSS
```

## The `theme_forge` agent tool

| action | 作用 |
|---|---|
| `apply` | 生成/更新主题并实时应用（`css` + `label` + `base`[light/dark] + `activate`，默认 true） |
| `list` | 列出工坊主题 |
| `remove` | 移除指定主题 |
| `reset` | 一键恢复系统主题 |
| `export` | 把主题 CSS 复制到剪贴板 |

## 安全模型

- 权限最小集：`ui.theme` + `agent.tool.register` + `clipboard.write`。**零出网、零文件访问**。
- 插件只能操作挂在自己 id 下的主题（`plugin:io.github.muzimu217.theme-forge:*`）。
- 所有 CSS 经宿主主题消毒器终审（256KB 上限、拒绝 `url()`/`@import`）；工具侧预检先行，报错可读。
- 只改变应用外观；`reset` 随时恢复系统主题。

## 模型要求

无特殊要求——任何能写 CSS 的模型即可（不需要视觉能力）。

## Roadmap

- v0.2：预览面板（主题画廊 + 变量滑杆）、从截图生成主题（配合 Vision Kit）、主题分享格式。
- v0.3：种子模板库（明/暗各若干预设起步）。

## License

MIT
