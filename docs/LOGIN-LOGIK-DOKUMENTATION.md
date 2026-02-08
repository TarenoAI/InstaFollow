---
ID: 20260208-login-logik-doku
Date: 2026-02-08
Status: Completed
Topic: Instagram & X Login-Logik Dokumentation
---

# 🔐 Login-Logik Dokumentation: Instagram & X (Twitter)

Diese Dokumentation beschreibt die automatische Login-Logik für das Smart Monitoring System.
Bei Problemen können die **Keywords** genutzt werden um den Fehler zu identifizieren.

---

## 📱 Instagram Login-Logik

### Flow-Übersicht

```
┌─────────────────────────────────────────────────────────┐
│  1. Navigiere zu /accounts/login/                       │
│  2. Warte 5 Sekunden                                    │
│  3. Dismiss Popups (Cookies, etc.)                      │
├─────────────────────────────────────────────────────────┤
│  FALL 1: Gespeichertes Konto ("Weiter" Button)          │
│  ├── Klicke auf "Weiter" / "Continue" / "Log in as"     │
│  ├── Warte 3 Sekunden                                   │
│  └── FALL 1b: Passwort-Abfrage erkannt?                 │
│      ├── JA: Passwort eingeben + "Anmelden" klicken     │
│      └── NEIN: Prüfe ob Login erfolgreich               │
├─────────────────────────────────────────────────────────┤
│  FALL 2: Standard Login-Felder                          │
│  ├── Warte auf input[name="username"]                   │
│  ├── Username eingeben                                  │
│  ├── Passwort eingeben                                  │
│  ├── Login-Button klicken                               │
│  └── Warte auf Navigation                               │
├─────────────────────────────────────────────────────────┤
│  FALL 3: Sicherheits-Check (Checkpoint/Challenge)       │
│  └── Manueller Eingriff via VNC erforderlich!           │
└─────────────────────────────────────────────────────────┘
```

### Keywords & Bedeutung

| Keyword/Log | Bedeutung | Aktion |
|-------------|-----------|--------|
| `🏁 Starte Auto-Login Prozess...` | Login wird gestartet | - |
| `🖱️ Klicke "Weiter" Button` | Gespeicherter Account erkannt | Normal |
| `🔐 Passwort-Abfrage erkannt` | Instagram will Passwort-Bestätigung | INSTAGRAM_PASSWORD muss in .env sein |
| `🖱️ Klicke Anmelden-Button` | Passwort wird abgeschickt | - |
| `✅ Login via gespeichertes Konto + Passwort erfolgreich!` | Erfolg mit Passwort | ✅ OK |
| `✅ Login via gespeichertes Konto erfolgreich!` | Erfolg ohne Passwort | ✅ OK |
| `✅ Login erfolgreich!` | Standard-Login erfolgreich | ✅ OK |
| `⚠️ Login-Feld nicht erschienen (Timeout)` | Weder Weiter-Button noch Login-Felder gefunden | UI hat sich geändert! |
| `⚠️ INSTAGRAM_PASSWORD nicht in .env gesetzt!` | Passwort fehlt | .env prüfen! |
| `❌ Login fehlgeschlagen. Seite: "..." | Body: "..."` | Login nicht möglich | Screenshot prüfen |
| `🚨 SICHERHEITS-CHECK ERFORDERLICH!` | Instagram verlangt Verifizierung | Via VNC manuell einloggen! |

### Gespeicherter Account UI-Varianten

Instagram zeigt verschiedene UIs für gespeicherte Accounts:

**Variante A: Nur "Weiter" Button (One-Click Login)**
```
[Profilbild]
aidragontech
[Weiter]  <-- Blaue Button
Anderes Profil verwenden
```
→ Klick auf "Weiter" reicht

**Variante B: "Weiter" + Passwort**
```
[Profilbild]
aidragontech
[Passwort-Feld]
[Anmelden]
Passwort vergessen?
```
→ Benötigt INSTAGRAM_PASSWORD

**Variante C: Normaler Login**
```
[Username-Feld]
[Passwort-Feld]
[Anmelden]
```
→ Benötigt INSTAGRAM_USERNAME + INSTAGRAM_PASSWORD

### Selektoren für "Weiter" Button

```typescript
const continueBtnSelectors = [
    // Deutsche Varianten
    'button:has-text("Weiter")',
    'div[role="button"]:has-text("Weiter")',
    'span:has-text("Weiter")',
    '[role="button"]:has-text("Weiter")',
    // Englische Varianten
    'button:has-text("Continue")',
    'div[role="button"]:has-text("Continue")',
    'button:has-text("Log in as")',
    'div[role="button"]:has-text("Log in as")',
];
```

### Selektoren für "Anmelden" Button

```typescript
const loginBtnSelectors = [
    'button[type="submit"]',
    'button:has-text("Anmelden")',
    'button:has-text("Log In")',
    'div[role="button"]:has-text("Anmelden")',
    'div[role="button"]:has-text("Log In")',
];
```

### Popup-Selektoren (dismissPopups)

```typescript
const popupSelectors = [
    // Cookie consent
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Allow all cookies")',
    // Not Now buttons
    'button:has-text("Jetzt nicht")',
    'button:has-text("Not Now")',
    // Save login info
    'button:has-text("Informationen nicht speichern")',
    // Notifications
    'button:has-text("Nicht aktivieren")',
    // Close buttons
    '[aria-label="Schließen"]',
    '[aria-label="Close"]',
    // Rate limit popup
    'button:has-text("OK")',
];
```

