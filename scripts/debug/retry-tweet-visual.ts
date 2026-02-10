
import { createClient } from '@libsql/client';
import { chromium } from 'playwright';
import { getTwitterContext, closeTwitterContext } from '../lib/twitter-auto-login';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// === CONFIG ===
const DEBUG_DIR = path.join(process.cwd(), 'public/debug');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

async function retryFailedTweets() {
    const db = createClient({
        url: process.env.DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    // 1. Hole unverarbeitete Events von heute
    const res = await db.execute(`
        SELECT * FROM ChangeEvent 
        WHERE processed = 0 
        AND detectedAt > datetime('now', '-1 day')
        ORDER BY detectedAt DESC
        LIMIT 1
    `);

    if (res.rows.length === 0) {
        console.log('✅ Keine unverarbeiteten Events gefunden.');
        return;
    }

    const event = res.rows[0];
    console.log(`\n🔄 Versuche Retry für Event: ${event.type} @${event.targetUsername} (${event.detectedAt})`);

    // 2. Browser starten
    console.log('   Starting Browser...');
    const { page, context } = await getTwitterContext(false); // headless: false zum Zuschauen (lokal) oder true für VPS
    if (!page) {
        console.error('❌ Browser Start fehlgeschlagen');
        return;
    }

    try {
        // 3. Tweet Text zusammenbauen (simuliert)
        const text = `TEST-RETRY: ${event.type === 'FOLLOW' ? '✅ Follow' : '❌ Unfollow'} @${event.targetUsername}\n#Debug`;
        console.log(`   📝 Tweet: ${text.replace(/\n/g, ' ')}`);

        // 4. Versuche zu posten
        await page.goto('https://twitter.com/compose/tweet');
        await page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 });

        await page.fill('[data-testid="tweetTextarea_0"]', text);
        await page.waitForTimeout(2000);

        // Screenshot VOR dem Klick
        const screenBefore = path.join(DEBUG_DIR, 'retry-before-click.png');
        await page.screenshot({ path: screenBefore });
        console.log(`   📸 Screenshot: ${screenBefore}`);

        // Klick auf "Post"
        const postButton = page.locator('[data-testid="tweetButton"]');
        if (await postButton.isVisible() && await postButton.isEnabled()) {
            await postButton.click();
            await page.waitForTimeout(5000);

            // Screenshot NACH dem Klick
            const screenAfter = path.join(DEBUG_DIR, 'retry-after-click.png');
            await page.screenshot({ path: screenAfter });
            console.log(`   📸 Screenshot: ${screenAfter} (Erfolg?)`);
        } else {
            console.log('   ⚠️ Post-Button nicht klickbar!');
            await page.screenshot({ path: path.join(DEBUG_DIR, 'retry-button-fail.png') });
        }

    } catch (err: any) {
        console.error('❌ Fehler beim Posten:', err.message);
        await page.screenshot({ path: path.join(DEBUG_DIR, 'retry-error.png') });
    } finally {
        await closeTwitterContext(context!);
    }
}

retryFailedTweets().catch(console.error);
