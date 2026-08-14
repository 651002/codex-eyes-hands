# Generate docs/demo-step-1..4.png — 4 张静态演示图（@2x 高清渲染）
from PIL import Image, ImageDraw, ImageFont

S = 2                      # 渲染倍率：2x 高清
W, H = 900, 560            # 设计尺寸（逻辑像素）

def s(n):
    return int(n * S)

BG = "#0f172a"
PANEL = "#1e293b"
BORDER = "#334155"
CYAN = "#22d3ee"
EMERALD = "#34d399"
VIOLET = "#a78bfa"
AMBER = "#fbbf24"
WHITE = "#f1f5f9"
GRAY = "#cbd5e1"
DIM = "#94a3b8"

F = lambda size: ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", s(size))
F_BOLD = lambda size: ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", s(size))

def base(tag):
    img = Image.new("RGB", (s(W), s(H)), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, s(W), s(60)], fill="#0b1220")
    d.text((s(28), s(16)), "codex-bridge 演示 · DeepSeek Harness × Codex CLI", font=F_BOLD(19), fill=WHITE)
    d.text((s(W - 175), s(20)), tag, font=F_BOLD(17), fill=CYAN)
    return img, d

def panel(d, x, y, w, h, title, color, body_lines, font=15, line_gap=28):
    d.rounded_rectangle([s(x), s(y), s(x + w), s(y + h)], radius=s(10), fill=PANEL, outline=BORDER, width=s(2))
    d.text((s(x + 20), s(y + 16)), title, font=F_BOLD(16), fill=color)
    yy = y + 56
    for ln in body_lines:
        d.text((s(x + 20), s(yy)), ln, font=F(font), fill=WHITE if not ln.startswith("·") else GRAY)
        yy += line_gap

def arrow(d, x1, y, x2, color):
    d.line([s(x1), s(y), s(x2), s(y)], fill=color, width=s(4))
    d.polygon([(s(x2), s(y)), (s(x2 - 14), s(y - 8)), (s(x2 - 14), s(y + 8))], fill=color)

def v_arrow(d, x, y1, y2, color):
    d.line([s(x), s(y1), s(x), s(y2)], fill=color, width=s(4))
    d.polygon([(s(x), s(y2)), (s(x - 8), s(y2 - 14)), (s(x + 8), s(y2 - 14))], fill=color)

def footer(d, text):
    d.text((s(28), s(H - 34)), text, font=F(14), fill=DIM)

frames = []

# ---- ① 用户发图 ----
img, d = base("第 1/4 步")
panel(d, 60, 92, 380, 320, "① 用户在 DeepSeek Harness Web 发来一张图片", CYAN,
      ["· 模型是 DeepSeek-V4-Pro（纯文本，看不了图）", "· 网关不再拒绝：图片落地成文件", "· 绝对路径以文本注入 Agent 消息", "", "本地文件绝对路径:", "C:\\Users\\...\\Temp\\dsh-incoming-images\\", "  e1da3f41-...png"], font=15, line_gap=30)
d.rounded_rectangle([s(520), s(130), s(780), s(300)], radius=s(10), fill="white")
d.text((s(580), s(168)), "HELLO", font=F_BOLD(42), fill="#111827")
d.text((s(580), s(232)), "DSH", font=F_BOLD(42), fill="#111827")
d.text((s(600), s(316)), "用户发送的截图", font=F(14), fill=GRAY)
arrow(d, 460, 215, 500, CYAN)
footer(d, "解法：网关补丁 patches/dsh-image-gateway.md（一键脚本 apply-dsh-gateway-patch.js）")
frames.append(img)

# ---- ② Codex 分析 ----
img, d = base("第 2/4 步")
panel(d, 60, 92, 780, 150, "② Agent 调 bridge.js 的 see 模式", EMERALD,
      ["$ node bridge.js see C:\\...\\e1da3f41-....png --ask \"图里写了什么\"", "· 主通道：codex exec -i <图>（gpt-5.6-sol，默认 ultra 思考强度）", "· 失败自动切备用通道 claude-sonnet-5（--backup auto）"], font=15, line_gap=30)
panel(d, 60, 268, 780, 150, "Codex 正在分析…", AMBER,
      ["· 挂图 → 本地中转 → 模型看图", "· 事件流实时可见（监督者模式 watch 同理）"], font=15, line_gap=30)
v_arrow(d, 320, 242, 268, EMERALD)
footer(d, "一条命令搞定：引号 / 编码 / 临时文件由脚本处理")
frames.append(img)

# ---- ③ 文字回流 ----
img, d = base("第 3/4 步")
panel(d, 60, 92, 780, 330, "③ Codex 返回文字结果（UTF-8 读回）", VIOLET,
      ["画面是一张白底图片，中央用黑色粗体写着：", "", "    HELLO", "    DSH", "", "· 纯文本模型拿到了「文字化」的图片内容", "· 脚本自动记录会话号（供 ask 追问复用）"], font=16, line_gap=30)
v_arrow(d, 480, 422, 452, VIOLET)
footer(d, "结果写入 %TEMP% → 脚本读回并清理")
frames.append(img)

# ---- ④ Agent 回答 ----
img, d = base("第 4/4 步")
panel(d, 60, 92, 780, 210, "④ Agent 基于文字继续推理并回答用户", CYAN,
      ["「图里写的是 HELLO DSH——白底黑字的测试图片。」", "", "分工：Codex = 眼睛和手，Agent = 大脑", "· 翻译 / 总结 / 追问 / 监督纠正 都由 Agent 完成"], font=16, line_gap=30)
d.rounded_rectangle([s(60), s(330), s(780), s(470)], radius=s(10), fill="#0b1220", outline=EMERALD, width=s(2))
d.text((s(80), s(348)), "✅ 全流程闭环", font=F_BOLD(16), fill=EMERALD)
d.text((s(80), s(384)), "发图 → 落地文件 → Codex 看图 → 文字回流 → 回答", font=F(15), fill=WHITE)
d.text((s(80), s(416)), "能力：see · read · ask · gen · watch · shot", font=F(14), fill=GRAY)
d.text((s(80), s(446)), "fetch · search · type · key　·　双通道容灾", font=F(14), fill=GRAY)
footer(d, "详见 README 与 SKILL.md")
frames.append(img)

names = ["demo-step-1.png", "demo-step-2.png", "demo-step-3.png", "demo-step-4.png"]
for i, fr in enumerate(frames):
    out = "E:/deepseek/codex-bridge-repo/docs/" + names[i]
    fr.save(out)
    print("saved", out, fr.size)
