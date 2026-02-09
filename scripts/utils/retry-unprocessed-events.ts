/**
 * 🔄 RETRY UNPROCESSED EVENTS
 * 
 * Holt alle Events mit processed=0 von den letzten 24h und postet sie auf Twitter.
 * Wartet 15 Minuten zwischen den Posts, um Rate Limits zu vermeiden.
 */

import { createClient } from '@libsql/client';
import { getTwitterContext, closeTwitterContext } from '../lib/twitter-auto-login';
import 'dotenv/config';
import path from 'path';

const DELAY_BETWEEN_POSTS_MS = 15 * 60 * 1000; // 15 Minuten
const DEBUG_DIR = path.join(process.cwd(), 'public/debug');

async function sleep(ms: number) {
    console.log(`   ⏰ Warte ${Math.round(ms / 60000)} Minuten...`);
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function postTweetInline(page: any, text: string): Promise<string | null> {
    try {
        // Gehe zur Compose-Seite
        await page.goto('https://x.com/compose/tweet', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Finde Textfeld
        const textarea = page.locator('[data-testid="tweetTextarea_0"]');
        await textarea.waitFor({ timeout: 10000 });
        await textarea.click();
        await page.waitForTimeout(500);

        // Text eingeben
        await page.keyboard.type(text, { delay: 30 });
        await page.waitForTimeout(1000);

        // Post Button klicken
        const postButton = page.locator('[data-testid="tweetButton"]');
        await postButton.click();
        await page.waitForTimeout(5000);

        // Prüfe ob erfolgreich (keine Fehlermeldung, URL ändert sich)
        const url = page.url();
        if (!url.includes('compose')) {
            console.log(`   ✅ Tweet gepostet!`);
            return url;
        }
        return null;
    } catch (err: any) {
        console.log(`   ⚠️ Post-Fehler: ${err.message}`);
        return null;
    }
}

async function retryUnprocessedEvents() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    console.log('\n🔍 Suche unverarbeitete Events (letzte 24h)...');

    // Hole nur Events von den letzten 24 Stunden
    const result = await db.execute(`
        SELECT ce.*, mp.username as monitoredUsername, mp.fullName as monitoredFullName
        FROM ChangeEvent ce
        JOIN MonitoredProfile mp ON ce.profileId = mp.id
        WHERE ce.processed = 0
        AND ce.detectedAt > datetime('now', '-1 day')
        ORDER BY ce.detectedAt ASC
    `);

    if (result.rows.length === 0) {
        console.log('✅ Keine unverarbeiteten Events in den letzten 24h gefunden.');
        return;
    }

    console.log(`📋 ${result.rows.length} Events gefunden.\n`);

    // Browser starten
    console.log('🐦 Starte Twitter Session...');
    const { page, context } = await getTwitterContext(true);
    if (!page || !context) {
        console.error('❌ Konnte Browser nicht starten');
        return;
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < result.rows.length; i++) {
        const event = result.rows[i];
        const eventNum = i + 1;

        console.log(`\n═══════════════════════════════════════════════════`);
        console.log(`📝 Event ${eventNum}/${result.rows.length}`);
        console.log(`   Type: ${event.type}`);
        console.log(`   Monitor: @${event.monitoredUsername}`);
        console.log(`   Target: @${event.targetUsername}`);
        console.log(`   Detected: ${event.detectedAt}`);
        console.log(`═══════════════════════════════════════════════════`);

        // Tweet Text erstellen
        const emoji = event.type === 'FOLLOW' ? '✅' : '👀';
        const actionEmoji = event.type === 'FOLLOW' ? '➕' : '❌';
        const actionDE = event.type === 'FOLLOW' ? 'folgt jetzt' : 'folgt nicht mehr';
        const actionEN = event.type === 'FOLLOW' ? 'now follows' : 'unfollowed';

        const text = `${emoji} @${event.monitoredUsername} (${event.monitoredFullName || ''}) ${actionDE}:
${emoji} @${event.monitoredUsername} ${actionEN}:

${actionEmoji} @${event.targetUsername} (${event.targetFullName || ''})
🔗 instagram.com/${event.targetUsername}

#Instagram #FollowerWatch #Bundesliga`;

        console.log(`\n   📝 Tweet:\n${text.split('\n').map(l => '      ' + l).join('\n')}\n`);

        try {
            const tweetUrl = await postTweetInline(page, text);

            if (tweetUrl) {
                successCount++;
                // Event als verarbeitet markieren
                await db.execute({
                    sql: `UPDATE ChangeEvent SET processed = 1, processedAt = datetime('now') WHERE id = ?`,
                    args: [event.id]
                });
                console.log(`   💾 Event als verarbeitet markiert.`);
            } else {
                console.log(`   ⚠️ Tweet fehlgeschlagen`);
                failCount++;
            }
        } catch (err: any) {
            console.error(`   ❌ Fehler: ${err.message}`);
            failCount++;
            await page.screenshot({ path: path.join(DEBUG_DIR, `retry-error-${eventNum}.png`) }).catch(() => { });
        }

        // Warte zwischen Posts (außer beim letzten)
        if (i < result.rows.length - 1) {
            await sleep(DELAY_BETWEEN_POSTS_MS);
        }
    }

    // Aufräumen
    await closeTwitterContext(context);

    console.log(`\n═══════════════════════════════════════════════════`);
    console.log(`📊 ZUSAMMENFASSUNG`);
    console.log(`   ✅ Erfolgreich: ${successCount}`);
    console.log(`   ❌ Fehlgeschlagen: ${failCount}`);
    console.log(`═══════════════════════════════════════════════════\n`);
}

retryUnprocessedEvents().catch(console.error);
