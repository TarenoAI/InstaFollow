/**
 * 🐦 TWITTER SESSION TEST
 * 
 * Testet ob die vorhandene Session funktioniert (OHNE Login)
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const TWITTER_SESSION_PATH = path.join(process.cwd(), 'twitter-session.json');
const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function main() {
    console.log('🐦 TWITTER SESSION TEST\n');

    if (!fs.existsSync(TWITTER_SESSION_PATH)) {
        console.log('❌ Keine Session-Datei gefunden!');
        console.log('   Bitte erst auf dem Mac einloggen und hochladen.');
        return;
    }

    console.log('📂 Session-Datei gefunden:', TWITTER_SESSION_PATH);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // WICHTIG: Session laden!
    const context = await browser.newContext({
        storageState: TWITTER_SESSION_PATH, // <-- Session nutzen
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    try {
        console.log('🌐 Öffne Twitter Home...');
        await page.goto('https://twitter.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_session_test.png') });
        console.log('📸 Screenshot gespeichert');

        const currentUrl = page.url();
        console.log(`🔗 URL: ${currentUrl}`);

        // Prüfe ob eingeloggt
        if (currentUrl.includes('home') && !currentUrl.includes('login')) {
            console.log('\n✅ SESSION FUNKTIONIERT! Du bist eingeloggt!');

            // Test-Tweet compose öffnen
            console.log('\n🐦 Öffne Tweet-Composer...');
            await page.goto('https://twitter.com/compose/tweet', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(3000);
            await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_composer.png') });
            console.log('📸 Screenshot: Tweet-Composer');
            console.log('\n✅ Alles bereit zum Posten!');

        } else {
            console.log('\n❌ Session ungültig oder abgelaufen');
            console.log('   Bitte erneut auf dem Mac einloggen.');
        }

    } catch (err: any) {
        console.error('❌ Fehler:', err.message);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_error.png') });
    } finally {
        await browser.close();
    }
}

main();
