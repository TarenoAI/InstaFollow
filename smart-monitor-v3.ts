/**
 * 🕵️‍♂️ SMART MONITORING v3 - RICH DATA für n8n Posts
 * 
 * Holt vollständige Profilinformationen für jeden Follow/Unfollow
 * um Posts wie @takiprazzi zu erstellen.
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { chromium, devices, Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

// === KONFIGURATION ===
const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

// === TYPEN ===
interface ProfileInfo {
    username: string;
    fullName: string;
    profilePicUrl: string;
    followerCount: string;
    followingCount: string;
    isVerified: boolean;
}

interface WebhookPayload {
    event: 'FOLLOW' | 'UNFOLLOW';
    monitoredProfile: ProfileInfo;
    targets: ProfileInfo[];
    timestamp: string;
    summary: string;
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

async function ensureLoggedIn(page: Page, context: BrowserContext): Promise<boolean> {
    console.log('🌐 Prüfe Login-Status...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await dismissPopups(page);

    const isLoginPage = page.url().includes('login') || await page.$('input[name="username"]') !== null;

    if (isLoginPage) {
        console.log('🔐 Login erforderlich...');
        const username = process.env.INSTAGRAM_USERNAME;
        const password = process.env.INSTAGRAM_PASSWORD;

        if (!username || !password) {
            console.error('❌ INSTAGRAM_USERNAME oder INSTAGRAM_PASSWORD fehlt!');
            return false;
        }

        if (!page.url().includes('login')) {
            await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
        }

        await dismissPopups(page);
        await page.fill('input[name="username"]', username);
        await humanDelay(500, 1000);
        await page.fill('input[name="password"]', password);
        await humanDelay(500, 1000);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(8000);
        await dismissPopups(page);

        if (page.url().includes('challenge') || page.url().includes('login')) {
            console.log('⚠️ Instagram Challenge erkannt!');
            return false;
        }

        await context.storageState({ path: SESSION_PATH });
        console.log('💾 Session gespeichert!');
    }

    console.log('✅ Eingeloggt!\n');
    return true;
}

/**
 * Holt vollständige Profilinformationen eines Users
 */
async function getProfileInfo(page: Page, username: string): Promise<ProfileInfo | null> {
    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Extrahiere Profilbild
        let profilePicUrl = '';
        try {
            const img = await page.$('header img');
            if (img) {
                profilePicUrl = await img.getAttribute('src') || '';
            }
        } catch { }

        // Extrahiere Full Name (meist im header oder meta)
        let fullName = '';
        try {
            // Versuche verschiedene Selektoren
            const nameEl = await page.$('header section span') ||
                await page.$('meta[property="og:title"]');
            if (nameEl) {
                fullName = await nameEl.getAttribute('content') || await nameEl.innerText() || '';
                fullName = fullName.replace(/\s*\(@.*\).*$/, '').trim(); // "Name (@user)" -> "Name"
            }
        } catch { }

        // Extrahiere Follower/Following Zahlen
        let followerCount = '0';
        let followingCount = '0';
        let isVerified = false;

        try {
            // Suche nach Verified Badge
            isVerified = await page.$('[aria-label*="Verified"], [title*="Verified"], svg[aria-label*="Verifiziert"]') !== null;

            // Hole alle Links und finde follower/following
            const stats = await page.$$eval('a[href*="followers"], a[href*="following"]', (links: any[]) => {
                return links.map(l => ({
                    href: l.href,
                    text: l.innerText.trim()
                }));
            });

            for (const stat of stats) {
                if (stat.href.includes('followers')) {
                    followerCount = stat.text.split(' ')[0] || '0';
                }
                if (stat.href.includes('following')) {
                    followingCount = stat.text.split(' ')[0] || '0';
                }
            }

            // Fallback: Suche in header section
            if (followerCount === '0') {
                const headerText = await page.$eval('header section', (el: any) => el.innerText);
                const followerMatch = headerText.match(/(\d[\d,.KMB]*)\s*(Follower|Abonnenten)/i);
                const followingMatch = headerText.match(/(\d[\d,.KMB]*)\s*(Following|Abonniert)/i);
                if (followerMatch) followerCount = followerMatch[1];
                if (followingMatch) followingCount = followingMatch[1];
            }
        } catch { }

        // Fallback für Full Name
        if (!fullName) {
            fullName = username;
        }

        return {
            username,
            fullName,
            profilePicUrl,
            followerCount,
            followingCount,
            isVerified
        };
    } catch (err: any) {
        console.log(`      ⚠️ Konnte @${username} nicht laden: ${err.message}`);
        return null;
    }
}

