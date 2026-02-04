/**
 * Instagram Session Test & Renewal
 * Prüft ob die Session noch gültig ist und erneuert sie bei Bedarf
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

async function main() {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📱 INSTAGRAM SESSION TEST');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Prüfe ob Session existiert
    if (!fs.existsSync(SESSION_PATH)) {
        console.log('❌ Keine Session-Datei gefunden!');
        console.log(`   Erwartet: ${SESSION_PATH}\n`);
        return;
    }

    console.log('📂 Session-Datei gefunden');

    // Parse Session
    const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf-8'));
    console.log(`   Cookies: ${session.cookies?.length || 0}`);

    // Prüfe ob wichtige Cookies vorhanden sind
    const sessionId = session.cookies?.find((c: any) => c.name === 'sessionid');
    if (sessionId) {
        const expires = new Date(sessionId.expires * 1000);
        console.log(`   sessionid expires: ${expires.toLocaleString()}`);
        if (expires < new Date()) {
            console.log('   ⚠️ Session ist abgelaufen!\n');
        } else {
            console.log('   ✅ Session ist noch gültig\n');
        }
    } else {
        console.log('   ⚠️ Kein sessionid Cookie gefunden!\n');
    }

    // Browser starten und testen
    console.log('🌐 Starte Browser...');
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
    });

    // Cookies laden
    await context.addCookies(session.cookies || []);

    const page = await context.newPage();

    try {
        console.log('📱 Lade Instagram...');
        await page.goto('https://www.instagram.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(5000);

        // Screenshot machen
        await page.screenshot({ path: 'session-test.png' });
        console.log('   📸 Screenshot: session-test.png');

        // Prüfe Login-Status
        const url = page.url();
        console.log(`   URL: ${url}`);

        if (url.includes('login') || url.includes('accounts/login')) {
            console.log('\n❌ NICHT EINGELOGGT!');
            console.log('   Die Session ist abgelaufen oder ungültig.');
            console.log('\n   Lösung:');
            console.log('   1. Logge dich manuell auf deinem Mac bei Instagram ein');
            console.log('   2. Kopiere die Session-Datei von deinem Mac zum VPS');
            console.log('   3. Oder nutze das interaktive Login (braucht GUI)\n');
        } else {
            // Prüfe ob Home-Icon sichtbar ist
            const homeIcon = await page.$('svg[aria-label="Startseite"], svg[aria-label="Home"]');
            if (homeIcon) {
                console.log('\n✅ EINGELOGGT!');
                console.log('   Die Session ist gültig.\n');

                // Session neu speichern (refreshed cookies)
                const newCookies = await context.cookies();
                fs.writeFileSync(SESSION_PATH, JSON.stringify({ cookies: newCookies }, null, 2));
                console.log('   💾 Session aktualisiert\n');
            } else {
                console.log('\n⚠️ Status unklar - prüfe session-test.png');
            }
        }

        // Teste einen konkreten Account
        console.log('🔍 Teste Profil-Zugriff...');
        await page.goto('https://www.instagram.com/fcbayern/', {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        await page.waitForTimeout(3000);

        // Schließe "View in App" Popup
        console.log('   🔇 Schließe Popups...');
        try {
            // ESC drücken
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);

            // X-Button suchen und klicken
            const closeButtons = ['[aria-label="Schließen"]', '[aria-label="Close"]', 'div[role="dialog"] button'];
            for (const sel of closeButtons) {
                const btn = await page.$(sel);
                if (btn && await btn.isVisible()) {
                    await btn.click({ force: true });
                    console.log(`   ✓ Geschlossen via ${sel}`);
                    await page.waitForTimeout(500);
                }
            }

            // Klicke außerhalb
            await page.mouse.click(10, 10);
            await page.waitForTimeout(500);
        } catch { }

        await page.screenshot({ path: 'session-test-after-popup.png' });
        console.log('   📸 Screenshot nach Popup-Schließung: session-test-after-popup.png');

        const followingLink = await page.$('a[href*="following"]');
        if (followingLink) {
            const text = await followingLink.innerText();
            console.log(`   ✅ fcbayern Following: ${text}\n`);
        } else {
            console.log('   ⚠️ Konnte Following-Zahl nicht lesen\n');
            await page.screenshot({ path: 'session-test-profile.png' });
            console.log('   📸 Screenshot: session-test-profile.png');
        }

    } catch (err: any) {
        console.log(`\n❌ Fehler: ${err.message}\n`);
    }

    await browser.close();
    console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
