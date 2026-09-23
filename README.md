# PHASE ECHO · 相位残影

原创浏览器竞技场 FPS（Three.js）。在霓虹竞技场 ECHO-7 中存活十波并击败首领 RESONATOR PRIME。

核心机制：相位能量充满后按 **Q**，你会被拉回 3 秒前的位置，并恢复这 3 秒内损失生命的一半；一个“过去的你”会重演刚才 3 秒的走位和每一发射击（65% 伤害），吸引敌人火力，最后坍缩、吸住并炸开周围的敌人。

## 运行

```
npm install
npm run dev      # http://localhost:5190
```

## Cloudflare Pages 部署

仓库已包含静态构建脚本和 `wrangler.toml`：

```bash
npm ci
npm run build    # 输出到 dist/
npx wrangler pages deploy dist --project-name phase-echo
```

在 Cloudflare Pages 连接 Git 仓库时，将构建命令设为 `npm run build`，构建输出目录设为 `dist`。

需要支持 WebGL2 的桌面浏览器和键鼠。请用本地服务打开，不要直接双击 `file://`。

## 操作

| 按键 | 动作 |
| --- | --- |
| W A S D | 移动 |
| 鼠标 / 左键 / 右键 | 瞄准 / 射击 / 精确瞄准 |
| 空格 | 跳跃 |
| Shift | 冲刺（2 次充能） |
| 1 2 3 / 滚轮 | 切换武器 |
| R | 换弹 |
| Q | 相位残影 |
| Esc / P | 暂停 |

## 测试

```
npm test                        # 语法检查 + 8 组规则测试（含机器人无头打通整局）
node tests/browser/smoke.mjs    # Playwright 冒烟（PLAYWRIGHT_MODULE 可指向已有安装，GPU=1 使用显卡）
```

设计、架构与验证记录见 `docs/mcp-phase-echo-design.md`。