/**
 * Holt die Following-Liste mit Usernamen
 */
async function getFollowingList(page: Page, username: string): Promise<string[]> {
    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Klicke auf Following
        await page.click('a[href*="following"]', { timeout: 10000 });
        await page.waitForTimeout(3000);

        const following = new Set<string>();
        let noNewCount = 0;

        for (let scroll = 0; scroll < 30 && noNewCount < 5; scroll++) {
            const users = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.getAttribute('href'))
                    .filter(h => h && h.match(/^\/[a-zA-Z0-9._-]+\/?$/))
                    .filter(h => !['explore', 'reels', 'p', 'direct', 'accounts', 'stories'].some(x => h!.includes(x)))
                    .map(h => h!.replace(/\//g, ''));
            });

            const prevSize = following.size;
            users.forEach(u => u && following.add(u));

            if (following.size === prevSize) {
                noNewCount++;
            } else {
                noNewCount = 0;
            }

            console.log(`   Scroll ${scroll + 1}: ${following.size} gefunden`);
            await page.evaluate(() => window.scrollBy(0, 800));
            await humanDelay(1500, 2500);
        }

        following.delete(username);
        return Array.from(following);
    } catch (err: any) {
        console.log(`   ❌ Fehler beim Scrapen: ${err.message}`);
        return [];
    }
}

/**
 * Holt Following-Zahl von der Profilseite (Quick-Check)
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
            if (match) {
                return parseInt(match[0].replace(/[,.]/g, ''));
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Sendet Rich-Data Webhook an n8n
 */
async function sendWebhook(payload: WebhookPayload) {
    if (!N8N_WEBHOOK_URL) {
        console.log('   ℹ️ Kein N8N_WEBHOOK_URL konfiguriert');
        return;
    }

    try {
        console.log('\n   📤 Sende Webhook an n8n:');
        console.log(`      Event: ${payload.event}`);
        console.log(`      Profil: @${payload.monitoredProfile.username}`);
        console.log(`      Targets: ${payload.targets.length}`);

        await axios.post(N8N_WEBHOOK_URL, payload);
        console.log('   ✅ Webhook erfolgreich gesendet!\n');
    } catch (err: any) {
        console.log(`   ⚠️ Webhook Fehler: ${err.message}`);
    }
}

