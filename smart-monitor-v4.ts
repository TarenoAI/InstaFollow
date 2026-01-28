/**
 * 🕵️‍♂️ SMART MONITORING v4 - MIT SCREENSHOTS & TWITTER POST
 * 
 * - Screenshots der Profile bei Änderungen
 * - Automatischer Twitter-Post via Playwright (keine API nötig!)
 * - Webhook-Bestätigung nach Post
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { chromium, devices, Page, BrowserContext, Browser } from 'playwright';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

// === KONFIGURATION ===
const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const TWITTER_SESSION_PATH = path.join(process.cwd(), 'twitter-session.json');
const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');
const iPhone = devices['iPhone 13 Pro'];
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const TWITTER_USERNAME = process.env.TWITTER_USERNAME;
const TWITTER_PASSWORD = process.env.TWITTER_PASSWORD;

// Erstelle Screenshots-Ordner
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// === TYPEN ===
interface ProfileInfo {
    username: string;
    fullName: string;
    profilePicUrl: string;
    followerCount: string;
    followingCount: string;
    isVerified: boolean;
    screenshotPath?: string;
}

interface WebhookPayload {
    event: 'FOLLOW' | 'UNFOLLOW';
    monitoredProfile: ProfileInfo;
    targets: ProfileInfo[];
    timestamp: string;
    summary: string;
    tweetUrl?: string;
}

// === HELPER ===
async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

async function dismissPopups(page: Page) {
    const selectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
    ];
    for (const sel of selectors) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) {
                await btn.click({ force: true });
                await page.waitForTimeout(500);
            }
        } catch { }
    }
}

/**
 * Macht einen Screenshot des Profils (nur Header-Bereich)
 */
async function takeProfileScreenshot(page: Page, username: string): Promise<string> {
    const screenshotPath = path.join(SCREENSHOTS_DIR, `${username}_${Date.now()}.png`);

    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Screenshot nur vom Header-Bereich (Profilbild + Stats)
        const header = await page.$('header');
        if (header) {
            await header.screenshot({ path: screenshotPath });
        } else {
            // Fallback: Oberen Teil der Seite
            await page.screenshot({
                path: screenshotPath,
                clip: { x: 0, y: 0, width: 390, height: 400 }
            });
        }

        console.log(`      📸 Screenshot: ${screenshotPath}`);
        return screenshotPath;
    } catch (err: any) {
        console.log(`      ⚠️ Screenshot fehlgeschlagen: ${err.message}`);
        return '';
    }
}

/**
 * Holt vollständige Profilinformationen + Screenshot
 */
async function getProfileInfo(page: Page, username: string, takeScreenshot: boolean = false): Promise<ProfileInfo | null> {
    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Screenshot wenn gewünscht
        let screenshotPath = '';
        if (takeScreenshot) {
            const header = await page.$('header');
            if (header) {
                screenshotPath = path.join(SCREENSHOTS_DIR, `${username}_${Date.now()}.png`);
                await header.screenshot({ path: screenshotPath });
            }
        }

        // Extrahiere Profilbild
        let profilePicUrl = '';
        try {
            const img = await page.$('header img');
            if (img) profilePicUrl = await img.getAttribute('src') || '';
        } catch { }

        // Extrahiere Full Name
        let fullName = username;
        try {
            const nameEl = await page.$('header section span');
            if (nameEl) {
                fullName = await nameEl.innerText() || username;
                fullName = fullName.replace(/\s*\(@.*\).*$/, '').trim();
            }
        } catch { }

        // Extrahiere Follower/Following
        let followerCount = '0';
        let followingCount = '0';
        let isVerified = false;

        try {
            isVerified = await page.$('[aria-label*="Verified"], svg[aria-label*="Verifiziert"]') !== null;

            const stats = await page.$$eval('a[href*="followers"], a[href*="following"]', (links: any[]) => {
                return links.map(l => ({ href: l.href, text: l.innerText.trim() }));
            });

            for (const stat of stats) {
                if (stat.href.includes('followers')) followerCount = stat.text.split(' ')[0] || '0';
                if (stat.href.includes('following')) followingCount = stat.text.split(' ')[0] || '0';
            }
        } catch { }

        return {
            username,
            fullName,
            profilePicUrl,
            followerCount,
            followingCount,
            isVerified,
            screenshotPath
        };
    } catch (err: any) {
        console.log(`      ⚠️ Profil @${username} nicht ladbar: ${err.message}`);
        return null;
    }
}

