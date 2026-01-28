/**
 * 📱 MOBILE SCRAPING - Komplett für BVB & Bayern
 * 
 * Nutzt iPhone-Emulation für besseres Scrolling
 */

import 'dotenv/config';
import { chromium, devices } from 'playwright';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

const PROFILES = ['bvb09', 'fcbayern'];

async function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    await new Promise(resolve => setTimeout(resolve, delay));
}

async function dismissPopups(page: any): Promise<void> {
    const selectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        '[aria-label="Schließen"]',
        'button >> text="Abbrechen"',
    ];

    for (const selector of selectors) {
        try {
            const button = await page.$(selector);
            if (button && await button.isVisible()) {
                await button.click({ force: true });
                await page.waitForTimeout(500);
            }
        } catch { }
    }
}

async function extractFollowing(page: any): Promise<string[]> {
    // Extrahiere alle Following-Usernames aus der aktuellen Ansicht
    const usernames = await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        const users: string[] = [];

        links.forEach(link => {
            const href = link.getAttribute('href');
            // Muster: /username/ (ohne weitere Pfade)
            if (href && href.match(/^\/[a-zA-Z0-9._]+\/?$/) && !href.includes('/accounts/') && !href.includes('/explore/')) {
                const username = href.replace(/\//g, '');
                if (username && !users.includes(username) && username.length > 1) {
                    // Filtere Navigation-Links
                    const isNavLink = ['reels', 'explore', 'direct', 'accounts', 'p', 'stories'].includes(username);
                    if (!isNavLink) {
                        users.push(username);
                    }
                }
            }
        });

        return users;
    });

    return usernames;
}

async function scrapeProfile(page: any, username: string): Promise<string[]> {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📊 @${username}`);
    console.log('─'.repeat(50));

    // Gehe zum Profil
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dismissPopups(page);

    // Klicke auf "Abonniert" / "Following"
    console.log('👆 Öffne Following-Liste...');

    try {
        // Mobile: Suche den Link mit "following" im href
        await page.click('a[href*="following"]', { timeout: 10000 });
    } catch {
        // Fallback: Suche nach Text
        try {
            await page.click('text=/Abonniert|Following/i');
        } catch {
            console.log('   ⚠️ Konnte Following-Link nicht finden');
            return [];
        }
    }

    await page.waitForTimeout(3000);

    console.log('📜 Scrolle durch die Liste...');

    const allUsernames = new Set<string>();
    let noNewCount = 0;
    let scrollCount = 0;
    const maxScrolls = 50; // Mehr Scrolls für vollständige Liste

    while (scrollCount < maxScrolls && noNewCount < 5) {
        // Extrahiere aktuelle Usernames
        const current = await extractFollowing(page);
        const previousSize = allUsernames.size;

        current.forEach(u => allUsernames.add(u));

        if (allUsernames.size === previousSize) {
            noNewCount++;
        } else {
            noNewCount = 0;
        }

        console.log(`   Scroll ${scrollCount + 1}: ${allUsernames.size} Accounts gefunden`);

        // Scroll down - auf Mobile einfach Fenster scrollen
        await page.evaluate(() => window.scrollBy(0, 800));
        await humanDelay(1500, 2500);

        // Zusätzlich Touch-Scroll simulieren
        await page.mouse.move(200, 400);
        await page.mouse.wheel(0, 500);
        await humanDelay(500, 1000);

        scrollCount++;
    }

    // Entferne das gescrapte Profil selbst aus der Liste
    allUsernames.delete(username);

    const result = Array.from(allUsernames);
    console.log(`\n✅ @${username}: ${result.length} Following gefunden`);

    return result;
}

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('📱 MOBILE SCRAPING - BVB & BAYERN');
    console.log('═'.repeat(60) + '\n');

    // Turso Connection
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    // Browser mit iPhone Emulation
    console.log('🎭 Starte iPhone 13 Pro Emulator...');
    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined
    });

    const page = await context.newPage();

    const results: { [key: string]: string[] } = {};

    try {
        // Login Check
        console.log('🌐 Gehe zu Instagram...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        const loginBtn = await page.$('a[href="/accounts/login/"]');
        if (loginBtn || page.url().includes('login')) {
            console.log('🔐 Login erforderlich...');

            if (!page.url().includes('login')) {
                await page.click('a[href="/accounts/login/"]');
                await page.waitForTimeout(2000);
            }

            await page.fill('input[name="username"]', process.env.INSTAGRAM_USERNAME!);
            await humanDelay(500, 1000);
            await page.fill('input[name="password"]', process.env.INSTAGRAM_PASSWORD!);
            await humanDelay(500, 1000);
            await page.click('button[type="submit"]');
            await page.waitForTimeout(8000);
            await dismissPopups(page);
        } else {
            console.log('✅ Bereits eingeloggt!');
        }

        // Scrape beide Profile
        for (const profile of PROFILES) {
            const following = await scrapeProfile(page, profile);
            results[profile] = following;

            // Pause zwischen Profilen
            if (PROFILES.indexOf(profile) < PROFILES.length - 1) {
                console.log('\n⏳ Warte 30 Sekunden...');
                await new Promise(r => setTimeout(r, 30000));
            }
        }

        // Session speichern
        await context.storageState({ path: SESSION_PATH });
        console.log('\n💾 Session gespeichert');

    } catch (error) {
        console.error('❌ Fehler:', error);
    } finally {
        await browser.close();
    }

    // ═══ Speichere in Turso ═══
    console.log('\n\n' + '═'.repeat(60));
    console.log('💾 SPEICHERE IN TURSO');
    console.log('═'.repeat(60) + '\n');

    for (const [profile, following] of Object.entries(results)) {
        console.log(`@${profile}: ${following.length} Following`);

        // Hole Profile ID
        const profileResult = await db.execute({
            sql: 'SELECT id FROM MonitoredProfile WHERE username = ?',
            args: [profile]
        });

        if (profileResult.rows.length === 0) {
            console.log(`   ⚠️ Profil @${profile} nicht in DB gefunden`);
            continue;
        }

        const profileId = profileResult.rows[0].id as string;

        // Lösche alte Einträge
        await db.execute({
            sql: 'DELETE FROM FollowingEntry WHERE profileId = ?',
            args: [profileId]
        });

        // Neue Einträge hinzufügen
        for (let i = 0; i < following.length; i++) {
            const username = following[i];
            await db.execute({
                sql: `INSERT INTO FollowingEntry (id, username, position, profileId, addedAt, lastSeenAt, missedScans) 
                      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                args: [`mobile_${Date.now()}_${i}`, username, i, profileId]
            });
        }

        console.log(`   ✅ ${following.length} Einträge gespeichert`);
    }

    // ═══ Zeige die Listen ═══
    console.log('\n\n' + '═'.repeat(60));
    console.log('📋 FOLLOWING LISTEN');
    console.log('═'.repeat(60));

    for (const [profile, following] of Object.entries(results)) {
        console.log(`\n\n@${profile} (${following.length} Following):`);
        console.log('─'.repeat(40));
        following.forEach((u, i) => {
            console.log(`${(i + 1).toString().padStart(3)}. @${u}`);
        });
    }

    console.log('\n\n✅ Fertig!\n');
}

main();
