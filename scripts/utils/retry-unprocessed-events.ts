/**
 * 🔄 RETRY UNPROCESSED EVENTS (V4)
 * 
 * Gruppiert Events pro Account + Typ in einen einzigen Tweet.
 * z.B. 3 Unfollows von @esmuellert → 1 Tweet mit allen 3 Targets.
 */

import { createClient } from '@libsql/client';
import { getTwitterContext, closeTwitterContext } from '../lib/twitter-auto-login';
import 'dotenv/config';
import path from 'path';
import fs from 'fs';

const DELAY_BETWEEN_POSTS_MS = 15 * 60 * 1000; // 15 Minuten
const MAX_GROUPS_PER_RUN = 10;
const MAX_CONSECUTIVE_FAILURES = 3;
const DEBUG_DIR = path.join(process.cwd(), 'public/debug');

interface GroupedEvent {
    monitoredUsername: string;
    monitoredFullName: string;
    type: string;
    targets: { username: string; fullName: string | null }[];
    eventIds: string[];
    screenshotUrl: string | null;
    profileId: string;
}

async function sleep(ms: number) {
    console.log(`   ⏰ Warte ${Math.round(ms / 60000)} Minuten...`);
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveImagePath(imagePath: string): string | null {
    let localPath = imagePath;
    if (localPath.startsWith('http')) {
        const mainIdx = localPath.indexOf('/main/');
        if (mainIdx !== -1) {
            localPath = localPath.substring(mainIdx + 6);
        }
    }

    let absolutePath = path.isAbsolute(localPath) ? localPath : path.join(process.cwd(), localPath);

    // Fallback: Suche neuesten Screenshot für diesen User
    if (!fs.existsSync(absolutePath)) {
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

    return fs.existsSync(absolutePath) ? absolutePath : null;
}

function formatGroupedTweet(group: GroupedEvent): string {
    const count = group.targets.length;
    const personDE = count === 1 ? 'Person' : 'Personen';
    const personEN = count === 1 ? 'person' : 'people';

    const isFollow = group.type === 'FOLLOW';
    const emoji = isFollow ? '✅' : '👀';
    const actionDE = isFollow ? `folgt ${count} neuen ${personDE}` : `entfolgte ${count} ${personDE}`;
    const actionEN = isFollow ? `now follows ${count} ${personEN}` : `unfollowed ${count} ${personEN}`;
    const actionEmoji = isFollow ? '➕' : '❌';

    const targetLines = group.targets.map(t => {
        return `${actionEmoji} @${t.username}\n🔗 instagram.com/${t.username}`;
    }).join('\n\n');

    return `${emoji} @${group.monitoredUsername} ${actionDE}:
${emoji} @${group.monitoredUsername} ${actionEN}:

${targetLines}

#Instagram #FollowerWatch #Bundesliga`;
}

async function postTweet(page: any, text: string, imagePath?: string | null): Promise<boolean> {
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

        // Bild hochladen
        if (imagePath) {
            console.log(`   🖼️ Lade Bild hoch: ${path.basename(imagePath)}`);
            const fileInput = page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(imagePath);
            await page.waitForTimeout(8000);
        }

        // Hashtag-Dropdown schließen
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Debug-Screenshot VOR dem Senden
        await page.screenshot({ path: `${DEBUG_DIR}/before-post-${Date.now()}.png` }).catch(() => { });

        console.log('   📤 Sende Tweet...');
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(3000);

        // Verifikation: Toast oder leeres Textfeld
        let verified = false;

        // Methode 1: Toast "Your post was sent"
        try {
            const toast = page.getByText('Your post was sent').first();
            await toast.waitFor({ timeout: 8000 });
            console.log('   ✅ Toast erkannt: "Your post was sent"!');
            verified = true;
        } catch {
            console.log('   ℹ️ Kein Toast, prüfe Textfeld...');
        }

        // Methode 2: Textfeld ist leer
        if (!verified) {
            try {
                const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
                const textLeft = await textarea.innerText().catch(() => '');
                if (!textLeft || textLeft.trim().length === 0) {
                    console.log('   ✅ Textfeld leer -> Post gesendet!');
                    verified = true;
                } else {
                    // Fallback: Button klicken
                    console.log('   🔄 Versuche Button...');
                    const postBtn = page.locator('[data-testid="tweetButtonInline"]').first();
                    if (await postBtn.isVisible()) {
                        await postBtn.click();
                        await page.waitForTimeout(5000);
                        const textAfter = await textarea.innerText().catch(() => '');
                        if (!textAfter || textAfter.trim().length === 0) {
                            console.log('   ✅ Button-Klick erfolgreich!');
                            verified = true;
                        }
                    }
                }
            } catch { }
        }

        await page.screenshot({ path: `${DEBUG_DIR}/after-post-${Date.now()}.png` }).catch(() => { });
        return verified;
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
        ORDER BY ce.profileId, ce.type, ce.detectedAt DESC
    `);

    if (result.rows.length === 0) {
        console.log('✅ Keine unverarbeiteten Events gefunden.');
        return;
    }

    // ═══ GRUPPIERUNG: Events pro Account + Typ zusammenfassen ═══
    const groupMap = new Map<string, GroupedEvent>();

    for (const event of result.rows) {
        const key = `${event.monitoredUsername}_${event.type}`;

        if (!groupMap.has(key)) {
            groupMap.set(key, {
                monitoredUsername: String(event.monitoredUsername),
                monitoredFullName: String(event.monitoredFullName || ''),
                type: String(event.type),
                targets: [],
                eventIds: [],
                screenshotUrl: event.screenshotUrl ? String(event.screenshotUrl) : null,
                profileId: String(event.profileId)
            });
        }

        const group = groupMap.get(key)!;
        group.targets.push({
            username: String(event.targetUsername),
            fullName: event.targetFullName ? String(event.targetFullName) : null
        });
        group.eventIds.push(String(event.id));
    }

    const groups = Array.from(groupMap.values()).slice(0, MAX_GROUPS_PER_RUN);

    console.log(`📋 ${result.rows.length} Events → ${groups.length} gruppierte Posts\n`);

    for (const group of groups) {
        console.log(`   📦 @${group.monitoredUsername} ${group.type}: ${group.targets.length} Targets`);
    }

    let page: any = null;
    let context: any = null;
    let successCount = 0;
    let failCount = 0;
    let consecutiveFailures = 0;

    async function startBrowser() {
        console.log('\n🐦 Starte Twitter Session...');
        const ctx = await getTwitterContext(true);
        page = ctx.page;
        context = ctx.context;
        console.log('   ✅ Browser bereit');
    }

    await startBrowser();

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];

        console.log(`\n═══════════════════════════════════════════════════`);
        console.log(`📝 Gruppe ${i + 1}/${groups.length}`);
        console.log(`   Monitor: @${group.monitoredUsername}`);
        console.log(`   ${group.type}: ${group.targets.map(t => '@' + t.username).join(', ')}`);
        console.log(`═══════════════════════════════════════════════════`);

        const text = formatGroupedTweet(group);

        // Bild auflösen
        let imagePath: string | null = null;
        if (group.screenshotUrl) {
            console.log(`   🖼️ Suche Screenshot...`);
            imagePath = resolveImagePath(group.screenshotUrl);
            if (!imagePath) {
                console.log(`   ⚠️ Kein Bild verfügbar.`);
            }
        }

        try {
            const success = await postTweet(page, text, imagePath);

            if (success) {
                console.log(`   ✅ Gruppierter Tweet gepostet! (${group.targets.length} Targets)`);
                successCount++;
                consecutiveFailures = 0;

                // Alle Events in der Gruppe als processed markieren
                for (const eventId of group.eventIds) {
                    await db.execute({
                        sql: `UPDATE ChangeEvent SET processed = 1 WHERE id = ?`,
                        args: [eventId]
                    });
                }
                console.log(`   💾 ${group.eventIds.length} Events markiert.`);

                // Browser neu starten
                console.log('   🔄 Browser-Neustart...');
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
            await closeTwitterContext(context).catch(() => { });
            await startBrowser();
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(`\n🛑 ${MAX_CONSECUTIVE_FAILURES} Fehler in Folge - Abbruch!`);
            break;
        }

        if (i < groups.length - 1 && consecutiveFailures === 0) {
            await sleep(DELAY_BETWEEN_POSTS_MS);
        }
    }

    console.log(`\n═══════════════════════════════════════════════════`);
    console.log(`📊 ZUSAMMENFASSUNG`);
    console.log(`   ✅ Erfolgreich: ${successCount} Gruppen`);
    console.log(`   ❌ Fehlgeschlagen: ${failCount} Gruppen`);
    console.log(`═══════════════════════════════════════════════════\n`);

    await closeTwitterContext(context).catch(() => { });
}

retryUnprocessedEvents().catch(console.error);
