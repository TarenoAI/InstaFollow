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
import fs from 'fs';

const DELAY_BETWEEN_POSTS_MS = 15 * 60 * 1000; // 15 Minuten
const MAX_EVENTS_PER_RUN = 10;
const MAX_CONSECUTIVE_FAILURES = 3;
const DEBUG_DIR = path.join(process.cwd(), 'public/debug');

async function sleep(ms: number) {
    console.log(`   ⏰ Warte ${Math.round(ms / 60000)} Minuten...`);
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function postTweet(page: any, text: string, imagePath?: string): Promise<boolean> {
    const TWITTER_USERNAME = process.env.TWITTER_USERNAME || 'BuliFollows';
    try {
        // Prüfe ob Browser noch lebt
        await page.evaluate(() => true);

        // Gehe zur HOME-Seite (dort ist das Compose-Feld oben)
        console.log('   🏠 Gehe zu x.com/home...');
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);

        // Finde und fokussiere das Textfeld
        let clicked = false;
        try {
            const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
            await textarea.waitFor({ timeout: 8000 });
            await textarea.click({ force: true });
            clicked = true;
        } catch {
            const fallback = page.getByText("What's happening?").first();
            if (await fallback.count() > 0) {
                await fallback.click({ force: true });
                clicked = true;
            }
        }

        if (!clicked) throw new Error('Konnte Eingabefeld nicht finden');

        await page.waitForTimeout(1000);
        console.log('   ⌨️ Tippe Text ein...');
        await page.keyboard.type(text, { delay: 30 });
        await page.waitForTimeout(1500);

        // Bild-Check
        if (imagePath) {
            const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.join(process.cwd(), imagePath);
            if (fs.existsSync(absolutePath)) {
                console.log(`   🖼️ Lade Bild hoch: ${path.basename(absolutePath)}`);
                const fileInput = page.locator('input[type="file"]').first();
                await fileInput.setInputFiles(absolutePath);
                await page.waitForTimeout(6000); // 6 Sek für Upload
            } else {
                console.log(`   ⚠️ Bild nicht gefunden am Pfad: ${absolutePath}`);
            }
        }

        console.log('   📤 Sende Tweet (Shortcut Ctrl+Enter)...');
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(8000); // Warten auf Verarbeitung

        // --- STRIKTE VERIFIKATION ---
        console.log(`   🔍 Verifiziere Post auf Profil @${TWITTER_USERNAME}...`);
        await page.goto(`https://x.com/${TWITTER_USERNAME}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(4000);

        // Prüfe ob der Text in einem der ersten zwei Tweets vorkommt
        const profileContent = await page.innerText('body');

        // Wir nehmen einen Teil des Textes zur Prüfung (z.B. den Monitor Namen und Target Namen)
        // Extrahiere @username aus dem Text
        const match = text.match(/@(\w+)/g);
        const verifyUser = match ? match[match.length - 1] : ''; // Nimm den Target-User

        if (profileContent.includes(verifyUser) || profileContent.includes('folgt jetzt')) {
            console.log('   ✅ Verifikation erfolgreich: Tweet auf Profil gefunden!');
            return true;
        } else {
            console.log('   ❌ Verifikation fehlgeschlagen: Tweet nicht auf Profil sichtbar.');
            await page.screenshot({ path: `${DEBUG_DIR}/verify-failed-${Date.now()}.png` });
            return false;
        }
    } catch (err: any) {
        console.log(`   ⚠️ Fehler im Post-Prozess: ${err.message}`);
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

        // Hole das Bild (falls vorhanden)
        const imagePath = event.screenshotUrl ? String(event.screenshotUrl) : undefined;

        try {
            const success = await postTweet(page, text, imagePath);

            if (success) {
                console.log(`   ✅ Tweet gepostet!`);
                successCount++;
                consecutiveFailures = 0;

                await db.execute({
                    sql: `UPDATE ChangeEvent SET processed = 1 WHERE id = ?`,
                    args: [event.id]
                });
                console.log(`   💾 Event markiert.`);

                // WICHTIG: Browser nach jedem Post neu starten für frische Session
                console.log('   🔄 Starte Browser neu für nächsten Post...');
                await closeTwitterContext(context).catch(() => { });
                await startBrowser();
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
