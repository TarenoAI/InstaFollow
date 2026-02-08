/**
 * 🐦 TWITTER VNC LOGIN
 * 
 * Öffnet Chrome mit persistentem Profil für Twitter.
 * Einmal einloggen, Session bleibt dauerhaft aktiv.
 */

import 'dotenv/config';
import { firefox } from 'playwright';  // Firefox statt Chromium - weniger Detection!
import path from 'path';
import fs from 'fs';

// Persistentes Profil für Twitter
const TWITTER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/twitter-firefox');

// Erstelle Profil-Ordner
if (!fs.existsSync(TWITTER_PROFILE_DIR)) {
    fs.mkdirSync(TWITTER_PROFILE_DIR, { recursive: true });
}

async function main() {
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`🐦 TWITTER VNC LOGIN - FIREFOX (weniger Detection)`);
    console.log(`════════════════════════════════════════════════════════════\n`);

    console.log(`📂 Browser-Profil: ${TWITTER_PROFILE_DIR}`);
    console.log(`\n🌐 Starte Firefox...\n`);

    // Firefox Persistenter Context
    const context = await firefox.launchPersistentContext(TWITTER_PROFILE_DIR, {
        headless: false,  // Sichtbar für VNC!
        viewport: { width: 1024, height: 600 },
        locale: 'de-DE',
        args: [
            '-width', '1024',
            '-height', '600',
        ],
    });

    const page = context.pages()[0] || await context.newPage();

    // Gehe zu Twitter/X
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });

    console.log(`════════════════════════════════════════════════════════════`);
    console.log(`🖥️ BROWSER OFFEN - VERBINDE VIA VNC!`);
    console.log(`════════════════════════════════════════════════════════════`);
    console.log(`\n📋 Anleitung:`);
    console.log(`   1. Öffne VNC-Client und verbinde zu VPS:5900`);
    console.log(`   2. Du siehst den Browser mit Twitter/X`);
    console.log(`   3. Logge dich manuell ein (falls nötig)`);
    console.log(`   4. Warte bis der Feed geladen ist`);
    console.log(`   5. Drücke ENTER hier wenn fertig\n`);

    // Warte auf Enter
    await new Promise<void>((resolve) => {
        process.stdin.resume();
        process.stdin.once('data', () => resolve());
    });

    // Prüfe ob eingeloggt
    const url = page.url();
    const isLoggedIn = !url.includes('login') && !url.includes('flow');

    if (isLoggedIn) {
        console.log(`\n✅ Twitter Login erfolgreich!`);
        console.log(`   URL: ${url}`);
    } else {
        console.log(`\n⚠️ Möglicherweise nicht eingeloggt`);
        console.log(`   URL: ${url}`);
    }

    // Browser schließen - Profil bleibt gespeichert
    await context.close();

    console.log(`\n📁 Session gespeichert in: ${TWITTER_PROFILE_DIR}`);
    console.log(`✅ Twitter-Posts werden dieses Profil nutzen!\n`);
}

main().catch(console.error);
