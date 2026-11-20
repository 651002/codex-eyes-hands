window.__ModuleLoader__.load({
    id: 'dsh-codex-eyes-hands',
    factory (require) {
        const React = require('react'), h = React.createElement;
        const words = {
            zh: {
                title: 'Codex 插件管理',
                pending: '项上游变化待复查',
                updates: '上游更新提醒',
                check: '立即检查',
                ack: '标记已读',
                auto: '自动检查',
                hours: '小时',
                save: '保存',
                features: '官方组件兼容检查',
                enable: '启用',
                disable: '停用',
                confirm: '此操作影响当前 DSH profile 的所有会话。会先备份配置，再调用官方开关；不会下载组件。是否继续？',
                loading: '正在读取…',
                failed: '读取失败',
                last: '上次成功检查',
                never: '尚未检查',
                scope: '只检查上游，不自动升级、执行脚本或合并代码。DSH 关闭时不运行。',
                period: '检查周期',
                terminal: '终端',
                search: '会话搜索',
                forge: 'Forge / 工作树',
                titles: '自动标题',
                running: '运行中',
                disabled: '未启用',
                missing: '缺少组件',
                incompatible: '版本不兼容',
                'selected-not-running': '已选择，未确认运行',
                refresh: '刷新状态',
                version: '版本',
                read: '查看变化',
                backup: '启停前自动备份',
                attention: '检查失败：',
                paused: '自动检查已关闭',
                restart: '配置已保存，需要重启 DSH 才会生效。',
                switched: '开关操作已处理，请以下方实际运行状态为准。'
            },
            en: {
                title: 'Codex plugin manager',
                pending: 'upstream changes to review',
                updates: 'Upstream update reminders',
                check: 'Check now',
                ack: 'Mark as read',
                auto: 'Automatic checks',
                hours: 'hours',
                save: 'Save',
                features: 'Official component compatibility',
                enable: 'Enable',
                disable: 'Disable',
                confirm: 'This affects all sessions in the DSH profile. Back up first, then use the official toggle; no packages will be downloaded. Continue?',
                loading: 'Loading…',
                failed: 'Read failed',
                last: 'Last successful check',
                never: 'Not checked yet',
                scope: 'Checks only. No automatic upgrades, scripts or code merges. Runs only while DSH is open.',
                period: 'Check interval',
                terminal: 'Terminal',
                search: 'Session search',
                forge: 'Forge / worktrees',
                titles: 'Automatic titles',
                running: 'Running',
                disabled: 'Disabled',
                missing: 'Missing',
                incompatible: 'Incompatible',
                'selected-not-running': 'Selected, runtime not confirmed',
                refresh: 'Refresh',
                version: 'Version',
                read: 'Review changes',
                backup: 'Backup before toggling',
                attention: 'Check failed: ',
                paused: 'Automatic checks paused',
                restart: 'Configuration saved. Restart DSH to apply it.',
                switched: 'Toggle processed. Check the actual runtime status below.'
            }
        };
        return {
            inject: [
                'slots',
                'connection',
                'locale'
            ],
            apply (ctx) {
                ctx.effect(()=>ctx.locale.register('codex-eyes-hands', words));
                const t = ctx.locale.bind('codex-eyes-hands');
                function Panel() {
                    React.useSyncExternalStore((cb)=>ctx.locale.subscribe(cb), ()=>ctx.locale.getSnapshot(), ()=>ctx.locale.getSnapshot());
                    const [state, setState] = React.useState(null), [full, setFull] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false), [hours, setHours] = React.useState('168'), [notice, setNotice] = React.useState('');
                    const call = async (endpoint, payload = {}, signal)=>{
                        const r = await ctx.connection.rpc.call('/codex-eyes-hands', endpoint, payload, signal);
                        if (!r.ok) throw Error(r.error.message);
                        return r.value;
                    };
                    const refresh = async (signal, details = false)=>{
                        try {
                            const value = await call(details ? 'status' : 'summary', {}, signal);
                            if (signal?.aborted) return;
                            if (details) {
                                setFull(value);
                                setState(value.updates);
                                setHours(String(value.updates.intervalHours));
                            } else setState(value);
                            setError('');
                        } catch (e) {
                            if (!signal?.aborted) setError(e.message);
                        }
                    };
                    React.useEffect(()=>{
                        const control = new AbortController();
                        let timeout, stopped = false;
                        const poll = async ()=>{
                            await refresh(control.signal);
                            if (!stopped) timeout = setTimeout(poll, 60000);
                        };
                        poll();
                        return ()=>{
                            stopped = true;
                            clearTimeout(timeout);
                            control.abort();
                        };
                    }, []);
                    const act = async (endpoint, payload)=>{
                        setBusy(true);
                        setError('');
                        setNotice('');
                        try {
                            const result = await call(endpoint, payload);
                            if (endpoint === 'features/set') setNotice(t(result.application === 'restart-required' ? 'restart' : 'switched'));
                            await refresh(undefined, true);
                        } catch (e) {
                            setError(e.message);
                        } finally{
                            setBusy(false);
                        }
                    };
                    const pending = state?.notices?.filter((n)=>!n.acknowledged) || [];
                    const button = (label, action, disabled = false)=>h('button', {
                            type: 'button',
                            disabled: busy || disabled,
                            onClick: action,
                            style: {
                                color: 'inherit',
                                background: 'transparent',
                                border: '1px solid currentColor',
                                borderRadius: 6,
                                padding: '4px 8px',
                                cursor: 'pointer'
                            }
                        }, label);
                    return h('details', {
                        style: {
                            fontSize: 12,
                            color: 'var(--dsw-alias-text-primary, inherit)',
                            padding: '5px 8px',
                            overflowWrap: 'anywhere'
                        },
                        onToggle: (e)=>{
                            if (e.currentTarget.open) refresh(undefined, true);
                        }
                    }, h('summary', {
                        'aria-label': t('title'),
                        style: {
                            cursor: 'pointer'
                        }
                    }, t('title'), pending.length ? ' · ' + pending.length + ' ' + t('pending') : state?.failures >= 3 ? ' · !' : ''), h('div', {
                        style: {
                            padding: '8px 0',
                            display: 'grid',
                            gap: 10
                        }
                    }, notice && h('div', {role: 'status'}, notice), error && h('div', {
                        role: 'alert'
                    }, t('failed') + ': ' + error), h('strong', null, t('updates')), !state ? h('span', null, t('loading')) : h(React.Fragment, null, h('div', null, t('last') + ': ' + (state.lastSuccess ? new Date(state.lastSuccess).toLocaleString() : t('never'))), state.lastError && h('div', {
                        role: 'status'
                    }, t('attention') + state.lastError), h('label', null, h('input', {
                        type: 'checkbox',
                        checked: state.enabled,
                        disabled: busy,
                        onChange: (e)=>act('updates/settings', {
                                enabled: e.target.checked,
                                intervalHours: state.intervalHours
                            })
                    }), ' ' + t('auto')), h('label', null, t('period') + ' ', h('input', {
                        type: 'number',
                        min: 1,
                        max: 720,
                        value: hours,
                        disabled: busy,
                        onChange: (e)=>setHours(e.target.value),
                        style: {
                            width: 65
                        }
                    }), ' ' + t('hours') + ' ', button(t('save'), ()=>act('updates/settings', {
                            enabled: state.enabled,
                            intervalHours: Number(hours)
                        }))), h('div', {
                        style: {
                            display: 'flex',
                            gap: 8
                        }
                    }, button(t('check'), ()=>act('updates/check', {})), button(t('ack'), ()=>act('updates/acknowledge', {}), pending.length === 0)), h('small', null, t('scope')), ...pending.map((n)=>h('div', {
                            key: n.id,
                            role: 'status'
                        }, h('strong', null, n.repo + ' · ' + (n.release || '') + ' / ' + n.head.slice(0, 8)), h('div', null, n.reason), n.files?.length ? h('ul', null, ...n.files.map((file)=>h('li', {
                                key: file
                            }, file))) : null, h('a', {
                            href: n.url,
                            target: '_blank',
                            rel: 'noopener noreferrer'
                        }, t('read'))))), h('strong', null, t('features')), h('small', null, t('backup')), button(t('refresh'), ()=>refresh(undefined, true)), ...(full?.features || []).map((f)=>h('div', {
                            key: f.id,
                            style: {
                                display: 'flex',
                                gap: 8,
                                alignItems: 'center',
                                flexWrap: 'wrap'
                            }
                        }, h('span', null, t(f.id) + ' · ' + t(f.status) + ' · ' + t('version') + ' ' + (f.version || '—')), button(t(f.enabled ? 'disable' : 'enable'), ()=>{
                            if (window.confirm(t('confirm') + '\n' + t(f.id))) act('features/set', {
                                id: f.id,
                                enabled: !f.enabled
                            });
                        }, !f.enabled && !f.canEnable), f.reason && h('small', null, f.reason)))));
                }
                ctx.slots.inject('conversation.composer.dock', ()=>ctx.slots.register({
                        name: 'conversation.composer.dock',
                        id: 'codex-eyes-hands-maintenance',
                        order: 80
                    }, Panel));
            }
        };
    }
});
