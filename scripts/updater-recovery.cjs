const fs = require('fs');
const path = require('path');

function rollbackInterruptedUpdate(root, options = {}) {
    const log = options.log || (() => {});
    const tmpDir = path.join(root, '.update-tmp');
    const backupDir = path.join(tmpDir, 'backup');
    if (!fs.existsSync(backupDir)) {
        log('No interrupted update backup was found; existing installation was not changed.');
        return false;
    }

    log('Restoring the previous installation after update failure...');
    for (const entry of fs.readdirSync(backupDir)) {
        // update.bat may still be executing. Keep the new recovery-capable
        // launcher instead of replacing it from underneath cmd.exe.
        if (entry === 'update.bat') continue;
        const source = path.join(backupDir, entry);
        const destination = path.join(root, entry);
        if (fs.existsSync(destination)) {
            fs.rmSync(destination, { recursive: true, force: true });
        }
        fs.renameSync(source, destination);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    log('Previous installation restored. Close RisuBard completely before retrying.');
    return true;
}

module.exports = { rollbackInterruptedUpdate };
