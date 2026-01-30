/**
 * Initial Scrape - Holt für alle Profile die Following-Listen und macht Screenshots als Baseline
 * Kann lokal oder auf VPS ausgeführt werden
 */

import 'dotenv/config';
import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');

// Stelle sicher dass Screenshots-Ordner existiert
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// DB Client (Turso für VPS, kann auch lokal verwendet werden)
const db = createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:./prisma/dev.db',
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function humanDelay(minMs: number, maxMs: number) {
    const delay = Math.random() * (maxMs - minMs) + minMs;
    await new Promise(r => setTimeout(r, delay));
}

async function dismissPopups(page: Page) {
    try {
        const cookieBtn = await page.$('button:has-text("Alle Cookies erlauben"), button:has-text("Allow all cookies"), button:has-text("Accept All")');
        if (cookieBtn) await cookieBtn.click();
        await page.waitForTimeout(500);

        const notNowBtn = await page.$('button:has-text("Nicht jetzt"), button:has-text("Not Now")');
        if (notNowBtn) await notNowBtn.click();
    } catch { }
}

async function takeProfileScreenshot(page: Page, username: string): Promise<string> {
    const screenshotPath = path.join(SCREENSHOTS_DIR, `${username}_baseline_${Date.now()}.png`);

    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        const header = await page.$('header');
        if (header) {
            await header.screenshot({ path: screenshotPath });
            console.log(`      📸 Screenshot: ${screenshotPath}`);
            return screenshotPath;
        }
    } catch (e: any) {
        console.log(`      ⚠️ Screenshot fehlgeschlagen: ${e.message}`);
    }
    return '';
}

async function scrapeFollowing(page: Page, username: string): Promise<string[]> {
    const following: string[] = [];

    try {
        await page.goto(`https://www.instagram.com/${username}/following/`, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Warte auf die Liste
        const dialog = await page.$('[role="dialog"], div[style*="overflow"]');
        if (!dialog) {
            console.log(`      ⚠️ Following-Dialog nicht gefunden`);
            return following;
        }

        let previousCount = 0;
        let noChangeCount = 0;

        for (let scroll = 0; scroll < 100; scroll++) {
            // Extrahiere alle Usernames
            const links = await page.$$eval('a[href^="/"][role="link"]', (elements: any[]) => {
                return elements
                    .map(el => {
                        const href = el.getAttribute('href') || '';
                        const match = href.match(/^\/([^\/]+)\/?$/);
                        return match ? match[1] : null;
                    })
                    .filter((u: string | null) => u && !['explore', 'reels', 'direct', 'accounts'].includes(u));
            });

            for (const u of links) {
                if (u && !following.includes(u)) {
                    following.push(u);
                }
            }

            if (scroll % 10 === 0) {
                console.log(`      Scroll ${scroll}: ${following.length} gefunden`);
            }

            // Prüfe ob wir fertig sind
            if (following.length === previousCount) {
                noChangeCount++;
                if (noChangeCount >= 5) break;
            } else {
                noChangeCount = 0;
                previousCount = following.length;
            }

            // Scroll
            await page.mouse.wheel(0, 500);
            await humanDelay(800, 1500);
        }

        // Schließe Dialog
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

    } catch (e: any) {
        console.log(`      ⚠️ Scraping fehlgeschlagen: ${e.message}`);
    }

    return following;
}

async function main() {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('📸 INITIAL SCRAPE - Baseline für alle Profile');
    console.log('════════════════════════════════════════════════════════════\n');

    // Lade alle Profile aus DB
    const profiles = await db.execute('SELECT id, username, followingCount FROM MonitoredProfile');
    console.log(`📋 ${profiles.rows.length} Profile gefunden\n`);

    if (profiles.rows.length === 0) {
        console.log('❌ Keine Profile in der Datenbank!');
        return;
    }

    // Browser starten
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 }
    });

    // Session laden falls vorhanden
    const sessionPath = path.join(process.cwd(), 'playwright-session.json');
    if (fs.existsSync(sessionPath)) {
        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        await context.addCookies(session.cookies || []);
        console.log('✅ Session geladen\n');
    }

    const page = await context.newPage();

    // Login prüfen
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dismissPopups(page);

    const isLoggedIn = await page.$('svg[aria-label="Home"], svg[aria-label="Startseite"]') !== null;
    if (!isLoggedIn) {
        console.log('❌ Nicht eingeloggt! Bitte erst manuell einloggen und Session speichern.');
        await browser.close();
        return;
    }
    console.log('✅ Eingeloggt!\n');

    let successCount = 0;

    for (const profile of profiles.rows) {
        const profileId = profile.id as string;
        const username = profile.username as string;
        const dbCount = profile.followingCount as number || 0;

        console.log(`────────────────────────────────────────────────────────────`);
        console.log(`🔍 @${username} (DB: ${dbCount})`);

        // Screenshot machen
        const screenshotPath = await takeProfileScreenshot(page, username);

        // Following-Liste scrapen
        console.log(`   📋 Scrape Following...`);
        const following = await scrapeFollowing(page, username);
        console.log(`   ✅ ${following.length} Following gescrapt`);

        if (following.length > 0) {
            // Alte Einträge löschen
            await db.execute({ sql: 'DELETE FROM FollowingEntry WHERE profileId = ?', args: [profileId] });

            // Neue Einträge speichern
            for (let i = 0; i < following.length; i++) {
                await db.execute({
                    sql: `INSERT INTO FollowingEntry (id, username, position, profileId, addedAt, lastSeenAt, missedScans) 
                          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                    args: [`init_${Date.now()}_${i}`, following[i], i, profileId]
                });
            }

            // Profil aktualisieren mit Screenshot
            await db.execute({
                sql: `UPDATE MonitoredProfile SET 
                      followingCount = ?, 
                      lastCheckedAt = datetime('now')
                      WHERE id = ?`,
                args: [following.length, profileId]
            });

            successCount++;
            console.log(`   💾 Gespeichert!`);
        }

        // Pause zwischen Profilen
        await humanDelay(5000, 10000);
    }

    // Session speichern
    const cookies = await context.cookies();
    fs.writeFileSync(sessionPath, JSON.stringify({ cookies }, null, 2));
    console.log('\n💾 Session gespeichert');

    await browser.close();

    console.log('\n════════════════════════════════════════════════════════════');
    console.log(`✅ Fertig! ${successCount}/${profiles.rows.length} Profile gescrapt`);
    console.log('════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