/**
 * Holt die Following-Liste
 */
async function getFollowingList(page: Page, username: string): Promise<string[]> {
    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        await page.click('a[href*="following"]', { timeout: 10000 });
        await page.waitForTimeout(3000);

        const following = new Set<string>();
        let noNewCount = 0;

        for (let scroll = 0; scroll < 30 && noNewCount < 5; scroll++) {
            const users = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.getAttribute('href'))
                    .filter(h => h && h.match(/^\/[a-zA-Z0-9._]+\/?$/))
                    .filter(h => !['explore', 'reels', 'p', 'direct', 'accounts', 'stories'].some(x => h!.includes(x)))
                    .map(h => h!.replace(/\//g, ''));
            });

            const prevSize = following.size;
            users.forEach(u => u && following.add(u));

            if (following.size === prevSize) noNewCount++;
            else noNewCount = 0;

            console.log(`   Scroll ${scroll + 1}: ${following.size} gefunden`);
            await page.evaluate(() => window.scrollBy(0, 800));
            await humanDelay(1500, 2500);
        }

        following.delete(username);
        return Array.from(following);
    } catch (err: any) {
        console.log(`   ❌ Scrape-Fehler: ${err.message}`);
        return [];
    }
}

/**
 * Quick-Check: Nur Following-Zahl abrufen
 */
