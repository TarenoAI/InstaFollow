/**
 * 🔬 TEST: API-Interception für vollständige Following-Liste
 * 
 * Fängt die Instagram GraphQL API-Calls ab während wir scrollen
 */

import 'dotenv/config';
import { chromium, devices, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const SESSION_PATH = path.join(process.cwd(), 'playwright-session.json');
const iPhone = devices['iPhone 13 Pro'];

interface FollowingUser {
    username: string;
    full_name?: string;
    is_verified?: boolean;
}

async function main() {
    console.log('\n🔬 API-INTERCEPTION TEST: @dfb_team\n');

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        ...iPhone,
        locale: 'de-DE',
        storageState: fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined
    });
    const page = await context.newPage();

    // Sammle alle Following aus API-Responses
    const apiFollowing = new Set<string>();

    // Intercepte alle Netzwerk-Responses
    page.on('response', async (response) => {
        const url = response.url();

        // Instagram GraphQL API für Following
        if (url.includes('/api/v1/friendships/') && url.includes('/following/')) {
            try {
                const json = await response.json();
                if (json.users) {
                    for (const user of json.users) {
                        if (user.username) {
                            apiFollowing.add(user.username);
                            console.log(`   📡 API: @${user.username} (Total: ${apiFollowing.size})`);
                        }
                    }
                }
            } catch { }
        }

        // Auch GraphQL abfangen
        if (url.includes('graphql') && url.includes('following')) {
            try {
                const json = await response.json();
                // Verschiedene GraphQL Response-Strukturen
                const edges = json?.data?.user?.edge_follow?.edges ||
                    json?.data?.user?.following?.edges ||
                    [];
                for (const edge of edges) {
                    const username = edge?.node?.username;
                    if (username) {
                        apiFollowing.add(username);
                        console.log(`   📡 GraphQL: @${username} (Total: ${apiFollowing.size})`);
                    }
                }
            } catch { }
        }
    });

    console.log('🌐 Gehe zu Profil...');
    await page.goto('https://www.instagram.com/dfb_team/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Popups schließen
    for (const sel of ['button:has-text("Alle akzeptieren")', 'button:has-text("Jetzt nicht")']) {
        try {
            const btn = await page.$(sel);
            if (btn && await btn.isVisible()) await btn.click({ force: true });
        } catch { }
    }

    console.log('👆 Öffne Following-Liste...\n');
    await page.click('a[href*="following"]', { timeout: 10000 });
    await page.waitForTimeout(5000);

    // Scroll durch die Liste um API-Calls zu triggern
    console.log('📜 Scrolle durch die Liste (API-Calls werden abgefangen)...\n');

    // Auch DOM-basiert sammeln
    const domFollowing = new Set<string>();
    let noNewCount = 0;

    for (let scroll = 0; scroll < 100 && noNewCount < 30; scroll++) {
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

        if (scroll % 10 === 0) {
            console.log(`Scroll ${scroll + 1}: DOM=${domFollowing.size} | API=${apiFollowing.size}`);
        }

        await page.evaluate(() => window.scrollBy(0, 400));
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
        await page.mouse.wheel(0, 300);
        await new Promise(r => setTimeout(r, 1000));
    }

    domFollowing.delete('dfb_team');
    apiFollowing.delete('dfb_team');

    // Kombiniere beide Quellen
    const combined = new Set([...domFollowing, ...apiFollowing]);

    console.log('\n' + '═'.repeat(60));
    console.log('📊 ERGEBNIS:');
    console.log('═'.repeat(60));
    console.log(`   DOM-basiert:     ${domFollowing.size}/203 (${((domFollowing.size / 203) * 100).toFixed(1)}%)`);
    console.log(`   API-Interception: ${apiFollowing.size}/203 (${((apiFollowing.size / 203) * 100).toFixed(1)}%)`);
    console.log(`   KOMBINIERT:       ${combined.size}/203 (${((combined.size / 203) * 100).toFixed(1)}%)`);
    console.log('═'.repeat(60) + '\n');

    if (apiFollowing.size > domFollowing.size) {
        console.log('✅ API-Interception hat MEHR gefunden! Diese Strategie funktioniert.');

        // Zeige die zusätzlichen
        const additional = [...apiFollowing].filter(u => !domFollowing.has(u));
        if (additional.length > 0) {
            console.log(`\n📋 Zusätzliche ${additional.length} via API:`);
            additional.forEach(u => console.log(`   + @${u}`));
        }
    } else {
        console.log('ℹ️ API-Interception hat nicht mehr gefunden als DOM.');
    }

    await context.storageState({ path: SESSION_PATH });
    console.log('\n⏳ Browser schließt in 10 Sekunden...');
    await new Promise(r => setTimeout(r, 10000));
    await browser.close();
}

main();
