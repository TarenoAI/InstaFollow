/**
 * 🔄 RETRY UNPROCESSED EVENTS
 * 
 * Holt alle Events mit processed=0 und postet sie auf Twitter.
 * Wartet 15 Minuten zwischen den Posts, um Rate Limits zu vermeiden.
 */

import { createClient } from '@libsql/client';
import { getTwitterContext, closeTwitterContext, postTweet } from '../lib/twitter-auto-login';
import 'dotenv/config';
import path from 'path';
import fs from 'fs';

const DELAY_BETWEEN_POSTS_MS = 15 * 60 * 1000; // 15 Minuten
const DEBUG_DIR = path.join(process.cwd(), 'public/debug');

async function sleep(ms: number) {
    console.log(`   ⏰ Warte ${Math.round(ms / 60000)} Minuten...`);
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryUnprocessedEvents() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    console.log('\n🔍 Suche unverarbeitete Events...');

    // Hole alle unverarbeiteten Events
    const result = await db.execute(`
        SELECT ce.*, mp.username as monitoredUsername, mp.fullName as monitoredFullName
        FROM ChangeEvent ce
        JOIN MonitoredProfile mp ON ce.profileId = mp.id
        WHERE ce.processed = 0
        ORDER BY ce.detectedAt ASC
    `);

    if (result.rows.length === 0) {
        console.log('✅ Keine unverarbeiteten Events gefunden.');
        return;
    }

    console.log(`📋 ${result.rows.length} Events gefunden.\n`);

    // Browser starten
    console.log('🐦 Starte Twitter Session...');
    const { page, context, browser } = await getTwitterContext(true);
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
            // Tweet posten
            const tweetUrl = await postTweet(page, text);

            if (tweetUrl) {
                console.log(`   ✅ Gepostet: ${tweetUrl}`);
                successCount++;

                // Event als verarbeitet markieren
                await db.execute({
                    sql: `UPDATE ChangeEvent SET processed = 1, processedAt = datetime('now') WHERE id = ?`,
                    args: [event.id]
                });
                console.log(`   💾 Event als verarbeitet markiert.`);
            } else {
                console.log(`   ⚠️ Tweet fehlgeschlagen (kein URL zurück)`);
                failCount++;
            }
        } catch (err: any) {
            console.error(`   ❌ Fehler: ${err.message}`);
            failCount++;

            // Screenshot bei Fehler
            await page.screenshot({ path: path.join(DEBUG_DIR, `retry-error-${eventNum}.png`) });
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
