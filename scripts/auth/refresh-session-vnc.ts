import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function main() {
    const BROWSER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/instagram');

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🌐 INSTAGRAM SESSION REFRESH (VNC MODUS)');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`📂 Nutze Profil: ${BROWSER_PROFILE_DIR}`);

    if (!fs.existsSync(BROWSER_PROFILE_DIR)) {
        fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
    }

    console.log('🚀 Starte Browser im sichtbaren Modus...');
    console.log('💡 Bitte logge dich manuell ein, falls nötig.');
    console.log('💡 Schließe den Browser einfach, wenn du fertig bist.\n');

    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        headless: false, // SICHTBAR!
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ],
        viewport: { width: 1280, height: 800 }
    });

    const page = context.pages()[0] || await context.newPage();

    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });

    // Warte bis der Browser geschlossen wird
    page.on('close', () => {
        console.log('\n✅ Browser geschlossen. Session wurde im Profil gespeichert.');
        process.exit(0);
    });

    // Falls das Script manuell beendet wird
    process.on('SIGINT', async () => {
        await context.close();
        process.exit(0);
    });

    console.log('⏳ Warte auf manuelle Interaktion im VNC-Fenster...');
}

main().catch(console.error);
