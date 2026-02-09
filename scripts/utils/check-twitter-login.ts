
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
            // Git Push für den Screenshot
            try {
                const { exec } = require('child_process');
                console.log('   📸 Screenshot wird zu Git gepusht...');
                // Force add (-f) weil public/debug ignoriert wird
                exec(`git add -f ${screenshotPath} && git commit -m "chore: Update Twitter status screenshot" && git push`, (err: any, stdout: any, stderr: any) => {
                    if (err) console.log('   ⚠️ Git Push Fehler (nicht kritisch):', stderr);
                    else console.log('   ✅ Screenshot gepusht!');
                });
            } catch (e) { console.log('   ⚠️ Git Push Fehler:', e); }

            await updateDbStatus(true);
        } else {
            console.log('❌ NICHT EINGELOGGT: Login-Seite oder Flow sichtbar.');
            const screenshotPath = path.join(DEBUG_DIR, 'twitter-login-fail.png');
            await page.screenshot({ path: screenshotPath });

            // Git Push auch bei Failure
            try {
                const { exec } = require('child_process');
                console.log('   📸 Failure-Screenshot wird zu Git gepusht...');
                exec(`git add ${screenshotPath} && git commit -m "chore: Update Twitter failure screenshot" && git push`, (err: any, stdout: any, stderr: any) => {
                    if (err) console.log('   ⚠️ Git Push Fehler (nicht kritisch):', stderr);
                    else console.log('   ✅ Failure-Screnshot gepusht!');
                });
            } catch (e) { console.log('   ⚠️ Git Push Fehler:', e); }

            await updateDbStatus(false);
        }

        await closeTwitterContext(context);
    } catch (err: any) {
        console.log(`❌ FEHLER: ${err.message}`);
        await closeTwitterContext(context).catch(() => { });
        process.exit(1);
    }
}

async function updateDbStatus(isLoggedIn: boolean) {
    try {
        // Finde den Haupt-Account (oder alle)
        const accounts = await (prisma as any).twitterAccount.findMany();

        for (const acc of accounts) {
            await (prisma as any).twitterAccount.update({
                where: { id: acc.id },
                data: {
                    lastLoginStatus: isLoggedIn,
                    lastStatusCheckAt: new Date()
                }
            });
            console.log(`   💾 Datenbank aktualisiert für @${acc.username}`);
        }
    } catch (err) {
        // Falls Tabellen noch nicht existieren (Migration fehlt)
        console.log('   ⚠️ Datenbank-Update übersprungen (Migration fehlt vermutlich)');
    }
}

checkLogin().catch(err => {
    console.error(err);
    process.exit(1);
});
