/**
 * 🔄 RETRY UNPROCESSED EVENTS (V2)
 * 
 * Verbesserte Version mit:
 * - Browser-Neustart bei Absturz
 * - Max 10 Events pro Durchlauf
 * - Abbruch nach 3 Fehlern in Folge
 */

import { createClient } from '@libsql/client';
import { getTwitterContext, closeTwitterContext } from '../lib/twitter-auto-login';
import 'dotenv/config';
import path from 'path';

const DELAY_BETWEEN_POSTS_MS = 15 * 60 * 1000; // 15 Minuten
const MAX_EVENTS_PER_RUN = 10;
const MAX_CONSECUTIVE_FAILURES = 3;
const DEBUG_DIR = path.join(process.cwd(), 'public/debug');

async function sleep(ms: number) {
    console.log(`   ⏰ Warte ${Math.round(ms / 60000)} Minuten...`);
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function postTweet(page: any, text: string): Promise<boolean> {
    try {
        // Prüfe ob Browser noch lebt
        await page.evaluate(() => true);

        // Gehe zur Compose-Seite (per Dokumentation: /compose/post)
        await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Finde Textfeld (per Dokumentation: div[data-testid="tweetTextarea_0"])
        const textarea = page.locator('[data-testid="tweetTextarea_0"]');
        await textarea.waitFor({ timeout: 10000 });
        await textarea.click();
        await page.waitForTimeout(500);

        // Text eingeben
        await page.keyboard.type(text, { delay: 30 });
        await page.waitForTimeout(1000);

        // Post absenden (per Dokumentation: Control+Enter ist primäre Methode)
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(5000);

        // Prüfe ob erfolgreich (URL sollte sich ändern, nicht mehr compose)
        const url = page.url();
        return !url.includes('compose');
    } catch (err: any) {
        console.log(`   ⚠️ Fehler: ${err.message}`);
        return false;
    }
}

async function retryUnprocessedEvents() {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN
    });

    console.log('\n🔍 Suche unverarbeitete Events (letzte 24h)...');

    const result = await db.execute(`
        SELECT ce.*, mp.username as monitoredUsername, mp.fullName as monitoredFullName
        FROM ChangeEvent ce
        JOIN MonitoredProfile mp ON ce.profileId = mp.id
        WHERE ce.processed = 0
        AND ce.detectedAt > datetime('now', '-1 day')
        ORDER BY ce.detectedAt DESC
        LIMIT ${MAX_EVENTS_PER_RUN}
    `);

    if (result.rows.length === 0) {
        console.log('✅ Keine unverarbeiteten Events gefunden.');
        return;
    }

    console.log(`📋 ${result.rows.length} Events werden verarbeitet (max ${MAX_EVENTS_PER_RUN}).\n`);

    let page: any = null;
    let context: any = null;
    let successCount = 0;
    let failCount = 0;
    let consecutiveFailures = 0;

    // Browser starten
    async function startBrowser() {
        console.log('🐦 Starte Twitter Session...');
        const result = await getTwitterContext(true);
        if (!result.page || !result.context) {
            throw new Error('Browser konnte nicht gestartet werden');
        }
        page = result.page;
        context = result.context;
        console.log('   ✅ Browser bereit');
    }

    await startBrowser();

    for (let i = 0; i < result.rows.length; i++) {
        const event = result.rows[i];
        const eventNum = i + 1;

        console.log(`\n═══════════════════════════════════════════════════`);
        console.log(`📝 Event ${eventNum}/${result.rows.length}`);
        console.log(`   Monitor: @${event.monitoredUsername}`);
        console.log(`   ${event.type}: @${event.targetUsername}`);
        console.log(`═══════════════════════════════════════════════════`);

        const emoji = event.type === 'FOLLOW' ? '✅' : '👀';
        const actionEmoji = event.type === 'FOLLOW' ? '➕' : '❌';
        const actionDE = event.type === 'FOLLOW' ? 'folgt jetzt' : 'folgt nicht mehr';
        const actionEN = event.type === 'FOLLOW' ? 'now follows' : 'unfollowed';

        const text = `${emoji} @${event.monitoredUsername} (${event.monitoredFullName || ''}) ${actionDE}:
${emoji} @${event.monitoredUsername} ${actionEN}:

${actionEmoji} @${event.targetUsername} (${event.targetFullName || ''})
🔗 instagram.com/${event.targetUsername}

#Instagram #FollowerWatch #Bundesliga`;

        try {
            const success = await postTweet(page, text);

            if (success) {
                console.log(`   ✅ Tweet gepostet!`);
                successCount++;
                consecutiveFailures = 0;

                await db.execute({
                    sql: `UPDATE ChangeEvent SET processed = 1 WHERE id = ?`,
                    args: [event.id]
                });
                console.log(`   💾 Event markiert.`);
            } else {
                console.log(`   ❌ Tweet fehlgeschlagen`);
                failCount++;
                consecutiveFailures++;
            }
        } catch (err: any) {
            console.log(`   ❌ Fehler: ${err.message}`);
            failCount++;
            consecutiveFailures++;

            // Browser neu starten bei Absturz
            console.log('   🔄 Versuche Browser-Neustart...');
            try {
                await closeTwitterContext(context).catch(() => { });
                await startBrowser();
                consecutiveFailures = 0; // Reset nach erfolgreichem Neustart
            } catch {
                console.log('   ❌ Browser-Neustart fehlgeschlagen, breche ab.');
                break;
            }
        }

        // Abbruch bei zu vielen Fehlern
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(`\n🛑 ${MAX_CONSECUTIVE_FAILURES} Fehler in Folge - Abbruch!`);
            break;
        }

        // Warte zwischen Posts
        if (i < result.rows.length - 1 && successCount > 0) {
            await sleep(DELAY_BETWEEN_POSTS_MS);
        }
    }

    // Aufräumen
    if (context) await closeTwitterContext(context).catch(() => { });

    console.log(`\n═══════════════════════════════════════════════════`);
    console.log(`📊 ZUSAMMENFASSUNG`);
    console.log(`   ✅ Erfolgreich: ${successCount}`);
    console.log(`   ❌ Fehlgeschlagen: ${failCount}`);
    console.log(`═══════════════════════════════════════════════════\n`);
}

retryUnprocessedEvents().catch(console.error);
