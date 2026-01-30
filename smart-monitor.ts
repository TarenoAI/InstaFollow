/**
 * 🕵️‍♂️ SMART MONITORING - VPS VERSION
 * 
 * Logik laut IMPLEMENTATION_PLAN.md:
 * 1. Quick-Check: Nur Following-ZAHL prüfen (schnell!)
 * 2. Bei Änderung: Full-Scrape triggern
 * 3. Änderungen erkennen (Diff)
 * 4. n8n Webhook senden
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { chromium, devices, Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';

// === KONFIGURATION ===
const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || '';

// === HELPER FUNCTIONS ===
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

    await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });
    await page.waitForTimeout(3000);
    await dismissPopups(page);

    // Check if we're on login page
    const isLoginPage = page.url().includes('login') ||
        await page.$('input[name="username"]') !== null;

    if (isLoginPage) {
        console.log('🔐 Login erforderlich...');

        const username = process.env.INSTAGRAM_USERNAME;
        const password = process.env.INSTAGRAM_PASSWORD;

        if (!username || !password) {
            console.error('❌ INSTAGRAM_USERNAME oder INSTAGRAM_PASSWORD fehlt in .env!');
            return false;
        }

        try {
            // Navigate to login if not already there
            if (!page.url().includes('login')) {
                await page.goto('https://www.instagram.com/accounts/login/', {
                    waitUntil: 'domcontentloaded'
                });
                await page.waitForTimeout(2000);
            }

            await dismissPopups(page);

            // Fill login form
            await page.fill('input[name="username"]', username);
            await humanDelay(500, 1000);
            await page.fill('input[name="password"]', password);
            await humanDelay(500, 1000);
            await page.click('button[type="submit"]');

            // Wait for navigation
            await page.waitForTimeout(8000);
            await dismissPopups(page);

            // Check if login succeeded
            if (page.url().includes('challenge') || page.url().includes('login')) {
                console.log('⚠️ Instagram verlangt Bestätigung (Challenge)');
                return false;
            }

            // Save session for future use
            await context.storageState({ path: SESSION_PATH });
            console.log('💾 Session gespeichert!');

        } catch (err: any) {
            console.error('❌ Login fehlgeschlagen:', err.message);
            return false;
        }
    }

    console.log('✅ Eingeloggt!');
    return true;
}

async function getFollowingCount(page: Page, username: string): Promise<number | null> {
    console.log(`   📊 Lade Profil @${username}...`);

    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Try to get following count from the page
        // Mobile layout: Look for the link containing "following"
        const followingLink = await page.$('a[href*="following"]');

        if (!followingLink) {
            console.log('   ⚠️ Following-Link nicht gefunden');
            return null;
        }

        const text = await followingLink.innerText();
        // Extract number: "99 Abonniert" -> 99
        const match = text.match(/[\d,.]+/);
        if (match) {
            const count = parseInt(match[0].replace(/[,.]/g, ''));
            console.log(`   ✅ Following-Zahl: ${count}`);
            return count;
        }

        return null;
    } catch (err: any) {
        console.log(`   ❌ Fehler beim Laden: ${err.message}`);
        return null;
    }
}

async function fullScrape(page: Page, username: string): Promise<string[]> {
    console.log(`   📋 Starte Full-Scrape für @${username}...`);

    try {
        // Click on following link to open modal
        await page.click('a[href*="following"]', { timeout: 10000 });
        await page.waitForTimeout(3000);

        const allUsernames = new Set<string>();
        let noNewCount = 0;

        for (let scroll = 0; scroll < 30 && noNewCount < 5; scroll++) {
            // Extract usernames from current view
            const usernames = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.getAttribute('href'))
                    .filter(href => href && href.match(/^\/[a-zA-Z0-9._-]+\/?$/))
                    .filter(href => !href!.includes('explore') && !href!.includes('accounts'))
                    .map(href => href!.replace(/\//g, ''));
            });

            const prevSize = allUsernames.size;
            usernames.forEach(u => u && allUsernames.add(u));

            if (allUsernames.size === prevSize) {
                noNewCount++;
            } else {
                noNewCount = 0;
            }

            console.log(`   Scroll ${scroll + 1}: ${allUsernames.size} gefunden`);

            // Scroll
            await page.evaluate(() => window.scrollBy(0, 800));
            await humanDelay(1500, 2500);
        }

        // Remove the profile itself
        allUsernames.delete(username);

        console.log(`   ✅ ${allUsernames.size} Following gescrapt`);
        return Array.from(allUsernames);

    } catch (err: any) {
        console.log(`   ❌ Scrape-Fehler: ${err.message}`);
        return [];
    }
}

async function sendWebhook(data: any) {
    if (!N8N_WEBHOOK_URL) {
        console.log('   ℹ️ Kein N8N_WEBHOOK_URL konfiguriert');
        return;
    }

    try {
        const axios = (await import('axios')).default;
        await axios.post(N8N_WEBHOOK_URL, data);
        console.log('   📤 Webhook an n8n gesendet!');
    } catch (err: any) {
        console.log(`   ⚠️ Webhook-Fehler: ${err.message}`);
    }
}

// === MAIN ===
async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(`🕵️ SMART MONITORING - ${new Date().toLocaleString()}`);
    console.log('═'.repeat(60) + '\n');

    // Connect to Turso
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    // Launch browser (headless on VPS)
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined
    });

    const page = await context.newPage();

    try {
        // Step 1: Ensure we're logged in
        const loggedIn = await ensureLoggedIn(page, context);
        if (!loggedIn) {
            console.log('\n❌ Konnte nicht einloggen. Abbruch.');
            await browser.close();
            return;
        }

        // Step 2: Get all profiles to monitor
        const profiles = await db.execute(
            "SELECT id, username, followingCount FROM MonitoredProfile"
        );

        if (profiles.rows.length === 0) {
            console.log('\n⚠️ Keine Profile zum Überwachen gefunden.');
            await browser.close();
            return;
        }

        console.log(`\n📋 ${profiles.rows.length} Profile zu prüfen:\n`);

        // Step 3: Quick-Check each profile
        for (const row of profiles.rows) {
            const profileId = row.id as string;
            const username = row.username as string;
            const lastCount = (row.followingCount as number) || 0;

            console.log(`\n🔍 @${username} (DB: ${lastCount}):`);

            // Quick-Check: Get current count
            const currentCount = await getFollowingCount(page, username);

            if (currentCount === null) {
                console.log('   ⏭️ Überspringe (Fehler beim Laden)');
                continue;
            }

            // Compare counts
            if (currentCount !== lastCount) {
                console.log(`   🚨 ÄNDERUNG: ${lastCount} → ${currentCount}`);

                // Full Scrape
                const currentFollowing = await fullScrape(page, username);

                if (currentFollowing.length > 0) {
                    // Get old following from DB
                    const oldRows = await db.execute({
                        sql: "SELECT username FROM FollowingEntry WHERE profileId = ?",
                        args: [profileId]
                    });
                    const oldFollowing = new Set(oldRows.rows.map(r => r.username as string));
                    const currentSet = new Set(currentFollowing);

                    // Calculate diff
                    const added = currentFollowing.filter(u => !oldFollowing.has(u));
                    const removed = Array.from(oldFollowing).filter(u => !currentSet.has(u));

                    console.log(`   ➕ Neu: ${added.length} | ➖ Entfolgt: ${removed.length}`);

                    if (added.length > 0 || removed.length > 0) {
                        // Send Webhook
                        await sendWebhook({
                            event: removed.length > 0 ? 'UNFOLLOW' : 'FOLLOW',
                            profile: username,
                            added,
                            removed,
                            timestamp: new Date().toISOString()
                        });

                        // Update DB
                        await db.execute({
                            sql: "DELETE FROM FollowingEntry WHERE profileId = ?",
                            args: [profileId]
                        });

                        for (let i = 0; i < currentFollowing.length; i++) {
                            await db.execute({
                                sql: `INSERT INTO FollowingEntry (id, username, position, profileId, addedAt, lastSeenAt, missedScans) 
                                      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                                args: [`cron_${Date.now()}_${i}`, currentFollowing[i], i, profileId]
                            });
                        }
                    }

                    // Update following count
                    await db.execute({
                        sql: "UPDATE MonitoredProfile SET followingCount = ?, lastCheckedAt = datetime('now') WHERE id = ?",
                        args: [currentCount, profileId]
                    });
                }
            } else {
                console.log('   ✅ Keine Änderung');

                // Update lastCheckedAt
                await db.execute({
                    sql: "UPDATE MonitoredProfile SET lastCheckedAt = datetime('now') WHERE id = ?",
                    args: [profileId]
                });
            }

            // Pause between profiles
            await humanDelay(5000, 10000);
        }

        // Save session
        await context.storageState({ path: SESSION_PATH });
        console.log('\n💾 Session gespeichert');

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
