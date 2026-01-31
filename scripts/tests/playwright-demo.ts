/**
 * 🎭 Playwright Instagram Demo v2
 * 
 * Robustere Version mit besserem Popup-Handling
 * 
 * Ausführen mit: npx tsx playwright-demo.ts
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');

interface FollowingUser {
    username: string;
    fullName: string;
}

// ============ DELAYS ============

async function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    console.log(`⏱️  Warte ${Math.round(delay / 1000)} Sekunden...`);
    await new Promise(resolve => setTimeout(resolve, delay));
}

// ============ BROWSER SETUP ============

async function createBrowser(): Promise<Browser> {
    console.log(`🎭 Starte Chromium Browser (SICHTBAR)...`);

    return await chromium.launch({
        headless: false,  // SICHTBAR!
        slowMo: 100,      // Langsamer für bessere Sichtbarkeit
    });
}

async function createContext(browser: Browser): Promise<BrowserContext> {
    let storageState = undefined;
    if (fs.existsSync(SESSION_PATH)) {
        console.log('📂 Lade gespeicherte Session...');
        storageState = SESSION_PATH;
    }

    return await browser.newContext({
        storageState,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'de-DE',
    });
}

// ============ POPUP KILLER ============

async function dismissAllPopups(page: Page): Promise<void> {
    const dismissSelectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Accept All")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not now")',
        'button:has-text("Not Now")',
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
        'svg[aria-label="Schließen"]',
        'svg[aria-label="Close"]',
    ];

    for (const selector of dismissSelectors) {
        try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
                console.log(`🔘 Schließe Popup: ${selector}`);
                await button.click({ force: true });
                await page.waitForTimeout(1000);
            }
        } catch {
            // Ignore
        }
    }
}

// ============ LOGIN ============

async function performLogin(page: Page, username: string, password: string): Promise<boolean> {
    console.log(`\n🔐 Login als @${username}...`);

    try {
        // Gehe zur Login-Seite
        console.log('   Navigiere zur Login-Seite...');
        await page.goto('https://www.instagram.com/accounts/login/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await humanDelay(3000, 4000);

        // Alle Popups schließen
        await dismissAllPopups(page);
        await page.waitForTimeout(1000);

        // Username eingeben
        console.log('   Gebe Username ein...');
        const usernameInput = await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
        await usernameInput.fill('');  // Clear first
        await usernameInput.type(username, { delay: 100 });

        await humanDelay(500, 1000);

        // Passwort eingeben
        console.log('   Gebe Passwort ein...');
        const passwordInput = await page.waitForSelector('input[name="password"], input[type="password"]', { timeout: 5000 });
        await passwordInput.fill('');  // Clear first
        await passwordInput.type(password, { delay: 100 });

        await humanDelay(500, 1000);

        // Nochmal Popups checken
        await dismissAllPopups(page);

        // Login Button klicken
        console.log('   Klicke Login-Button...');
        const loginButton = await page.$('button[type="submit"]');
        if (loginButton) {
            await loginButton.click({ force: true });
        } else {
            await page.keyboard.press('Enter');
        }

        console.log('⏳ Warte auf Login-Antwort...');
        await humanDelay(5000, 8000);

        // Prüfe URL
        const currentUrl = page.url();
        console.log(`   Aktuelle URL: ${currentUrl}`);

        if (currentUrl.includes('challenge') || currentUrl.includes('two_factor') || currentUrl.includes('suspicious')) {
            console.log('\n' + '═'.repeat(50));
            console.log('⚠️  VERIFIZIERUNG ERFORDERLICH!');
            console.log('   Bitte löse die Challenge im Browser-Fenster...');
            console.log('   (Script wartet max. 5 Minuten)');
            console.log('═'.repeat(50) + '\n');

            // Warte auf Weiterleitung
            await page.waitForURL(url => {
                const u = url.toString();
                return !u.includes('challenge') && !u.includes('two_factor') && !u.includes('suspicious');
            }, { timeout: 300000 });
        }

        // Popups nach Login schließen
        await humanDelay(2000, 3000);
        await dismissAllPopups(page);

        console.log('✅ Login erfolgreich!');
        return true;

    } catch (error: any) {
        console.error('❌ Login fehlgeschlagen:', error.message);
        return false;
    }
}

// ============ FOLLOWING LIST ============

async function getFollowingList(page: Page, targetUsername: string): Promise<FollowingUser[]> {
    const following: FollowingUser[] = [];

    console.log(`\n📋 Rufe Following-Liste von @${targetUsername} ab...`);

    try {
        // Navigiere zum Profil
        await page.goto(`https://www.instagram.com/${targetUsername}/`, { waitUntil: 'networkidle' });
        await humanDelay(2000, 3000);
        await dismissAllPopups(page);

        // Finde Following-Link
        console.log('   Suche Following-Link...');

        // Versuche verschiedene Wege
        const followingLink = await page.$('a[href$="/following/"]');

        if (!followingLink) {
            // Versuche über den Text
            const links = await page.$$('a');
            for (const link of links) {
                const text = await link.textContent();
                if (text && (text.includes('Abonniert') || text.includes('following'))) {
                    await link.click();
                    break;
                }
            }
        } else {
            await followingLink.click();
        }

        await humanDelay(2000, 3000);

        // Warte auf Dialog
        console.log('   Warte auf Following-Liste...');
        const dialog = await page.waitForSelector('[role="dialog"]', { timeout: 10000 });

        if (!dialog) {
            console.log('⚠️  Dialog nicht gefunden');
            return following;
        }

        // Scrolle und sammle
        console.log('📜 Scrolle durch die Liste...');

        for (let i = 0; i < 5; i++) {  // Max 5 Scroll-Iterationen für Demo
            // Finde alle Links im Dialog
            const links = await page.$$('[role="dialog"] a[role="link"]');

            for (const link of links) {
                try {
                    const href = await link.getAttribute('href');
                    if (!href || href === '/') continue;

                    const username = href.replace(/\//g, '');
                    if (username && !following.find(u => u.username === username)) {
                        following.push({ username, fullName: '' });
                    }
                } catch {
                    continue;
                }
            }

            console.log(`   Gefunden: ${following.length} Accounts`);

            // Scroll im Dialog
            await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]');
                const scrollable = dialog?.querySelector('div[style*="overflow"]') || dialog;
                if (scrollable) {
                    scrollable.scrollTop += 300;
                }
            });

            await humanDelay(1500, 2500);
        }

        // Schließe Dialog
        await page.keyboard.press('Escape');

    } catch (error: any) {
        console.error('❌ Fehler:', error.message);
    }

    return following;
}

// ============ MAIN ============

async function main() {
    console.log('\n' + '═'.repeat(50));
    console.log('🎭 PLAYWRIGHT INSTAGRAM DEMO v2');
    console.log('═'.repeat(50) + '\n');

    require('dotenv').config();

    const username = process.env.INSTAGRAM_USERNAME;
    const password = process.env.INSTAGRAM_PASSWORD;

    if (!username || !password) {
        console.error('❌ INSTAGRAM_USERNAME und INSTAGRAM_PASSWORD müssen gesetzt sein!');
        return;
    }

    const targetProfile = 'instagram';  // Öffentliches Profil zum Testen

    const browser = await createBrowser();
    const context = await createContext(browser);
    const page = await context.newPage();

    try {
        // Login
        const loginSuccess = await performLogin(page, username, password);

        if (!loginSuccess) {
            console.log('❌ Login fehlgeschlagen. Beende.');
            return;
        }

        // Session speichern
        await context.storageState({ path: SESSION_PATH });
        console.log('💾 Session gespeichert');

        // Following-Liste abrufen
        const following = await getFollowingList(page, targetProfile);

        // Ergebnis
        console.log('\n' + '═'.repeat(50));
        console.log('📊 ERGEBNIS');
        console.log('═'.repeat(50));
        console.log(`\n@${targetProfile} folgt ${following.length} Accounts:\n`);

        for (const user of following.slice(0, 15)) {
            console.log(`   • @${user.username}`);
        }

        if (following.length > 15) {
            console.log(`   ... und ${following.length - 15} weitere`);
        }

        console.log('\n✅ Demo abgeschlossen!');
        console.log('⏳ Browser schließt in 10 Sekunden...\n');
        await page.waitForTimeout(10000);

    } finally {
        await browser.close();
    }
}

main().catch(console.error);
