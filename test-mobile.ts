/**
 * 📱 Playwright Mobile Test
 * 
 * Testet ob die Mobile-Version von Instagram mehr Following anzeigt.
 * Verwendet "devices" von Playwright für iPhone-Emulation.
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import path from 'path';

const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');

// Wir nutzen iPhone 13 Pro
const iPhone = devices['iPhone 13 Pro'];

async function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    await new Promise(resolve => setTimeout(resolve, delay));
}

async function dismissPopups(page: any): Promise<void> {
    // Mobil sind die Buttons oft anders
    const selectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        '[aria-label="Schließen"]',
        'button >> text="Abbrechen"',
        'button >> text="Cancel"'
    ];

    for (const selector of selectors) {
        try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
                await button.click({ force: true });
                await page.waitForTimeout(500);
            }
        } catch { }
    }
}

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('📱 MOBILE EMULATION TEST');
    console.log('═'.repeat(60) + '\n');

    console.log('🎭 Starte iPhone 13 Pro Emulator...');
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        storageState: SESSION_PATH // Versuche Session zu laden
    });

    const page = await context.newPage();

    try {
        console.log('🌐 Gehe zu Instagram...');
        await page.goto('https://www.instagram.com/');
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Check Login
        const loginBtn = await page.$('a[href="/accounts/login/"]');
        if (loginBtn || page.url().includes('login')) {
            console.log('🔐 Login erforderlich (Mobile Session ist anders)...');

            // Versuche Login
            const username = process.env.INSTAGRAM_USERNAME!;
            const password = process.env.INSTAGRAM_PASSWORD!;

            if (page.url().includes('login')) {
                // Already on login page
            } else {
                await page.click('text="Anmelden"');
            }

            await page.fill('input[name="username"]', username);
            await page.fill('input[name="password"]', password);
            await page.click('button[type="submit"]');
            await page.waitForTimeout(5000);
        } else {
            console.log('✅ Session geladen!');
        }

        // Teste BVB09
        const target = 'bvb09';
        console.log(`\n👤 Öffne @${target}...`);
        await page.goto(`https://www.instagram.com/${target}/`);
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Auf Mobile muss man oft auf "Following" tippen 
        // Die Selector sind anders!
        console.log('👆 Tippe auf "Abonniert"...');

        // Suche nach dem Link der "following" im href hat
        await page.click('a[href*="following"]');
        await page.waitForTimeout(3000);

        console.log('📜 Scrolle Mobile-Liste...');

        // Auf Mobile ist das oft kein Dialog, sondern eine volle Seite oder Sheet
        // Wir scrollen einfach das ganze Fenster oder den Container

        let lastHeight = 0;
        let sameHeightCount = 0;
        let followingCount = 0;

        for (let i = 0; i < 20; i++) { // 20 Scrolls
            // Scroll down
            await page.evaluate(() => window.scrollBy(0, 500));
            await humanDelay(1000, 2000);

            // Zähle Elemente
            const items = await page.$$('a[href^="/"]');
            // Filtere Logik: Nur User Links (ohne Bild, etc.)
            // Mobile DOM ist tricky, wir zählen einfach alles was wie ein User aussieht

            followingCount = items.length; // Grobe Schätzung
            console.log(`   Scroll ${i + 1}: ca. ${followingCount} Elemente geladen`);

            // Check End
            const newHeight = await page.evaluate(() => document.body.scrollHeight);
            if (newHeight === lastHeight) {
                sameHeightCount++;
                if (sameHeightCount > 3) break;
            } else {
                sameHeightCount = 0;
            }
            lastHeight = newHeight;
        }

        console.log(`\n✅ Mobile Test beendet. Gefunden: ca. ${followingCount} Elemente`);

        // Warte damit du reinschauen kannst
        await page.waitForTimeout(10000);

    } catch (error) {
        console.log('❌ Fehler:', error);
    } finally {
        await browser.close();
    }
}

main();
