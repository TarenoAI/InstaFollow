/**
 * 🔧 TWITTER VNC FIX (Persistent Profile)
 * 
 * Öffnet Chromium mit persistentem Browser-Profil, damit du
 * dich bei Twitter einloggen kannst. Die Session bleibt
 * dauerhaft im Profil-Ordner gespeichert.
 * 
 * Verwendung in VNC:
 * cd ~/InstaFollow && npx tsx scripts/auth/fix-twitter-vnc.ts
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

async function main() {
    console.log('═'.repeat(50));
    console.log('🔧 TWITTER VNC SESSION FIX (Persistent Profile)');
    console.log('═'.repeat(50));
    console.log('');

    // Stelle sicher, dass der Browser-Profil-Ordner existiert
    const BROWSER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/twitter');
    if (!fs.existsSync(BROWSER_PROFILE_DIR)) {
        fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
    }

    console.log('🚀 Starte Chromium mit persistentem Profil...');
    console.log(`   Profil-Ordner: ${BROWSER_PROFILE_DIR}`);
    console.log('');

    // Nutze PERSISTENT CONTEXT für langlebige Sessions
    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ],
        viewport: { width: 1280, height: 800 },
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });

    const page = await context.newPage();

    console.log('📱 Öffne Twitter/X...');
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Prüfe ob eingeloggt
    const isLoggedIn = !page.url().includes('login') &&
        !(await page.$('input[autocomplete="username"]'));

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
    console.log('  export DISPLAY=:99');
    console.log('  npx tsx scripts/tests/vps-twitter-test.ts');
    console.log('═'.repeat(50));
}

main().catch(console.error);
