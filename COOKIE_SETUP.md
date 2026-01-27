# 🍪 Instagram Session-Cookie Setup

Diese Anleitung erklärt, wie du deine Instagram-Session-Cookies exportierst, um die App sicher zu nutzen.

## Warum Cookies statt Login?

- **Sicherer**: Kein Login = Instagram erkennt keine verdächtigen Login-Versuche
- **Stabiler**: Cookies halten ca. 90 Tage
- **Weniger Sperren**: Kein "Checkpoint Required" mehr

---

## Schritt 1: Instagram im Browser öffnen

1. Öffne **Chrome** oder **Firefox**
2. Gehe zu [instagram.com](https://www.instagram.com)
3. Logge dich **normal ein** (mit deinem Account, der überwachen soll)
4. Stelle sicher, dass du eingeloggt bleibst

---

## Schritt 2: Cookies exportieren

### Option A: Mit Browser-Erweiterung (Empfohlen)

1. Installiere die Erweiterung **"EditThisCookie"** (Chrome) oder **"Cookie-Editor"** (Firefox)
2. Gehe zu instagram.com
3. Klicke auf das Erweiterungs-Icon
4. Klicke auf **"Export"** (JSON-Format)
5. Kopiere den gesamten JSON-Text

### Option B: Manuell via DevTools

1. Drücke `F12` um die DevTools zu öffnen
2. Gehe zum Tab **"Application"** (Chrome) oder **"Storage"** (Firefox)
3. Links unter **"Cookies"** → **"https://www.instagram.com"**
4. Finde diese wichtigen Cookies:
   - `sessionid`
   - `csrftoken`
   - `ds_user_id`
   - `mid`
5. Notiere die Werte

---

## Schritt 3: In der App eintragen

### Variante 1: Umgebungsvariable (Empfohlen für Vercel)

Füge in deiner `.env` oder in Vercel hinzu:

```env
INSTAGRAM_SESSION_ID=dein_sessionid_wert_hier
INSTAGRAM_CSRF_TOKEN=dein_csrftoken_wert_hier
INSTAGRAM_DS_USER_ID=deine_user_id_hier
```

### Variante 2: Komplettes Cookie-JSON

Alternativ kannst du das gesamte JSON exportieren:

```env
INSTAGRAM_COOKIES='[{"name":"sessionid","value":"xxx",...}]'
```

---

## Schritt 4: Testen

Nach dem Eintragen der Cookies:

1. Starte die App neu: `npm run dev`
2. Versuche ein Profil hinzuzufügen
3. Es sollte **ohne Login-Fehler** funktionieren

---

## ⚠️ Wichtige Hinweise

- **Cookies laufen ab**: Nach ca. 90 Tagen musst du neue exportieren
- **Nicht teilen**: Deine Cookies sind wie dein Passwort!
- **Ein Account pro App**: Nutze nur einen Instagram-Account
- **Aktivität**: Logge dich ab und zu normal im Browser ein, damit die Session aktiv bleibt

---

## 🔄 Cookie erneuern

Wenn die Cookies abgelaufen sind:

1. Logge dich im Browser bei Instagram ein
2. Exportiere die Cookies erneut
3. Aktualisiere die Umgebungsvariablen
4. Starte die App neu

---

## Fehlerbehebung

| Problem | Lösung |
|---------|--------|
| "Session expired" | Neue Cookies exportieren |
| "Checkpoint required" | Im Browser einloggen, Challenge lösen, dann Cookies neu exportieren |
| "Invalid cookies" | Stelle sicher, dass `sessionid` korrekt kopiert wurde |
