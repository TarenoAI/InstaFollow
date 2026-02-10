
import 'dotenv/config';
import { chromium, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

/**
 * 🕵️‍♂️ INSTAGRAM STEP-BY-STEP DEBUGGER
 * 
 * Führt die kritischen Schritte manuell durch und erstellt nach jedem Schritt einen Screenshot.
 * Ideal um Rate-Limits oder UI-Änderungen zu verstehen.
 */

const DEBUG_DIR = path.join(process.cwd(), 'public/debug/step-test');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

async function pushToGit(username: string) {
    try {
        const { execSync } = await import('child_process');
        console.log(`\n📤 Pushe Debug-Screenshots für @${username} zu Git...`);
        execSync(`git config user.email "bot@tareno.ai" && git config user.name "InstaBot"`, { stdio: 'ignore' });
        execSync(`git add public/debug/step-test/`, { stdio: 'ignore' });
        const status = execSync('git status --porcelain').toString();
        if (status.trim().length > 0) {
            execSync(`git commit -m "debug: step-by-step instagram test @${username}"`, { stdio: 'ignore' });
            execSync(`git pull --rebase origin main && git push origin main`, { stdio: 'ignore' });
            console.log(`✅ Screenshots gepusht!`);
        } else {
            console.log(`ℹ️ Keine neuen Bilder zum Pushen.`);
        }
    } catch (err: any) {
        console.log(`⚠️ Git-Push fehlgeschlagen: ${err.message}`);
    }
}

async function takeStepScreenshot(page: Page, stepName: string) {
    const filename = `step_${Date.now()}_${stepName.replace(/\s+/g, '_')}.png`;
    const fullPath = path.join(DEBUG_DIR, filename);
    await page.screenshot({ path: fullPath, fullPage: true });
    console.log(`📸 Screenshot [${stepName}]: ${fullPath}`);
}

async function runTest(username: string) {
    console.log(`🚀 Starte Step-by-Step Test für @${username}...`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        storageState: path.join(process.cwd(), 'data/browser-profiles/instagram-session.json'),
        viewport: { width: 390, height: 844 }, // Mobile Viewport
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1'
    });

    const page = await context.newPage();

    try {
        // SCHRITT 1: Navigiere zu Profil
        console.log(`1️⃣ Navigiere zu: https://www.instagram.com/${username}/`);
        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
        await takeStepScreenshot(page, 'navigation');

        // SCHRITT 2: Klicke auf Following
        console.log(`2️⃣ Suche Following-Link...`);
        const followingLink = page.locator(`a[href$="/following/"]`).first();
        if (await followingLink.isVisible()) {
            await followingLink.click();
            console.log(`✅ Klick auf Following ausgeführt.`);
        } else {
            console.log(`⚠️ Following-Link nicht direkt sichtbar. Versuche via JS.`);
            await page.evaluate(() => {
                const link = Array.from(document.querySelectorAll('a')).find(a => a.href.includes('/following/'));
                if (link) link.click();
            });
        }
        await page.waitForTimeout(2000);
        await takeStepScreenshot(page, 'after_click_following');

        // SCHRITT 3: Warte 10 Sekunden
        console.log(`3️⃣ Warte 10 Sekunden (Beobachte Loading/Blocks)...`);
        await page.waitForTimeout(10000);
        await takeStepScreenshot(page, 'after_10s_wait');

        // SCHRITT 4: Fehlerprüfung (Rate Limit)
        console.log(`4️⃣ Prüfe auf Fehlermeldungen...`);
        const bodyText = await page.evaluate(() => document.body.innerText);
        const rateLimitTexts = ["Versuche es später noch einmal", "Try again later"];
        let blocked = false;
        for (const text of rateLimitTexts) {
            if (bodyText.includes(text)) {
                console.log(`🚨 BLOCK ERKANNT: "${text}"`);
                blocked = true;
                break;
            }
        }

        if (blocked) {
            console.log(`👉 Versuche "OK" zu klicken...`);
            const okButton = page.locator('button:has-text("OK"), button:has-text("Ok")').first();
            if (await okButton.isVisible()) {
                await okButton.click();
                await page.waitForTimeout(2000);
            }
        }
        await takeStepScreenshot(page, 'after_error_check');

        // SCHRITT 5: Scroll-Versuche
        console.log(`5️⃣ Starte 3 Scroll-Versuche...`);
        for (let i = 1; i <= 3; i++) {
            console.log(`   📜 Scroll #${i}...`);
            await page.keyboard.press('PageDown');
            await page.waitForTimeout(3000);
            await takeStepScreenshot(page, `scroll_${i}`);
        }

    } catch (err: any) {
        console.error(`❌ Test fehlgeschlagen: ${err.message}`);
    } finally {
        await browser.close();
        await pushToGit(username);
        console.log(`🏁 Test abgeschlossen.`);
    }
}

const target = process.argv[2] || 'morewatchez';
runTest(target).catch(console.error);
