/**
 * 🐦 TWITTER VPS LOGIN (iPhone Emulation)
 * 
 * Versucht Login auf VPS mit iPhone-Emulation
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import path from 'path';
import fs from 'fs';

const TWITTER_SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-session.json');
const SCREENSHOTS_DIR = path.join(process.cwd(), 'artifacts/screenshots');
const iPhone = devices['iPhone 13 Pro'];

if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function main() {
    console.log('🐦 TWITTER VPS LOGIN (iPhone)\n');

    const username = process.env.TWITTER_USERNAME;
    const password = process.env.TWITTER_PASSWORD;

    if (!username || !password) {
        console.log('❌ TWITTER_USERNAME oder TWITTER_PASSWORD fehlt in .env!');
        return;
    }

    console.log(`👤 Username: ${username}`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
    });

    const page = await context.newPage();

    try {
        // Mobile Twitter-Login URL
        console.log('🌐 Öffne Mobile Twitter...');
        await page.goto('https://mobile.twitter.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_iphone_1.png') });
        console.log('📸 Screenshot 1: Login-Seite');

        // Username eingeben
        console.log('👤 Gebe Username ein...');
        const usernameInput = await page.$('input[autocomplete="username"]') || await page.$('input[name="session[username_or_email]"]');
        if (usernameInput) {
            await usernameInput.fill(username);
            await page.waitForTimeout(1500);

            // Versuche "Weiter" oder Enter
            const nextBtn = await page.$('text=Weiter') || await page.$('text=Next') || await page.$('[role="button"]:has-text("Weiter")');
            if (nextBtn) {
                await nextBtn.click();
            } else {
                await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(4000);
        } else {
            console.log('⚠️ Username-Feld nicht gefunden, versuche alternatives Format...');
            // Versuche direkt beide Felder auf einmal (alte mobile Version)
        }

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_iphone_2.png') });
        console.log('📸 Screenshot 2: Nach Username');

        // Passwort eingeben
        console.log('🔐 Gebe Passwort ein...');
        const passwordInput = await page.$('input[type="password"]') || await page.$('input[name="session[password]"]');
        if (passwordInput) {
            await passwordInput.fill(password);
            await page.waitForTimeout(1000);

            const loginBtn = await page.$('text=Anmelden') || await page.$('text=Log in') || await page.$('[data-testid="LoginForm_Login_Button"]');
            if (loginBtn) {
                await loginBtn.click();
            } else {
                await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(8000);
        } else {
            console.log('⚠️ Passwort-Feld nicht gefunden');
        }

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_iphone_3.png') });
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
        }

    } catch (err: any) {
        console.error('❌ Fehler:', err.message);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_iphone_error.png') });
    } finally {
        await browser.close();
    }

    console.log('\n📁 Screenshots:', SCREENSHOTS_DIR);
}

main();
