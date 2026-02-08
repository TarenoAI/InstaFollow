/**
 * 📸 FETCH PROFILE PICTURES
 * 
 * Holt nur die Profilbilder für alle Profile eines Sets.
 * Keine Following-Liste, nur schneller Profilbild-Update.
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { chromium, devices, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

// DB Connection
const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function delay(ms: number) {
    return new Promise(r => setTimeout(r, ms));
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

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`📸 PROFILBILDER AKTUALISIEREN`);
    console.log(`════════════════════════════════════════════════════════════\n`);
    console.log(`📋 Set: ${setName}`);

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

    // Filter profiles without pics
    const needPics = profiles.filter(p => !p.profilePicUrl);
    console.log(`📸 Davon ohne Profilbild: ${needPics.length}\n`);

    if (needPics.length === 0) {
        console.log(`✅ Alle Profile haben bereits Bilder!`);
        process.exit(0);
    }

    // Launch browser
    console.log(`🌐 Starte Browser...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        ...iPhone,
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined,
        locale: 'de-DE',
    });
    const page = await context.newPage();

    let updated = 0;
    let failed = 0;

    for (let i = 0; i < needPics.length; i++) {
        const profile = needPics[i];
        const username = profile.username as string;

        console.log(`────────────────────────────────────────────────────────────`);
        console.log(`[${i + 1}/${needPics.length}] @${username}`);

        const info = await getProfileInfo(page, username);

        if (info?.profilePicUrl) {
            await db.execute({
                sql: `UPDATE MonitoredProfile SET 
                      profilePicUrl = ?,
                      fullName = ?,
                      isVerified = ?,
                      followerCount = ?,
                      followingCount = ?
                      WHERE id = ?`,
                args: [
                    info.profilePicUrl,
                    info.fullName,
                    info.isVerified ? 1 : 0,
                    parseInt(info.followerCount.replace(/[.,]/g, '') || '0'),
                    info.followingCount,
                    profile.id
                ]
            });
            console.log(`   ✅ Bild gespeichert: ${info.fullName}`);
            updated++;
        } else {
            console.log(`   ⚠️ Kein Bild gefunden`);
            failed++;
        }

        // Rate limiting
        await delay(3000 + Math.random() * 2000);
    }

    await context.storageState({ path: SESSION_PATH });
    await browser.close();

    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`✅ Fertig: ${updated} aktualisiert, ${failed} fehlgeschlagen`);
    console.log(`════════════════════════════════════════════════════════════\n`);
}

main().catch(console.error);
