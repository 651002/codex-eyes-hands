# 上下文插件兼容边界

核对日期：2026-11-21。目标：codex-eyes-hands 2.4.1，DSH 0.2.2-rc.5。测试实装版本billion-context 0.1.216、dsh-mnemon 0.5.50，不代表任意未来版本。

## 职责不重叠

- eyes-hands：新用户图片恢复为持久附件、只读识图、简短摘要；全文在本插件存储中，按会话查询。只扩展agent/pre-step和原生user-text/API/tool；不重写历史。
- billion-context：本机代码的llm/stream监听主要传请求归属，压缩由其网络链完成。其compaction gate通过internal/config关闭原生basic自动压缩，避免双重压缩。不能随意关gate或同时手动开第二套压缩。
- Mnemon：本机preStep先await next()再追加自身记忆指引；其summaryWithoutTransientMemory只按Mnemon来源清理瞬时记忆快照，不应抹掉普通用户图片摘要。MnemonCompactionEngine是可选Basic派生组件，不是本插件必需依赖。

## 已执行与未执行

已执行实装导出函数契约测试：billion消息归属id、请求槽id、文本投影后的媒体字节；Mnemon真实摘要过滤函数和createPluginMessage；记忆贡献在前/后均不改用户原话、不重复识图。主工具真实defineTool参数与会话隔离测试通过。测试未调用第三方apply，不启动压缩代理、网络模型或真实记忆写入。界面只核对启用状态，不把启用冒充长会话已验证。

未执行：真实模型压缩摘要质量、跨月连续运行、远程记忆Provider服务、真实OCR准确率，以及第三方所有组合配置。内部摘要chunk测试只用于固定实装版本的只读回归；若上游结构改动，测试须报错重审，生产代码从不导入该chunk。

## 恢复与限制

压缩可能省略图片id，因此新增codex_vision_details无id列表模式，list_offset翻页，按当前会话找回已存摘要，再读全文。不要求压缩器永远保留某个标记；没有自动全量注入图片全文。30天/约128份保留策略不变，过期不是压缩器故障；跨会话查询仍拒绝。

## 复现

常规npm test；实际DSH宿主npm run test:host。设置DSH_COMPAT_PROFILE为已安装两个插件的profile路径时，test:host额外运行3项实装兼容测试；未设置时明确skip，不假装已验证。测试目录、临时目录和隔离HOME均设到E盘，设置BILI_NATIVE_DSH=0及BILLION_CONTEXT_PLUGIN=0仅限子进程测试，不改真实DSH配置。

## 来源

- https://github.com/ranxianglei/billion-context （本机dsh-native.js、dsh-compaction-gate.js、dsh.bundle.patch.yml）
- https://github.com/omdsh-dev/dsh-mnemon （本机index.js、compaction.js、snapshot-compaction版本chunk）

远程文档读取本次未成功，结论以本机实际运行安装包为依据，不声称已核对GitHub最新代码。
