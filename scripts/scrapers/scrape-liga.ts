/**
 * 🌍 UNIVERSELLER LIGA INSTAGRAM SCRAPER v3
 * 
 * Korrigierter Ansatz mit Cookie-Consent und Besuch der Spieler-Profilseiten.
 * 
 * Ausführen: 
 *   npx tsx scripts/scrapers/scrape-liga.ts <liga-code> [min-followers]
 */

import 'dotenv/config';
import { chromium, devices, Page } from 'playwright';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const INSTAGRAM_SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

const LIGA_CODE = process.argv[2] || 'L1';
const MIN_FOLLOWERS = parseInt(process.argv[3] || '300000');

const LIGEN: Record<string, { name: string; url: string }> = {
    'GB1': { name: 'Premier League', url: 'https://www.transfermarkt.de/premier-league/startseite/wettbewerb/GB1' },
    'ES1': { name: 'LaLiga', url: 'https://www.transfermarkt.de/laliga/startseite/wettbewerb/ES1' },
    'IT1': { name: 'Serie A', url: 'https://www.transfermarkt.de/serie-a/startseite/wettbewerb/IT1' },
    'L1': { name: 'Bundesliga', url: 'https://www.transfermarkt.de/bundesliga/startseite/wettbewerb/L1' },
    'FR1': { name: 'Ligue 1', url: 'https://www.transfermarkt.de/ligue-1/startseite/wettbewerb/FR1' },
};

const TOP5_CODES = ['GB1', 'ES1', 'IT1', 'L1', 'FR1'];

interface Team {
    name: string;
    id: string;
}

interface PlayerLink {
    name: string;
    profileUrl: string;
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
// COOKIE CONSENT HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleCookieConsent(page: Page) {
    try {
        await page.waitForTimeout(1000);

        const consentSelectors = [
            'button:has-text("Zustimmen")',
            'button:has-text("Accept")',
            'button:has-text("Akzeptieren")',
            '[title="Zustimmen & weiter"]',
            '.sp_choice_type_11',
        ];

        for (const selector of consentSelectors) {
            try {
                const btn = await page.$(selector);
                if (btn) {
                    await btn.click();
                    await page.waitForTimeout(500);
                    return;
                }
            } catch { }
        }

        for (const frame of page.frames()) {
            try {
                const btn = await frame.$('button:has-text("Zustimmen")');
                if (btn) {
                    await btn.click();
                    await page.waitForTimeout(500);
                    return;
                }
            } catch { }
        }
    } catch (e) {
        // Ignore
    }
}

// ═══════════════════════════════════════════════════════════════
// TRANSFERMARKT SCRAPING
// ═══════════════════════════════════════════════════════════════

