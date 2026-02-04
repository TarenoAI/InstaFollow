/**
 * Schnelltest: Testet ob wir Following-Zahl lesen können
 */

import 'dotenv/config';
import { chromium, devices, Page } from 'playwright';
import fs from 'fs';
import path from 'path';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

async function dismissPopups(page: Page) {
    const selectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Accept All")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
        'div[role="dialog"] button[type="button"]',
    ];

    for (const sel of selectors) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) {
                await btn.click({ force: true });
                console.log(`   🔇 Closed: ${sel}`);
                await page.waitForTimeout(300);
            }
        } catch { }
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Klicke außerhalb
    try {
        await page.mouse.click(10, 10);
        await page.waitForTimeout(300);
    } catch { }
}

async function getFollowingCount(page: Page, username: string): Promise<number | null> {
    console.log(`\n🔍 Teste @${username}...`);

    await page.goto(`https://www.instagram.com/${username}/`, {
        waitUntil: 'networkidle',
        timeout: 45000
    });
    await page.waitForTimeout(3000);
    await dismissPopups(page);
    await page.waitForTimeout(1000);

    // Screenshot
    await page.screenshot({ path: `test-${username}.png` });
    console.log(`   📸 Screenshot: test-${username}.png`);

    // Methode 5: Suche im ganzen Seitentext nach "X Gefolgt"
    const pageText = await page.evaluate(() => document.body?.innerText || '');
    const textMatches = pageText.match(/(\d+[\d,.]*)\s*(Gefolgt|Following|abonniert)/gi);
    if (textMatches && textMatches.length > 0) {
        for (const m of textMatches) {
            const numMatch = m.match(/[\d,.]+/);
            if (numMatch) {
                const count = parseInt(numMatch[0].replace(/[,.]/g, ''));
                console.log(`   ✅ [M5] Found: "${m}" → ${count}`);
                return count;
            }
        }
    }

    // Methode 6: Header
    const headerText = await page.$eval('header', (h: any) => h.innerText).catch(() => '');
    console.log(`   Header text: ${headerText.substring(0, 200)}...`);

    const followingMatch = headerText.match(/(\d+[\d,.\s]*(?:Mio\.?|K|M)?)\s*(Gefolgt|Following)/i);
    if (followingMatch) {
        let numStr = followingMatch[1].replace(/[,.\s]/g, '');
        if (followingMatch[1].toLowerCase().includes('mio')) {
            numStr = numStr.replace(/mio/i, '');
            const num = parseFloat(numStr) * 1000000;
            console.log(`   ✅ [M6] Found: "${followingMatch[0]}" → ${Math.round(num)}`);
            return Math.round(num);
        }
        const count = parseInt(numStr);
        console.log(`   ✅ [M6] Found: "${followingMatch[0]}" → ${count}`);
        return count;
    }

    console.log(`   ❌ Konnte Following nicht lesen`);
    return null;
}

async function main() {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🧪 QUICK FOLLOWING TEST');
    console.log('═══════════════════════════════════════════════════════════\n');

    const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf-8'));

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
    });
    await context.addCookies(session.cookies || []);
    const page = await context.newPage();

    // Test ein paar Profile
    const testAccounts = ['fcbayern', 'bfrfrench'];

    for (const acc of testAccounts) {
        const count = await getFollowingCount(page, acc);
        console.log(`   Result for @${acc}: ${count || 'FAILED'}\n`);
    }

    await browser.close();
    console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
