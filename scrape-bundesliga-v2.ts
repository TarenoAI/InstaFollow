/**
 * 🏆 BUNDESLIGA INSTAGRAM SCRAPER v2
 * 
 * Features:
 * - Scrappt alle Bundesliga-Spieler von Transfermarkt.de
 * - Extrahiert deren Instagram-Accounts
 * - Prüft Follower-Zahl auf Instagram und filtert nach Mindestgröße
 * - Fügt relevante Accounts automatisch zur Überwachung hinzu
 * 
 * Ausführen: npx tsx scrape-bundesliga-v2.ts [min-followers]
 * Beispiel:  npx tsx scrape-bundesliga-v2.ts 10000   (nur Accounts mit 10k+ Followern)
 */

import 'dotenv/config';
import { chromium, devices, Page, BrowserContext } from 'playwright';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const INSTAGRAM_SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

// Minimum Follower-Zahl (Standard: 50.000)
const MIN_FOLLOWERS = parseInt(process.argv[2] || '50000');

// Team-Limit für Test (0 = alle)
const MAX_TEAMS = parseInt(process.argv[3] || '0');

interface BundesligaTeam {
    name: string;
    id: string;
}

interface PlayerInfo {
    playerName: string;
    team: string;
    instagram: string;
    followers: number;
    isVerified: boolean;
    fullName: string | null;
    profilePicUrl: string | null;
}

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

// ═══════════════════════════════════════════════════════════════
// TRANSFERMARKT SCRAPING
// ═══════════════════════════════════════════════════════════════

/**
 * Holt alle Bundesliga-Teams
 */
async function getTeams(page: Page): Promise<BundesligaTeam[]> {
    console.log('📋 Hole Bundesliga-Teams von Transfermarkt.de...\n');

    await page.goto('https://www.transfermarkt.de/bundesliga/startseite/wettbewerb/L1', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });
    await page.waitForTimeout(3000);

    // Cookie-Banner akzeptieren
    try {
        const acceptBtn = await page.$('#onetrust-accept-btn-handler');
        if (acceptBtn) await acceptBtn.click();
        await page.waitForTimeout(1000);
    } catch { }

    const teams = await page.evaluate(() => {
        const teamLinks = document.querySelectorAll('a[href*="/startseite/verein/"]');
        const teamsMap = new Map<string, { name: string; id: string }>();

        teamLinks.forEach(link => {
            const href = link.getAttribute('href') || '';
            const match = href.match(/\/startseite\/verein\/(\d+)/);
            if (match) {
                const id = match[1];
                const name = link.textContent?.trim() || '';
                if (name && name.length > 2 && !teamsMap.has(id)) {
                    teamsMap.set(id, { name, id });
                }
            }
        });

        return Array.from(teamsMap.values());
    });

    console.log(`✅ ${teams.length} Teams gefunden:\n`);
    teams.forEach((t, i) => console.log(`   ${i + 1}. ${t.name}`));

    return teams;
}

/**
 * Holt alle Spieler-Instagram-Links von einem Team
 */
