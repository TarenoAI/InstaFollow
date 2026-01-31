/**
 * 🐦 TWITTER VPS LOGIN (Firefox)
 * 
 * Versucht Login auf VPS mit Firefox (wie bei Instagram)
 */

import 'dotenv/config';
import { firefox } from 'playwright';
import path from 'path';
import fs from 'fs';

const TWITTER_SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-session.json');
const SCREENSHOTS_DIR = path.join(process.cwd(), 'artifacts/screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function main() {
    console.log('🐦 TWITTER VPS LOGIN (Firefox)\n');

    const username = process.env.TWITTER_USERNAME;
    const password = process.env.TWITTER_PASSWORD;

    if (!username || !password) {
        console.log('❌ TWITTER_USERNAME oder TWITTER_PASSWORD fehlt in .env!');
        return;
    }

    console.log(`👤 Username: ${username}`);

    const browser = await firefox.launch({
        headless: true,
        args: []
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
    });

    const page = await context.newPage();

    try {
        console.log('🌐 Öffne Twitter Login...');
        await page.goto('https://twitter.com/login', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(5000);

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_ff_1.png') });
        console.log('📸 Screenshot 1: Login-Seite');

        // Username eingeben
        console.log('👤 Gebe Username ein...');
        await page.fill('input[autocomplete="username"]', username);
        await page.waitForTimeout(1500);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(4000);

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_ff_2.png') });
        console.log('📸 Screenshot 2: Nach Username');

        // Prüfe ob zusätzliche Verifikation nötig
        const phoneOrEmailInput = await page.$('input[data-testid="ocfEnterTextTextInput"]');
        if (phoneOrEmailInput) {
            console.log('⚠️ Twitter will Telefonnummer oder Email zur Verifikation');
            // Hier könntest du die Email/Telefon eingeben wenn nötig
            await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_ff_verification.png') });
        }

        // Passwort eingeben
        console.log('🔐 Gebe Passwort ein...');
        const passwordInput = await page.$('input[type="password"]');
        if (passwordInput) {
            await passwordInput.fill(password);
            await page.waitForTimeout(1000);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(8000);
        } else {
            console.log('⚠️ Passwort-Feld nicht gefunden');
        }

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_ff_3.png') });
        console.log('📸 Screenshot 3: Nach Login-Versuch');

        const currentUrl = page.url();
        console.log(`🔗 URL: ${currentUrl}`);

        // Prüfe ob Login erfolgreich
        if (currentUrl.includes('home') || (currentUrl.includes('twitter.com') && !currentUrl.includes('login') && !currentUrl.includes('flow'))) {
            console.log('\n✅ LOGIN ERFOLGREICH!');
            await context.storageState({ path: TWITTER_SESSION_PATH });
            console.log('💾 Session gespeichert:', TWITTER_SESSION_PATH);

        } else {
            console.log('\n❌ Login nicht erfolgreich');
            console.log('   Prüfe die Screenshots für Details.');
        }

    } catch (err: any) {
        console.error('❌ Fehler:', err.message);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_ff_error.png') });
    } finally {
        await browser.close();
    }

    console.log('\n📁 Screenshots:', SCREENSHOTS_DIR);
}

main();