async function getTeamsFromLiga(page: Page, ligaUrl: string): Promise<Team[]> {
    console.log(`   📋 Lade Teams von ${ligaUrl}...`);

    await page.goto(ligaUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await handleCookieConsent(page);

    const teams = await page.evaluate(() => {
        const results: { name: string; id: string }[] = [];
        const links = document.querySelectorAll('a[href*="/startseite/verein/"]');
        const seen = new Set<string>();

        links.forEach(link => {
            const href = link.getAttribute('href') || '';
            const match = href.match(/\/verein\/(\d+)/);
            const name = link.textContent?.trim() || '';

            if (match && name.length > 1 && !seen.has(match[1])) {
                seen.add(match[1]);
                results.push({
                    name,
                    id: match[1]
                });
            }
        });

        return results;
    });

    console.log(`   ✅ ${teams.length} Teams gefunden`);
    return teams;
}

async function getPlayerLinksFromTeam(page: Page, team: Team): Promise<PlayerLink[]> {
    const kaderUrl = `https://www.transfermarkt.de/team/kader/verein/${team.id}/saison_id/2024/plus/1`;

    try {
        await page.goto(kaderUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        await handleCookieConsent(page);

        const players = await page.evaluate(() => {
            const results: { name: string; profileUrl: string }[] = [];
            const seen = new Set<string>();
            const links = document.querySelectorAll('a[href*="/profil/spieler/"]');

            links.forEach(link => {
                const href = link.getAttribute('href') || '';
                const name = link.textContent?.trim() || '';

                if (href && name.length > 2 && !seen.has(href)) {
                    const isPlayerName = !name.includes('Transferhistorie') &&
                        !name.includes('Leistungsdaten') &&
                        !name.match(/^\d+$/);
                    if (isPlayerName) {
                        seen.add(href);
                        results.push({
                            name,
                            profileUrl: 'https://www.transfermarkt.de' + href
                        });
                    }
                }
            });

            return results;
        });

        return players;
    } catch (error) {
        console.error(`   ⚠️ Fehler beim Laden von ${team.name}:`, error);
        return [];
    }
}

async function getInstagramFromPlayerProfile(page: Page, player: PlayerLink): Promise<string | null> {
    try {
        await page.goto(player.profileUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000); // Schnellerer Zugriff, da TM stabil ist

        await handleCookieConsent(page);

        const instagram = await page.evaluate(() => {
            const igByTitle = document.querySelector('a[title="Instagram"]');
            if (igByTitle) {
                const href = igByTitle.getAttribute('href') || '';
                const match = href.match(/instagram\.com\/([^\/\?\s]+)/);
                if (match) return match[1].toLowerCase().replace(/\/$/, '');
            }

            const igInToolbar = document.querySelector('.social-media-toolbar__icons a[href*="instagram.com"]');
            if (igInToolbar) {
                const href = igInToolbar.getAttribute('href') || '';
                const match = href.match(/instagram\.com\/([^\/\?\s]+)/);
                if (match) return match[1].toLowerCase().replace(/\/$/, '');
            }

            const allIgLinks = document.querySelectorAll('a[href*="instagram.com"]');
            for (const link of allIgLinks) {
                const href = link.getAttribute('href') || '';
                const match = href.match(/instagram\.com\/([^\/\?\s]+)/);
                if (match && !['p', 'explore', 'reel', 'stories', 'accounts'].includes(match[1])) {
                    return match[1].toLowerCase().replace(/\/$/, '');
                }
            }

            return null;
        });

        return instagram;
    } catch (error) {
        return null;
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

            const isVerified = !!document.querySelector('svg[aria-label*="Verified"], span[title*="Verified"], svg[aria-label*="verifiziert"]');
            const nameEl = document.querySelector('header section h2, header h1');
            const fullName = nameEl?.textContent?.trim() || null;
            const picEl = document.querySelector('header img[alt]');
            const profilePicUrl = picEl?.getAttribute('src') || null;

            return { followers, isVerified, fullName, profilePicUrl };
        });

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
    } catch (error) {
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

    const setId = `set_${setName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    await db.execute({
        sql: `INSERT OR IGNORE INTO ProfileSet (id, name, isActive, createdAt, updatedAt) 
              VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
        args: [setId, setName]
    });

    let added = 0;
    for (const player of players) {
        try {
            const profileId = `mp_${player.instagram.toLowerCase()}`;
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
                    profileId,
                    player.instagram.toLowerCase(),
                    player.fullName || player.playerName,
                    player.profilePicUrl,
                    player.isVerified ? 1 : 0,
                    player.followers
                ]
            });

            await db.execute({
                sql: `INSERT OR IGNORE INTO _MonitoredProfileToProfileSet (A, B) VALUES (?, ?)`,
                args: [profileId, setId]
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
    let ligaCodes: string[];
    if (LIGA_CODE.toUpperCase() === 'ALL') {
        ligaCodes = TOP5_CODES;
    } else if (!LIGEN[LIGA_CODE.toUpperCase()]) {
        console.error(`❌ Unbekannter Liga-Code: ${LIGA_CODE}`);
        console.log('Verfügbare Codes:', Object.keys(LIGEN).join(', '), 'oder ALL');
        process.exit(1);
    } else {
        ligaCodes = [LIGA_CODE.toUpperCase()];
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🏆 LIGA INSTAGRAM SCRAPER v3`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`📌 Ligen: ${ligaCodes.map(c => LIGEN[c].name).join(', ')}`);
    console.log(`📌 Mindest-Follower: ${formatFollowers(MIN_FOLLOWERS)}`);
    console.log(`${'═'.repeat(60)}\n`);

    const sessionPath = fs.existsSync(INSTAGRAM_SESSION_PATH)
        ? INSTAGRAM_SESSION_PATH
        : fs.existsSync('playwright-session.json') ? 'playwright-session.json' : undefined;

    const browser = await chromium.launch({ headless: true });

    const tmContext = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    });
    const tmPage = await tmContext.newPage();

    const igContext = await browser.newContext({
        ...iPhone,
        storageState: sessionPath
    });
    const igPage = await igContext.newPage();

    const allPlayers: PlayerInfo[] = [];
    const checkedInstagrams = new Set<string>();

    try {
        for (const code of ligaCodes) {
            const liga = LIGEN[code];
            console.log(`\n🏟️ === ${liga.name} ===`);

            const teams = await getTeamsFromLiga(tmPage, liga.url);

            for (const team of teams) {
                console.log(`\n   ⚽ ${team.name}`);

                const playerLinks = await getPlayerLinksFromTeam(tmPage, team);
                console.log(`      👥 ${playerLinks.length} Spieler im Kader`);

                let teamInstagrams = 0;
                let teamQualified = 0;

                for (const player of playerLinks) {
                    await humanDelay(200, 400);
                    const instagram = await getInstagramFromPlayerProfile(tmPage, player);

                    if (instagram && !checkedInstagrams.has(instagram)) {
                        checkedInstagrams.add(instagram);
                        teamInstagrams++;

                        await humanDelay(1000, 2000);
                        const info = await checkInstagramProfile(igPage, instagram, player.name, team.name, liga.name);

                        if (info) {
                            const status = info.followers >= MIN_FOLLOWERS ? '✅ QUALIFIZIERT' : '⬇️ Nicht qualifiziert';
                            console.log(`      ${player.name}: @${instagram} (${formatFollowers(info.followers)}) -> ${status}`);

                            if (info.followers >= MIN_FOLLOWERS) {
                                teamQualified++;
                                allPlayers.push(info);
                            }
                        }
                    } else if (instagram) {
                        // Bereits gecheckt
                    } else {
                        console.log(`      ${player.name}: ❌ Kein Instagram`);
                    }
                }

                console.log(`      📊 Ergebnis: ${teamInstagrams} IG Accounts, ${teamQualified} qualifiziert`);
            }
        }

        allPlayers.sort((a, b) => b.followers - a.followers);

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`📊 ZUSAMMENFASSUNG`);
        console.log(`${'═'.repeat(60)}`);
        console.log(`Gefunden: ${allPlayers.length} Spieler mit ${formatFollowers(MIN_FOLLOWERS)}+ Followern\n`);

        if (allPlayers.length > 0) {
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
