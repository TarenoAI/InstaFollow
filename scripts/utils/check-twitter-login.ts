
/**
 * 🧪 TWITTER LOGIN CHECKER
 * 
 * Überprüft ob die X/Twitter Session aktuell gültig ist (Home-Feed sichtbar).
 * Gibt den Status zurück und speichert optional einen Screenshot.
 */

import 'dotenv/config';
import { getTwitterContext, closeTwitterContext, checkTwitterSession } from '../lib/twitter-auto-login';
import * as path from 'path';
import { prisma } from '../../src/lib/prisma';

const DEBUG_DIR = path.join(process.cwd(), 'public/debug');

async function checkLogin() {
    console.log('\n🔍 Prüfe X/Twitter Login-Status...');

    // Wir starten im non-headless Modus falls wir manuell schauen wollen (lokal), 
    // aber standardmäßig headless für den Cron/Server.
    const result = await getTwitterContext(true);

    if (!result.success || !result.page || !result.context) {
        console.log(`❌ NICHT EINGELOGGT: ${result.error || 'Unbekannter Fehler'}`);
        await updateDbStatus(false);
        process.exit(1);
    }

    const { page, context } = result;

    try {
        // Wir sind schon auf x.com/home nach getTwitterContext
        const isLoggedIn = await checkTwitterSession(page);

        if (isLoggedIn) {
            console.log('✅ EINGELOGGT: Home-Feed ist sichtbar.');
            const screenshotPath = path.join(DEBUG_DIR, 'twitter-status-check.png');
            await page.screenshot({ path: screenshotPath });
            await pushToGit(screenshotPath, "chore: Update Twitter status screenshot");
            await updateDbStatus(true);
        } else {
            console.log('❌ NICHT EINGELOGGT: Login-Seite oder Flow sichtbar.');
            const screenshotPath = path.join(DEBUG_DIR, 'twitter-login-fail.png');
            await page.screenshot({ path: screenshotPath });
            await pushToGit(screenshotPath, "chore: Update Twitter failure screenshot");
            await updateDbStatus(false);
        }

        await closeTwitterContext(context);
    } catch (err: any) {
        console.log(`❌ FEHLER: ${err.message}`);
        await closeTwitterContext(context).catch(() => { });
        process.exit(1);
    }
}

/**
 * Pushes a file to Git
 */
async function pushToGit(filePath: string, message: string) {
    try {
        const { execSync } = require('child_process');
        console.log(`   📤 Push to Git: ${path.basename(filePath)}...`);

        // Config setzen
        execSync(`git config user.email "bot@tareno.ai" && git config user.name "TwitterBot"`, { stdio: 'ignore' });

        // Add, Commit & Push
        execSync(`git add -f "${filePath}"`, { stdio: 'ignore' });
        execSync(`git commit -m "${message}"`, { stdio: 'ignore' });
        execSync(`git push`, { stdio: 'ignore' });

        console.log(`   ✅ Erfolgreich gepusht zu Git (Pfad: ${filePath.replace(process.cwd(), '')})`);
    } catch (error: any) {
        console.log(`   ⚠️ Git Push fehlgeschlagen: ${error.message}`);
    }
}

async function updateDbStatus(isLoggedIn: boolean) {
    try {
        const { createClient } = await import('@libsql/client');
        const db = createClient({
            url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL!,
            authToken: process.env.TURSO_AUTH_TOKEN
        });

        // Update alle Twitter Accounts
        await db.execute({
            sql: `UPDATE TwitterAccount SET lastLoginStatus = ?, lastStatusCheckAt = datetime('now')`,
            args: [isLoggedIn ? 1 : 0]
        });

        console.log(`   💾 Datenbank aktualisiert: ${isLoggedIn ? 'Eingeloggt' : 'Ausgeloggt'}`);
    } catch (err: any) {
        console.log('   ⚠️ Datenbank-Update fehlgeschlagen:', err.message);
    }
}

checkLogin().catch(err => {
    console.error(err);
    process.exit(1);
});
