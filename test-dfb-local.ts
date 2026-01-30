/**
 * 🧪 LOKALER TEST: @dfb_team Following scrapen
 * Mit längeren Delays und sichtbarem Browser
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import path from 'path';
import fs from 'fs';

const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

async function main() {
    console.log('\n🧪 LOKALER TEST: @dfb_team Following scrapen\n');

    const browser = await chromium.launch({ headless: false }); // Sichtbar!
    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined
    });
    const page = await context.newPage();

    await page.goto('https://www.instagram.com/dfb_team/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // Dismiss popups
    const popups = ['button:has-text("Alle akzeptieren")', 'button:has-text("Jetzt nicht")'];
    for (const sel of popups) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) await btn.click({ force: true });
        } catch { }
    }

    // Klicke auf Following
    console.log('👆 Öffne Following-Liste...\n');
    await page.click('a[href*="following"]', { timeout: 10000 });
    await page.waitForTimeout(5000);

    const following = new Set<string>();
    let noNewCount = 0;
    const maxScrolls = 120; // Mehr Scrolls für lokalen Test
    const maxNoNew = 25; // Mehr Geduld

    for (let scroll = 0; scroll < maxScrolls && noNewCount < maxNoNew; scroll++) {
        const users = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .map(a => a.getAttribute('href'))
                .filter(h => h && h.match(/^\/[a-zA-Z0-9._-]+\/?$/))
                .filter(h => !['explore', 'reels', 'p', 'direct', 'accounts', 'stories'].some(x => h!.includes(x)))
                .map(h => h!.replace(/\//g, ''));
        });

        const prevSize = following.size;
        users.forEach(u => u && following.add(u));

        if (following.size === prevSize) noNewCount++;
        else noNewCount = 0;

        // Log jeden 5. Scroll oder bei Änderung
        if (scroll % 5 === 0 || following.size !== prevSize) {
            console.log(`Scroll ${scroll + 1}/${maxScrolls}: ${following.size}/203 gefunden (${((following.size / 203) * 100).toFixed(1)}%)`);
        }

        // Scroll mit längeren Delays
        await page.evaluate(() => window.scrollBy(0, 500));
        await humanDelay(3500, 5500); // Noch längere Delays

        // Touch scroll
        await page.mouse.move(200, 400);
        await page.mouse.wheel(0, 250);
        await humanDelay(2000, 3000);
    }

    following.delete('dfb_team');

    console.log('\n' + '═'.repeat(50));
    console.log(`✅ ERGEBNIS: ${following.size}/203 Following gescrapt`);
    console.log(`📊 Quote: ${((following.size / 203) * 100).toFixed(1)}%`);
    console.log(`🔄 Scrolls: ${Math.min(noNewCount, maxNoNew) >= maxNoNew ? 'Stop wegen keine neuen' : maxScrolls}`);
    console.log('═'.repeat(50) + '\n');

    // Liste ausgeben
    const list = Array.from(following);
    console.log('📋 Gefundene Following:');
    list.forEach((u, i) => console.log(`${(i + 1).toString().padStart(3)}. @${u}`));

    await context.storageState({ path: SESSION_PATH });
    console.log('\n⏳ Browser schließt in 10 Sekunden...');
    await new Promise(r => setTimeout(r, 10000));
    await browser.close();
}

main();
