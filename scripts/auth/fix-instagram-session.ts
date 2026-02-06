/**
 * 🔧 INSTAGRAM VNC SESSION FIX
 * 
 * Öffnet Chromium mit sichtbarem Browser, damit du
 * dich bei Instagram einloggen kannst.
 * 
 * Verwendung in VNC oder mit xvfb:
 * export DISPLAY=:99
 * npx tsx scripts/auth/fix-instagram-session.ts
 */

import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

async function main() {
    console.log('═'.repeat(50));
    console.log('🔧 INSTAGRAM SESSION FIX');
    console.log('═'.repeat(50));
    console.log('');

    // Stelle sicher, dass der Sessions-Ordner existiert
    const sessionDir = path.dirname(SESSION_PATH);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    console.log('🚀 Starte Chromium Browser (Mobile-Ansicht)...');
    console.log('');

    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Lade existierende Session wenn vorhanden
    const context = await browser.newContext({
        ...iPhone,
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });

    const page = await context.newPage();

    console.log('📱 Öffne Instagram...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Prüfe ob eingeloggt
    const isLoggedIn = !page.url().includes('login') &&
        !(await page.$('input[name="username"]'));

    if (isLoggedIn) {
        console.log('✅ Bereits eingeloggt!');
    } else {
        console.log('❌ Nicht eingeloggt - Login erforderlich');
    }

    console.log('');
    console.log('═'.repeat(50));
    console.log('👀 BROWSER IST JETZT OFFEN!');
    console.log('═'.repeat(50));
    console.log('');
    console.log('Bitte im Browser:');
    console.log('  1. Falls nicht eingeloggt: Einloggen');
    console.log('  2. Warte bis du den Feed oder ein Profil siehst');
    console.log('  3. Navigiere zu einem beliebigen Profil');
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
    console.log('  npx tsx scripts/monitors/smart-monitor-v4.ts morewatchez');
    console.log('═'.repeat(50));
}

main().catch(console.error);
