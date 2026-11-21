window.__ModuleLoader__.load({id:'dsh-codex-eyes-hands',factory(require){
const React=require('react'),h=React.createElement,PANEL='codex-eyes-hands';
const words={
    "zh": {
        "title": "codex-eyes-hands",
        "pending": "待复查变化",
        "updates": "上游更新提醒",
        "check": "立即检查",
        "ack": "标记已读",
        "auto": "自动检查",
        "hours": "小时",
        "save": "保存",
        "loading": "正在读取…",
        "failed": "读取失败",
        "last": "上次成功检查",
        "never": "尚未检查",
        "scope": "只检查上游，不自动升级、执行脚本或合并代码。DSH 关闭时不运行。",
        "period": "检查周期",
        "running": "运行中",
        "disabled": "未启用",
        "missing": "缺少组件",
        "incompatible": "版本不兼容",
        "selected-not-running": "已选择，未确认运行",
        "refresh": "刷新状态",
        "version": "插件版本",
        "read": "查看变化",
        "attention": "检查失败：",
        "paused": "自动检查已关闭",
        "subtitle": "Codex 能力与上游提醒",
        "settings": "插件设置",
        "active": "更新检查",
        "guide": "Codex 能力入口",
        "safety": "安全与运行边界",
        "noTask": "按需调用",
        "empty": "暂时没有待复查的上游变化",
        "safetyText": "默认 workspace-write，不静默放宽权限；识图与电脑操作分开。检查状态不调用模型。电脑操作依赖已有 Codex 工具。",
        "noFake": "只展示实际状态，不编造 Token、费用或成功率。",
        "processed": "操作已处理，请以上次成功检查时间为准。",
        "nativeBoundary": "DSH 的原生功能由官方设置管理，本插件不内置、不接管。",
        "doctor": "入口检查（不调用模型）",
        "see": "识图 / OCR",
        "task": "任务委派",
        "enabled": "自动检查已开启"
    },
    "en": {
        "title": "codex-eyes-hands",
        "pending": "Changes to review",
        "updates": "Upstream update reminders",
        "check": "Check now",
        "ack": "Mark as read",
        "auto": "Automatic checks",
        "hours": "hours",
        "save": "Save",
        "loading": "Loading…",
        "failed": "Read failed",
        "last": "Last successful check",
        "never": "Not checked yet",
        "scope": "Checks only. No automatic upgrades, scripts or code merges. Runs only while DSH is open.",
        "period": "Check interval",
        "running": "Running",
        "disabled": "Disabled",
        "missing": "Missing",
        "incompatible": "Incompatible",
        "selected-not-running": "Selected, runtime not confirmed",
        "refresh": "Refresh",
        "version": "Plugin version",
        "read": "Review changes",
        "attention": "Check failed: ",
        "paused": "Automatic checks paused",
        "subtitle": "Codex capabilities and upstream reminders",
        "settings": "Plugin settings",
        "active": "Update checks",
        "guide": "Codex capabilities",
        "safety": "Safety and runtime boundaries",
        "noTask": "On demand",
        "empty": "No upstream changes waiting for review",
        "safetyText": "Uses workspace-write by default. Does not silently widen permissions. Vision and computer control are separate. Computer control requires existing Codex tools.",
        "noFake": "Only observed status; no invented token, cost or success-rate metrics.",
        "processed": "Request processed. Check the last successful check time.",
        "nativeBoundary": "Native DSH features are managed by DSH settings, not this plugin.",
        "doctor": "Entry check (no model)",
        "see": "Image analysis / OCR",
        "task": "Task delegation",
        "enabled": "Automatic checks enabled"
    }
};
const css=".ceh-page{container-type:inline-size;box-sizing:border-box;height:100%;overflow:auto;padding:24px clamp(18px,2.5vw,40px) 40px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-l1,var(--dsw-alias-bg-base));font:inherit}.ceh-page *{box-sizing:border-box}.ceh-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:24px}.ceh-title{font-size:22px;font-weight:650;margin:0 0 4px}.ceh-muted{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}.ceh-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.ceh-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:24px}.ceh-card{min-width:0;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);border-radius:12px;padding:20px}.ceh-value{display:block;font-size:26px;font-weight:650;line-height:1.4;margin-top:10px}.ceh-section-title{font-size:16px;font-weight:600;margin:0 0 14px}.ceh-row{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-top:16px}.ceh-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr);gap:20px}.ceh-button{font:inherit;font-size:13px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l3));border-radius:7px;min-height:36px;padding:7px 13px}.ceh-button:hover:not(:disabled){background:var(--dsw-alias-bg-hover,var(--dsw-alias-bg-l1))}.ceh-button:focus-visible,.ceh-page input:focus-visible{outline:2px solid var(--dsw-alias-primary,var(--dsw-alias-label-primary));outline-offset:3px}.ceh-button:disabled{opacity:.45;cursor:not-allowed}.ceh-page input{font:inherit;accent-color:var(--dsw-alias-primary);color:inherit}.ceh-number{width:84px;padding:7px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base)}.ceh-notice{padding:12px 16px;margin-bottom:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);overflow-wrap:anywhere}.ceh-notice[role=alert]{border-style:dashed}.ceh-update{padding-top:14px;margin-top:14px;border-top:1px solid var(--dsw-alias-border-l3);overflow-wrap:anywhere}.ceh-update ul{padding-left:20px;font-size:12px;max-height:160px;overflow:auto}.ceh-page a{color:var(--dsw-alias-text-link,var(--dsw-alias-label-primary));text-decoration:underline}.ceh-command{display:block;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l3)}.ceh-command:last-child{border-bottom:0}.ceh-command code{display:block;font-size:13px;margin-top:5px;overflow-wrap:anywhere}.ceh-icon{width:21px;height:21px;flex:none}.ceh-footer{margin-top:20px}@media(max-width:800px){.ceh-grid{grid-template-columns:1fr}.ceh-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:480px){.ceh-page{padding:18px 14px}.ceh-button{min-height:44px}.ceh-card{padding:16px}}@container(max-width:760px){.ceh-grid{grid-template-columns:1fr}.ceh-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}";

        function Icon(){return h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,className:'ceh-icon','aria-hidden':true},h('path',{d:'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z'}),h('circle',{cx:12,cy:12,r:2.5}));}
        return {
            inject:['slots','connection','locale','layout'],
            apply(ctx){
                ctx.effect(()=>ctx.locale.register(PANEL,words));
                const t=ctx.locale.bind(PANEL);
                function Page(){
                    React.useSyncExternalStore(cb=>ctx.locale.subscribe(cb),()=>ctx.locale.getSnapshot(),()=>ctx.locale.getSnapshot());
                    const [state,setState]=React.useState(null),[full,setFull]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[hours,setHours]=React.useState('168'),[notice,setNotice]=React.useState('');
                    const call=async(endpoint,payload={},signal)=>{const r=await ctx.connection.rpc.call('/api','codex-eyes-hands/'+endpoint,payload,signal);if(!r.ok)throw Error(r.error.message);return r.value;};
                    const refresh=async(signal)=>{try{const v=await call('status',{},signal);if(signal?.aborted)return;setFull(v);setState(v.updates);setHours(String(v.updates.intervalHours));setError('');}catch(e){if(!signal?.aborted)setError(e.message);}};
                    React.useEffect(()=>{const control=new AbortController();let timer,stopped=false;const poll=async()=>{await refresh(control.signal);if(!stopped)timer=setTimeout(poll,60000);};poll();return()=>{stopped=true;clearTimeout(timer);control.abort();};},[]);
                    const act=async(endpoint,payload)=>{setBusy(true);setError('');setNotice('');try{const r=await call(endpoint,payload);setNotice(t('processed'));await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
                    const button=(label,onClick,disabled=false)=>h('button',{type:'button',className:'ceh-button',onClick,disabled:busy||disabled},label);
                    const pending=state?.notices?.filter(n=>!n.acknowledged)||[];
                    const metric=(label,value)=>h('div',{className:'ceh-card',key:label},h('div',{className:'ceh-muted'},label),h('strong',{className:'ceh-value'},value));
                    const settings=ctx.get?.('uiPluginManager');
                    return h('main',{className:'ceh-page','aria-label':t('title')},h('style',null,css),
                        h('header',{className:'ceh-header'},h('div',null,h('h1',{className:'ceh-title'},t('title')),h('div',{className:'ceh-muted'},t('subtitle'))),h('div',{className:'ceh-actions'},button(t('refresh'),()=>refresh()),settings&&button(t('settings'),()=>settings.openBundle('dsh-codex-eyes-hands')))),
                        error&&h('div',{className:'ceh-notice',role:'alert'},t('failed')+': '+error,' ',button(t('refresh'),()=>refresh())),
                        notice&&h('div',{className:'ceh-notice',role:'status'},notice),
                        h('section',{className:'ceh-metrics','aria-label':t('subtitle')},metric(t('version'),full?.pluginVersion||'2.3.0'),metric(t('active'),state?t(state.enabled?'enabled':'paused'):'—'),metric(t('pending'),state?pending.length:'—'),metric('Codex',t('noTask'))),
                        h('div',{className:'ceh-grid'},h('section',{className:'ceh-card','aria-label':t('updates')},
                            h('div',{className:'ceh-row',style:{marginTop:0}},h('h2',{className:'ceh-section-title'},t('updates')),h('div',{className:'ceh-actions'},button(t('check'),()=>act('updates/check',{})),button(t('ack'),()=>act('updates/acknowledge',{}),!pending.length))),
                            state&&h(React.Fragment,null,h('p',{className:'ceh-muted'},t('last')+': '+(state.lastSuccess?new Date(state.lastSuccess).toLocaleString():t('never'))),state.lastError&&h('div',{role:'status'},t('attention')+state.lastError),
                                h('div',{className:'ceh-actions'},h('label',null,h('input',{type:'checkbox',checked:state.enabled,disabled:busy,onChange:e=>act('updates/settings',{enabled:e.target.checked,intervalHours:state.intervalHours})}),' '+t('auto')),h('label',null,t('period')+' ',h('input',{type:'number',className:'ceh-number',min:1,max:720,value:hours,disabled:busy,onChange:e=>setHours(e.target.value),'aria-label':t('period')}),' '+t('hours')),button(t('save'),()=>act('updates/settings',{enabled:state.enabled,intervalHours:Number(hours)})))),
                            h('p',{className:'ceh-muted'},t('scope')),state&&!pending.length&&h('p',{className:'ceh-muted'},t('empty')),
                            ...pending.map(n=>h('article',{key:n.id,className:'ceh-update'},h('strong',null,n.repo),h('p',{className:'ceh-muted'},(n.release||'')+' / '+n.head.slice(0,8)),h('div',null,n.reason),n.files?.length?h('ul',null,...n.files.map(f=>h('li',{key:f},f))):null,h('a',{href:n.url,target:'_blank',rel:'noopener noreferrer'},t('read'))))),
                            h('aside',{className:'ceh-card'},h('h2',{className:'ceh-section-title'},t('guide')),
                                ...[[t('doctor'),'/codex doctor'],[t('see'),'/codex see / /codex ocr'],[t('task'),'codex_task']].map(([label,command])=>h('div',{className:'ceh-command',key:command},h('span',{className:'ceh-muted'},label),h('code',null,command))),
                                h('h2',{className:'ceh-section-title',style:{marginTop:24}},t('safety')),h('p',{className:'ceh-muted'},t('safetyText')),h('p',{className:'ceh-muted'},t('nativeBoundary')))),
                        h('footer',{className:'ceh-muted ceh-footer'},t('noFake')));
                }
                ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:PANEL,locale:PANEL},Page));
                ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:PANEL,order:35,label:()=>t('title'),locale:PANEL},Icon));
            }
        };
    }
});
