---
ID: 20260208-process-twitter
Date: 2026-02-08
Status: Active
Topic: X/Twitter Complete Process (Login, Posting)
---

# 🐦 X (Twitter) Prozess-Dokumentation (Single Source of Truth)

Dieses Dokument ist die zentrale Referenz für den X/Twitter-Automatisierungsprozess.

---

## 1. Login-Prüfung

### A. Start
- URL: `https://x.com/home`
- Browser: Firefox Persistent Profile
- Warten: 3 Sekunden

### B. Session-Check
- **Fehlerfall:** Login-Seite oder `i/flow/login` erkannt.
    - Selektor: `[data-testid="loginButton"]`
    - Aktion: Warnung generieren + Screenshot. **Manuell via VNC einloggen** (`scripts/auth/twitter-vnc-login.ts`).
- **Erfolgsfall:** Timeline oder Navigation sichtbar.

---

## 2. Navigieren zum "Posten"

### A. Aufruf
1.  **Direkt-Link:** `https://x.com/compose/post` (bevorzugt).
2.  **Home-Button:**
    - Selektor: `a[href="/compose/tweet"]` oder `div[role="button"][aria-label="Post"]`
    - Oft in der Seitenleiste links oder als "+" Bubble (Mobile).

---

## 3. Post-Erstellung (Schreiben)

### A. Textfeld
1.  **Selektor:** `div[data-testid="tweetTextarea_0"]`
2.  **Aktion:**
    - Klicken (Focus).
    - Text eintippen (Keyboard-Send).

### B. Medien (Bilder)
1.  **Input:** `input[type="file"][accept*="image"]` (versteckt, aber steuerbar).
2.  **Aktion:** `setInputFiles(pfad)`
3.  **Warten:** 5 Sekunden auf Upload-Preview (`[data-testid="attachments"]`).

---

## 4. Post-Absenden (Kritischer Schritt)

### A. Senden (Primary Method)
1.  **Shortcut:** `Control + Enter` (Cmd + Enter auf Mac).
    - Zuverlässiger als Button, da dieser manchmal deaktiviert scheint (obwohl er es nicht ist).

### B. Senden (Secondary Method - Button)
1.  **Suche:** Button "Posten", "Tweet".
    - Selektor: `div[data-testid="tweetButton"]`
    - Position (Desktop): Unten rechts im Dialog / Textfeld.
    - Position (Mobile): Oben rechts.
2.  **Status-Check:**
    - Prüfen ob deaktiviert (`aria-disabled="true"`). Wenn ja -> Textfeld noch leer oder zu lang?

---

## 5. Verifikation

### A. Erfolgs-Meldung
1.  **Toast:** Unten mittig erscheint "Your post was sent" / "Dein Tweet wurde gesendet".
2.  **Weiterleitung:** Zurück zur Timeline oder Profil?

### B. Link extrahieren
1.  **Profil:** Gehe zu `https://x.com/[DEIN_USERNAME]`.
2.  **Suche:** Erster Tweet in der Liste `article`.
    - Selektor: `article a[href*="/status/"]`

---
*Letztes Update: 2026-02-08*
