---
ID: 20260208-login-twitter
Date: 2026-02-08
Status: Active
Topic: X/Twitter Login & Posting Process
---

# 🐦 X (Twitter) Login & Posting Protokoll

Dieses Dokument ist die **Single Source of Truth** für den X/Twitter-Automatisierungsprozess.
Es beschreibt exakt, wie der Browser gesteuert werden muss, welche Selektoren verwendet werden und wie auf verschiedene Szenarien reagiert wird.

**WICHTIG:** Wenn sich das Verhalten von X/Twitter ändert (z.B. neue Buttons, andere Texte), MUSS dieses Dokument aktualisiert werden!

---

## 1. Login-Prüfung & Session-Check

1. **Start:** Öffne `https://x.com/home` (Firefox Persistent Profile).
2. **Warnung/Ablauf:**
   - URL enthält: `/flow` oder `/i/flow/login`?
   - Selektor-Check: `[data-testid="loginButton"]` gefunden?
   - **FEHLERSZENARIO:** Screenshot erstellen `twitter-session-expired-*.png`.
   - **Lösung:** Manuell via VNC einloggen (`scripts/auth/twitter-vnc-login.ts`).
3. **Erfolg:** URL ist `https://x.com/home` oder Timeline wird geladen.

## 2. Navigieren zum "Posten" (Compose)

1. **Option 1 (Direkt):**
   - Gehe zu `https://x.com/compose/post`.
   - **Vorteil:** Direkt im Eingabefeld.
   - **Warte:** Auf `[data-testid="tweetTextarea_0"]`.
2. **Option 2 (Home):**
   - Suche Button "Posten", "Tweet", "+".
   - Selektor: `a[href="/compose/tweet"]`, `div[role="button"][aria-label="Post"]`.

## 3. Post erstellen

1. **Text eingeben:**
   - Klicke in `[data-testid="tweetTextarea_0"]`.
   - Tippe Text (Keyboard-Input ist zuverlässiger als `fill()`).
2. **Medien (Optional):**
   - Suche Input: `input[type="file"][accept*="image"]`.
   - Datei hochladen (`setInputFiles`).
   - Warte auf Upload (mind. 5s für Bilder).

## 4. Post absenden

1. **Senden:**
   - **Shortcut:** Drücke `Control+Enter` (Cmd+Enter).
   - **Alternativ:** Suche Button "Posten", "Tweet".
   - Selektor: `div[data-testid="tweetButton"]`.
2. **Verifikation:**
   - Warte auf Verschwinden des Composer-Overlays.
   - Warte auf Toast-Benachrichtigung ("Your post was sent").

---

## 🔧 Fehlerbehandlung & Updates

**Wenn ein Schritt fehlschlägt:**
1. **Screenshot erstellen:** `public/debug/` prüfen.
2. **Analyse:**
   - Hat sich der Text des Buttons geändert? (z.B. "Posten" -> "Veröffentlichen")
   - Hat sich die ID/Klasse geändert?
   - Ist ein Captcha erschienen?
3. **DOKUMENT UPDATE:**
   - Trage die Änderung HIER in dieses Dokument ein.
   - Aktualisiere den Code (`smart-monitor-v4.ts`) entsprechend der neuen Doku.

---
*Letztes Update: 2026-02-08*
