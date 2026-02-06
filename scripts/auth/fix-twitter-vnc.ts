/**
 * 🔧 TWITTER VNC FIX
 * 
 * Öffnet Chromium mit sichtbarem Browser, damit du den
 * "Create Passcode" Dialog manuell schließen kannst.
 * 
 * Verwendung in VNC:
 * cd ~/InstaFollow && npx tsx scripts/auth/fix-twitter-vnc.ts
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-session.json');

async function main() {
    console.log('═'.repeat(50));
    console.log('🔧 TWITTER VNC SESSION FIX');
    console.log('═'.repeat(50));
    console.log('');

    // Stelle sicher, dass der Sessions-Ordner existiert
    const sessionDir = path.dirname(SESSION_PATH);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    console.log('🚀 Starte Chromium Browser...');
    console.log('');

    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Lade existierende Session wenn vorhanden
    const context = await browser.newContext({
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined,
        viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    console.log('📱 Öffne Twitter/X...');
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    console.log('');
    console.log('═'.repeat(50));
    console.log('👀 BROWSER IST JETZT OFFEN!');
    console.log('═'.repeat(50));
    console.log('');
    console.log('Bitte im Browser:');
    console.log('  1. Falls Login nötig: Einloggen');
    console.log('  2. Falls "Create Passcode" erscheint:');
    console.log('     → Klicke auf "Not now" ODER erstelle einen');
    console.log('  3. Warte bis du den Home-Feed siehst');
    console.log('');
    console.log('Danach: Drücke ENTER zum Speichern der Session');
    console.log('═'.repeat(50));
    console.log('');

    // Warte auf Enter
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    await new Promise<void>(resolve => {
        rl.question('>>> Drücke ENTER wenn fertig: ', () => {
            rl.close();
            resolve();
        });
    });

    console.log('');
    console.log('💾 Speichere Session...');
    await context.storageState({ path: SESSION_PATH });

    console.log('✅ Session gespeichert in: ' + SESSION_PATH);
    console.log('');

    await browser.close();

    console.log('═'.repeat(50));
    console.log('🎉 FERTIG!');
    console.log('');
    console.log('Teste jetzt mit:');
    console.log('  npx tsx scripts/tests/vps-twitter-test.ts');
    console.log('═'.repeat(50));
}

main().catch(console.error);
