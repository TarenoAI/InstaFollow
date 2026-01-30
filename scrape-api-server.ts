/**
 * 🚀 SCRAPE API SERVER
 * 
 * HTTP Server der Scrape-Anfragen von der UI empfängt
 * Läuft auf dem VPS neben dem Cron-Job
 * 
 * Starten: npx tsx scrape-api-server.ts
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { chromium, devices, Page } from 'playwright';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.SCRAPE_API_PORT || 3001;

const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

// Middleware
app.use(cors());
app.use(express.json());

// Database
const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!
});

// Aktive Scrape-Jobs
const activeJobs = new Map<string, {
    status: 'starting' | 'counting' | 'scraping' | 'saving' | 'done' | 'error';
    progress: number;
    total: number;
    found: number;
    estimatedSeconds: number;
    error?: string;
    startedAt: number;
}>();

// Browser-Instanz (wiederverwendbar)
let browser: any = null;
let context: any = null;
let page: Page | null = null;

async function ensureBrowser() {
    if (!browser) {
        console.log('🌐 Starte Browser...');
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({
            ...iPhone,
            locale: 'de-DE',
            storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined
        });
        page = await context.newPage();
    }
    return page!;
}

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

/**
 * Holt Following-Anzahl von einem Profil (Quick-Check)
 */
async function getFollowingCount(page: Page, username: string): Promise<number> {
    await page.goto(`https://www.instagram.com/${username}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });
    await page.waitForTimeout(3000);

    const count = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/following/"]');
        for (const link of links) {
            const text = link.textContent || '';
            const match = text.match(/(\d+[.,]?\d*)\s*(K|M|Tsd\.|Mio\.)?/i);
            if (match) {
                let num = parseFloat(match[1].replace(',', '.'));
                const suffix = match[2]?.toLowerCase();
                if (suffix === 'k' || suffix === 'tsd.') num *= 1000;
                if (suffix === 'm' || suffix === 'mio.') num *= 1000000;
                return Math.round(num);
            }
        }
        return 0;
    });

    return count;
}

/**
 * Scrapt Following-Liste mit API-Interception
 */
async function scrapeFollowingList(page: Page, username: string, jobId: string): Promise<string[]> {
    const apiFollowing = new Set<string>();
    const domFollowing = new Set<string>();

    // API Response Handler
    const responseHandler = async (response: any) => {
        const url = response.url();
        if (url.includes('/api/v1/friendships/') && url.includes('/following/')) {
            try {
                const json = await response.json();
                if (json.users) {
                    for (const user of json.users) {
                        if (user.username) apiFollowing.add(user.username);
                    }
                }
            } catch { }
        }
    };

    page.on('response', responseHandler);

    await page.goto(`https://www.instagram.com/${username}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });
    await page.waitForTimeout(3000);

    // Klicke auf Following
    await page.click('a[href*="following"]', { timeout: 10000 });
    await page.waitForTimeout(3000);

    let noNewCount = 0;
    const maxScrolls = 60;

    for (let scroll = 0; scroll < maxScrolls && noNewCount < 15; scroll++) {
        // DOM-basierte Extraktion
        const users = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .map(a => a.getAttribute('href'))
                .filter(h => h && h.match(/^\/[a-zA-Z0-9._-]+\/?$/))
                .filter(h => !['explore', 'reels', 'p', 'direct', 'accounts', 'stories'].some(x => h!.includes(x)))
                .map(h => h!.replace(/\//g, ''));
        });

        const prevSize = domFollowing.size;
        users.forEach(u => u && domFollowing.add(u));

        if (domFollowing.size === prevSize) noNewCount++;
        else noNewCount = 0;

        // Update Job-Status
        const job = activeJobs.get(jobId);
        if (job) {
            job.found = Math.max(domFollowing.size, apiFollowing.size);
            job.progress = Math.min(scroll / maxScrolls * 100, 99);
        }

        await page.evaluate(() => window.scrollBy(0, 500));
        await humanDelay(2000, 3000);
        await page.mouse.wheel(0, 300);
        await humanDelay(1000, 1500);
    }

    page.off('response', responseHandler);

    // Kombiniere beide Quellen
    const combined = new Set([...domFollowing, ...apiFollowing]);
    combined.delete(username);

    return Array.from(combined);
}

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/health
 * Health-Check
 */
app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', activeJobs: activeJobs.size });
});

/**
 * POST /api/scrape/:username
 * Startet einen Scrape-Job für einen User
 */
