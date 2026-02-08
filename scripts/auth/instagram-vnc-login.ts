/**
 * 🔐 INSTAGRAM VNC LOGIN
 * 
 * Öffnet Chrome mit persistentem Profil und iPhone-View.
 * Du loggst dich via VNC ein, Session bleibt dauerhaft aktiv.
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import path from 'path';
import fs from 'fs';

// MUSS der gleiche Pfad sein wie in smart-monitor-v4.ts!
const CHROME_PROFILE = path.join(process.cwd(), 'data/browser-profiles/instagram');
const iPhone = devices['iPhone 13 Pro'];

// Erstelle Profil-Ordner
if (!fs.existsSync(CHROME_PROFILE)) {
    fs.mkdirSync(CHROME_PROFILE, { recursive: true });
}

async function main() {
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`🔐 INSTAGRAM VNC LOGIN - PERSISTENTES PROFIL`);
    console.log(`════════════════════════════════════════════════════════════\n`);

    console.log(`📂 Chrome-Profil: ${CHROME_PROFILE}`);
    console.log(`📱 Viewport: iPhone 13 Pro (390x844)`);
    console.log(`\n🌐 Starte Browser...\n`);

    // Persistenter Browser-Context mit iPhone View
    const context = await chromium.launchPersistentContext(CHROME_PROFILE, {
        headless: false,  // Sichtbar für VNC!
        viewport: iPhone.viewport,
        userAgent: iPhone.userAgent,
        deviceScaleFactor: iPhone.deviceScaleFactor,
        isMobile: iPhone.isMobile,
        hasTouch: iPhone.hasTouch,
        locale: 'de-DE',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--disable-sync',
        ],
    });

    const page = context.pages()[0] || await context.newPage();

    // Gehe zu Instagram
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });

    console.log(`════════════════════════════════════════════════════════════`);
    console.log(`🖥️ BROWSER OFFEN - VERBINDE VIA VNC!`);
    console.log(`════════════════════════════════════════════════════════════`);
    console.log(`\n📋 Anleitung:`);
    console.log(`   1. Öffne VNC-Client und verbinde zu VPS:5900`);
    console.log(`   2. Du siehst den Browser mit Instagram`);
    console.log(`   3. Logge dich manuell ein`);
    console.log(`   4. Navigiere zu deinem Feed oder einem Profil`);
    console.log(`   5. Drücke ENTER hier wenn fertig\n`);

    // Warte auf Enter
    await new Promise<void>((resolve) => {
        process.stdin.resume();
        process.stdin.once('data', () => resolve());
    });

    // Prüfe ob eingeloggt
    const url = page.url();
    const bodyText = await page.locator('body').textContent().catch(() => '');

    if (url.includes('/accounts/login') || bodyText.length < 500) {
        console.log(`\n❌ Login scheint nicht erfolgreich!`);
        console.log(`   URL: ${url}`);
        console.log(`   Body-Länge: ${bodyText.length}`);
    } else {
        console.log(`\n✅ Login erfolgreich!`);
        console.log(`   URL: ${url}`);
        console.log(`   Body-Länge: ${bodyText.length}`);
    }

    // Browser schließen - Profil bleibt gespeichert
    await context.close();

    console.log(`\n📁 Session gespeichert in: ${CHROME_PROFILE}`);
    console.log(`✅ Der smart-monitor wird dieses Profil nutzen!\n`);
}

main().catch(console.error);
