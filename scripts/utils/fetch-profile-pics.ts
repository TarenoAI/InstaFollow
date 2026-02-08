/**
 * 📸 FETCH PROFILE PICTURES
 * 
 * Holt Profilbilder und speichert sie LOKAL (nicht nur URLs).
 * Die lokalen Bilder werden in public/profile-pics/ gespeichert.
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { chromium, devices, Page, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';

// MUSS der gleiche Pfad sein wie in smart-monitor-v4.ts!
const BROWSER_PROFILE_DIR = path.join(process.cwd(), 'data/browser-profiles/instagram');
const PROFILE_PICS_DIR = path.join(process.cwd(), 'public/profile-pics');
const iPhone = devices['iPhone 13 Pro'];

// Erstelle Ordner
if (!fs.existsSync(PROFILE_PICS_DIR)) {
    fs.mkdirSync(PROFILE_PICS_DIR, { recursive: true });
}

// DB Connection
const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function delay(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

// Download Bild und speichere lokal
async function downloadImage(url: string, filename: string): Promise<string | null> {
    return new Promise((resolve) => {
        const filepath = path.join(PROFILE_PICS_DIR, filename);
        const file = fs.createWriteStream(filepath);

        const protocol = url.startsWith('https') ? https : http;

        const request = protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15',
                'Accept': 'image/*',
            }
        }, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(`/profile-pics/${filename}`);
                });
            } else {
                file.close();
                fs.unlink(filepath, () => { });
                resolve(null);
            }
        });

        request.on('error', () => {
            file.close();
            fs.unlink(filepath, () => { });
            resolve(null);
        });

        request.setTimeout(10000, () => {
            request.destroy();
            resolve(null);
        });
    });
}

async function getProfileInfo(page: Page, username: string): Promise<{
    profilePicUrl: string;
    fullName: string;
    isVerified: boolean;
    followerCount: string;
    followingCount: number;
} | null> {
    try {
        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(2000);

        // Dismiss popups
        for (const selector of ['button:has-text("Jetzt nicht")', 'button:has-text("Ablehnen")', '[aria-label="Schließen"]']) {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
                await btn.click().catch(() => { });
                await delay(500);
            }
        }

        // Get profile info
        let profilePicUrl = '';
        try {
            const img = page.locator('header img[alt*="Profilbild"], header img[alt*="profile picture"]').first();
            if (await img.isVisible({ timeout: 2000 })) {
                profilePicUrl = await img.getAttribute('src') || '';
            }
        } catch { }

        const headerText = await page.locator('header').first().textContent() || '';
        const fullName = headerText.split('\n').find(l => l.trim() && !l.includes('@')) || username;
        const isVerified = headerText.includes('Verifiziert') || await page.locator('header [aria-label*="Verifiziert"]').isVisible().catch(() => false);

        // Get counts
        const statsText = await page.locator('header ul, header section').first().textContent() || '';
        const followingMatch = statsText.match(/(\d+(?:[.,]\d+)?)\s*(?:Gefolgt|Following|abonniert)/i);
        const followerMatch = statsText.match(/(\d+(?:[.,]\d+)?)\s*(?:Follower|Abonnent)/i);

        return {
            profilePicUrl,
            fullName: fullName.trim(),
            isVerified,
            followerCount: followerMatch?.[1] || '0',
            followingCount: parseInt(followingMatch?.[1]?.replace(/[.,]/g, '') || '0'),
        };
    } catch (err: any) {
        console.log(`   ❌ Fehler: ${err.message}`);
        return null;
    }
}

async function main() {
    const setName = process.argv[2] || 'Bundesliga 300K+';
    const forceRefresh = process.argv.includes('--force');

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`📸 PROFILBILDER AKTUALISIEREN (LOKAL SPEICHERN)`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    console.log(`📋 Set: ${setName}`);
    console.log(`🔄 Force Refresh: ${forceRefresh ? 'Ja' : 'Nein'}`);

    // Get profiles from set
    const setResult = await db.execute({
        sql: `SELECT ps.id as setId, ps.name 
              FROM ProfileSet ps 
              WHERE ps.name LIKE ?`,
        args: [`%${setName}%`]
    });

    if (!setResult.rows.length) {
        console.log(`❌ Set "${setName}" nicht gefunden!`);
        process.exit(1);
    }

    const setId = setResult.rows[0].setId as string;
    console.log(`✅ Set gefunden: ${setResult.rows[0].name}`);

    // Get profiles in set
    const profilesResult = await db.execute({
        sql: `SELECT mp.id, mp.username, mp.profilePicUrl 
              FROM MonitoredProfile mp
              JOIN _MonitoredProfileToProfileSet rel ON mp.id = rel.A
              WHERE rel.B = ?
              ORDER BY mp.username`,
        args: [setId]
    });

    const profiles = profilesResult.rows;
    console.log(`📊 ${profiles.length} Profile im Set\n`);

    // Filter profiles - nur die ohne lokales Bild oder bei --force alle
    const needPics = forceRefresh
        ? profiles
        : profiles.filter(p => !p.profilePicUrl || !(p.profilePicUrl as string).startsWith('/profile-pics/'));

    console.log(`📸 Zu aktualisieren: ${needPics.length}\n`);

    if (needPics.length === 0) {
        console.log(`✅ Alle Profile haben lokale Bilder!`);
        process.exit(0);
    }

    // Launch browser mit persistentem Profil
    console.log(`🌐 Starte Browser mit persistentem Profil...`);
    console.log(`📂 Profil: ${BROWSER_PROFILE_DIR}`);

    // Erstelle Profil-Ordner falls nicht vorhanden
    if (!fs.existsSync(BROWSER_PROFILE_DIR)) {
        fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
    }

    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ],
        ...iPhone,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin'
    });
    const page = context.pages()[0] || await context.newPage();

    let updated = 0;
    let failed = 0;

    for (let i = 0; i < needPics.length; i++) {
        const profile = needPics[i];
        const username = profile.username as string;

        console.log(`────────────────────────────────────────────────────────────`);
        console.log(`[${i + 1}/${needPics.length}] @${username}`);

        const info = await getProfileInfo(page, username);

        if (info?.profilePicUrl) {
            // Download und lokal speichern
            const filename = `${username}.jpg`;
            const localPath = await downloadImage(info.profilePicUrl, filename);

            if (localPath) {
                await db.execute({
                    sql: `UPDATE MonitoredProfile SET 
                          profilePicUrl = ?,
                          fullName = ?,
                          isVerified = ?,
                          followerCount = ?,
                          followingCount = ?
                          WHERE id = ?`,
                    args: [
                        localPath,  // Lokaler Pfad statt Instagram URL!
                        info.fullName,
                        info.isVerified ? 1 : 0,
                        parseInt(info.followerCount.replace(/[.,]/g, '') || '0'),
                        info.followingCount,
                        profile.id
                    ]
                });
                console.log(`   ✅ Lokal gespeichert: ${localPath}`);
                updated++;
            } else {
                console.log(`   ⚠️ Download fehlgeschlagen`);
                failed++;
            }
        } else {
            console.log(`   ⚠️ Kein Bild gefunden`);
            failed++;
        }

        // Rate limiting
        await delay(3000 + Math.random() * 2000);
    }

    await context.close();

    // Git Push der Bilder
    const { exec } = await import('child_process');
    exec(`cd ${process.cwd()} && git add public/profile-pics/ && git commit -m "auto: profile pics" && git push origin main`,
        (err) => {
            if (!err) console.log('📤 Bilder zu Git gepusht');
        });

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`✅ Fertig: ${updated} lokal gespeichert, ${failed} fehlgeschlagen`);
    console.log(`📁 Bilder in: ${PROFILE_PICS_DIR}`);
    console.log(`════════════════════════════════════════════════════════════\n`);
}

main().catch(console.error);
