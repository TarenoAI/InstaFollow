/**
 * 🍪 EXPORT TWITTER SESSION FROM FIREFOX
 * 
 * Extrahiert Twitter/X Cookies aus der Firefox SQLite Datenbank der VPS
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Pfad zur Firefox SQLite DB (auf deiner VPS gefunden)
const cookiesDb = '/root/snap/firefox/common/.mozilla/firefox/n0ef3nry.default/cookies.sqlite';
const SESSION_PATH = path.join(process.cwd(), 'data/sessions/twitter-session.json');

async function main() {
    console.log('🍪 Starte Twitter Cookie Export...');

    if (!fs.existsSync(cookiesDb)) {
        console.error(`❌ Firefox-Datenbank nicht gefunden unter: ${cookiesDb}`);
        process.exit(1);
    }

    try {
        // KOPIERE DB UM LOCK ZU UMGEHEN
        const tempDb = path.join('/tmp', `cookies_temp_${Date.now()}.sqlite`);
        fs.copyFileSync(cookiesDb, tempDb);

        const db = new Database(tempDb, { readonly: true });

        // Hole alle x.com/twitter.com Cookies
        const cookies = db.prepare(`
            SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite
            FROM moz_cookies 
            WHERE host LIKE '%x.com%' OR host LIKE '%twitter.com%'
        `).all();

        console.log(`📊 Gefundene Cookies: ${cookies.length}`);

        if (cookies.length === 0) {
            console.error('❌ Keine Twitter Cookies im Firefox-Profil gefunden. Bist du dort eingeloggt?');
            db.close();
            process.exit(1);
        }

        // Konvertiere zu Playwright-Format
        const playwrightCookies = cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
            domain: c.host,
            path: c.path,
            expires: c.expiry,
            httpOnly: !!c.isHttpOnly,
            secure: !!c.isSecure,
            sameSite: c.sameSite === 0 ? 'None' : c.sameSite === 1 ? 'Lax' : 'Strict'
        }));

        // Verzeichnis sicherstellen
        const sessionDir = path.dirname(SESSION_PATH);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Speichere Session
        const session = { cookies: playwrightCookies, origins: [] };
        fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));

        console.log(`✅ Session gespeichert in: ${SESSION_PATH}`);

        const hasAuthToken = cookies.some((c: any) => c.name === 'auth_token');
        if (hasAuthToken) {
            console.log('💎 auth_token gefunden! Der Login sollte funktionieren.');
        } else {
            console.log('⚠️ auth_token FEHLT! Du musst dich vermutlich erst im Firefox einloggen.');
        }

        db.close();
    } catch (err: any) {
        console.error(`❌ Fehler beim DB-Zugriff: ${err.message}`);
    }
}

main().catch(console.error);
