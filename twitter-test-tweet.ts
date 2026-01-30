/**
 * 🐦 TWITTER TEST TWEET v2
 * 
 * Nutzt die Compose-URL direkt
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function main() {
    console.log('🐦 TWITTER TEST TWEET v2\n');

    const authToken = process.env.TWITTER_AUTH_TOKEN;
    const ct0 = process.env.TWITTER_CT0;
    const twid = process.env.TWITTER_TWID;

    if (!authToken || !ct0 || !twid) {
        console.log('❌ Fehlende Cookies in .env!');
        return;
    }

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    await context.addCookies([
        { name: 'auth_token', value: authToken, domain: '.x.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
        { name: 'ct0', value: ct0, domain: '.x.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' },
        { name: 'twid', value: twid, domain: '.x.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' }
    ]);

    const page = await context.newPage();

    try {
        const testMessage = `🧪 Test vom VPS Bot - ${new Date().toLocaleString('de-DE')}`;

        // Direkt zur Compose-URL mit vorausgefülltem Text
        const encodedMessage = encodeURIComponent(testMessage);
        console.log('🌐 Öffne Tweet-Composer direkt...');
        await page.goto(`https://x.com/intent/tweet?text=${encodedMessage}`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await page.waitForTimeout(5000);

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_test2_1.png') });
        console.log('📸 Screenshot 1');
        console.log(`🔗 URL: ${page.url()}`);

        // Suche nach dem Posten-Button
        const postButton = await page.$('[data-testid="tweetButton"]') ||
            await page.$('button[type="submit"]') ||
            await page.$('button:has-text("Posten")') ||
            await page.$('button:has-text("Post")');

        if (postButton) {
            console.log('🚀 Klicke Posten...');
            await postButton.click();
            await page.waitForTimeout(5000);

            await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_test2_2.png') });
            console.log('📸 Screenshot 2: Nach Posten');
            console.log('\n✅ TEST-TWEET GESENDET!');
        } else {
            console.log('❌ Posten-Button nicht gefunden');

            // Debug: Zeige alle Buttons
            const buttons = await page.$$eval('button', btns => btns.map(b => b.innerText.substring(0, 50)));
            console.log('   Gefundene Buttons:', buttons.slice(0, 10));

            await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_test2_error.png') });
        }

    } catch (err: any) {
        console.error('❌ Fehler:', err.message);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_test2_error.png') });
    } finally {
        await browser.close();
    }
}

main();
