/**
 * 🧪 VPS PROFILE TEST - Testet 5-10 Profile mit vollem DB-Abgleich
 * 
 * Sortiert nach Followern, morewatchez immer enthalten.
 * Führt den kompletten Scraping + DB-Vergleich durch.
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { chromium, devices, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const SCREENSHOTS_DIR = path.join(process.cwd(), 'public/screenshots');
const iPhone = devices['iPhone 13 Pro'];

// Anzahl der Profile zum Testen
const TEST_PROFILE_COUNT = 8;

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

async function dismissPopups(page: Page) {
    const selectors = [
        'button:has-text("Alle akzeptieren")',
        'button:has-text("Accept All")',
        'button:has-text("Jetzt nicht")',
        'button:has-text("Not Now")',
        '[aria-label="Schließen"]',
        '[aria-label="Close"]',
        'div[role="dialog"] button',
    ];

    for (const sel of selectors) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) {
                await btn.click({ force: true });
                await page.waitForTimeout(400);
            }
        } catch { }
    }

    await page.keyboard.press('Escape').catch(() => { });
    await page.waitForTimeout(200);
}

async function captureProfileScreenshot(page: Page, username: string): Promise<string | null> {
    try {
        if (!fs.existsSync(SCREENSHOTS_DIR)) {
            fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
        }

        const timestamp = Date.now();
        const filename = `${username}-${timestamp}.png`;
        const filepath = path.join(SCREENSHOTS_DIR, filename);

        await page.screenshot({ path: filepath, fullPage: false });
        console.log(`      📸 Screenshot: ${filename}`);

        return `https://raw.githubusercontent.com/TarenoAI/InstaFollow/main/public/screenshots/${filename}`;
    } catch (err: any) {
        console.log(`      ⚠️ Screenshot fehlgeschlagen: ${err.message}`);
        return null;
    }
}

async function getFollowingCount(page: Page, username: string): Promise<number | null> {
    try {
        // Direkte Navigation zum Profil
        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        // Warte auf Content
        let bodyLen = 0;
        for (let i = 0; i < 5; i++) {
            bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
            if (bodyLen > 200) break;

            console.log(`      ⏳ Warte auf Content (${i + 1}/5)...`);
            await page.waitForTimeout(2000);
            await dismissPopups(page);
        }

        if (bodyLen < 200) {
            console.log(`      ⚠️ Seite ist leer (${bodyLen} Zeichen)`);
            return null;
        }

        // Methode 1: Link mit "following" im href
        const followingLink = await page.$('a[href*="following"]');
        if (followingLink) {
            const text = await followingLink.innerText();
            const match = text.match(/[\d,.]+/);
            if (match) {
                const count = parseInt(match[0].replace(/[,.]/g, ''));
                return count;
            }
        }

        // Methode 2: Alle Links prüfen
        const allLinks = await page.$$('a');
        for (const link of allLinks) {
            const href = await link.getAttribute('href').catch(() => '');
            if (href?.includes('following')) {
                const text = await link.innerText().catch(() => '');
                const match = text.match(/[\d,.]+/);
                if (match) {
                    return parseInt(match[0].replace(/[,.]/g, ''));
                }
            }
        }

        return null;
    } catch (err: any) {
        console.log(`      ❌ Fehler: ${err.message}`);
        return null;
    }
}

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log(`🧪 VPS PROFILE TEST - ${new Date().toLocaleString()}`);
    console.log(`   Testet ${TEST_PROFILE_COUNT} Profile mit vollem DB-Abgleich`);
    console.log('═'.repeat(60) + '\n');

    // Check Session
    if (!fs.existsSync(SESSION_PATH)) {
        console.log('❌ Keine Session-Datei gefunden!');
        console.log(`   Erwartet: ${SESSION_PATH}`);
        return;
    }

    // DB Connection
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    // Lade Profile: morewatchez + Top-Profile nach Followern
    console.log('📊 Lade Test-Profile aus Datenbank...\n');

    const profiles = await db.execute(`
        SELECT id, username, followingCount, followerCount, isBaselineComplete, screenshotUrl
        FROM MonitoredProfile 
        ORDER BY 
            CASE WHEN username = 'morewatchez' THEN 0 ELSE 1 END,
            followerCount DESC
        LIMIT ?
    `, [TEST_PROFILE_COUNT]);

    if (profiles.rows.length === 0) {
        console.log('❌ Keine Profile in der Datenbank gefunden!');
        return;
    }

    console.log(`✅ ${profiles.rows.length} Profile geladen:\n`);
    for (const p of profiles.rows) {
        console.log(`   • @${p.username} (${(p.followerCount as number || 0).toLocaleString()} Follower, ${p.followingCount} Following)`);
    }
    console.log('');

    // Browser starten
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf-8'));
    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
    });
    await context.addCookies(session.cookies || []);
    const page = await context.newPage();

    // Login Check
    console.log('🌐 Prüfe Instagram Login...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dismissPopups(page);

    if (page.url().includes('login')) {
        console.log('❌ Nicht eingeloggt! Bitte Session erneuern.\n');
        await browser.close();
        return;
    }
    console.log('✅ Eingeloggt!\n');

    // Teste jedes Profil
    const results: { username: string; dbCount: number; liveCount: number | null; diff: number | string; screenshot: boolean }[] = [];

    for (const row of profiles.rows) {
        const username = row.username as string;
        const dbCount = (row.followingCount as number) || 0;
        const existingScreenshot = row.screenshotUrl as string | null;

        console.log('─'.repeat(60));
        console.log(`🔍 Teste @${username}`);
        console.log(`   📊 DB: ${dbCount} Following`);

        const liveCount = await getFollowingCount(page, username);

        if (liveCount === null) {
            console.log('   ⚠️ Konnte Live-Zahl nicht lesen');
            results.push({ username, dbCount, liveCount: null, diff: 'ERROR', screenshot: false });
        } else {
            console.log(`   🌐 Live: ${liveCount} Following`);

            const diff = liveCount - dbCount;
            if (diff === 0) {
                console.log('   ✅ Keine Änderung');
            } else if (diff > 0) {
                console.log(`   🚨 ÄNDERUNG: +${diff} (neue Follows!)`);
            } else {
                console.log(`   🚨 ÄNDERUNG: ${diff} (Unfollows!)`);
            }

            // Screenshot NUR bei Änderung machen!
            let screenshotMade = false;
            if (diff !== 0) {
                console.log(`   📸 Screenshot wegen Änderung...`);
                const screenshotUrl = await captureProfileScreenshot(page, username);
                if (screenshotUrl) {
                    await db.execute({
                        sql: `UPDATE MonitoredProfile SET screenshotUrl = ? WHERE username = ?`,
                        args: [screenshotUrl, username]
                    });
                    screenshotMade = true;
                }
            }

            results.push({ username, dbCount, liveCount, diff, screenshot: screenshotMade });
        }

        console.log('');
        await humanDelay(5000, 8000);
    }

    await browser.close();

    // Zusammenfassung
    console.log('═'.repeat(60));
    console.log('📊 ERGEBNIS-ZUSAMMENFASSUNG\n');

    console.log('┌─────────────────────────┬────────┬────────┬──────────┬──────────┐');
    console.log('│ Username                │ DB     │ Live   │ Diff     │ Screenshot│');
    console.log('├─────────────────────────┼────────┼────────┼──────────┼──────────┤');

    for (const r of results) {
        const user = r.username.padEnd(23);
        const db = String(r.dbCount).padStart(6);
        const live = r.liveCount !== null ? String(r.liveCount).padStart(6) : '  ERR!';
        const diff = typeof r.diff === 'number'
            ? (r.diff > 0 ? `+${r.diff}` : r.diff === 0 ? '0' : String(r.diff)).padStart(8)
            : '   ERROR';
        const screenshot = r.screenshot ? '    ✅    ' : '          ';
        console.log(`│ ${user} │ ${db} │ ${live} │ ${diff} │${screenshot}│`);
    }

    console.log('└─────────────────────────┴────────┴────────┴──────────┴──────────┘');

    // Änderungen zählen
    const changesCount = results.filter(r => typeof r.diff === 'number' && r.diff !== 0).length;
    const errorsCount = results.filter(r => r.diff === 'ERROR').length;

    console.log(`\n✅ ${results.length - errorsCount - changesCount} Profile unverändert`);
    if (changesCount > 0) console.log(`🚨 ${changesCount} Profile mit Änderungen`);
    if (errorsCount > 0) console.log(`⚠️ ${errorsCount} Profile konnten nicht gelesen werden`);

    // Git Push
    console.log('\n📤 Pushe Screenshots zu Git...');
    exec(`cd ${process.cwd()} && git add public/screenshots/ && git commit -m "test: profile screenshots" && git push origin main`, (err) => {
        if (!err) console.log('   ✅ Screenshots gepusht!');
        else console.log('   ℹ️ Keine neuen Screenshots');
    });

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Test abgeschlossen');
    console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
