
'use server';

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function triggerTwitterStatusCheck() {
    console.log('[Action] Triggering Twitter status check...');
    try {
        // Starte das externe Script um Playwright-Issues mit Next.js Server Actions zu vermeiden
        const scriptPath = path.join(process.cwd(), 'scripts/utils/check-twitter-login.ts');
        const command = `npx tsx ${scriptPath}`;

        // Wir warten nicht auf das Ergebnis für die UI, oder doch? 
        // Besser wir warten, damit die UI sich sofort aktualisieren kann.
        const { stdout, stderr } = await execAsync(command);

        console.log('[Action] Status check output:', stdout);
        if (stderr) console.error('[Action] Status check error:', stderr);

        return { success: true, output: stdout };
    } catch (error: any) {
        console.error('[Action] Failed to trigger status check:', error);
        return { success: false, error: error.message };
    }
}
