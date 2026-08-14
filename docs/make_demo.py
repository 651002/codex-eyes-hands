# Generate docs/demo.gif — animated flow demo: 发图 → codex 分析 → 回答
from PIL import Image, ImageDraw, ImageFont
import textwrap

W, H = 900, 560
BG = "#0f172a"
PANEL = "#1e293b"
BORDER = "#334155"
CYAN = "#22d3ee"
EMERALD = "#34d399"
VIOLET = "#a78bfa"
AMBER = "#fbbf24"
WHITE = "#e2e8f0"
GRAY = "#94a3b8"

F = lambda s: ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", s)
F_BOLD = lambda s: ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", s)

def base(tag):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 56], fill="#0b1220")
    d.text((28, 16), "codex-bridge 演示 · DeepSeek Harness × Codex CLI", font=F_BOLD(18), fill=WHITE)
    d.text((W - 90, 20), tag, font=F_BOLD(16), fill=CYAN)
    return img, d

def panel(d, x, y, w, h, title, color, body_lines, font=14, line_gap=24):
    d.rounded_rectangle([x, y, x + w, y + h], radius=10, fill=PANEL, outline=BORDER, width=2)
    d.text((x + 20, y + 14), title, font=F_BOLD(15), fill=color)
    yy = y + 48
    for ln in body_lines:
        d.text((x + 20, yy), ln, font=F(font), fill=WHITE if not ln.startswith("·") else GRAY)
        yy += line_gap

def arrow(d, x1, y, x2, color):
    d.line([x1, y, x2, y], fill=color, width=4)
    d.polygon([(x2, y), (x2 - 14, y - 8), (x2 - 14, y + 8)], fill=color)

def v_arrow(d, x, y1, y2, color):
    d.line([x, y1, x, y2], fill=color, width=4)
    d.polygon([(x, y2), (x - 8, y2 - 14), (x + 8, y2 - 14)], fill=color)

def footer(d, text):
    d.text((28, H - 30), text, font=F(13), fill="#64748b")

frames = []

# ---- frame 1: user sends image ----
img, d = base("1/4")
panel(d, 60, 90, 380, 330, "① 用户在 DeepSeek Harness Web 发来一张图片", CYAN,
      ["· 模型是 DeepSeek-V4-Pro（纯文本，看不了图）", "· 网关不再拒绝：图片落地成文件", "· 绝对路径以文本注入 agent 消息", "", "本地文件绝对路径:", "C:\\Users\\...\\Temp\\dsh-incoming-images\\", "  e1da3f41-...png"])
# thumbnail image
d.rounded_rectangle([520, 120, 780, 300], radius=10, fill="white")
d.text((560, 190), "HELLO", font=F_BOLD(44), fill="#111827")
d.text((560, 250), "DSH", font=F_BOLD(44), fill="#111827")
d.text((520, 316), "用户发送的截图", font=F(13), fill=GRAY)
arrow(d, 460, 210, 500, CYAN)
footer(d, "网关补丁（patches/dsh-image-gateway.md）：图片落地 + 路径文本")
frames.append(img)

# ---- frame 2: bridge calls codex ----
img, d = base("2/4")
panel(d, 60, 90, 780, 150, "② agent 调 bridge.js 的 see 模式", EMERALD,
      ["$ node bridge.js see C:\\...\\e1da3f41-....png --ask \"图里写了什么\"", "· 主通道：codex exec -i <图> （gpt-5.6-sol，默认 ultra 思考强度）", "· 失败自动切备用通道 claude-sonnet-5（--backup auto）"], font=13)
panel(d, 60, 270, 780, 150, "codex 正在分析…", AMBER,
      ["· 挂图 → 本地中转 → 模型看图", "· 事件流实时可见（监督者模式 watch 同理）"], font=13)
v_arrow(d, 320, 240, 270, EMERALD)
footer(d, "一条命令搞定：引号 / 编码 / 临时文件由脚本处理")
frames.append(img)

# ---- frame 3: codex returns text ----
img, d = base("3/4")
panel(d, 60, 90, 780, 330, "③ Codex 返回文字结果（UTF-8 读回）", VIOLET,
      ["画面是一张白底图片，中央用黑色粗体写着：", "", "    HELLO", "    DSH", "", "· 纯文本模型拿到了「文字化」的图片内容", "· 脚本自动记录会话号（供 ask 追问复用）"], font=14)
v_arrow(d, 480, 420, 450, VIOLET)
footer(d, "结果文件写入 %TEMP% → 脚本读回并清理")
frames.append(img)

# ---- frame 4: agent answers ----
img, d = base("4/4")
panel(d, 60, 90, 780, 220, "④ Agent 基于文字继续推理并回答用户", CYAN,
      ["「图里写的是 HELLO DSH——白底黑字的测试图片。」", "", "分工：Codex = 眼睛和手，Agent = 大脑", "· 翻译 / 总结 / 追问 / 监督纠正 都由 agent 完成"], font=15)
d.rounded_rectangle([60, 340, 780, 440], radius=10, fill="#0b1220", outline=EMERALD, width=2)
d.text((80, 358), "✔ 全流程闭环：发图 → 落地文件 → codex 看图 → 文字回流 → 回答", font=F_BOLD(15), fill=EMERALD)
d.text((80, 390), "  能力：see / read / ask / gen / watch / shot / fetch / search / type · 双通道容灾", font=F(13), fill=GRAY)
footer(d, "详见 README 与 SKILL.md")
frames.append(img)

frames[0].save(
    "E:/deepseek/codex-bridge-repo/docs/demo.gif",
    save_all=True, append_images=frames[1:], duration=1400, loop=0,
)
print("demo.gif written:", len(frames), "frames")