async function getTeamPlayerInstagrams(page: Page, team: BundesligaTeam): Promise<string[]> {
    // Korrigierte URL-Struktur
    const kaderUrl = `https://www.transfermarkt.de/fc-bayern-munchen/kader/verein/${team.id}/saison_id/2025`;

    await page.goto(kaderUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });
    await page.waitForTimeout(2000);

    // Finde alle Spieler-Profile (mehrere Selektoren)
    const playerUrls = await page.$$eval('a[href*="/profil/spieler/"]', (links) => {
        const unique = new Map<string, string>();
        links.forEach(link => {
            const href = link.getAttribute('href') || '';
            const name = link.textContent?.trim() || '';
            if (href && name && name.length > 2) {
                const match = href.match(/\/profil\/spieler\/(\d+)/);
                if (match) {
                    unique.set(match[1], href);
                }
            }
        });
        return Array.from(unique.values());
    });

    console.log(`   📋 ${playerUrls.length} Spieler gefunden, suche Instagram...`);

    const instagrams: string[] = [];
    const blacklist = ['transfermarkt', 'bundesliga', 'instagram', 'dfb'];

    for (const url of playerUrls) {
        try {
            await page.goto(`https://www.transfermarkt.de${url}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
            await page.waitForTimeout(1000);

            const instagram = await page.evaluate((bl) => {
                const instaLinks = document.querySelectorAll('a[href*="instagram.com"]');
                for (const link of instaLinks) {
                    const href = link.getAttribute('href') || '';
                    const match = href.match(/instagram\.com\/([^\/\?\#]+)/);
                    if (match) {
                        const username = match[1].toLowerCase();
                        if (!bl.some(b => username.includes(b)) && username.length > 2 && username.length < 35) {
                            return match[1];
                        }
                    }
                }
                return null;
            }, blacklist);

            if (instagram) {
                instagrams.push(instagram);
            }

            await humanDelay(300, 600);

        } catch { }
    }

    console.log(`   ✅ ${instagrams.length} Instagram-Accounts gefunden`);
    return instagrams;
}

// ═══════════════════════════════════════════════════════════════
// INSTAGRAM FOLLOWER CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Prüft Instagram-Profil und holt Follower-Zahl
 */
async function checkInstagramProfile(page: Page, username: string): Promise<PlayerInfo | null> {
    try {
        await page.goto(`https://www.instagram.com/${username}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });
        await page.waitForTimeout(2500);

        // Dismiss popups
        for (const sel of ['button:has-text("Alle akzeptieren")', 'button:has-text("Jetzt nicht")', 'button:has-text("Not Now")']) {
            try {
                const btn = await page.$(sel);
                if (btn && await btn.isVisible()) await btn.click({ force: true });
            } catch { }
        }
        await page.waitForTimeout(500);

        const profileInfo = await page.evaluate(() => {
            // Follower-Zahl
            let followers = 0;
            const metaLinks = document.querySelectorAll('a[href*="/followers/"], span[title], meta[property="og:description"]');

            for (const el of metaLinks) {
                const text = el.getAttribute('title') || el.textContent || '';
                // Match patterns like "1.5M", "150K", "1,234,567"
                const match = text.match(/([\d,.]+)\s*([MK])?/i);
                if (match) {
                    let num = parseFloat(match[1].replace(/,/g, ''));
                    if (match[2]?.toUpperCase() === 'M') num *= 1000000;
                    if (match[2]?.toUpperCase() === 'K') num *= 1000;
                    if (num > followers) followers = Math.round(num);
                }
            }

            // Fallback: Meta Description
            if (followers === 0) {
                const metaDesc = document.querySelector('meta[property="og:description"]');
                const content = metaDesc?.getAttribute('content') || '';
                const match = content.match(/([\d,.]+)\s*(Mio\.|M|Tsd\.|K)?\s*(Follower|Abonnenten)/i);
                if (match) {
                    let num = parseFloat(match[1].replace(/,/g, '.'));
                    if (match[2] && (match[2].includes('Mio') || match[2] === 'M')) num *= 1000000;
                    if (match[2] && (match[2].includes('Tsd') || match[2] === 'K')) num *= 1000;
                    followers = Math.round(num);
                }
            }

            // Verified Badge
            const isVerified = !!document.querySelector('svg[aria-label="Verifiziert"], svg[aria-label="Verified"]');

            // Full Name
            const nameEl = document.querySelector('header section span, header h2');
            const fullName = nameEl?.textContent?.trim() || null;

            // Profile Pic
            const picEl = document.querySelector('header img');
            const profilePicUrl = picEl?.getAttribute('src') || null;

            return { followers, isVerified, fullName, profilePicUrl };
        });

        return {
            playerName: username,
            team: '',
            instagram: username,
            followers: profileInfo.followers,
            isVerified: profileInfo.isVerified,
            fullName: profileInfo.fullName,
            profilePicUrl: profileInfo.profilePicUrl
        };

    } catch (err: any) {
        console.log(`      ❌ @${username}: Fehler`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════════════════

async function saveToTurso(players: PlayerInfo[], setName: string) {
    console.log('\n' + '═'.repeat(60));
    console.log('💾 SPEICHERE IN TURSO');
    console.log('═'.repeat(60) + '\n');

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    // Erstelle/Finde Set
    let setId: string;
    const existingSet = await db.execute({
        sql: 'SELECT id FROM ProfileSet WHERE name = ?',
        args: [setName]
    });

    if (existingSet.rows.length > 0) {
        setId = existingSet.rows[0].id as string;
        console.log(`📁 Set "${setName}" existiert (ID: ${setId})`);
    } else {
        setId = `set_${Date.now()}`;
        await db.execute({
            sql: `INSERT INTO ProfileSet (id, name, isActive, createdAt, updatedAt) 
                  VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
            args: [setId, setName]
        });
        console.log(`📁 Set "${setName}" erstellt (ID: ${setId})`);
    }

    let added = 0;
    let skipped = 0;

    for (const player of players) {
        const existing = await db.execute({
            sql: 'SELECT id FROM MonitoredProfile WHERE username = ? AND setId = ?',
            args: [player.instagram, setId]
        });

        if (existing.rows.length > 0) {
            skipped++;
            continue;
        }

        const profileId = `bl_${Date.now()}_${added}`;
        await db.execute({
            sql: `INSERT INTO MonitoredProfile 
                  (id, username, fullName, profilePicUrl, isVerified, followerCount, followingCount, setId, createdAt, updatedAt) 
                  VALUES (?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))`,
            args: [profileId, player.instagram, player.fullName || player.playerName, player.profilePicUrl, player.isVerified ? 1 : 0, player.followers, setId]
        });

        console.log(`   🆕 @${player.instagram} (${player.followers.toLocaleString()} Follower)`);
        added++;

        await humanDelay(30, 60);
    }

    console.log(`\n✅ ${added} Profile hinzugefügt, ${skipped} übersprungen`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('🏆 BUNDESLIGA INSTAGRAM SCRAPER v2');
    console.log(`📊 Minimum Follower: ${MIN_FOLLOWERS.toLocaleString()}`);
    if (MAX_TEAMS > 0) console.log(`🔢 Max Teams: ${MAX_TEAMS}`);
    console.log('═'.repeat(60) + '\n');

    // Browser für Transfermarkt (Desktop)
    const transfermarktBrowser = await chromium.launch({
        headless: false,
        args: ['--lang=de-DE']
    });
    const transfermarktPage = await transfermarktBrowser.newPage();

    // Browser für Instagram (Mobile)
    const instagramBrowser = await chromium.launch({ headless: false });
    const instagramContext = await instagramBrowser.newContext({
        ...iPhone,
        locale: 'de-DE',
        storageState: fs.existsSync(INSTAGRAM_SESSION_PATH) ? INSTAGRAM_SESSION_PATH : undefined
    });
    const instagramPage = await instagramContext.newPage();

    const allPlayersFiltered: PlayerInfo[] = [];
    const allInstagrams: { username: string; team: string }[] = [];

    try {
        // 1. Hole Teams
        const teams = await getTeams(transfermarktPage);
        const teamsToProcess = MAX_TEAMS > 0 ? teams.slice(0, MAX_TEAMS) : teams;

        // 2. Sammle Instagram-Accounts von Transfermarkt
        console.log('\n' + '─'.repeat(60));
        console.log('📱 PHASE 1: Instagram-Accounts von Transfermarkt sammeln');
        console.log('─'.repeat(60) + '\n');

        for (let i = 0; i < teamsToProcess.length; i++) {
            const team = teamsToProcess[i];
            console.log(`\n[${i + 1}/${teamsToProcess.length}] ⚽ ${team.name}`);

            const instagrams = await getTeamPlayerInstagrams(transfermarktPage, team);
            instagrams.forEach(ig => allInstagrams.push({ username: ig, team: team.name }));

            await humanDelay(2000, 3000);
        }

        console.log(`\n✅ ${allInstagrams.length} Instagram-Accounts von Transfermarkt gesammelt`);

        // 3. Prüfe Follower-Zahlen auf Instagram
        console.log('\n' + '─'.repeat(60));
        console.log(`📊 PHASE 2: Follower-Check (Min: ${MIN_FOLLOWERS.toLocaleString()})`);
        console.log('─'.repeat(60) + '\n');

        // Deduplicate
        const uniqueInstagrams = [...new Map(allInstagrams.map(x => [x.username.toLowerCase(), x])).values()];
        console.log(`📋 ${uniqueInstagrams.length} einzigartige Accounts zu prüfen\n`);

        let checked = 0;
        let passed = 0;
        let failed = 0;

        for (const { username, team } of uniqueInstagrams) {
            checked++;
            const progress = `[${checked}/${uniqueInstagrams.length}]`;

            const info = await checkInstagramProfile(instagramPage, username);

            if (info && info.followers >= MIN_FOLLOWERS) {
                info.team = team;
                allPlayersFiltered.push(info);
                passed++;
                console.log(`${progress} ✅ @${username}: ${info.followers.toLocaleString()} Follower ${info.isVerified ? '✓' : ''}`);
            } else if (info) {
                failed++;
                console.log(`${progress} ⚪ @${username}: ${info.followers.toLocaleString()} (< ${MIN_FOLLOWERS.toLocaleString()})`);
            } else {
                failed++;
            }

            await humanDelay(2000, 3000);

            // Instagram Session speichern
            if (checked % 10 === 0) {
                await instagramContext.storageState({ path: INSTAGRAM_SESSION_PATH });
            }
        }

        // Final Save
        await instagramContext.storageState({ path: INSTAGRAM_SESSION_PATH });

        // 4. Zusammenfassung
        console.log('\n\n' + '═'.repeat(60));
        console.log('📊 ZUSAMMENFASSUNG');
        console.log('═'.repeat(60));
        console.log(`\n🏆 ${teamsToProcess.length} Teams durchsucht`);
        console.log(`📱 ${uniqueInstagrams.length} Instagram-Accounts geprüft`);
        console.log(`✅ ${allPlayersFiltered.length} Accounts mit ${MIN_FOLLOWERS.toLocaleString()}+ Followern\n`);

        // Top 20 nach Followern
        const sorted = allPlayersFiltered.sort((a, b) => b.followers - a.followers);
        console.log('🔝 TOP ACCOUNTS:');
        sorted.slice(0, 20).forEach((p, i) => {
            console.log(`   ${(i + 1).toString().padStart(2)}. @${p.instagram.padEnd(25)} ${p.followers.toLocaleString().padStart(15)} ${p.isVerified ? '✓' : ''}`);
        });

        // 5. In Turso speichern
        if (allPlayersFiltered.length > 0) {
            await saveToTurso(allPlayersFiltered, `Bundesliga ${MIN_FOLLOWERS >= 100000 ? '100k+' : MIN_FOLLOWERS >= 50000 ? '50k+' : MIN_FOLLOWERS >= 10000 ? '10k+' : 'All'}`);
        }

    } catch (err: any) {
        console.error('\n❌ Fehler:', err.message);
    } finally {
        console.log('\n⏳ Browser schließen...');
        await transfermarktBrowser.close();
        await instagramBrowser.close();
    }

    console.log('\n✅ Fertig!\n');
}

main();
