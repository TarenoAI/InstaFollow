/**
 * 🌍 UNIVERSELLER LIGA INSTAGRAM SCRAPER
 * 
 * Unterstützt alle europäischen Top-Ligen von Transfermarkt.de
 * 
 * Ausführen: 
 *   npx tsx scrape-liga.ts <liga-code> [min-followers]
 * 
 * Liga-Codes:
 *   GB1  = Premier League (England)
 *   ES1  = LaLiga (Spanien)
 *   IT1  = Serie A (Italien)
 *   L1   = Bundesliga (Deutschland)
 *   FR1  = Ligue 1 (Frankreich)
 *   PO1  = Liga Portugal
 *   TR1  = Süper Lig (Türkei)
 *   NL1  = Eredivisie (Niederlande)
 *   BE1  = Jupiler Pro League (Belgien)
 *   GR1  = Super League 1 (Griechenland)
 *   DK1  = Superliga (Dänemark)
 *   A1   = Bundesliga (Österreich)
 *   SE1  = Allsvenskan (Schweden)
 *   NO1  = Eliteserien (Norwegen)
 *   SC1  = Premiership (Schottland)
 *   ALL  = Alle Top-5-Ligen (GB1, ES1, IT1, L1, FR1)
 * 
 * Beispiele:
 *   npx tsx scrape-liga.ts L1 300000      # Bundesliga, 300k+ Follower
 *   npx tsx scrape-liga.ts GB1 500000     # Premier League, 500k+ Follower
 *   npx tsx scrape-liga.ts ALL 1000000    # Top-5 Ligen, 1M+ Follower
 */

import 'dotenv/config';
import { chromium, devices, Page } from 'playwright';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const INSTAGRAM_SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

// Liga-Code und Mindest-Follower aus Argumenten
const LIGA_CODE = process.argv[2] || 'L1';
const MIN_FOLLOWERS = parseInt(process.argv[3] || '300000');

// Liga-Definitionen
const LIGEN: Record<string, { name: string; url: string }> = {
    'GB1': { name: 'Premier League', url: 'https://www.transfermarkt.de/premier-league/startseite/wettbewerb/GB1' },
    'ES1': { name: 'LaLiga', url: 'https://www.transfermarkt.de/laliga/startseite/wettbewerb/ES1' },
    'IT1': { name: 'Serie A', url: 'https://www.transfermarkt.de/serie-a/startseite/wettbewerb/IT1' },
    'L1': { name: 'Bundesliga', url: 'https://www.transfermarkt.de/bundesliga/startseite/wettbewerb/L1' },
    'FR1': { name: 'Ligue 1', url: 'https://www.transfermarkt.de/ligue-1/startseite/wettbewerb/FR1' },
    'PO1': { name: 'Liga Portugal', url: 'https://www.transfermarkt.de/liga-portugal/startseite/wettbewerb/PO1' },
    'TR1': { name: 'Süper Lig', url: 'https://www.transfermarkt.de/super-lig/startseite/wettbewerb/TR1' },
    'NL1': { name: 'Eredivisie', url: 'https://www.transfermarkt.de/eredivisie/startseite/wettbewerb/NL1' },
    'BE1': { name: 'Jupiler Pro League', url: 'https://www.transfermarkt.de/jupiler-pro-league/startseite/wettbewerb/BE1' },
    'GR1': { name: 'Super League 1', url: 'https://www.transfermarkt.de/super-league-1/startseite/wettbewerb/GR1' },
    'DK1': { name: 'Superliga', url: 'https://www.transfermarkt.de/superliga/startseite/wettbewerb/DK1' },
    'A1': { name: 'Bundesliga Österreich', url: 'https://www.transfermarkt.de/bundesliga/startseite/wettbewerb/A1' },
    'SE1': { name: 'Allsvenskan', url: 'https://www.transfermarkt.de/allsvenskan/startseite/wettbewerb/SE1' },
    'NO1': { name: 'Eliteserien', url: 'https://www.transfermarkt.de/eliteserien/startseite/wettbewerb/NO1' },
    'SC1': { name: 'Premiership', url: 'https://www.transfermarkt.de/scottish-premiership/startseite/wettbewerb/SC1' },
};

const TOP5_CODES = ['GB1', 'ES1', 'IT1', 'L1', 'FR1'];

interface Team {
    name: string;
    id: string;
}

interface PlayerInfo {
    playerName: string;
    team: string;
    liga: string;
    instagram: string;
    followers: number;
    isVerified: boolean;
    fullName: string | null;
    profilePicUrl: string | null;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, Math.random() * (maxMs - minMs) + minMs));
}

function formatFollowers(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
}

// ═══════════════════════════════════════════════════════════════
// TRANSFERMARKT SCRAPING
// ═══════════════════════════════════════════════════════════════

