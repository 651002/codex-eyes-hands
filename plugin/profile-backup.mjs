import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export async function backupProfile({ profile = process.env.DSH_PROFILE_DIR, root = 'E:/Codex/备份仓库', now = new Date() } = {}) {
    if (!profile || !path.isAbsolute(profile)) throw Error('DSH_PROFILE_DIR 不可用，无法先备份；请在官方插件页操作。');
    const folder = fs.realpathSync(profile);
    const date = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);
    const stamp = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(now).replace(/[-: ]/g, '');
    const rel = folder.replace(/^([a-z]):[\\/]/i, '$1/').replace(/^[/\\]+/, '');
    const dir = path.join(root, date, rel);
    fs.mkdirSync(dir, {
        recursive: true
    });
    const records = [];
    for (const name of [
        'package.json',
        'cordis.patch.yml'
    ]){
        const file = path.join(folder, name);
        if (!fs.existsSync(file)) throw Error('无法备份所需配置 ' + name);
        const suffix = stamp + '_' + crypto.randomBytes(3).toString('hex');
        const target = path.join(dir, name + '.备份.' + suffix);
        fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
        const quote = (s)=>"'" + s.replaceAll("'", "''") + "'";
        const script = '$ErrorActionPreference="Stop"; Copy-Item -LiteralPath ' + quote(target) + ' -Destination ' + quote(file) + ' -Force; Write-Host "Restored"';
        const bat = '@echo off\r\npowershell.exe -NoProfile -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64') + '\r\nif errorlevel 1 exit /b 1\r\npause\r\n';
        const restore = path.join(dir, '一键恢复_' + name + '.bat');
        if (fs.existsSync(restore)) fs.copyFileSync(restore, restore + '.备份.' + suffix, fs.constants.COPYFILE_EXCL);
        fs.writeFileSync(restore, bat, 'ascii');
        records.push({
            source: file,
            backup: target,
            restore
        });
    }
    return records;
}
