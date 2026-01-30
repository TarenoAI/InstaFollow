/**
 * 🧪 Quick Test: Follower-Parsing für 3 Accounts
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import path from 'path';
import fs from 'fs';

const INSTAGRAM_SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

const testAccounts = ['lennart_kl10', 'svenulreichoffiziell', 'jonas.urbig'];

async function main() {
    console.log('\n🧪 FOLLOWER-PARSING TEST\n');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        storageState: fs.existsSync(INSTAGRAM_SESSION_PATH) ? INSTAGRAM_SESSION_PATH : undefined
    });
    const page = await context.newPage();

    for (const username of testAccounts) {
        console.log(`\n📱 @${username}:`);

        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });
        await page.waitForTimeout(3000);

        // Dismiss popups
        for (const sel of ['button:has-text("Alle akzeptieren")', 'button:has-text("Jetzt nicht")']) {
            try {
                const btn = await page.$(sel);
                if (btn && await btn.isVisible()) await btn.click({ force: true });
            } catch { }
        }
        await page.waitForTimeout(500);

        const result = await page.evaluate(() => {
            // Meta Description holen
            const metaDesc = document.querySelector('meta[property="og:description"]');
            const metaContent = metaDesc?.getAttribute('content') || '';

            // Versuche Follower-Zahl zu parsen
            let followers = 0;

            // Pattern: "888 Tsd. Follower" oder "1,5 Mio. Follower"
            const tsdMatch = metaContent.match(/(\d+[.,]?\d*)\s*Tsd\./i);
            if (tsdMatch) {
                followers = Math.round(parseFloat(tsdMatch[1].replace(',', '.')) * 1000);
            }

            const mioMatch = metaContent.match(/(\d+[.,]?\d*)\s*Mio\./i);
            if (mioMatch) {
                followers = Math.round(parseFloat(mioMatch[1].replace(',', '.')) * 1000000);
            }

            // Englisch: "144M", "55K"
            const mMatch = metaContent.match(/(\d+[.,]?\d*)\s*M\s/i);
            if (mMatch && !mioMatch) {
                followers = Math.round(parseFloat(mMatch[1].replace(',', '.')) * 1000000);
            }

            const kMatch = metaContent.match(/(\d+[.,]?\d*)\s*K\s/i);
            if (kMatch && !tsdMatch) {
                followers = Math.round(parseFloat(kMatch[1].replace(',', '.')) * 1000);
            }

            // Fallback: span[title] mit großen Zahlen
            if (followers === 0) {
                const spans = document.querySelectorAll('span[title]');
                for (const span of spans) {
                    const title = span.getAttribute('title') || '';
                    // "1.234.567" oder "888.000"
                    const numMatch = title.match(/^[\d.]+$/);
                    if (numMatch) {
                        const num = parseInt(title.replace(/\./g, ''));
                        if (num > followers) followers = num;
                    }
                }
            }

            return {
                rawMeta: metaContent,
                parsedFollowers: followers
            };
        });

        console.log(`   Meta: "${result.rawMeta.substring(0, 80)}..."`);
        console.log(`   Parsed: ${result.parsedFollowers.toLocaleString()} Follower`);

        await new Promise(r => setTimeout(r, 2000));
    }

    await context.storageState({ path: INSTAGRAM_SESSION_PATH });
    console.log('\n⏳ Browser schließt...');
    await new Promise(r => setTimeout(r, 3000));
    await browser.close();
}

main();
