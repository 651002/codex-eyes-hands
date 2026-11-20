export const OFFICIAL_FEATURES = [
    {
        id: 'terminal',
        label: '终端',
        package: '@deepseek-ai/dsh-experimental-terminal-bundle',
        warning: '为所有会话提供终端工具；不自动运行命令。'
    },
    {
        id: 'search',
        label: '会话搜索',
        package: '@deepseek-ai/dsh-experimental-session-search',
        warning: '按官方访问边界检索历史，不复制聊天数据库。'
    },
    {
        id: 'forge',
        label: 'Forge / 工作树',
        package: '@deepseek-ai/dsh-experimental-forge-bundle',
        warning: '管理Git工作树和PR；沿用官方归档清理设置。'
    },
    {
        id: 'titles',
        label: '自动标题',
        package: '@deepseek-ai/dsh-experimental-session-titles-bundle',
        warning: '会影响会话标题生成提供方，可能产生辅助模型调用。'
    }
];
export class FeatureManager {
    constructor({ manager, hostVersion, backup }){
        Object.assign(this, {
            manager,
            hostVersion,
            backup
        });
        this.pending = Promise.resolve();
    }
    async list() {
        const [bundles, plugins] = await Promise.all([
            this.manager.listBundles(),
            this.manager.listPlugins()
        ]);
        return OFFICIAL_FEATURES.map((f)=>{
            const b = bundles.find((x)=>x.name === f.package);
            const compatible = !!b && b.availability !== 'missing' && b.version === this.hostVersion && !b.error;
            const live = (b?.rows ?? []).map((r)=>plugins.find((p)=>p.entryId === r.entryId));
            const running = !!b?.enabled && live.length > 0 && live.every((r)=>r?.fiberPhase === 'active');
            return {
                ...f,
                hostVersion: this.hostVersion,
                version: b?.version ?? null,
                availability: b?.availability ?? 'missing',
                enabled: !!b?.enabled,
                compatible,
                status: !b || b.availability === 'missing' ? 'missing' : !compatible ? 'incompatible' : !b.enabled ? 'disabled' : running ? 'running' : 'selected-not-running',
                canEnable: compatible && !b?.readOnlyReason,
                reason: b?.error?.code ?? b?.readOnlyReason ?? (!compatible ? 'Requires the exact installed DSH version' : null)
            };
        });
    }
    async set(id, enabled) {
        const operation = async ()=>{
            if (typeof enabled !== 'boolean') throw Error('enabled 必须为布尔值');
            const row = (await this.list()).find((f)=>f.id === id);
            if (!row) throw Error('未知官方组件');
            if (enabled && !row.canEnable) throw Error('当前官方组件不可启用：' + row.status + '。不会自动安装或替换版本。');
            if (row.enabled === enabled) return {
                changed: false,
                application: row.status === 'running' ? 'applied' : 'unchanged',
                feature: row
            };
            await this.backup();
            const result = await this.manager.setBundleEnabled(row.package, enabled);
            if (result.application === 'failed' || result.error) throw Error('官方组件管理失败：' + (result.error?.code ?? 'unknown'));
            return {
                ...result,
                feature: (await this.list()).find((f)=>f.id === id)
            };
        };
        const r = this.pending.then(operation, operation);
        this.pending = r.catch(()=>{});
        return r;
    }
}