// === MAIN ===
async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(`🕵️ SMART MONITORING v3 - ${new Date().toLocaleString()}`);
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
        // Login prüfen
        const loggedIn = await ensureLoggedIn(page, context);
        if (!loggedIn) {
            await browser.close();
            return;
        }

        // Alle Profile laden
        const profiles = await db.execute(
            "SELECT id, username, followingCount FROM MonitoredProfile"
        );

        if (profiles.rows.length === 0) {
            console.log('⚠️ Keine Profile zum Überwachen gefunden.');
            await browser.close();
            return;
        }

        console.log(`📋 ${profiles.rows.length} Profile zu prüfen:\n`);

        for (const row of profiles.rows) {
            const profileId = row.id as string;
            const username = row.username as string;
            const lastCount = (row.followingCount as number) || 0;

            console.log('─'.repeat(60));
            console.log(`🔍 @${username} (Letzter Stand: ${lastCount})`);

            // Quick-Check: Aktuelle Following-Zahl
            const currentCount = await getFollowingCount(page, username);

            if (currentCount === null) {
                console.log('   ⚠️ Konnte Following-Zahl nicht lesen, überspringe...\n');
                continue;
            }

            console.log(`   Aktuell: ${currentCount}`);

            // Vergleiche
            if (currentCount !== lastCount) {
                console.log(`   🚨 ÄNDERUNG ERKANNT! (${lastCount} → ${currentCount})`);

                // Full Scrape der Following-Liste
                const currentFollowing = await getFollowingList(page, username);
                console.log(`   📋 ${currentFollowing.length} Following gescrapt`);

                if (currentFollowing.length > 0) {
                    // Alte Following aus DB
                    const oldRows = await db.execute({
                        sql: "SELECT username FROM FollowingEntry WHERE profileId = ?",
                        args: [profileId]
                    });
                    const oldFollowing = new Set(oldRows.rows.map(r => r.username as string));

                    // Diff berechnen
                    const addedUsernames = currentFollowing.filter(u => !oldFollowing.has(u));
                    const removedUsernames = Array.from(oldFollowing).filter(u => !currentFollowing.includes(u));

                    console.log(`   ➕ Neu: ${addedUsernames.length} | ➖ Entfolgt: ${removedUsernames.length}`);

                    // Für jeden geänderten User: Hole vollständige Profilinfos
                    if (addedUsernames.length > 0 || removedUsernames.length > 0) {

                        // Hole Profil-Info des überwachten Accounts
                        console.log(`\n   📊 Lade Profilinfos...`);
                        const monitoredProfileInfo = await getProfileInfo(page, username);

                        if (!monitoredProfileInfo) {
                            console.log('   ⚠️ Konnte Hauptprofil nicht laden');
                            continue;
                        }

                        // Verarbeite FOLLOWS
                        if (addedUsernames.length > 0) {
                            console.log(`\n   🆕 Lade Infos für ${addedUsernames.length} neue Follows...`);
                            const addedProfiles: ProfileInfo[] = [];

                            for (const targetUsername of addedUsernames) {
                                console.log(`      → @${targetUsername}`);
                                const info = await getProfileInfo(page, targetUsername);
                                if (info) {
                                    addedProfiles.push(info);
                                }
                                await humanDelay(2000, 4000); // Pause zwischen Profilen
                            }

                            if (addedProfiles.length > 0) {
                                const payload: WebhookPayload = {
                                    event: 'FOLLOW',
                                    monitoredProfile: monitoredProfileInfo,
                                    targets: addedProfiles,
                                    timestamp: new Date().toISOString(),
                                    summary: `👉 ${monitoredProfileInfo.fullName} (@${username}) folgt jetzt ${addedProfiles.length} ${addedProfiles.length === 1 ? 'Person' : 'Personen'}`
                                };
                                await sendWebhook(payload);
                            }
                        }

                        // Verarbeite UNFOLLOWS
                        if (removedUsernames.length > 0) {
                            console.log(`\n   ❌ Lade Infos für ${removedUsernames.length} Entfolgungen...`);
                            const removedProfiles: ProfileInfo[] = [];

                            for (const targetUsername of removedUsernames) {
                                console.log(`      → @${targetUsername}`);
                                const info = await getProfileInfo(page, targetUsername);
                                if (info) {
                                    removedProfiles.push(info);
                                }
                                await humanDelay(2000, 4000);
                            }

                            if (removedProfiles.length > 0) {
                                const payload: WebhookPayload = {
                                    event: 'UNFOLLOW',
                                    monitoredProfile: monitoredProfileInfo,
                                    targets: removedProfiles,
                                    timestamp: new Date().toISOString(),
                                    summary: `👀 ${monitoredProfileInfo.fullName} (@${username}) folgt ${removedProfiles.length} ${removedProfiles.length === 1 ? 'Person' : 'Personen'} nicht mehr`
                                };
                                await sendWebhook(payload);
                            }
                        }

                        // DB aktualisieren
                        console.log('\n   💾 Aktualisiere Datenbank...');
                        await db.execute({
                            sql: "DELETE FROM FollowingEntry WHERE profileId = ?",
                            args: [profileId]
                        });

                        for (let i = 0; i < currentFollowing.length; i++) {
                            await db.execute({
                                sql: `INSERT INTO FollowingEntry (id, username, position, profileId, addedAt, lastSeenAt, missedScans) 
                                      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                                args: [`v3_${Date.now()}_${i}`, currentFollowing[i], i, profileId]
                            });
                        }
                    }
                }

                // Update Following Count
                await db.execute({
                    sql: "UPDATE MonitoredProfile SET followingCount = ?, lastCheckedAt = datetime('now') WHERE id = ?",
                    args: [currentCount, profileId]
                });

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

        // Session speichern
        await context.storageState({ path: SESSION_PATH });
        console.log('💾 Session gespeichert');

    } catch (err: any) {
        console.error('\n❌ Kritischer Fehler:', err.message);
    } finally {
        await browser.close();
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Monitoring abgeschlossen');
    console.log('═'.repeat(60) + '\n');
}

main();