async function getFollowingCount(page: Page, username: string): Promise<number | null> {
    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        const followingLink = await page.$('a[href*="following"]');
        if (followingLink) {
            const text = await followingLink.innerText();
            const match = text.match(/[\d,.]+/);
            if (match) return parseInt(match[0].replace(/[,.]/g, ''));
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * 🐦 Twitter-Post via Playwright (ohne API!)
 */
async function postToTwitter(
    browser: Browser,
    text: string,
    imagePath?: string
): Promise<string | null> {
    if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
        console.log('   ⚠️ TWITTER_USERNAME oder TWITTER_PASSWORD fehlt');
        return null;
    }

    console.log('\n   🐦 Poste auf Twitter...');

    const context = await browser.newContext({
        storageState: fs.existsSync(TWITTER_SESSION_PATH) ? TWITTER_SESSION_PATH : undefined,
        viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    try {
        // Prüfe ob eingeloggt
        await page.goto('https://twitter.com/home', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Login wenn nötig
        if (page.url().includes('login') || await page.$('input[autocomplete="username"]')) {
            console.log('   🔐 Twitter Login...');

            if (!page.url().includes('login')) {
                await page.goto('https://twitter.com/login');
                await page.waitForTimeout(2000);
            }

            await page.fill('input[autocomplete="username"]', TWITTER_USERNAME);
            await page.click('text=Weiter');
            await page.waitForTimeout(2000);

            await page.fill('input[type="password"]', TWITTER_PASSWORD);
            await page.click('text=Anmelden');
            await page.waitForTimeout(5000);

            // Session speichern
            await context.storageState({ path: TWITTER_SESSION_PATH });
        }

        console.log('   ✅ Twitter eingeloggt');

        // Zum Compose-Bereich
        await page.goto('https://twitter.com/compose/tweet', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Text eingeben
        const textArea = await page.$('[data-testid="tweetTextarea_0"]');
        if (textArea) {
            await textArea.fill(text);
            await page.waitForTimeout(1000);
        }

        // Bild hochladen wenn vorhanden
        if (imagePath && fs.existsSync(imagePath)) {
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                await fileInput.setInputFiles(imagePath);
                await page.waitForTimeout(3000);
            }
        }

        // Tweet absenden
        await page.click('[data-testid="tweetButton"]');
        await page.waitForTimeout(5000);

        // Tweet-URL extrahieren (von der Timeline)
        await page.goto(`https://twitter.com/${TWITTER_USERNAME}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const tweetLink = await page.$('article a[href*="/status/"]');
        let tweetUrl = '';
        if (tweetLink) {
            tweetUrl = await tweetLink.getAttribute('href') || '';
            if (tweetUrl) tweetUrl = `https://twitter.com${tweetUrl}`;
        }

        console.log(`   ✅ Tweet gepostet! ${tweetUrl}`);

        await context.storageState({ path: TWITTER_SESSION_PATH });
        await context.close();

        return tweetUrl;
    } catch (err: any) {
        console.log(`   ❌ Twitter Fehler: ${err.message}`);
        await context.close();
        return null;
    }
}

/**
 * Webhook senden
 */
async function sendWebhook(payload: WebhookPayload) {
    if (!N8N_WEBHOOK_URL) return;

    try {
        console.log('   📤 Sende Webhook...');
        await axios.post(N8N_WEBHOOK_URL, payload);
        console.log('   ✅ Webhook gesendet!');
    } catch (err: any) {
        console.log(`   ⚠️ Webhook Fehler: ${err.message}`);
    }
}

/**
 * Formatiert den Tweet-Text
 */
function formatTweetText(event: 'FOLLOW' | 'UNFOLLOW', profile: ProfileInfo, targets: ProfileInfo[]): string {
    const emoji = event === 'FOLLOW' ? '👉' : '👀';
    const actionEmoji = event === 'FOLLOW' ? '✅' : '❌';
    const action = event === 'FOLLOW' ? 'folgt jetzt' : 'folgt nicht mehr';

    let text = `${emoji} ${profile.fullName} (@${profile.username}) ${action} ${targets.length} ${targets.length === 1 ? 'Person' : 'Personen'}:\n\n`;

    for (const target of targets.slice(0, 3)) { // Max 3 um Tweet-Limit zu respektieren
        text += `${actionEmoji} ${target.username} (${target.fullName})\n`;
        text += `🔗 instagram.com/${target.username}\n\n`;
    }

    if (targets.length > 3) {
        text += `... und ${targets.length - 3} weitere`;
    }

    return text;
}

// === MAIN ===
async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(`🕵️ SMART MONITORING v4 - ${new Date().toLocaleString()}`);
    console.log('═'.repeat(60) + '\n');

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined
    });

    const page = await context.newPage();

    try {
        // Login Check für Instagram
        console.log('🌐 Prüfe Instagram Login...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        if (page.url().includes('login')) {
            console.log('❌ Nicht eingeloggt! Bitte Session erneuern.');
            await browser.close();
            return;
        }
        console.log('✅ Eingeloggt!\n');

        // Alle Profile laden
        const profiles = await db.execute("SELECT id, username, followingCount FROM MonitoredProfile");
        console.log(`📋 ${profiles.rows.length} Profile zu prüfen:\n`);

        for (const row of profiles.rows) {
            const profileId = row.id as string;
            const username = row.username as string;
            const lastCount = (row.followingCount as number) || 0;

            console.log('─'.repeat(60));
            console.log(`🔍 @${username} (DB: ${lastCount})`);

            const currentCount = await getFollowingCount(page, username);

            if (currentCount === null) {
                console.log('   ⚠️ Konnte Zahl nicht lesen\n');
                continue;
            }

            console.log(`   Aktuell: ${currentCount}`);

            if (currentCount !== lastCount) {
                console.log(`   🚨 ÄNDERUNG: ${lastCount} → ${currentCount}`);

                // Full Scrape
                const currentFollowing = await getFollowingList(page, username);
                console.log(`   📋 ${currentFollowing.length} Following gescrapt`);

                if (currentFollowing.length > 0) {
                    const oldRows = await db.execute({
                        sql: "SELECT username FROM FollowingEntry WHERE profileId = ?",
                        args: [profileId]
                    });
                    const oldFollowing = new Set(oldRows.rows.map(r => r.username as string));

                    const addedUsernames = currentFollowing.filter(u => !oldFollowing.has(u));
                    const removedUsernames = Array.from(oldFollowing).filter(u => !currentFollowing.includes(u));

                    console.log(`   ➕ Neu: ${addedUsernames.length} | ➖ Entfolgt: ${removedUsernames.length}`);

                    if (addedUsernames.length > 0 || removedUsernames.length > 0) {
                        // Lade Profil-Infos mit Screenshots
                        console.log('\n   📊 Lade Profilinfos mit Screenshots...');

                        const monitoredProfileInfo = await getProfileInfo(page, username, true);
                        if (!monitoredProfileInfo) continue;

                        // Verarbeite FOLLOWS
                        if (addedUsernames.length > 0) {
                            console.log(`\n   🆕 Verarbeite ${addedUsernames.length} neue Follows...`);
                            const addedProfiles: ProfileInfo[] = [];

                            for (const targetUsername of addedUsernames) {
                                console.log(`      → @${targetUsername}`);
                                const info = await getProfileInfo(page, targetUsername, true);
                                if (info) addedProfiles.push(info);
                                await humanDelay(2000, 4000);
                            }

                            if (addedProfiles.length > 0) {
                                // Tweet formatieren
                                const tweetText = formatTweetText('FOLLOW', monitoredProfileInfo, addedProfiles);

                                // Twitter Post
                                const tweetUrl = await postToTwitter(
                                    browser,
                                    tweetText,
                                    monitoredProfileInfo.screenshotPath
                                );

                                // Webhook senden
                                await sendWebhook({
                                    event: 'FOLLOW',
                                    monitoredProfile: monitoredProfileInfo,
                                    targets: addedProfiles,
                                    timestamp: new Date().toISOString(),
                                    summary: `${monitoredProfileInfo.username} folgt ${addedProfiles.length} neuen Personen`,
                                    tweetUrl: tweetUrl || undefined
                                });
                            }
                        }

                        // Verarbeite UNFOLLOWS
                        if (removedUsernames.length > 0) {
                            console.log(`\n   ❌ Verarbeite ${removedUsernames.length} Entfolgungen...`);
                            const removedProfiles: ProfileInfo[] = [];

                            for (const targetUsername of removedUsernames) {
                                console.log(`      → @${targetUsername}`);
                                const info = await getProfileInfo(page, targetUsername, true);
                                if (info) removedProfiles.push(info);
                                await humanDelay(2000, 4000);
                            }

                            if (removedProfiles.length > 0) {
                                const tweetText = formatTweetText('UNFOLLOW', monitoredProfileInfo, removedProfiles);

                                const tweetUrl = await postToTwitter(
                                    browser,
                                    tweetText,
                                    removedProfiles[0]?.screenshotPath || monitoredProfileInfo.screenshotPath
                                );

                                await sendWebhook({
                                    event: 'UNFOLLOW',
                                    monitoredProfile: monitoredProfileInfo,
                                    targets: removedProfiles,
                                    timestamp: new Date().toISOString(),
                                    summary: `${monitoredProfileInfo.username} folgt ${removedProfiles.length} Personen nicht mehr`,
                                    tweetUrl: tweetUrl || undefined
                                });
                            }
                        }

                        // DB aktualisieren
                        console.log('\n   💾 Aktualisiere Datenbank...');
                        await db.execute({ sql: "DELETE FROM FollowingEntry WHERE profileId = ?", args: [profileId] });

                        for (let i = 0; i < currentFollowing.length; i++) {
                            await db.execute({
                                sql: `INSERT INTO FollowingEntry (id, username, position, profileId, addedAt, lastSeenAt, missedScans) 
                                      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                                args: [`v4_${Date.now()}_${i}`, currentFollowing[i], i, profileId]
                            });
                        }

                        // Aktualisiere auch Profilinfos (Follower, Bild, etc.)
                        const followerNum = parseInt(monitoredProfileInfo.followerCount.replace(/[,.KMB]/g, '') || '0');
                        await db.execute({
                            sql: `UPDATE MonitoredProfile SET 
                                  followingCount = ?, 
                                  followerCount = ?,
                                  fullName = ?,
                                  profilePicUrl = ?,
                                  isVerified = ?,
                                  lastCheckedAt = datetime('now') 
                                  WHERE id = ?`,
                            args: [
                                currentCount,
                                followerNum,
                                monitoredProfileInfo.fullName || username,
                                monitoredProfileInfo.profilePicUrl || null,
                                monitoredProfileInfo.isVerified ? 1 : 0,
                                profileId
                            ]
                        });
                    } else {
                        // Keine neuen/entfernten Follows, nur Count updaten
                        await db.execute({
                            sql: "UPDATE MonitoredProfile SET followingCount = ?, lastCheckedAt = datetime('now') WHERE id = ?",
                            args: [currentCount, profileId]
                        });
                    }
                }
            } else {
                console.log('   ✅ Keine Änderung');
                await db.execute({
                    sql: "UPDATE MonitoredProfile SET lastCheckedAt = datetime('now') WHERE id = ?",
                    args: [profileId]
                });
            }

            console.log('');
            await humanDelay(5000, 10000);
        }

        await context.storageState({ path: SESSION_PATH });
        console.log('💾 Instagram Session gespeichert');

    } catch (err: any) {
        console.error('\n❌ Fehler:', err.message);
    } finally {
        await browser.close();
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Monitoring abgeschlossen');
    console.log('═'.repeat(60) + '\n');
}

main();
