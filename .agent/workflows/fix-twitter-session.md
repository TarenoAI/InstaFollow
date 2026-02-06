---
description: Fix Twitter/X session for automated posting via VNC login on VPS
---

# Twitter/X Session Fix Workflow

Wenn der Twitter/X Post fehlschlägt (Fehlermeldung "Etwas ist schiefgelaufen"), folge diesen Schritten:

> ⚠️ **WICHTIG:** Twitter blockiert Chromium-Browser beim Login! Nutze immer **Firefox** für Twitter-Logins.

## 1. VNC-Verbindung herstellen

### VNC starten (falls nicht läuft)
```bash
# Auf VPS (ssh root@31.97.32.40)
vncserver :1 -geometry 1280x800 -depth 24
```

### VNC verbinden
- Auf Mac: Finder → Gehe zu → Mit Server verbinden
- URL: `vnc://31.97.32.40:5901`
- Passwort eingeben

## 2. Im VPS-Browser bei Twitter/X einloggen

```bash
# Falls Firefox nicht startet
export DISPLAY=:1
xhost +local:
firefox https://x.com/login &
```

1. Firefox öffnet sich im VNC-Fenster
2. Gehe zu x.com/login
3. Logge dich manuell ein mit **BuliFollows**
4. Warte bis Home-Feed sichtbar ist
5. **Schließe Firefox NICHT!**

## 3. Cookies extrahieren

Im Firefox:
1. F12 drücken (Developer Tools)
2. Storage → Cookies → x.com
3. Kopiere diese Cookies:
   - `auth_token`
   - `ct0`
   - `twid`

## 4. Session-Datei erstellen

```bash
# Auf VPS
mkdir -p ~/InstaFollow/data/sessions
nano ~/InstaFollow/data/sessions/twitter-session.json
```

Füge ein (ersetze die Werte):
```json
{
  "cookies": [
    {
      "name": "auth_token",
      "value": "DEIN_AUTH_TOKEN",
      "domain": ".x.com",
      "path": "/",
      "httpOnly": true,
      "secure": true
    },
    {
      "name": "ct0",
      "value": "DEIN_CT0_TOKEN",
      "domain": ".x.com",
      "path": "/",
      "httpOnly": false,
      "secure": true
    },
    {
      "name": "twid",
      "value": "DEIN_TWID",
      "domain": ".x.com",
      "path": "/",
      "httpOnly": false,
      "secure": true
    }
  ]
}
```

## 5. Twitter Post testen

// turbo
```bash
cd ~/InstaFollow
npx tsx scripts/tests/vps-twitter-test.ts
```

## Alternative: Mit Playwright Session speichern

Wenn du lieber automatisch die Session speichern willst:

```bash
cd ~/InstaFollow
npx tsx -e "
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('https://x.com/login');
console.log('Logge dich ein und drücke dann Enter...');
await new Promise(r => process.stdin.once('data', r));
await context.storageState({ path: 'data/sessions/twitter-session.json' });
await browser.close();
console.log('Session gespeichert!');
"
```

## Wichtige Hinweise

- **VPS IP:** `31.97.32.40`
- **Twitter Account:** BuliFollows
- Session hält ca. 30 Tage bei normalem Betrieb
- Bei "Etwas ist schiefgelaufen" → Session erneuern
