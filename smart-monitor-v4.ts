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
        // Cookie consent
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Accept All")',
        // "Not Now" buttons  
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        'button:has-text("Nicht jetzt")',
        // Save login info popup
        'button:has-text("Informationen nicht speichern")',
        'button:has-text("Not now")',
        // Turn on notifications
        'button:has-text("Nicht aktivieren")',
        'button:has-text("Not Now")',
        // Close buttons
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
        'svg[aria-label="Schließen"]',
        'svg[aria-label="Close"]',
        // Cancel/Dismiss
        'button:has-text("Abbrechen")',
        'button:has-text("Cancel")',
    ];

    for (const sel of selectors) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) {
                await btn.click({ force: true });
                await page.waitForTimeout(300);
            }
        } catch { }
    }

    // ESC drücken um Dialoge zu schließen
    try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
    } catch { }
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
 * Holt die Following-Liste mit API-Interception für 100% Erfassung
 * Fängt Instagram's API-Responses ab während gescrollt wird
 * @param expectedCount - Die erwartete Anzahl an Following für dynamische Scroll-Berechnung
 */
async function getFollowingList(page: Page, username: string, expectedCount: number = 200): Promise<string[]> {
    try {
        // API-Response Sammler
        const apiFollowing = new Set<string>();

        // Intercepte Instagram API-Responses
        const responseHandler = async (response: any) => {
            const url = response.url();

            // Instagram Following API
            if (url.includes('/api/v1/friendships/') && url.includes('/following/')) {
                try {
                    const json = await response.json();
                    if (json.users) {
                        for (const user of json.users) {
                            if (user.username) {
                                apiFollowing.add(user.username);
                            }
                        }
                    }
                } catch { }
            }

            // GraphQL Following
            if (url.includes('graphql') && url.includes('following')) {
                try {
                    const json = await response.json();
                    const edges = json?.data?.user?.edge_follow?.edges ||
                        json?.data?.user?.following?.edges || [];
                    for (const edge of edges) {
                        const u = edge?.node?.username;
                        if (u) apiFollowing.add(u);
                    }
                } catch { }
            }
        };

        page.on('response', responseHandler);

        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(4000);
        await dismissPopups(page);

        await page.click('a[href*="following"]', { timeout: 10000 });
        await page.waitForTimeout(4000);
        await dismissPopups(page);

        // DOM-basierte Sammlung als Backup
        const domFollowing = new Set<string>();
        let noNewCount = 0;

        // Dynamische Scroll-Anzahl: ~10 Accounts pro Scroll sichtbar
        // Bei 500 Following = 60 Scrolls, bei 1000 Following = 120 Scrolls
        const maxScrolls = Math.max(80, Math.ceil(expectedCount / 8) + 20);
        const maxNoNewCount = 25; // Mehr Versuche bevor wir aufgeben

        console.log(`   📜 Max Scrolls: ${maxScrolls} (für ${expectedCount} Following)`);

        // Finde den Dialog/Container für das Scrolling
        const scrollContainer = await page.$('[role="dialog"] div[style*="overflow"], [role="dialog"] ul, div[style*="overflow-y"]');

        for (let scroll = 0; scroll < maxScrolls && noNewCount < maxNoNewCount; scroll++) {
            // Sammle alle sichtbaren Usernames
            const users = await page.evaluate(() => {
                const links: string[] = [];
                document.querySelectorAll('a[role="link"]').forEach(a => {
                    const href = a.getAttribute('href');
                    if (href && href.match(/^\/[a-zA-Z0-9._]+\/?$/)) {
                        const username = href.replace(/\//g, '');
                        if (!['explore', 'reels', 'p', 'direct', 'accounts', 'stories', 'search'].includes(username)) {
                            links.push(username);
                        }
                    }
                });
                return links;
            });

            const prevSize = domFollowing.size;
            users.forEach(u => u && domFollowing.add(u));

            if (domFollowing.size === prevSize) noNewCount++;
            else noNewCount = 0;

            // Logge Status
            if (scroll % 5 === 0) {
                console.log(`   Scroll ${scroll + 1}/${maxScrolls}: DOM=${domFollowing.size} | API=${apiFollowing.size}`);
            }

            // Verschiedene Scroll-Strategien
            try {
                if (scrollContainer) {
                    // Scrolle innerhalb des Dialogs
                    await scrollContainer.evaluate((el: Element) => {
                        el.scrollTop += 500;
                    });
                } else {
                    // Fallback: Keyboard scrolling (Page Down)
                    await page.keyboard.press('End'); // Scrollt zum Ende der Liste
                    await page.waitForTimeout(200);
                    await page.keyboard.press('ArrowDown');
                    await page.keyboard.press('ArrowDown');
                    await page.keyboard.press('ArrowDown');
                }
            } catch {
                // Fallback: Mouse wheel
                await page.mouse.wheel(0, 500);
            }

            await humanDelay(1500, 2500);

            // Alle 20 Scrolls: Extra warten für Lazy Loading
            if (scroll % 20 === 19) {
                await page.waitForTimeout(3000);
            }
        }

        // Response Handler entfernen
        page.off('response', responseHandler);

        // Kombiniere beide Quellen
        const combined = new Set([...domFollowing, ...apiFollowing]);
        combined.delete(username);

        console.log(`   ✅ Scraping beendet: DOM=${domFollowing.size} | API=${apiFollowing.size} | KOMBINIERT=${combined.size}`);

        // Wenn API mehr gefunden hat, logge das
        if (apiFollowing.size > domFollowing.size) {
            const additional = apiFollowing.size - domFollowing.size;
            console.log(`   📡 API-Interception fand ${additional} zusätzliche Accounts!`);
        }

        // Dialog schließen
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        return Array.from(combined);
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
 * Formatiert den Tweet-Text im Stil von @takiprazzi
 * Zeigt ALLE Accounts, nicht nur 3!
 */
function formatTweetText(event: 'FOLLOW' | 'UNFOLLOW', profile: ProfileInfo, targets: ProfileInfo[]): string {
    const emoji = event === 'FOLLOW' ? '👉' : '👀';
    const actionEmoji = event === 'FOLLOW' ? '✅' : '❌';
    const action = event === 'FOLLOW'
        ? `folgt jetzt ${targets.length} ${targets.length === 1 ? 'Person' : 'Personen'}`
        : `folgt nicht mehr ${targets.length} ${targets.length === 1 ? 'Person' : 'Personen'}`;

    let text = `${emoji} ${profile.username} (${profile.fullName}) ${action}:\n\n`;

    // ALLE Targets anzeigen - Twitter erlaubt bis zu 280 Zeichen, aber Threads sind möglich
    for (const target of targets) {
        text += `${actionEmoji} ${target.username} (${target.fullName})\n`;
        text += `🔗 instagram.com/${target.username}\n\n`;
    }

    return text.trim();
}

const LOCK_FILE = path.join(process.cwd(), '.monitor.lock');

// === MAIN ===
async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(`🕵️ SMART MONITORING v4 - ${new Date().toLocaleString()}`);
    console.log('═'.repeat(60) + '\n');

    // Lock-File prüfen um überlappende Runs zu verhindern
    if (fs.existsSync(LOCK_FILE)) {
        const lockTime = fs.statSync(LOCK_FILE).mtime;
        const lockAge = (Date.now() - lockTime.getTime()) / 1000 / 60; // in Minuten

        if (lockAge < 60) { // Maximal 60 Minuten Lock
            console.log(`🔒 ABBRUCH: Ein anderer Prozess läuft bereits (Lock: ${lockAge.toFixed(1)} Min alt)`);
            console.log(`   Lock-File: ${LOCK_FILE}`);
            console.log(`   Falls dies ein Fehler ist, lösche die Datei manuell.\n`);
            return;
        } else {
            console.log(`⚠️ Stale Lock gefunden (${lockAge.toFixed(1)} Min alt) - wird überschrieben`);
        }
    }

    // Lock setzen
    fs.writeFileSync(LOCK_FILE, new Date().toISOString());
    console.log(`🔓 Lock gesetzt`);

    // Cleanup bei Exit
    const cleanup = () => {
        try { fs.unlinkSync(LOCK_FILE); } catch { }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(); });
    process.on('SIGTERM', () => { cleanup(); process.exit(); });

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
        const profiles = await db.execute("SELECT id, username, followingCount, isBaselineComplete FROM MonitoredProfile");
        console.log(`📋 ${profiles.rows.length} Profile zu prüfen:\n`);

        for (const row of profiles.rows) {
            const profileId = row.id as string;
            const username = row.username as string;
            const lastCount = (row.followingCount as number) || 0;
            const isBaselineComplete = Boolean(row.isBaselineComplete);

            console.log('─'.repeat(60));
            console.log(`🔍 @${username} (DB: ${lastCount})`);

            const currentCount = await getFollowingCount(page, username);

            if (currentCount === null) {
                console.log('   ⚠️ Konnte Zahl nicht lesen\n');
                continue;
            }

            console.log(`   Aktuell: ${currentCount}`);

            // ⚠️ Skip Profile mit zu vielen Followings (nicht zuverlässig scrapbar)
            const MAX_FOLLOWING = 1000;
            if (currentCount > MAX_FOLLOWING) {
                console.log(`   ⏭️ ÜBERSPRUNGEN: ${currentCount} > ${MAX_FOLLOWING} Following`);
                console.log(`      Profile mit >1000 Following können nicht zuverlässig gescrapt werden.`);
                console.log(`      Nur Count aktualisieren, keine Changes.\n`);

                await db.execute({
                    sql: `UPDATE MonitoredProfile SET followingCount = ?, lastCheckedAt = datetime('now') WHERE id = ?`,
                    args: [currentCount, profileId]
                });

                await humanDelay(3000, 5000);
                continue;
            }

            if (currentCount !== lastCount) {
                console.log(`   🚨 ÄNDERUNG: ${lastCount} → ${currentCount}`);

                // Full Scrape
                const currentFollowing = await getFollowingList(page, username, currentCount);
                console.log(`   📋 ${currentFollowing.length} Following gescrapt`);

                // Diagnose-Logs für Scraping-Quote
                const scrapeQuote = currentCount > 0 ? ((currentFollowing.length / currentCount) * 100).toFixed(1) : '100';
                console.log(`   📈 Scraping-Quote: ${currentFollowing.length}/${currentCount} (${scrapeQuote}%)`);

                if (currentFollowing.length < currentCount * 0.8) {
                    console.log(`   ⚠️ DIAGNOSE: Weniger als 80% gescrapt!`);
                    console.log(`      Mögliche Ursachen:`);
                    console.log(`      1. Instagram Lazy-Loading Limits`);
                    console.log(`      2. Gelöschte/Deaktivierte Accounts in der Zählung`);
                    console.log(`      3. Netzwerk-Latenz auf VPS`);
                }

                // ⚠️ KRITISCH: Wenn weniger als 90% gescrapt, keine Changes verarbeiten!
                const MIN_SCRAPE_QUOTA = 0.90;
                if (currentFollowing.length < currentCount * MIN_SCRAPE_QUOTA) {
                    console.log(`   🚫 ABBRUCH: Nur ${currentFollowing.length}/${currentCount} gescrapt (${scrapeQuote}%)`);
                    console.log(`      Benötigt: mindestens ${Math.ceil(currentCount * MIN_SCRAPE_QUOTA)} (90%)`);
                    console.log(`      ➡️ Keine Changes werden verarbeitet um falsche Unfollows zu vermeiden!`);
                    console.log(`      ➡️ Nur den Count aktualisieren, kein Post.\n`);

                    // Nur Count aktualisieren, NICHT die FollowingEntry-Liste!
                    await db.execute({
                        sql: `UPDATE MonitoredProfile SET followingCount = ?, lastCheckedAt = datetime('now') WHERE id = ?`,
                        args: [currentCount, profileId]
                    });

                    await humanDelay(5000, 10000);
                    continue; // Zum nächsten Profil
                }

                if (currentFollowing.length > 0) {
                    const oldRows = await db.execute({
                        sql: "SELECT username FROM FollowingEntry WHERE profileId = ?",
                        args: [profileId]
                    });
                    const oldFollowing = new Set(oldRows.rows.map(r => r.username as string));

                    const addedUsernames = currentFollowing.filter(u => !oldFollowing.has(u));
                    const removedUsernames = Array.from(oldFollowing).filter(u => !currentFollowing.includes(u));

                    console.log(`   ➕ Neu: ${addedUsernames.length} | ➖ Entfolgt: ${removedUsernames.length}`);

                    // === BASELINE NICHT KOMPLETT: Erst Baseline erstellen ===
                    if (!isBaselineComplete) {
                        console.log(`\n   🆕 BASELINE NICHT KOMPLETT - Erstelle/Aktualisiere Baseline...`);
                        console.log(`      Bisherige Einträge in DB: ${oldFollowing.size}`);
                        console.log(`      Gescrapt: ${currentFollowing.length}`);

                        // Lösche alte Einträge und ersetze mit vollständigem Scrape
                        await db.execute({
                            sql: "DELETE FROM FollowingEntry WHERE profileId = ?",
                            args: [profileId]
                        });

                        // Batch-Insert für bessere Performance
                        const batchSize = 50;
                        for (let batch = 0; batch < Math.ceil(currentFollowing.length / batchSize); batch++) {
                            const start = batch * batchSize;
                            const end = Math.min(start + batchSize, currentFollowing.length);

                            for (let i = start; i < end; i++) {
                                await db.execute({
                                    sql: `INSERT INTO FollowingEntry (id, username, position, profileId, addedAt, lastSeenAt, missedScans) 
                                          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                                    args: [`v4_${Date.now()}_${i}`, currentFollowing[i], i, profileId]
                                });
                            }
                            console.log(`      💾 Batch ${batch + 1}: ${end}/${currentFollowing.length} gespeichert`);
                        }

                        // Markiere als Baseline-complete + speichere Zeitpunkt
                        await db.execute({
                            sql: `UPDATE MonitoredProfile SET 
                                  followingCount = ?, 
                                  lastCheckedAt = datetime('now'),
                                  isBaselineComplete = 1,
                                  lastSuccessfulScrapeAt = datetime('now')
                                  WHERE id = ?`,
                            args: [currentCount, profileId]
                        });

                        console.log(`   ✅ Baseline erstellt (${currentFollowing.length} Einträge) - KEINE Changes gemeldet`);
                        console.log(`   ℹ️ Ab jetzt werden Änderungen erkannt!\n`);
                        await humanDelay(5000, 10000);
                        continue; // Zum nächsten Profil!
                    }

                    // === ECHTER CHANGE: Profilinfos laden und tweeten ===
                    if (addedUsernames.length > 0 || removedUsernames.length > 0) {
                        console.log('\n   📊 Lade Profilinfos mit Screenshots...');

                        const monitoredProfileInfo = await getProfileInfo(page, username, true);
                        if (!monitoredProfileInfo) continue;

                        // Verarbeite FOLLOWS (max 10 um Zeit zu sparen)
                        if (addedUsernames.length > 0) {
                            const maxToProcess = Math.min(addedUsernames.length, 10);
                            console.log(`\n   🆕 Verarbeite ${maxToProcess} von ${addedUsernames.length} neuen Follows...`);
                            const addedProfiles: ProfileInfo[] = [];

                            for (const targetUsername of addedUsernames.slice(0, maxToProcess)) {
                                console.log(`      → @${targetUsername}`);
                                const info = await getProfileInfo(page, targetUsername, true);
                                if (info) addedProfiles.push(info);
                                await humanDelay(2000, 4000);
                            }

                            if (addedProfiles.length > 0) {
                                const tweetText = formatTweetText('FOLLOW', monitoredProfileInfo, addedProfiles);

                                // Screenshot: Bei 1 Target -> Target-Screenshot, sonst Monitor-Screenshot
                                const screenshotToUse = addedProfiles.length === 1 && addedProfiles[0].screenshotPath
                                    ? addedProfiles[0].screenshotPath
                                    : monitoredProfileInfo.screenshotPath;

                                const tweetUrl = await postToTwitter(
                                    browser,
                                    tweetText,
                                    screenshotToUse
                                );

                                await sendWebhook({
                                    event: 'FOLLOW',
                                    monitoredProfile: monitoredProfileInfo,
                                    targets: addedProfiles,
                                    timestamp: new Date().toISOString(),
                                    summary: `${monitoredProfileInfo.username} folgt ${addedUsernames.length} neuen Personen`,
                                    tweetUrl: tweetUrl || undefined
                                });

                                // ChangeEvents in DB speichern
                                for (const target of addedProfiles) {
                                    await db.execute({
                                        sql: `INSERT INTO ChangeEvent (id, type, targetUsername, screenshotUrl, detectedAt, isConfirmed, processed, profileId) 
                                              VALUES (?, 'FOLLOW', ?, ?, datetime('now'), 1, 0, ?)`,
                                        args: [`ce_${Date.now()}_${Math.random().toString(36).slice(2)}`, target.username, monitoredProfileInfo.screenshotPath || null, profileId]
                                    });
                                }
                            }
                        }

                        // Verarbeite UNFOLLOWS (max 10 um Zeit zu sparen)
                        if (removedUsernames.length > 0) {
                            const maxToProcess = Math.min(removedUsernames.length, 10);
                            console.log(`\n   ❌ Verarbeite ${maxToProcess} von ${removedUsernames.length} Entfolgungen...`);
                            const removedProfiles: ProfileInfo[] = [];

                            for (const targetUsername of removedUsernames.slice(0, maxToProcess)) {
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
                                    summary: `${monitoredProfileInfo.username} folgt ${removedUsernames.length} Personen nicht mehr`,
                                    tweetUrl: tweetUrl || undefined
                                });

                                // ChangeEvents in DB speichern
                                for (const target of removedProfiles) {
                                    await db.execute({
                                        sql: `INSERT INTO ChangeEvent (id, type, targetUsername, screenshotUrl, detectedAt, isConfirmed, processed, profileId) 
                                              VALUES (?, 'UNFOLLOW', ?, ?, datetime('now'), 1, 0, ?)`,
                                        args: [`ce_${Date.now()}_${Math.random().toString(36).slice(2)}`, target.username, monitoredProfileInfo.screenshotPath || null, profileId]
                                    });
                                }
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

                        // Aktualisiere auch Profilinfos
                        const followerNum = parseInt(monitoredProfileInfo.followerCount.replace(/[,.KMB]/g, '') || '0');
                        await db.execute({
                            sql: `UPDATE MonitoredProfile SET 
                                  followingCount = ?, 
                                  followerCount = ?,
                                  fullName = ?,
                                  profilePicUrl = ?,
                                  isVerified = ?,
                                  lastCheckedAt = datetime('now'),
                                  lastSuccessfulScrapeAt = datetime('now')
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
                        // Keine neuen/entfernten Follows, nur Count und Timestamp updaten
                        await db.execute({
                            sql: `UPDATE MonitoredProfile SET 
                                  followingCount = ?, 
                                  lastCheckedAt = datetime('now'),
                                  lastSuccessfulScrapeAt = datetime('now') 
                                  WHERE id = ?`,
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