app.post('/api/scrape/:username', async (req: Request, res: Response) => {
    const username = req.params.username as string;
    const { profileId, setId } = req.body;

    const jobId = `${username}_${Date.now()}`;

    // Prüfe ob bereits ein Job läuft
    for (const [id, job] of activeJobs) {
        if (id.startsWith(username) && job.status !== 'done' && job.status !== 'error') {
            return res.json({
                success: false,
                error: 'Scrape läuft bereits',
                jobId: id
            });
        }
    }

    // Erstelle Job
    activeJobs.set(jobId, {
        status: 'starting',
        progress: 0,
        total: 0,
        found: 0,
        estimatedSeconds: 0,
        startedAt: Date.now()
    });

    res.json({ success: true, jobId });

    // Starte Scrape im Hintergrund
    (async () => {
        try {
            const page = await ensureBrowser();
            const job = activeJobs.get(jobId)!;

            // 1. Hole Following-Anzahl
            job.status = 'counting';
            const followingCount = await getFollowingCount(page, username);
            job.total = followingCount;

            // Berechne Zeitschätzung (ca. 3 Sekunden pro 10 Following)
            job.estimatedSeconds = Math.max(30, Math.round(followingCount / 10 * 3));

            // 2. Scrape Following-Liste
            job.status = 'scraping';
            const following = await scrapeFollowingList(page, username, jobId);

            // 3. Speichere in Turso
            job.status = 'saving';
            job.found = following.length;

            // Lösche alte Einträge
            await db.execute({
                sql: 'DELETE FROM FollowingEntry WHERE profileId = ?',
                args: [profileId]
            });

            // Füge neue Einträge hinzu
            for (let i = 0; i < following.length; i++) {
                await db.execute({
                    sql: `INSERT INTO FollowingEntry (id, username, position, profileId, addedAt, lastSeenAt, missedScans) 
                          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 0)`,
                    args: [`api_${Date.now()}_${i}`, following[i], i, profileId]
                });
            }

            // Update Profil
            await db.execute({
                sql: `UPDATE MonitoredProfile 
                      SET followingCount = ?, lastCheckedAt = datetime('now'), updatedAt = datetime('now') 
                      WHERE id = ?`,
                args: [following.length, profileId]
            });

            // Session speichern
            await context.storageState({ path: SESSION_PATH });

            job.status = 'done';
            job.progress = 100;

            console.log(`✅ Scrape fertig: @${username} - ${following.length} Following`);

        } catch (err: any) {
            const job = activeJobs.get(jobId);
            if (job) {
                job.status = 'error';
                job.error = err.message;
            }
            console.error(`❌ Scrape-Fehler @${username}:`, err.message);
        }
    })();
});

/**
 * GET /api/scrape/:jobId/status
 * Gibt den Status eines Scrape-Jobs zurück
 */
app.get('/api/scrape/:jobId/status', (req: Request, res: Response) => {
    const jobId = req.params.jobId as string;
    const job = activeJobs.get(jobId);

    if (!job) {
        return res.json({ success: false, error: 'Job nicht gefunden' });
    }

    const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
    const remaining = Math.max(0, job.estimatedSeconds - elapsed);

    res.json({
        success: true,
        ...job,
        elapsedSeconds: elapsed,
        remainingSeconds: remaining
    });

    // Cleanup alte Jobs
    if (job.status === 'done' || job.status === 'error') {
        setTimeout(() => activeJobs.delete(jobId), 60000);
    }
});

/**
 * GET /api/estimate/:username
 * Gibt eine Zeitschätzung für einen User zurück (ohne zu scrapen)
 */
app.get('/api/estimate/:username', async (req: Request, res: Response) => {
    const username = req.params.username as string;

    try {
        const page = await ensureBrowser();
        const followingCount = await getFollowingCount(page, username);

        // Schätzung: ~3 Sekunden pro 10 Following, mindestens 30 Sekunden
        const estimatedSeconds = Math.max(30, Math.round(followingCount / 10 * 3));

        res.json({
            success: true,
            username,
            followingCount,
            estimatedSeconds,
            estimatedMinutes: Math.ceil(estimatedSeconds / 60)
        });

    } catch (err: any) {
        res.json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
    console.log('\n' + '═'.repeat(50));
    console.log('🚀 SCRAPE API SERVER');
    console.log('═'.repeat(50));
    console.log(`\n📡 Server läuft auf Port ${PORT}`);
    console.log('\nEndpoints:');
    console.log(`  GET  /api/health`);
    console.log(`  POST /api/scrape/:username`);
    console.log(`  GET  /api/scrape/:jobId/status`);
    console.log(`  GET  /api/estimate/:username`);
    console.log('\n');
});
