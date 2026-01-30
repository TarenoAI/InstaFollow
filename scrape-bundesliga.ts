/**
 * 🏆 BUNDESLIGA INSTAGRAM SCRAPER
 * 
 * Scrappt alle Bundesliga-Spieler von Transfermarkt.de und extrahiert deren Instagram-Accounts
 * Fügt diese automatisch zur Überwachung hinzu
 * 
 * Ausführen: npx tsx scrape-bundesliga.ts
 */

import 'dotenv/config';
import { chromium, devices, Page } from 'playwright';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');

interface BundesligaTeam {
    name: string;
    id: string;
    kaderUrl: string;
}

interface PlayerInstagram {
    playerName: string;
    team: string;
    instagram: string;
    position?: string;
    marketValue?: string;
}

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

/**
 * Holt alle Bundesliga-Teams von der Startseite
 */
async function getTeams(page: Page): Promise<BundesligaTeam[]> {
    console.log('📋 Hole Bundesliga-Teams...\n');

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
        const teamsMap = new Map<string, { name: string; id: string; kaderUrl: string }>();

        teamLinks.forEach(link => {
            const href = link.getAttribute('href') || '';
            const match = href.match(/\/startseite\/verein\/(\d+)/);
            if (match) {
                const id = match[1];
                const name = link.textContent?.trim() || '';
                if (name && !teamsMap.has(id)) {
                    teamsMap.set(id, {
                        name,
                        id,
                        kaderUrl: `https://www.transfermarkt.de/team/kader/verein/${id}/saison_id/2025`
                    });
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
 * Holt alle Spieler mit Instagram von einem Team
 */
async function getPlayersWithInstagram(page: Page, team: BundesligaTeam): Promise<PlayerInstagram[]> {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`⚽ ${team.name}`);
    console.log('─'.repeat(50));

    const kaderUrl = `https://www.transfermarkt.de/fc-bayern-munchen/kader/verein/${team.id}/saison_id/2025`;

    await page.goto(kaderUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });
    await page.waitForTimeout(3000);

    // Finde alle Spieler-Links
    const playerLinks = await page.$$eval('a[href*="/profil/spieler/"]', (links) => {
        const unique = new Map<string, string>();
        links.forEach(link => {
            const href = link.getAttribute('href') || '';
            const name = link.textContent?.trim() || '';
            if (href && name && name.length > 2) {
                const match = href.match(/\/profil\/spieler\/(\d+)/);
                if (match) {
                    unique.set(match[1], JSON.stringify({ name, href: `https://www.transfermarkt.de${href}` }));
                }
            }
        });
        return Array.from(unique.values());
    });

    console.log(`   📋 ${playerLinks.length} Spieler gefunden`);

    const playersWithInsta: PlayerInstagram[] = [];

    // Besuche jeden Spieler und suche nach Instagram
    for (let i = 0; i < playerLinks.length; i++) {
        const { name, href } = JSON.parse(playerLinks[i]);

        try {
            await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForTimeout(1500);

            // Suche nach Instagram-Link im Social Media Bereich (nur persönliche Accounts)
            const instagram = await page.evaluate(() => {
                // Blacklist für Seiten-Accounts die keine Spieler sind
                const blacklist = ['transfermarkt.de', 'transfermarkt', 'bundesliga', 'instagram.com', 'instagram', 'dfb', '@'];

                // Alle Instagram-Links durchsuchen
                const instaLinks = document.querySelectorAll('a[href*="instagram.com"]');

                for (const link of instaLinks) {
                    const href = link.getAttribute('href') || '';
                    const match = href.match(/instagram\.com\/([^\/\?\#]+)/);
                    if (match) {
                        const username = match[1].toLowerCase();
                        // Filter: Nicht in Blacklist und sieht aus wie ein Spieler-Account
                        if (!blacklist.includes(username) &&
                            !username.includes('transfermarkt') &&
                            !username.includes('bundesliga') &&
                            username.length > 2 &&
                            username.length < 35) {
                            return match[1];
                        }
                    }
                }

                return null;
            });

            if (instagram) {
                console.log(`      ✅ @${instagram} - ${name}`);
                playersWithInsta.push({
                    playerName: name,
                    team: team.name,
                    instagram
                });
            } else {
                console.log(`      ⚪ ${name} - kein Instagram`);
            }

            await humanDelay(500, 1000);

        } catch (err: any) {
            console.log(`      ❌ ${name} - Fehler: ${err.message}`);
        }
    }

    console.log(`\n   📊 ${playersWithInsta.length}/${playerLinks.length} Spieler mit Instagram`);

    return playersWithInsta;
}

/**
 * Fügt Instagram-Accounts zur Überwachung hinzu
 */
async function addToMonitoring(players: PlayerInstagram[], setName: string) {
    console.log('\n' + '═'.repeat(60));
    console.log('💾 SPEICHERE IN TURSO');
    console.log('═'.repeat(60) + '\n');

    const db = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!
    });

    // Erstelle Set falls nicht vorhanden
    let setId: string;
    const existingSet = await db.execute({
        sql: 'SELECT id FROM ProfileSet WHERE name = ?',
        args: [setName]
    });

    if (existingSet.rows.length > 0) {
        setId = existingSet.rows[0].id as string;
        console.log(`📁 Set "${setName}" existiert bereits (ID: ${setId})`);
    } else {
        setId = `set_${Date.now()}`;
        await db.execute({
            sql: `INSERT INTO ProfileSet (id, name, isActive, createdAt, updatedAt) 
                  VALUES (?, ?, 1, datetime('now'), datetime('now'))`,
            args: [setId, setName]
        });
        console.log(`📁 Set "${setName}" erstellt (ID: ${setId})`);
    }

    // Füge Profile hinzu
    let added = 0;
    let skipped = 0;

    for (const player of players) {
        // Prüfe ob schon vorhanden
        const existing = await db.execute({
            sql: 'SELECT id FROM MonitoredProfile WHERE username = ? AND setId = ?',
            args: [player.instagram, setId]
        });

        if (existing.rows.length > 0) {
            skipped++;
            continue;
        }

        // Neues Profil erstellen
        const profileId = `tm_${Date.now()}_${added}`;
        await db.execute({
            sql: `INSERT INTO MonitoredProfile 
                  (id, username, fullName, followingCount, setId, createdAt, updatedAt) 
                  VALUES (?, ?, ?, 0, ?, datetime('now'), datetime('now'))`,
            args: [profileId, player.instagram, player.playerName, setId]
        });

        console.log(`   🆕 @${player.instagram} (${player.playerName}) hinzugefügt`);
        added++;

        await humanDelay(50, 100);
    }

    console.log(`\n✅ ${added} Profile hinzugefügt, ${skipped} übersprungen`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('🏆 BUNDESLIGA INSTAGRAM SCRAPER');
    console.log('═'.repeat(60) + '\n');

    const browser = await chromium.launch({
        headless: false,
        args: ['--lang=de-DE']
    });

    const context = await browser.newContext({
        locale: 'de-DE',
        viewport: { width: 1280, height: 900 }
    });

    const page = await context.newPage();

    const allPlayers: PlayerInstagram[] = [];

    try {
        // 1. Hole alle Teams
        const teams = await getTeams(page);

        // 2. Für jedes Team: Hole Spieler mit Instagram
        for (let i = 0; i < teams.length; i++) {
            const team = teams[i];
            console.log(`\n[${i + 1}/${teams.length}]`);

            const players = await getPlayersWithInstagram(page, team);
            allPlayers.push(...players);

            // Pause zwischen Teams
            if (i < teams.length - 1) {
                console.log(`\n⏳ Warte 5 Sekunden...`);
                await humanDelay(4000, 6000);
            }
        }

        console.log('\n\n' + '═'.repeat(60));
        console.log('📊 ZUSAMMENFASSUNG');
        console.log('═'.repeat(60));
        console.log(`\n🏆 ${teams.length} Teams durchsucht`);
        console.log(`📱 ${allPlayers.length} Spieler mit Instagram gefunden\n`);

        // 3. In Turso speichern
        if (allPlayers.length > 0) {
            await addToMonitoring(allPlayers, 'Bundesliga 25/26');
        }

        // Zeige alle gefundenen
        console.log('\n📋 GEFUNDENE INSTAGRAM-ACCOUNTS:');
        console.log('─'.repeat(50));

        const byTeam = new Map<string, PlayerInstagram[]>();
        for (const p of allPlayers) {
            if (!byTeam.has(p.team)) byTeam.set(p.team, []);
            byTeam.get(p.team)!.push(p);
        }

        for (const [team, players] of byTeam) {
            console.log(`\n⚽ ${team} (${players.length}):`);
            players.forEach(p => console.log(`   • @${p.instagram} - ${p.playerName}`));
        }

    } catch (err: any) {
        console.error('\n❌ Fehler:', err.message);
    } finally {
        console.log('\n⏳ Browser schließt in 5 Sekunden...');
        await new Promise(r => setTimeout(r, 5000));
        await browser.close();
    }

    console.log('\n✅ Fertig!\n');
}

main();
