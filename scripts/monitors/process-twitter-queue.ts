/**
 * 📤 X/Twitter Queue Processor
 * 
 * Verarbeitet gespeicherte Posts aus der Queue
 * mit 15-Minuten-Delays zwischen den Posts
 */

import 'dotenv/config';
import { firefox, devices } from 'playwright';
import path from 'path';
import fs from 'fs';
import { loadQueue, removeFromQueue, incrementRetryCount, QueuedPost } from '../lib/twitter-queue';

const DEBUG_DIR = path.join(process.cwd(), 'public/debug');
const TWITTER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/twitter-firefox');
const TWITTER_USERNAME = process.env.TWITTER_USERNAME;

const DELAY_BETWEEN_POSTS_MS = 15 * 60 * 1000; // 15 Minuten
const MAX_RETRIES = 5;

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

import { getTwitterContext, closeTwitterContext, performTwitterLogin } from '../lib/twitter-auto-login';

async function postToTwitter(text: string, imagePath?: string): Promise<string | null> {
    if (!TWITTER_USERNAME) {
        console.log('   ⚠️ TWITTER_USERNAME fehlt');
        return null;
    }

    console.log('\n   🐦 Poste auf Twitter (mit Auto-Login Fallback)...');

    // Nutze den neuen Twitter-Context mit Auto-Login
    const sessionResult = await getTwitterContext(true); // headless: true für Produktion

    if (!sessionResult.success || !sessionResult.page || !sessionResult.context) {
        console.log(`   ❌ Twitter Session Fehler: ${sessionResult.error}`);
        return null;
    }

    const { page, context } = sessionResult;

    try {
        console.log('   ✅ Twitter eingeloggt');

        await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const tweetBox = page.locator('[data-testid="tweetTextarea_0"]').first();
        await tweetBox.waitFor({ timeout: 10000 });
        await tweetBox.click();
        await page.waitForTimeout(500);
        await page.keyboard.type(text, { delay: 30 });
        await page.waitForTimeout(1000);

        if (imagePath && fs.existsSync(imagePath)) {
            console.log(`   📂 Lade Bild hoch: ${path.basename(imagePath)}`);
            const fileInput = page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(imagePath);
            await page.waitForTimeout(5000);

            // Prüfe ob Bild angezeigt wird
            const hasMedia = await page.$('[data-testid="attachments"]');
            if (hasMedia) {
                console.log('   ✅ Bild hochgeladen');
            }
        }

        console.log('   📤 Sende Tweet...');
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(6000);

        console.log('   🔍 Suche Tweet-URL...');
        await page.goto(`https://x.com/${TWITTER_USERNAME}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const tweetLink = page.locator('article a[href*="/status/"]').first();
        let tweetUrl = '';
        try {
            const href = await tweetLink.getAttribute('href');
            if (href) tweetUrl = `https://x.com${href}`;
        } catch (e) {
            console.log('   ⚠️ Konnte Tweet-URL nicht finden');
        }

        console.log(`   ✅ Tweet gepostet! ${tweetUrl || '(URL unbekannt)'}`);

        await closeTwitterContext(context);
        return tweetUrl || 'https://x.com';
    } catch (err: any) {
        console.log(`   ❌ Twitter Fehler: ${err.message}`);
        await page.screenshot({ path: `${DEBUG_DIR}/queue-twitter-error-${Date.now()}.png` }).catch(() => { });
        await closeTwitterContext(context).catch(() => { });
        return null;
    }
}

async function processQueue(): Promise<void> {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('📤 X/Twitter Queue Processor');
    console.log(`📅 ${new Date().toLocaleString('de-DE')}`);
    console.log('════════════════════════════════════════════════════════════\n');

    const queue = loadQueue();

    if (queue.length === 0) {
        console.log('✅ Queue ist leer - nichts zu posten.\n');
        return;
    }

    console.log(`📋 ${queue.length} Post(s) in der Queue\n`);

    let postedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < queue.length; i++) {
        const post = queue[i];

        console.log(`\n────────────────────────────────────────────────────────────`);
        console.log(`📝 Verarbeite Post ${i + 1}/${queue.length}: ${post.id}`);
        console.log(`   Erstellt: ${post.createdAt}`);
        console.log(`   Retries: ${post.retryCount}`);
        console.log(`   Text: ${post.text.substring(0, 80)}...`);

        if (post.retryCount >= MAX_RETRIES) {
            console.log(`   ⚠️ Max Retries (${MAX_RETRIES}) erreicht - überspringe`);
            failedCount++;
            continue;
        }

        const result = await postToTwitter(post.text, post.imagePath);

        if (result) {
            console.log('   ✅ Erfolgreich gepostet - entferne aus Queue');
            removeFromQueue(post.id);
            postedCount++;

            // Delay vor dem nächsten Post (außer beim letzten)
            if (i < queue.length - 1) {
                console.log(`\n   ⏳ Warte 15 Minuten vor dem nächsten Post...`);
                await sleep(DELAY_BETWEEN_POSTS_MS);
            }
        } else {
            console.log('   ❌ Fehlgeschlagen - erhöhe Retry-Counter');
            incrementRetryCount(post.id, 'Twitter Session oder Post fehlgeschlagen');
            failedCount++;

            // Bei Fehlschlag auch kurz warten, dann abbrechen (Session-Problem)
            console.log('   ⚠️ Breche ab wegen Session-Problem');
            break;
        }
    }

    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`📊 Ergebnis: ${postedCount} gepostet, ${failedCount} fehlgeschlagen`);
    console.log(`📋 Verbleibend in Queue: ${loadQueue().length}`);
    console.log('════════════════════════════════════════════════════════════\n');
}

// Start
processQueue().catch(console.error);
