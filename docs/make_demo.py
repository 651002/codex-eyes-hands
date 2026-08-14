# Generate docs/demo.gif — animated flow demo: 发图 → codex 分析 → 回答
from PIL import Image, ImageDraw, ImageFont

W, H = 900, 560
BG = "#0f172a"
PANEL = "#1e293b"
BORDER = "#334155"
CYAN = "#22d3ee"
EMERALD = "#34d399"
VIOLET = "#a78bfa"
AMBER = "#fbbf24"
WHITE = "#f1f5f9"
GRAY = "#cbd5e1"      # 比之前更亮，提高可读性
DIM = "#94a3b8"

F = lambda s: ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", s)
F_BOLD = lambda s: ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", s)

def base(tag):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 60], fill="#0b1220")
    d.text((28, 16), "codex-bridge 演示 · DeepSeek Harness × Codex CLI", font=F_BOLD(19), fill=WHITE)
    d.text((W - 170, 20), tag, font=F_BOLD(17), fill=CYAN)
    return img, d

def panel(d, x, y, w, h, title, color, body_lines, font=15, line_gap=28):
    d.rounded_rectangle([x, y, x + w, y + h], radius=10, fill=PANEL, outline=BORDER, width=2)
    d.text((x + 20, y + 16), title, font=F_BOLD(16), fill=color)
    yy = y + 56
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
    d.text((28, H - 34), text, font=F(14), fill=DIM)

frames = []

# ---- frame 1: user sends image ----
img, d = base("第 1/4 步")
panel(d, 60, 92, 380, 320, "① 用户在 DeepSeek Harness Web 发来一张图片", CYAN,
      ["· 模型是 DeepSeek-V4-Pro（纯文本，看不了图）", "· 网关不再拒绝：图片落地成文件", "· 绝对路径以文本注入 Agent 消息", "", "本地文件绝对路径:", "C:\\Users\\...\\Temp\\dsh-incoming-images\\", "  e1da3f41-...png"], font=15, line_gap=30)
d.rounded_rectangle([520, 130, 780, 300], radius=10, fill="white")
d.text((575, 185), "HELLO", font=F_BOLD(42), fill="#111827")
d.text((575, 245), "DSH", font=F_BOLD(42), fill="#111827")
d.text((560, 316), "用户发送的截图", font=F(14), fill=GRAY)
arrow(d, 460, 215, 500, CYAN)
footer(d, "解法：网关补丁 patches/dsh-image-gateway.md（一键脚本 apply-dsh-gateway-patch.js）")
frames.append(img)

# ---- frame 2: bridge calls codex ----
img, d = base("第 2/4 步")
panel(d, 60, 92, 780, 150, "② Agent 调 bridge.js 的 see 模式", EMERALD,
      ["$ node bridge.js see C:\\...\\e1da3f41-....png --ask \"图里写了什么\"", "· 主通道：codex exec -i <图>（gpt-5.6-sol，默认 ultra 思考强度）", "· 失败自动切备用通道 claude-sonnet-5（--backup auto）"], font=15, line_gap=30)
panel(d, 60, 268, 780, 150, "Codex 正在分析…", AMBER,
      ["· 挂图 → 本地中转 → 模型看图", "· 事件流实时可见（监督者模式 watch 同理）"], font=15, line_gap=30)
v_arrow(d, 320, 242, 268, EMERALD)
footer(d, "一条命令搞定：引号 / 编码 / 临时文件由脚本处理")
frames.append(img)

# ---- frame 3: codex returns text ----
img, d = base("第 3/4 步")
panel(d, 60, 92, 780, 330, "③ Codex 返回文字结果（UTF-8 读回）", VIOLET,
      ["画面是一张白底图片，中央用黑色粗体写着：", "", "    HELLO", "    DSH", "", "· 纯文本模型拿到了「文字化」的图片内容", "· 脚本自动记录会话号（供 ask 追问复用）"], font=16, line_gap=30)
v_arrow(d, 480, 422, 452, VIOLET)
footer(d, "结果写入 %TEMP% → 脚本读回并清理")
frames.append(img)

# ---- frame 4: agent answers ----
img, d = base("第 4/4 步")
panel(d, 60, 92, 780, 210, "④ Agent 基于文字继续推理并回答用户", CYAN,
      ["「图里写的是 HELLO DSH——白底黑字的测试图片。」", "", "分工：Codex = 眼睛和手，Agent = 大脑", "· 翻译 / 总结 / 追问 / 监督纠正 都由 Agent 完成"], font=16, line_gap=30)
d.rounded_rectangle([60, 330, 780, 460], radius=10, fill="#0b1220", outline=EMERALD, width=2)
d.text((80, 348), "✅ 全流程闭环", font=F_BOLD(16), fill=EMERALD)
d.text((80, 384), "发图 → 落地文件 → Codex 看图 → 文字回流 → 回答", font=F(15), fill=WHITE)
d.text((80, 418), "能力：see · read · ask · gen · watch · shot · fetch · search · type　·　双通道容灾", font=F(14), fill=GRAY)
footer(d, "详见 README 与 SKILL.md")
frames.append(img)

frames[0].save(
    "E:/deepseek/codex-bridge-repo/docs/demo.gif",
    save_all=True, append_images=frames[1:], duration=1800, loop=0,
)
print("demo.gif written:", len(frames), "frames")
