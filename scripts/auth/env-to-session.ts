/**
 * Konvertiert die Instagram Cookies aus .env in eine Playwright-Session-Datei
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const SESSION_PATH = path.join(process.cwd(), 'data/sessions/playwright-session.json');

async function main() {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🍪 COOKIE → SESSION KONVERTER');
    console.log('═══════════════════════════════════════════════════════════\n');

    const sessionId = process.env.INSTAGRAM_SESSION_ID;
    const csrfToken = process.env.INSTAGRAM_CSRF_TOKEN;
    const dsUserId = process.env.INSTAGRAM_DS_USER_ID;

    if (!sessionId) {
        console.log('❌ INSTAGRAM_SESSION_ID fehlt in .env!');
        return;
    }

    console.log('📋 Gefundene Cookies:');
    console.log(`   sessionid: ${sessionId.substring(0, 20)}...`);
    console.log(`   csrftoken: ${csrfToken || '(nicht gesetzt)'}`);
    console.log(`   ds_user_id: ${dsUserId || '(nicht gesetzt)'}`);

    // Cookies im Playwright-Format
    const cookies = [
        {
            name: 'sessionid',
            value: sessionId,
            domain: '.instagram.com',
            path: '/',
            expires: Date.now() / 1000 + 365 * 24 * 60 * 60, // 1 Jahr
            httpOnly: true,
            secure: true,
            sameSite: 'Lax' as const
        },
        {
            name: 'csrftoken',
            value: csrfToken || '',
            domain: '.instagram.com',
            path: '/',
            expires: Date.now() / 1000 + 365 * 24 * 60 * 60,
            httpOnly: false,
            secure: true,
            sameSite: 'Lax' as const
        },
        {
            name: 'ds_user_id',
            value: dsUserId || '',
            domain: '.instagram.com',
            path: '/',
            expires: Date.now() / 1000 + 365 * 24 * 60 * 60,
            httpOnly: false,
            secure: true,
            sameSite: 'Lax' as const
        },
        {
            name: 'ig_did',
            value: 'VPS-' + Date.now(),
            domain: '.instagram.com',
            path: '/',
            expires: Date.now() / 1000 + 365 * 24 * 60 * 60,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax' as const
        },
        {
            name: 'mid',
            value: 'VPS-' + Math.random().toString(36).substring(2),
            domain: '.instagram.com',
            path: '/',
            expires: Date.now() / 1000 + 365 * 24 * 60 * 60,
            httpOnly: false,
            secure: true,
            sameSite: 'Lax' as const
        }
    ].filter(c => c.value); // Leere Cookies entfernen

    // Session-Datei erstellen
    const sessionDir = path.dirname(SESSION_PATH);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    fs.writeFileSync(SESSION_PATH, JSON.stringify({ cookies }, null, 2));

    console.log(`\n✅ Session-Datei erstellt: ${SESSION_PATH}`);
    console.log(`   ${cookies.length} Cookies geschrieben\n`);

    console.log('🧪 Jetzt den Session-Test ausführen:');
    console.log('   npx tsx scripts/auth/session-test.ts\n');
}

main().catch(console.error);