async function getTeamsFromLiga(page: Page, ligaUrl: string): Promise<Team[]> {
    console.log(`   📋 Lade Teams von ${ligaUrl}...`);

    await page.goto(ligaUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const teams = await page.evaluate(() => {
        const results: { name: string; id: string }[] = [];

        // Vereins-Tabelle finden
        const rows = document.querySelectorAll('table.items tbody tr');
        rows.forEach(row => {
            const link = row.querySelector('td.hauptlink a[href*="/startseite/verein/"]');
            if (link) {
                const href = link.getAttribute('href') || '';
                const match = href.match(/\/verein\/(\d+)/);
                if (match) {
                    results.push({
                        name: link.textContent?.trim() || '',
                        id: match[1]
                    });
                }
            }
        });

        return results;
    });

    console.log(`   ✅ ${teams.length} Teams gefunden`);
    return teams;
}

async function getTeamPlayerInstagrams(page: Page, team: Team): Promise<{ username: string; playerName: string }[]> {
    const kaderUrl = `https://www.transfermarkt.de/team/kader/verein/${team.id}`;

    try {
        await page.goto(kaderUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        const players = await page.evaluate(() => {
            const results: { username: string; playerName: string }[] = [];

            const rows = document.querySelectorAll('table.items tbody tr.odd, table.items tbody tr.even');
            rows.forEach(row => {
                const nameCell = row.querySelector('td.hauptlink a');
                const igLink = row.querySelector('a[href*="instagram.com"]');

                if (nameCell && igLink) {
                    const href = igLink.getAttribute('href') || '';
                    const match = href.match(/instagram\.com\/([^\/\?]+)/);
                    if (match) {
                        results.push({
                            username: match[1].toLowerCase(),
                            playerName: nameCell.textContent?.trim() || ''
                        });
                    }
                }
            });

            return results;
        });

        return players;
    } catch (error) {
        console.error(`   ⚠️ Fehler bei Team ${team.name}:`, error);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// INSTAGRAM FOLLOWER CHECK
// ═══════════════════════════════════════════════════════════════

async function checkInstagramProfile(page: Page, username: string, playerName: string, team: string, liga: string): Promise<PlayerInfo | null> {
    try {
        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        const profileData = await page.evaluate(() => {
            // Follower-Zahl finden
            const metaDesc = document.querySelector('meta[name="description"]');
            let followers = 0;
            if (metaDesc) {
                const content = metaDesc.getAttribute('content') || '';
                const match = content.match(/([\d,\.]+)\s*(M|K|Mio|Tsd)?\s*Follower/i);
                if (match) {
                    let num = parseFloat(match[1].replace(/,/g, '.'));
                    const suffix = (match[2] || '').toUpperCase();
                    if (suffix === 'M' || suffix === 'MIO') num *= 1_000_000;
                    if (suffix === 'K' || suffix === 'TSD') num *= 1_000;
                    followers = Math.round(num);
                }
            }

            // Alternative: Stats-Bereich
            if (!followers) {
                const statsSection = document.querySelector('header section ul');
                if (statsSection) {
                    const followerItem = Array.from(statsSection.querySelectorAll('li')).find(li =>
                        li.textContent?.toLowerCase().includes('follower')
                    );
                    if (followerItem) {
                        const text = followerItem.textContent || '';
                        const match = text.match(/([\d,\.]+)\s*(M|K)?/i);
                        if (match) {
                            let num = parseFloat(match[1].replace(/,/g, '.'));
                            const suffix = (match[2] || '').toUpperCase();
                            if (suffix === 'M') num *= 1_000_000;
                            if (suffix === 'K') num *= 1_000;
                            followers = Math.round(num);
                        }
                    }
                }
            }

            // Verified Badge
            const isVerified = !!document.querySelector('svg[aria-label*="Verified"], span[title*="Verified"]');

            // Full Name
            const nameEl = document.querySelector('header section h2, header h1');
            const fullName = nameEl?.textContent?.trim() || null;

            // Profile Pic
            const picEl = document.querySelector('header img[alt], img[data-testid="user-avatar"]');
            const profilePicUrl = picEl?.getAttribute('src') || null;

            return { followers, isVerified, fullName, profilePicUrl };
        });

        if (profileData.followers >= MIN_FOLLOWERS) {
            return {
                playerName,
                team,
                liga,
                instagram: username,
                followers: profileData.followers,
                isVerified: profileData.isVerified,
                fullName: profileData.fullName,
                profilePicUrl: profileData.profilePicUrl
            };
        }

        return null;
    } catch (error) {
        console.error(`   ⚠️ Fehler bei @${username}:`, error);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════════════════

async function saveToTurso(players: PlayerInfo[], setName: string) {
    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    console.log(`\n💾 Speichere ${players.length} Spieler in Turso...`);

    // Set erstellen oder finden
    await db.execute({
        sql: `INSERT OR IGNORE INTO ProfileSet (id, name, isActive, createdAt, updatedAt) 
              VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
        args: [`set_${setName.toLowerCase().replace(/\s+/g, '_')}`, setName]
    });

    const setResult = await db.execute({
        sql: `SELECT id FROM ProfileSet WHERE name = ?`,
        args: [setName]
    });
    const setId = setResult.rows[0]?.id as string;

    let added = 0;
    for (const player of players) {
        try {
            // Profil erstellen oder aktualisieren
            await db.execute({
                sql: `INSERT INTO MonitoredProfile (id, username, fullName, profilePicUrl, isVerified, followerCount, createdAt, updatedAt)
                      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                      ON CONFLICT(username) DO UPDATE SET
                        fullName = excluded.fullName,
                        profilePicUrl = excluded.profilePicUrl,
                        isVerified = excluded.isVerified,
                        followerCount = excluded.followerCount,
                        updatedAt = datetime('now')`,
                args: [
                    `mp_${player.instagram.toLowerCase()}`,
                    player.instagram.toLowerCase(),
                    player.fullName || player.playerName,
                    player.profilePicUrl,
                    player.isVerified ? 1 : 0,
                    player.followers
                ]
            });

            // Mit Set verbinden
            await db.execute({
                sql: `INSERT OR IGNORE INTO _MonitoredProfileToProfileSet (A, B) VALUES (?, ?)`,
                args: [`mp_${player.instagram.toLowerCase()}`, setId]
            });

            added++;
            console.log(`   ✅ @${player.instagram} (${player.playerName}, ${player.team})`);
        } catch (err) {
            console.error(`   ❌ Fehler bei @${player.instagram}:`, err);
        }
    }

    console.log(`\n🎉 ${added}/${players.length} Spieler zum Set "${setName}" hinzugefügt!`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    // Bestimme welche Ligen gescrapt werden
    let ligaCodes: string[];
    if (LIGA_CODE.toUpperCase() === 'ALL') {
        ligaCodes = TOP5_CODES;
        console.log(`\n🌍 MULTI-LIGA SCRAPER: Top 5 Ligen`);
    } else if (!LIGEN[LIGA_CODE.toUpperCase()]) {
        console.error(`❌ Unbekannter Liga-Code: ${LIGA_CODE}`);
        console.log('Verfügbare Codes:', Object.keys(LIGEN).join(', '), 'oder ALL');
        process.exit(1);
    } else {
        ligaCodes = [LIGA_CODE.toUpperCase()];
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🏆 LIGA INSTAGRAM SCRAPER`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`📌 Ligen: ${ligaCodes.map(c => LIGEN[c].name).join(', ')}`);
    console.log(`📌 Mindest-Follower: ${formatFollowers(MIN_FOLLOWERS)}`);
    console.log(`${'═'.repeat(60)}\n`);

    const browser = await chromium.launch({ headless: true });

    // Transfermarkt Context (Desktop)
    const tmContext = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const tmPage = await tmContext.newPage();

    // Instagram Context (Mobile mit Session)
    const igContext = await browser.newContext({
        ...iPhone,
        storageState: fs.existsSync(INSTAGRAM_SESSION_PATH) ? INSTAGRAM_SESSION_PATH : undefined
    });
    const igPage = await igContext.newPage();

    const allPlayers: PlayerInfo[] = [];

    try {
        for (const code of ligaCodes) {
            const liga = LIGEN[code];
            console.log(`\n🏟️ === ${liga.name} ===`);

            // Teams holen
            const teams = await getTeamsFromLiga(tmPage, liga.url);

            for (const team of teams) {
                console.log(`\n   ⚽ ${team.name}`);

                // Spieler-Instagrams holen
                const players = await getTeamPlayerInstagrams(tmPage, team);
                console.log(`      📱 ${players.length} Instagram-Accounts gefunden`);

                for (const player of players) {
                    await humanDelay(1000, 2000);

                    const info = await checkInstagramProfile(
                        igPage,
                        player.username,
                        player.playerName,
                        team.name,
                        liga.name
                    );

                    if (info) {
                        console.log(`      ✅ @${info.instagram}: ${formatFollowers(info.followers)} Follower`);
                        allPlayers.push(info);
                    }
                }
            }
        }

        // Sortieren nach Followern
        allPlayers.sort((a, b) => b.followers - a.followers);

        // Zusammenfassung
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`📊 ZUSAMMENFASSUNG`);
        console.log(`${'═'.repeat(60)}`);
        console.log(`Gefunden: ${allPlayers.length} Spieler mit ${formatFollowers(MIN_FOLLOWERS)}+ Followern\n`);

        if (allPlayers.length > 0) {
            console.log('Top 10:');
            allPlayers.slice(0, 10).forEach((p, i) => {
                console.log(`   ${i + 1}. @${p.instagram} - ${formatFollowers(p.followers)} (${p.playerName}, ${p.liga})`);
            });

            // In DB speichern
            const setName = ligaCodes.length > 1
                ? `Top Europa ${formatFollowers(MIN_FOLLOWERS)}+`
                : `${LIGEN[ligaCodes[0]].name} ${formatFollowers(MIN_FOLLOWERS)}+`;

            await saveToTurso(allPlayers, setName);
        }

    } finally {
        await browser.close();
    }
}

main().catch(console.error);
