# 🐦 Twitter/X Automatisierung - Vollständige Dokumentation

> **Stand:** 06.02.2026  
> **Status:** ✅ Funktioniert vollautomatisch ohne VNC

---

## 📋 Übersicht

Dieses System postet automatisch auf Twitter/X wenn Instagram-Änderungen erkannt werden.  
Es nutzt **Playwright** (Browser-Automation) statt der offiziellen Twitter API.

### Warum Playwright statt API?
- ❌ Twitter API: Teuer, eingeschränkt, komplizierte Genehmigung
- ✅ Playwright: Kostenlos, uneingeschränkt, simuliert echten User

---

## 🏗️ Architektur

```
Instagram Monitor  →  Erkennt Änderung  →  Twitter Browser  →  Post erstellt
     (headless)                              (headless: false + xvfb)
```

### Dateien

| Datei | Beschreibung |
|-------|-------------|
| `scripts/monitors/smart-monitor-v4.ts` | Hauptmonitor mit Twitter-Integration |
| `scripts/tests/vps-twitter-test.ts` | Test-Script für Twitter-Posting |
| `scripts/auth/twitter-session-manager.ts` | Session-Management mit Browser-Fallback |
| `scripts/auth/fix-twitter-vnc.ts` | VNC-basierter Session-Fix |
| `scripts/setup/setup-xvfb.sh` | xvfb Setup für automatisierung |
| `data/sessions/twitter-session.json` | Gespeicherte Twitter-Session |

---

## 🔧 Technische Details

### Das Problem: headless vs. non-headless

Twitter erkennt **headless Browser** und zeigt Dialoge wie "Create Passcode", die das Posten blockieren.

**Lösung:** `headless: false` verwenden, aber mit **xvfb** (virtuelles Display) damit kein echtes Display nötig ist.

### Browser-Konfiguration (funktioniert!)

```typescript
const browser = await chromium.launch({
    headless: false,  // WICHTIG: false um Twitter-Dialoge zu vermeiden
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',  // Anti-Detection
        '--disable-infobars',
        '--window-size=1280,800'
    ]
});
```

### Session-Cookies

Die Session wird in `data/sessions/twitter-session.json` gespeichert und enthält:
- `auth_token` - Hauptauthentifizierung
- `ct0` - CSRF Token
- `twid` - Twitter User ID

**Session-Gültigkeit:** ~30 Tage bei normalem Betrieb

---

## 🖥️ VPS Setup

### 1. xvfb installieren (einmalig)

```bash
cd ~/InstaFollow
chmod +x scripts/setup/setup-xvfb.sh
sudo bash scripts/setup/setup-xvfb.sh
```

Das Script:
- Installiert xvfb
- Startet virtuelles Display auf `:99`
- Erstellt systemd Service für Auto-Start

### 2. Session erstellen/erneuern (bei Problemen)

**Option A: Via xvfb (empfohlen)**
```bash
export DISPLAY=:99
npx tsx scripts/auth/fix-twitter-vnc.ts
```

**Option B: Via VNC (falls nötig)**
1. VNC verbinden: `vnc://31.97.32.40:5901`
2. Script ausführen:
   ```bash
   npx tsx scripts/auth/fix-twitter-vnc.ts
   ```
3. Im Browser einloggen
4. Enter drücken zum Speichern

---

## 🚀 Verwendung

### Twitter-Post Test

```bash
export DISPLAY=:99
npx tsx scripts/tests/vps-twitter-test.ts
```

### Vollständiger Monitor mit Twitter-Integration

```bash
export DISPLAY=:99
npx tsx scripts/monitors/smart-monitor-v4.ts
```

### Einzelnes Profil überwachen

```bash
export DISPLAY=:99
npx tsx scripts/monitors/smart-monitor-v4.ts morewatchez
```

---

## 🔄 Automatisierung (Cron)

### Crontab einrichten

```bash
crontab -e
```

Hinzufügen:
```cron
# Alle 30 Minuten Monitor ausführen
*/30 * * * * cd /root/InstaFollow && export DISPLAY=:99 && npx tsx scripts/monitors/smart-monitor-v4.ts >> /var/log/instafollow.log 2>&1
```

---

## 🐛 Troubleshooting

### Problem: "Post-Button ist deaktiviert"

**Ursache:** "Create Passcode" Dialog blockiert  
**Lösung:** 
1. Prüfe ob xvfb läuft: `pgrep Xvfb`
2. Falls nicht: `sudo systemctl start xvfb`
3. Erneuere Session: `npx tsx scripts/auth/fix-twitter-vnc.ts`

### Problem: "Session ungültig"

**Ursache:** Cookies abgelaufen  
**Lösung:**
```bash
export DISPLAY=:99
npx tsx scripts/auth/fix-twitter-vnc.ts
# Im Browser einloggen, Enter drücken
```

### Problem: "Cannot open display"

**Ursache:** xvfb läuft nicht  
**Lösung:**
```bash
sudo systemctl start xvfb
# oder
export DISPLAY=:99 && Xvfb :99 -screen 0 1280x800x24 &
```

### Problem: Browser startet nicht

**Ursache:** Fehlende Dependencies  
**Lösung:**
```bash
npx playwright install-deps chromium
```

---

## 📊 Erfolgserkennung

Das Script prüft den Post-Erfolg so:

1. **Primär:** Ist das Compose-Fenster geschlossen? → Post erfolgreich
2. **Fallback:** Suche nach Post-Text im Profil-Feed

```typescript
const composeGone = !(await page.$('[data-testid="tweetTextarea_0"]'));
if (composeGone) {
    // POST ERFOLGREICH!
}
```

---

## 🔐 Umgebungsvariablen

In `.env`:
```env
TWITTER_USERNAME=BuliFollows
TWITTER_PASSWORD=dein_passwort
```

---

## 📝 Wichtige Hinweise

1. **headless: false ist PFLICHT** - Twitter blockiert headless Browser
2. **xvfb muss laufen** - Für Server ohne Display
3. **Session ~30 Tage gültig** - Danach manuell erneuern
4. **Anti-Detection Args** - Wichtig um Bot-Erkennung zu umgehen
5. **Separater Browser für Twitter** - Monitor nutzt headless für Instagram, separaten non-headless für Twitter

---

## 🎯 Monetarisierung

Für X Content Monetization siehe:
- https://help.x.com/en/rules-and-policies/content-monetization-standards

Anforderungen:
- 500+ Follower
- 3 Monate aktiv
- Keine Verstöße
-Ads Revenue Sharing aktivieren

---

*Letzte Aktualisierung: 06.02.2026, 22:41*
