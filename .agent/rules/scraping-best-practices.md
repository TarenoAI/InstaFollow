# Instagram Scraping Best Practices 🕷️

Dies sind die Regeln für stabiles Instagram-Scraping auf VPS/Headless Umgebungen, basierend auf erfolgreichen Tests (Stand: 2026).

## 1. Viewport & Geräte-Emulation 📱
**IMMER Mobile Viewport nutzen!**
Die Desktop-Version von Instagram lädt Listen in Modals, die oft Lazy-Loading Probleme haben oder nicht vollständig scrollbar sind.

```typescript
// ✅ RICHTIG:
const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 12 Pro
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true
});

// ❌ FALSCH:
// viewport: { width: 1280, height: 800 } (Desktop View verursacht Scroll-Probleme)
```

## 2. Popup-Handling 🚫
**Vorsicht beim Schließen von Popups!**
Einige "Schließen"-Buttons schließen auch wichtige Dialoge (wie die Following-Liste), wenn man sie blindlings klickt.

*   **Vor dem Scraping:** Alle Popups (Cookie, Login-Info, Notifications) schließen.
*   **Während des Scrapings (Liste offen):** KEINE Popups schließen, es sei denn man ist sicher, dass es nicht die Liste ist.

```typescript
// ✅ RICHTIG:
await page.click('a[href*="following"]');
await page.waitForTimeout(4000);
// HIER NICHT dismissPopups() aufrufen!
```

## 3. Scraping Quota 📊
**Niemals 100% erzwingen.**
Instagram blendet oft deaktivierte Accounts nicht ein oder stoppt das Laden kurz vor dem Ende. Lazy Loading ist nicht deterministisch.

*   **Ziel-Quota:** 95% - 98%
*   **Warnung:** Unter 90% ist verdächtig
*   **Abbruch:** Unter 75% auf keinen Fall Changes verarbeiten (Gefahr von Massen-Unfollow-Fehlalarmen!)

```typescript
const MIN_SCRAPE_QUOTA = 0.95; // 95% reicht aus
```

## 4. Navigation & Timeouts ⏳
**Kein `networkidle` verwenden.**
Instagram lädt ständig im Hintergrund nach (Tracking, Preload). `networkidle` führt zu Timeouts.

```typescript
// ✅ RICHTIG:
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

// ❌ FALSCH:
// await page.goto(url, { waitUntil: 'networkidle' });
```

## 5. Login & Session 🔐
*   Cookie-Consent muss aktiv akzeptiert werden.
*   Mehrere Selektoren für Username/Login-Button probieren (`input[type="text"]`, `button:has-text("Log in")`).
*   Enter-Taste als Fallback für den Login-Button nutzen.
*   Session nach jedem erfolgreichen Lauf speichern.
