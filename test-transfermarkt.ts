/**
 * 🧪 TEST: Einzelnes Team von Transfermarkt scrapen
 * Testet das Instagram-Scraping für FC Bayern München
 */

import 'dotenv/config';
import { chromium, Page } from 'playwright';

interface PlayerInstagram {
    playerName: string;
    team: string;
    instagram: string;
}

async function humanDelay(minMs: number, maxMs: number) {
    await new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

async function main() {
    console.log('\n🧪 TEST: FC Bayern München Instagram-Accounts\n');

    const browser = await chromium.launch({
        headless: false,
        args: ['--lang=de-DE']
    });

    const page = await browser.newPage();

    try {
        // Gehe zur Kader-Seite
        console.log('🌐 Lade Kader-Seite...');
        await page.goto('https://www.transfermarkt.de/fc-bayern-munchen/kader/verein/27/saison_id/2025', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(3000);

        // Cookie-Banner akzeptieren
        try {
            const acceptBtn = await page.$('#onetrust-accept-btn-handler');
            if (acceptBtn) {
                await acceptBtn.click();
                console.log('   ✅ Cookie-Banner akzeptiert');
                await page.waitForTimeout(1000);
            }
        } catch { }

        // Screenshot machen
        await page.screenshot({ path: 'test-transfermarkt-kader.png' });
        console.log('   📸 Screenshot gespeichert');

        // Finde Spieler-Links in der Haupttabelle
        const playerUrls = await page.$$eval('table.items tbody tr td.hauptlink a[href*="/profil/spieler/"]', (links) => {
            return links.map(link => ({
                name: link.textContent?.trim() || '',
                href: link.getAttribute('href') || ''
            })).filter(p => p.name && p.href);
        });

        console.log(`\n📋 ${playerUrls.length} Spieler gefunden:\n`);

        const playersWithInsta: PlayerInstagram[] = [];

        for (let i = 0; i < Math.min(playerUrls.length, 10); i++) { // Nur erste 10 für Test
            const player = playerUrls[i];
            const url = `https://www.transfermarkt.de${player.href}`;

            console.log(`[${i + 1}/${Math.min(playerUrls.length, 10)}] ${player.name}...`);

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForTimeout(2000);

                // Suche nach Instagram-Link im Social Media Bereich (nur persönliche Accounts)
                const instagram = await page.evaluate(() => {
                    // Blacklist für Seiten-Accounts die keine Spieler sind
                    const blacklist = ['transfermarkt.de', 'transfermarkt', 'bundesliga', 'instagram.com', 'instagram'];

                    // Suche im "Social Media" Bereich (Spielerdaten-Box)
                    const socialMediaRow = document.querySelector('th.bg_blau_20:has-text("Social Media"), span:contains("Social Media")');

                    // Methode 1: Alle Instagram-Links durchsuchen, aber nur im Content-Bereich
                    const contentArea = document.querySelector('.spielerdaten, .dataContent, main');
                    const instaLinks = (contentArea || document).querySelectorAll('a[href*="instagram.com"]');

                    for (const link of instaLinks) {
                        const href = link.getAttribute('href') || '';
                        const match = href.match(/instagram\.com\/([^\/\?\#]+)/);
                        if (match) {
                            const username = match[1].toLowerCase();
                            // Filter: Nicht in Blacklist und sieht aus wie ein Spieler-Account
                            if (!blacklist.includes(username) &&
                                !username.includes('transfermarkt') &&
                                username.length > 2 &&
                                username.length < 30) {
                                return match[1];
                            }
                        }
                    }

                    return null;
                });

                if (instagram) {
                    console.log(`   ✅ @${instagram}`);
                    playersWithInsta.push({
                        playerName: player.name,
                        team: 'FC Bayern München',
                        instagram
                    });
                } else {
                    console.log(`   ⚪ Kein Instagram gefunden`);
                }

                await humanDelay(1000, 2000);

            } catch (err: any) {
                console.log(`   ❌ Fehler: ${err.message}`);
            }
        }

        console.log('\n' + '═'.repeat(50));
        console.log('📊 ERGEBNIS:');
        console.log('═'.repeat(50));
        console.log(`\n${playersWithInsta.length} Spieler mit Instagram gefunden:\n`);

        playersWithInsta.forEach(p => {
            console.log(`   • @${p.instagram} - ${p.playerName}`);
        });

    } finally {
        console.log('\n⏳ Browser schließt in 5 Sekunden...');
        await new Promise(r => setTimeout(r, 5000));
        await browser.close();
    }
}

main();
