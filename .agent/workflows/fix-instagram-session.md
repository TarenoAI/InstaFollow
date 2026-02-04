---
description: Fix Instagram session issues via VNC login on VPS
---

# Instagram Session Fix Workflow

Wenn der Instagram-Monitor fehlschlägt (leere Seiten, Login-Seite, Session abgelaufen), folge diesen Schritten:

## 1. Problem diagnostizieren

```bash
# Auf VPS
cd ~/insta-follows
npx tsx scripts/tests/vps-quick-test.ts
```

Wenn Body length < 200 oder Screenshots leer/Login-Seite zeigen → Session ist abgelaufen.

## 2. VNC-Verbindung herstellen

### VNC starten (falls nicht läuft)
```bash
# Auf VPS
vncserver :1 -geometry 1280x800 -depth 24
```

### VNC verbinden
- Auf Mac: Finder → Gehe zu → Mit Server verbinden
- URL: `vnc://VPS-IP:5901`
- Passwort eingeben

## 3. Im VPS-Browser bei Instagram einloggen

// turbo
```bash
# Falls Firefox nicht startet
export DISPLAY=:1
xhost +local:
firefox &
```

1. Firefox öffnet sich im VNC-Fenster
2. Gehe zu instagram.com
3. Logge dich manuell ein
4. Warte bis Feed sichtbar ist

## 4. Cookies extrahieren

Im Firefox:
1. F12 drücken (Developer Tools)
2. Storage → Cookies → instagram.com
3. Kopiere: `sessionid`, `csrftoken`, `ds_user_id`

## 5. Cookies auf VPS speichern

```bash
nano ~/insta-follows/.env

# Aktualisiere diese Werte:
INSTAGRAM_SESSION_ID=<sessionid>
INSTAGRAM_CSRF_TOKEN=<csrftoken>
INSTAGRAM_DS_USER_ID=<ds_user_id>
```

## 6. Session konvertieren und testen

// turbo
```bash
cd ~/insta-follows
npx tsx scripts/auth/env-to-session.ts
npx tsx scripts/tests/vps-quick-test.ts
```

Wenn Body length > 200 → Session funktioniert!

## 7. Monitor starten

// turbo
```bash
git pull origin main
npx tsx scripts/monitors/smart-monitor-v4.ts
```

## Wichtige Hinweise

- **IMMER** vom VPS aus einloggen, nicht vom Mac
- **NIE** gleichzeitig von Mac und VPS eingeloggt sein
- Session hält ca. 2-4 Wochen bei normalem Betrieb
- Längere Pausen zwischen Profilen (8-15 Sekunden) verhindern Detection
