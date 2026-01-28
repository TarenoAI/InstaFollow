/**
 * 🐦 TWITTER LOGIN TEST
 * 
 * testet den Twitter-Login auf dem VPS
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
    console.log('🐦 TWITTER LOGIN TEST\n');

    const username = process.env.TWITTER_USERNAME;
    const password = process.env.TWITTER_PASSWORD;

    if (!username || !password) {
        console.log('❌ TWITTER_USERNAME oder TWITTER_PASSWORD fehlt in .env!');
        return;
    }

    console.log(`👤 Username: ${username}`);

    // Lösche alte Session für frischen Test
    if (fs.existsSync(TWITTER_SESSION_PATH)) {
        fs.unlinkSync(TWITTER_SESSION_PATH);
        console.log('🗑️ Alte Twitter-Session gelöscht\n');
    }

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    try {
        console.log('🌐 Öffne Twitter Login...');
        await page.goto('https://twitter.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_1_login_page.png') });
        console.log('📸 Screenshot 1: Login-Seite');

        // Username eingeben
        console.log('👤 Gebe Username ein...');
        const usernameInput = await page.$('input[autocomplete="username"]');
        if (usernameInput) {
            await usernameInput.fill(username);
            await page.waitForTimeout(1000);

            // "Weiter" Button
            const nextButton = await page.$('text=Weiter') || await page.$('text=Next');
            if (nextButton) {
                await nextButton.click();
                await page.waitForTimeout(3000);
            } else {
                // Fallback: Enter drücken
                await page.keyboard.press('Enter');
                await page.waitForTimeout(3000);
            }
        } else {
            console.log('❌ Username-Feld nicht gefunden!');
            await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_error.png') });
            await browser.close();
            return;
        }

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_2_after_username.png') });
        console.log('📸 Screenshot 2: Nach Username');

        // Passwort eingeben
        console.log('🔐 Gebe Passwort ein...');
        const passwordInput = await page.$('input[type="password"]');
        if (passwordInput) {
            await passwordInput.fill(password);
            await page.waitForTimeout(1000);

            // "Anmelden" Button
            const loginButton = await page.$('text=Anmelden') || await page.$('text=Log in');
            if (loginButton) {
                await loginButton.click();
            } else {
                await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(8000);
        } else {
            console.log('⚠️ Passwort-Feld nicht gefunden - möglicherweise Zusatzverifikation');
        }

        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_3_after_login.png') });
        console.log('📸 Screenshot 3: Nach Login-Versuch');

        const currentUrl = page.url();
        console.log(`🔗 URL: ${currentUrl}`);

        // Prüfe ob Login erfolgreich
        if (currentUrl.includes('home') || currentUrl.includes('twitter.com/') && !currentUrl.includes('login')) {
            console.log('\n✅ LOGIN ERFOLGREICH!');
            await context.storageState({ path: TWITTER_SESSION_PATH });
            console.log('💾 Session gespeichert in:', TWITTER_SESSION_PATH);

            // Test-Tweet compose öffnen
            console.log('\n🐦 Öffne Tweet-Composer...');
            await page.goto('https://twitter.com/compose/tweet', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(3000);
            await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_4_composer.png') });
            console.log('📸 Screenshot 4: Tweet-Composer');

        } else if (currentUrl.includes('challenge') || currentUrl.includes('account/access')) {
            console.log('\n⚠️ TWITTER VERLANGT ZUSATZ-VERIFIKATION!');
            console.log('   Du musst evtl. Email/SMS-Code eingeben oder reCAPTCHA lösen.');
            console.log('   Schau dir die Screenshots an.');
        } else {
            console.log('\n❌ Login fehlgeschlagen oder unbekannter Status');
        }

    } catch (err: any) {
        console.error('❌ Fehler:', err.message);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'twitter_error.png') });
    } finally {
        await browser.close();
    }

    console.log('\n📁 Screenshots liegen in:', SCREENSHOTS_DIR);
    console.log('   Lade sie herunter um zu sehen was passiert ist.');
}

main();