### Umgebungsvariablen

| Variable | Beschreibung | Erforderlich |
|----------|--------------|--------------|
| `INSTAGRAM_USERNAME` | Instagram Username | Ja |
| `INSTAGRAM_PASSWORD` | Instagram Passwort | Ja (für Passwort-Abfrage) |
| `INSTAGRAM_SESSION_ID` | Optional: Session Cookie | Nein |

---

## 🐦 X (Twitter) Login-Logik

### Flow-Übersicht

```
┌─────────────────────────────────────────────────────────┐
│  1. Starte Firefox mit persistentem Profil              │
│     data/browser-profiles/twitter-firefox               │
│  2. Navigiere zu https://x.com/home                     │
│  3. Warte 3 Sekunden                                    │
├─────────────────────────────────────────────────────────┤
│  Prüfe: URL enthält "login" oder "flow"?                │
│  ├── JA: Session abgelaufen!                            │
│  │   └── Manuell via VNC einloggen                      │
│  └── NEIN: Session aktiv, poste Tweet                   │
├─────────────────────────────────────────────────────────┤
│  Tweet posten:                                          │
│  1. Navigiere zu /compose/post                          │
│  2. Warte auf Textarea                                  │
│  3. Text eingeben                                       │
│  4. Optional: Bild hochladen                            │
│  5. Ctrl+Enter zum Absenden                             │
│  6. Tweet-URL extrahieren                               │
└─────────────────────────────────────────────────────────┘
```

### Keywords & Bedeutung

| Keyword/Log | Bedeutung | Aktion |
|-------------|-----------|--------|
| `🐦 Poste auf Twitter (via Firefox Persistent Profile)...` | Twitter-Post wird gestartet | - |
| `✅ Twitter eingeloggt` | Session aktiv | ✅ OK |
| `❌ Twitter Session abgelaufen oder nicht eingeloggt!` | Session weg | Via VNC neu einloggen! |
| `📂 Lade Bild hoch...` | Bild wird hochgeladen | - |
| `📤 Sende Tweet (Shortcut)...` | Ctrl+Enter wird gedrückt | - |
| `🔍 Suche Tweet-URL...` | Tweet wurde gepostet, URL wird gesucht | - |
| `✅ Tweet gepostet!` | Erfolg | ✅ OK |
| `⚠️ Konnte Tweet-URL nicht direkt finden` | Tweet gepostet, aber URL nicht gefunden | OK, Tweet existiert |
| `❌ Twitter Fehler: ...` | Kritischer Fehler | Screenshot prüfen |

### Wichtige Selektoren

```typescript
// Tweet-Textarea
'[data-testid="tweetTextarea_0"]'

// File Input für Bilder
'input[type="file"]'

// Tweet-Link auf Profil
'article a[href*="/status/"]'
```

### Browser-Profil

Twitter verwendet ein **persistentes Firefox-Profil**:
```
data/browser-profiles/twitter-firefox/
```

Dieses Profil speichert:
- Cookies
- LocalStorage
- Session-Daten

### Manueller Login via VNC

Wenn Twitter-Session abgelaufen:

```bash
# Auf VPS:
DISPLAY=:1 npx tsx scripts/auth/twitter-vnc-login.ts
```

Alternativ manuell im VNC-Browser:
1. Öffne x.com
2. Logge dich ein
3. Schließe Browser
4. Profil ist gespeichert

### Umgebungsvariablen

| Variable | Beschreibung | Erforderlich |
|----------|--------------|--------------|
| `TWITTER_USERNAME` | X/Twitter Username | Ja |
| `TWITTER_PASSWORD` | X/Twitter Passwort | Nur für manuellen Login |

---

## 🔧 Troubleshooting

### Instagram: Login schlägt fehl

1. **Screenshot prüfen**: `public/debug/login-failed-*.png`
2. **Häufige Ursachen**:
   - UI geändert → Selektoren updaten
   - Rate-Limit → 24h warten
   - Checkpoint → Via VNC einloggen
   - Passwort falsch → .env prüfen

### Twitter: Session abgelaufen

1. **Screenshot prüfen**: `public/debug/twitter-session-expired.png`
2. **Lösung**:
   ```bash
   DISPLAY=:1 npx tsx scripts/auth/twitter-vnc-login.ts
   ```
   Oder manuell im VNC-Browser einloggen

### Allgemein: Debug-Screenshots

Alle Debug-Screenshots werden automatisch zu Git gepusht:
```
public/debug/login-failed-*.png
public/debug/login-error-*.png
public/debug/twitter-session-expired.png
```

Nach jedem Fehler sind sie unter:
```
https://github.com/TarenoAI/InstaFollow/tree/main/public/debug/
```

---

## 📋 Checkliste bei Problemen

- [ ] .env Variablen korrekt?
- [ ] Debug-Screenshot vorhanden?
- [ ] Git gepullt (neueste Version)?
- [ ] VNC erreichbar für manuellen Login?
- [ ] Browser-Profile nicht korrupt?

---

*Erstellt: 2026-02-08*
*Letzte Aktualisierung: 2026-02-08*
