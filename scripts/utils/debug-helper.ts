/**
 * Debug Helper - Speichert Screenshots automatisch in .incidents und pusht zu Git
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const INCIDENTS_DIR = path.join(process.cwd(), '.incidents');

// Erstelle .incidents Ordner falls nicht vorhanden
if (!fs.existsSync(INCIDENTS_DIR)) {
    fs.mkdirSync(INCIDENTS_DIR, { recursive: true });
}

export async function saveDebugScreenshot(page: any, name: string): Promise<string> {
    const timestamp = Date.now();
    const filename = `${name}_${timestamp}.png`;
    const filepath = path.join(INCIDENTS_DIR, filename);

    await page.screenshot({ path: filepath });
    console.log(`📸 Debug Screenshot: .incidents/${filename}`);

    return filepath;
}

export async function pushIncidentsToGit(message: string = 'debug: auto-push screenshots'): Promise<void> {
    try {
        console.log('📤 Pushing debug screenshots to Git...');

        await execAsync('git add .incidents/', { cwd: process.cwd() });
        await execAsync(`git commit -m "${message}"`, { cwd: process.cwd() });
        await execAsync('git push origin main', { cwd: process.cwd() });

        console.log('✅ Debug screenshots pushed to Git!');
    } catch (err: any) {
        // Wenn keine Änderungen, ist das OK
        if (err.message.includes('nothing to commit')) {
            console.log('ℹ️ Keine neuen Screenshots zum Pushen');
        } else {
            console.log(`⚠️ Git push fehlgeschlagen: ${err.message}`);
        }
    }
}

export async function debugAndPush(page: any, name: string): Promise<void> {
    await saveDebugScreenshot(page, name);
    await pushIncidentsToGit(`debug: ${name}`);
}
