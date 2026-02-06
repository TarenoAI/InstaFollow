/**
 * 🔧 INSTAGRAM VNC SESSION FIX
 * 
 * Öffnet Chromium mit sichtbarem Browser und persistentem Profil,
 * damit du dich bei Instagram einloggen kannst.
 * 
 * Verwendung in VNC oder mit xvfb:
 * export DISPLAY=:99
 * npx tsx scripts/auth/fix-instagram-session.ts
 */

import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const iPhone = devices['iPhone 13 Pro'];

async function main() {
    console.log('═'.repeat(50));
    console.log('🔧 INSTAGRAM SESSION FIX (Persistent Profile)');
    console.log('═'.repeat(50));
    console.log('');

    // Stelle sicher, dass der Browser-Profil-Ordner existiert
    const BROWSER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/instagram');
    if (!fs.existsSync(BROWSER_PROFILE_DIR)) {
        fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
    }

    console.log('🚀 Starte Chromium Browser mit persistentem Profil...');
    console.log(`   Profil-Ordner: ${BROWSER_PROFILE_DIR}`);
    console.log('');

    // Nutze PERSISTENT CONTEXT für langlebige Sessions
    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        ...iPhone,
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
    console.log('💾 Session automatisch im Browser-Profil gespeichert!');
    console.log('');

    await context.close();

    console.log('═'.repeat(50));
    console.log('🎉 FERTIG!');
    console.log('');
    console.log('Die Session ist jetzt im persistenten Profil gespeichert.');
    console.log('Sie bleibt auch nach Browser-Neustarts erhalten!');
    console.log('');
    console.log('Teste jetzt mit:');
    console.log('  npx tsx scripts/monitors/smart-monitor-v4.ts morewatchez');
    console.log('═'.repeat(50));
}

main().catch(console.error);
