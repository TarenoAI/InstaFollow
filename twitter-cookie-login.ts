/**
 * 🐦 TWITTER COOKIE LOGIN
 * 
 * Nutzt exportierte Browser-Cookies für den Login
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
    console.log('🐦 TWITTER COOKIE LOGIN\n');

    const authToken = process.env.TWITTER_AUTH_TOKEN;
    const ct0 = process.env.TWITTER_CT0;
    const twid = process.env.TWITTER_TWID;

    if (!authToken || !ct0 || !twid) {
        console.log('❌ Fehlende Cookies in .env!');
        console.log('   Benötigt: TWITTER_AUTH_TOKEN, TWITTER_CT0, TWITTER_TWID');
        return;
    }

    console.log('✅ Cookies gefunden');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // Cookies setzen
    console.log('🍪 Setze Cookies...');
    await context.addCookies([
        {
            name: 'auth_token',
            value: authToken,
            domain: '.x.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'None'
        },
        {
            name: 'ct0',
            value: ct0,
            domain: '.x.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'twid',
            value: twid,
            domain: '.x.com',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'None'
        }
    ]);

    const page = await context.newPage();

    try {
        console.log('🌐 Öffne Twitter Home...');
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_cookie_1.png') });
        console.log('📸 Screenshot 1: Home');

        const currentUrl = page.url();
        console.log(`🔗 URL: ${currentUrl}`);

        // Prüfe ob eingeloggt
        if (currentUrl.includes('home') && !currentUrl.includes('login')) {
            console.log('\n✅ COOKIE-LOGIN ERFOLGREICH!');

            // Session speichern für später
            await context.storageState({ path: TWITTER_SESSION_PATH });
            console.log('💾 Session gespeichert:', TWITTER_SESSION_PATH);

            // Test Tweet-Composer
            console.log('\n🐦 Teste Tweet-Composer...');
            await page.goto('https://x.com/compose/tweet', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(3000);
            await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_cookie_2.png') });
            console.log('📸 Screenshot 2: Composer');
            console.log('\n✅ Alles bereit zum automatischen Posten!');

        } else {
            console.log('\n❌ Cookies funktionieren nicht');
            console.log('   Möglicherweise abgelaufen oder falsch kopiert.');
        }

    } catch (err: any) {
        console.error('❌ Fehler:', err.message);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_cookie_error.png') });
    } finally {
        await browser.close();
    }

    console.log('\n📁 Screenshots:', SCREENSHOTS_DIR);
}

main();
