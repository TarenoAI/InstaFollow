/**
 * 🔄 RETRY UNPROCESSED EVENTS (V3)
 * 
 * Verbesserte Version mit:
 * - Strikter Profil-Verifikation
 * - Support für Usernames mit Punkten
 * - Hashtag-Autocomplete Fix (Escape)
 * - Bild-Pfad Korrektur (GitHub URL -> Local)
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
        await page.evaluate(() => true);

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
            let localPath = imagePath;
            if (localPath.startsWith('http')) {
                const mainIdx = localPath.indexOf('/main/');
                if (mainIdx !== -1) {
                    localPath = localPath.substring(mainIdx + 6);
                }
            }

            let absolutePath = path.isAbsolute(localPath) ? localPath : path.join(process.cwd(), localPath);

            // Fallback auf neuesten Screenshot falls exakt nicht da
            if (!fs.existsSync(absolutePath)) {
                console.log(`   ⚠️ Screenshot nicht am Pfad gefunden, suche Alternative...`);
                const screenshotsDir = path.join(process.cwd(), 'public/screenshots');
                const filename = path.basename(localPath);
                const usernamePart = filename.split('-')[0];
                if (usernamePart && fs.existsSync(screenshotsDir)) {
                    const files = fs.readdirSync(screenshotsDir)
                        .filter(f => f.startsWith(usernamePart) && f.endsWith('.png'))
                        .sort().reverse();
                    if (files.length > 0) {
                        absolutePath = path.join(screenshotsDir, files[0]);
                        console.log(`   🖼️ Alternative gefunden: ${files[0]}`);
                    }
                }
            }

            if (fs.existsSync(absolutePath)) {
                console.log(`   🖼️ Lade Bild hoch: ${path.basename(absolutePath)}`);
                const fileInput = page.locator('input[type="file"]').first();
                await fileInput.setInputFiles(absolutePath);
                await page.waitForTimeout(8000);
            } else {
                console.log(`   ⚠️ Kein Bild verfügbar.`);
            }
        }

        // Hashtag-Dropdown schließen
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Debug-Screenshot VOR dem Senden
        await page.screenshot({ path: `${DEBUG_DIR}/before-post-${Date.now()}.png` }).catch(() => { });

        console.log('   📤 Sende Tweet...');
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(3000);

        // Verifikation: Suche nach "Your post was sent" Toast oder leeres Textfeld
        let verified = false;

        // Methode 1: Toast-Nachricht "Your post was sent"
        try {
            const toast = page.getByText('Your post was sent').first();
            await toast.waitFor({ timeout: 8000 });
            console.log('   ✅ Toast erkannt: "Your post was sent"!');
            verified = true;
        } catch {
            console.log('   ℹ️ Kein Toast erkannt, prüfe Textfeld...');
        }

        // Methode 2: Textfeld ist leer (Post wurde gesendet)
        if (!verified) {
            try {
                const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
                const textLeft = await textarea.innerText().catch(() => '');
                if (!textLeft || textLeft.trim().length === 0) {
                    console.log('   ✅ Textfeld ist leer -> Post gesendet!');
                    verified = true;
                } else {
                    console.log(`   ⚠️ Textfeld hat noch Inhalt: "${textLeft.substring(0, 30)}..."`);
                    // Fallback: Button klicken
                    console.log('   🔄 Versuche Button zu klicken...');
                    const postBtn = page.locator('[data-testid="tweetButtonInline"]').first();
                    if (await postBtn.isVisible()) {
                        await postBtn.click();
                        await page.waitForTimeout(5000);
                        const textAfterBtn = await textarea.innerText().catch(() => '');
                        if (!textAfterBtn || textAfterBtn.trim().length === 0) {
                            console.log('   ✅ Button-Klick erfolgreich!');
                            verified = true;
                        }
                    }
                }
            } catch { }
        }

        await page.screenshot({ path: `${DEBUG_DIR}/after-post-${Date.now()}.png` }).catch(() => { });

        if (verified) {
            console.log('   ✅ Tweet erfolgreich gepostet!');
            return true;
        } else {
            console.log('   ❌ Tweet konnte nicht verifiziert werden.');
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

    async function startBrowser() {
        console.log('🐦 Starte Twitter Session...');
        const ctx = await getTwitterContext(true);
        page = ctx.page;
        context = ctx.context;
        console.log('   ✅ Twitter Session aktiv');
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

                console.log('   🔄 Starte Browser neu für nächsten Post...');
                await closeTwitterContext(context).catch(() => { });
                await startBrowser();
            } else {
                console.log(`   ❌ Tweet fehlgeschlagen`);
                failCount++;
                consecutiveFailures++;
            }
        } catch (err: any) {
            console.log(`   ❌ Kritischer Fehler: ${err.message}`);
            failCount++;
            consecutiveFailures++;
            await closeTwitterContext(context).catch(() => { });
            await startBrowser();
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(`\n🛑 ${MAX_CONSECUTIVE_FAILURES} Fehler in Folge - Abbruch!`);
            break;
        }

        if (i < result.rows.length - 1 && consecutiveFailures === 0) {
            await sleep(DELAY_BETWEEN_POSTS_MS);
        }
    }

    console.log(`\n═══════════════════════════════════════════════════`);
    console.log(`📊 ZUSAMMENFASSUNG`);
    console.log(`   ✅ Erfolgreich: ${successCount}`);
    console.log(`   ❌ Fehlgeschlagen: ${failCount}`);
    console.log(`═══════════════════════════════════════════════════\n`);

    await closeTwitterContext(context);
}

retryUnprocessedEvents().catch(console.error);
