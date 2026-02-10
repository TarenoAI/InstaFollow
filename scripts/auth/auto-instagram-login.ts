/**
 * 🔐 AUTOMATISCHER INSTAGRAM LOGIN
 * 
 * Loggt sich automatisch bei Instagram ein und speichert die Session.
 * Verwendet Cookies/Session wenn möglich, sonst Login mit Credentials.
 * 
 * Benötigt in .env:
 * - INSTAGRAM_USERNAME
 * - INSTAGRAM_PASSWORD
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME;
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD;

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

async function dismissPopups(page: any) {
    const selectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Accept All")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        'button:has-text("Nicht jetzt")',
        'button:has-text("Informationen nicht speichern")',
        'button:has-text("Nicht aktivieren")',
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
    ];

    for (const sel of selectors) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) {
                await btn.click({ force: true });
                await page.waitForTimeout(500);
            }
        } catch { }
    }
}

async function autoLogin(): Promise<boolean> {
    console.log('═'.repeat(50));
    console.log('🔐 AUTOMATISCHER INSTAGRAM LOGIN');
    console.log('═'.repeat(50));
    console.log('');

    if (!INSTAGRAM_USERNAME || !INSTAGRAM_PASSWORD) {
        console.log('❌ INSTAGRAM_USERNAME oder INSTAGRAM_PASSWORD fehlt in .env');
        console.log('');
        console.log('Füge hinzu:');
        console.log('  INSTAGRAM_USERNAME=dein_username');
        console.log('  INSTAGRAM_PASSWORD=dein_passwort');
        return false;
    }

    console.log(`👤 Username: ${INSTAGRAM_USERNAME}`);
    console.log('');

    // Erkenne ob wir eine GUI haben (XServer)
    const hasDisplay = !!process.env.DISPLAY;
    const isVps = process.platform === 'linux' && !hasDisplay;

    // Headless Modus: Standardmäßig true auf VPS, außer --headed wird übergeben
    const isHeaded = process.argv.includes('--headed');
    const headless = isVps ? !isHeaded : false;

    if (isVps && isHeaded) {
        console.log('⚠️  WARNUNG: --headed wurde auf dem VPS ohne XServer angefordert.');
        console.log('   Nutze "xvfb-run" oder logge dich über VNC ein.');
    }

    // Stelle sicher, dass der Browser-Profil-Ordner existiert
    const BROWSER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/instagram');
    if (!fs.existsSync(BROWSER_PROFILE_DIR)) {
        fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
    }

    // Nutze PERSISTENT CONTEXT für langlebige Sessions
    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        headless: headless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ],
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });

    const page = await context.newPage();

    try {
        console.log('🌐 Öffne Instagram...');
        await page.goto('https://www.instagram.com/', {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Prüfe ob bereits eingeloggt
        const needsLogin = page.url().includes('login') ||
            await page.$('input[name="username"]');

        if (!needsLogin) {
            console.log('✅ Bereits eingeloggt!');

            // Teste ob Session wirklich funktioniert
            console.log('🧪 Teste Session...');
            await page.goto('https://www.instagram.com/instagram/', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await page.waitForTimeout(3000);

            if (!page.url().includes('login')) {
                console.log('✅ Session ist gültig!');
                await context.storageState({ path: SESSION_PATH });
                await context.close();
                return true;
            }
        }

        console.log('🔐 Login erforderlich...');

        // Navigiere zur Login-Seite
        if (!page.url().includes('login')) {
            await page.goto('https://www.instagram.com/accounts/login/', {
                waitUntil: 'networkidle',
                timeout: 30000
            });
            await page.waitForTimeout(2000);
        }

        await dismissPopups(page);
        await page.screenshot({ path: 'debug-instagram-login-page.png' });

        // Finde Login-Felder
        console.log('   📧 Gebe Username ein...');
        const usernameInput = await page.$('input[name="username"]') ||
            await page.$('input[type="text"]');

        if (!usernameInput) {
            console.log('❌ Username-Feld nicht gefunden');
            await page.screenshot({ path: 'debug-instagram-no-username.png' });
            await context.close();
            return false;
        }

        await usernameInput.click();
        await humanDelay(300, 600);
        await usernameInput.fill('');
        await page.keyboard.type(INSTAGRAM_USERNAME, { delay: 50 + Math.random() * 50 });
        await humanDelay(500, 1000);

        console.log('   🔑 Gebe Passwort ein...');
        const passwordInput = await page.$('input[name="password"]') ||
            await page.$('input[type="password"]');

        if (!passwordInput) {
            console.log('❌ Passwort-Feld nicht gefunden');
            await context.close();
            return false;
        }

        await passwordInput.click();
        await humanDelay(300, 600);
        await page.keyboard.type(INSTAGRAM_PASSWORD, { delay: 50 + Math.random() * 50 });
        await humanDelay(500, 1000);

        // Login-Button klicken
        console.log('   🚀 Klicke Login...');
        const loginButton = await page.$('button[type="submit"]') ||
            await page.$('button:has-text("Anmelden")') ||
            await page.$('button:has-text("Log in")');

        if (loginButton) {
            await loginButton.click();
        } else {
            await page.keyboard.press('Enter');
        }

        // Warte auf Login-Ergebnis
        console.log('   ⏳ Warte auf Login...');
        await page.waitForTimeout(5000);
        await dismissPopups(page);

        // Screenshot für Debugging
        await page.screenshot({ path: 'debug-instagram-after-login.png' });

        // Prüfe auf Login-Fehler
        const errorMessage = await page.$('div[role="alert"]') ||
            await page.$('[data-testid="login-error-message"]');

        if (errorMessage) {
            const errorText = await errorMessage.innerText().catch(() => '');
            console.log(`❌ Login-Fehler: ${errorText}`);
            await context.close();
            return false;
        }

        // Prüfe ob wir jetzt eingeloggt sind
        await page.waitForTimeout(3000);
        const currentUrl = page.url();

        if (currentUrl.includes('login') || currentUrl.includes('challenge')) {
            console.log('⚠️ Zusätzliche Verifizierung erforderlich!');
            console.log('   URL: ' + currentUrl);
            console.log('');
            console.log('   Dies kann bedeuten:');
            console.log('   - 2-Faktor-Authentifizierung');
            console.log('   - Captcha');
            console.log('   - Verdächtige Aktivität erkannt');
            console.log('');
            console.log('   ➡️ Bitte manuell über VNC einloggen!');
            await page.screenshot({ path: 'debug-instagram-challenge.png' });
            await context.close();
            return false;
        }

        // Popups nach Login schließen
        await dismissPopups(page);
        await page.waitForTimeout(2000);
        await dismissPopups(page);

        console.log('✅ Login erfolgreich!');

        // Session speichern
        console.log('💾 Speichere Session...');
        await context.storageState({ path: SESSION_PATH });
        console.log(`✅ Session gespeichert: ${SESSION_PATH}`);

        await context.close();
        return true;

    } catch (err: any) {
        console.log(`❌ Fehler: ${err.message}`);
        await page.screenshot({ path: 'debug-instagram-error.png' }).catch(() => { });
        await context.close();
        return false;
    }
}

// Hauptfunktion
async function main() {
    const success = await autoLogin();

    console.log('');
    console.log('═'.repeat(50));
    if (success) {
        console.log('✅ INSTAGRAM LOGIN ERFOLGREICH');
        console.log('');
        console.log('Teste jetzt mit:');
        console.log('  npx tsx scripts/monitors/smart-monitor-v4.ts morewatchez');
    } else {
        console.log('❌ INSTAGRAM LOGIN FEHLGESCHLAGEN');
        console.log('');
        console.log('Optionen:');
        console.log('  1. Prüfe INSTAGRAM_USERNAME und INSTAGRAM_PASSWORD in .env');
        console.log('  2. Manueller Login über VNC:');
        console.log('     npx tsx scripts/auth/fix-instagram-session.ts');
    }
    console.log('═'.repeat(50));

    process.exit(success ? 0 : 1);
}

main();
