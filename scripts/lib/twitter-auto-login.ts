/**
 * 🔐 TWITTER AUTO-LOGIN FALLBACK
 * 
 * Automatisierter Login-Mechanismus für Twitter/X.
 * Wird aufgerufen wenn die Session abgelaufen ist.
 */

import 'dotenv/config';
import { firefox, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const TWITTER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/twitter-firefox');
const DEBUG_DIR = path.join(process.cwd(), 'public/debug');

// Stelle sicher dass Ordner existieren
if (!fs.existsSync(TWITTER_PROFILE_DIR)) fs.mkdirSync(TWITTER_PROFILE_DIR, { recursive: true });
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

export interface TwitterLoginResult {
    success: boolean;
    context?: BrowserContext;
    page?: Page;
    error?: string;
}

/**
 * Prüft ob die Twitter Session gültig ist
 */
export async function checkTwitterSession(page: Page): Promise<boolean> {
    try {
        const url = page.url();

        // Login-Seite = nicht eingeloggt
        if (url.includes('login') || url.includes('flow/login') || url.includes('i/flow')) {
            return false;
        }

        // Prüfe ob Home-Feed oder Compose sichtbar
        const homeIndicator = await page.$('[data-testid="primaryColumn"]') ||
            await page.$('[data-testid="tweetTextarea_0"]') ||
            await page.$('[aria-label="Home timeline"]');

        return !!homeIndicator;
    } catch {
        return false;
    }
}

/**
 * Versucht automatischen Login mit gespeicherten Credentials
 */
export async function performTwitterLogin(page: Page): Promise<boolean> {
    const TWITTER_USERNAME = process.env.TWITTER_USERNAME;
    const TWITTER_PASSWORD = process.env.TWITTER_PASSWORD;

    if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
        console.log('   ⚠️ TWITTER_USERNAME oder TWITTER_PASSWORD fehlt in .env');
        return false;
    }

    console.log('   🔐 Starte automatischen Twitter Login...');

    try {
        // Gehe zur Login-Seite
        await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Username eingeben
        const usernameInput = page.locator('input[autocomplete="username"]');
        await usernameInput.waitFor({ timeout: 10000 });
        await usernameInput.fill(TWITTER_USERNAME);
        await page.waitForTimeout(1000);

        // Weiter-Button klicken
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);

        // Prüfe ob Passwort-Feld erscheint (oder ob zusätzliche Verification nötig)
        const passwordInput = page.locator('input[type="password"]');
        const usernameVerify = page.locator('input[data-testid="ocfEnterTextTextInput"]');

        if (await usernameVerify.isVisible().catch(() => false)) {
            // Twitter fragt nach Username/Phone zur Verifikation
            console.log('   📧 Twitter verlangt Username/Phone Verification...');
            await usernameVerify.fill(TWITTER_USERNAME);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(3000);
        }

        // Passwort eingeben
        try {
            await passwordInput.waitFor({ timeout: 10000 });
            await passwordInput.fill(TWITTER_PASSWORD);
            await page.waitForTimeout(1000);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(5000);
        } catch (e) {
            console.log('   ⚠️ Passwort-Feld nicht gefunden');
            await page.screenshot({ path: `${DEBUG_DIR}/twitter-login-no-password-${Date.now()}.png` });
            return false;
        }

        // Prüfe ob Login erfolgreich
        const finalUrl = page.url();
        if (finalUrl.includes('login') || finalUrl.includes('flow')) {
            console.log('   ❌ Login fehlgeschlagen - immer noch auf Login-Seite');
            await page.screenshot({ path: `${DEBUG_DIR}/twitter-login-failed-${Date.now()}.png` });
            return false;
        }

        // Prüfe auf Sicherheits-Challenges
        if (finalUrl.includes('challenge') || finalUrl.includes('verify')) {
            console.log('   🚨 SICHERHEITS-CHECK erforderlich! Bitte via VNC einloggen.');
            await page.screenshot({ path: `${DEBUG_DIR}/twitter-security-check-${Date.now()}.png` });
            return false;
        }

        console.log('   ✅ Twitter Auto-Login erfolgreich!');
        return true;

    } catch (err: any) {
        console.log(`   ❌ Twitter Auto-Login Fehler: ${err.message}`);
        await page.screenshot({ path: `${DEBUG_DIR}/twitter-login-error-${Date.now()}.png` }).catch(() => { });
        return false;
    }
}

/**
 * Hauptfunktion: Holt eine gültige Twitter Session mit Auto-Login Fallback
 */
export async function getTwitterContext(headless: boolean = true): Promise<TwitterLoginResult> {
    console.log('\n   🐦 Starte Twitter Session...');

    const context = await firefox.launchPersistentContext(TWITTER_PROFILE_DIR, {
        headless,
        viewport: { width: 1024, height: 600 },
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });

    const page = context.pages()[0] || await context.newPage();

    try {
        // Gehe zu Twitter Home
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Prüfe Session
        const isLoggedIn = await checkTwitterSession(page);

        if (isLoggedIn) {
            console.log('   ✅ Twitter Session aktiv');
            return { success: true, context, page };
        }

        console.log('   ⚠️ Twitter Session abgelaufen - versuche Auto-Login...');

        // Fallback: Auto-Login
        const loginSuccess = await performTwitterLogin(page);

        if (loginSuccess) {
            // Navigiere zurück zu Home um Session zu bestätigen
            await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            return { success: true, context, page };
        }

        // Login fehlgeschlagen
        await context.close();
        return {
            success: false,
            error: 'Auto-Login fehlgeschlagen. Bitte via VNC einloggen: vnc://31.97.32.40:5901'
        };

    } catch (err: any) {
        await context.close().catch(() => { });
        return { success: false, error: err.message };
    }
}

/**
 * Schließt die Twitter Session sauber
 */
export async function closeTwitterContext(context: BrowserContext): Promise<void> {
    try {
        await context.close();
    } catch { }
}

// Test wenn direkt ausgeführt
if (require.main === module) {
    (async () => {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('🔐 TWITTER AUTO-LOGIN TEST');
        console.log('═══════════════════════════════════════════════════════════\n');

        const result = await getTwitterContext(false); // headless: false für Debug

        if (result.success && result.page) {
            console.log('\n✅ Twitter Session aktiv!');
            console.log(`   URL: ${result.page.url()}`);

            // Warte auf Enter
            console.log('\nDrücke ENTER zum Beenden...');
            await new Promise<void>((resolve) => {
                process.stdin.resume();
                process.stdin.once('data', () => resolve());
            });

            if (result.context) await closeTwitterContext(result.context);
        } else {
            console.log(`\n❌ Fehler: ${result.error}`);
            process.exit(1);
        }
    })();
}
