# 🏆 Liga Scraper - Dokumentation

Mit diesem Script kannst du automatisch alle Instagram-Accounts von Spielern einer europäischen Fußball-Liga scrapen und als Set zur Überwachung hinzufügen.

---

## 🚀 Schnellstart

```bash
cd ~/insta-follows
npx tsx scrape-liga.ts <LIGA-CODE> <MIN-FOLLOWER>
```

**Beispiel:**
```bash
npx tsx scrape-liga.ts L1 300000
```
→ Scrapt alle **Bundesliga**-Spieler mit mindestens **300.000 Followern**

---

## 📋 Verfügbare Liga-Codes

| Code | Liga | Land |
|------|------|------|
| `L1` | Bundesliga | 🇩🇪 Deutschland |
| `GB1` | Premier League | 🏴󠁧󠁢󠁥󠁮󠁧󠁿 England |
| `ES1` | LaLiga | 🇪🇸 Spanien |
| `IT1` | Serie A | 🇮🇹 Italien |
| `FR1` | Ligue 1 | 🇫🇷 Frankreich |
| `PO1` | Liga Portugal | 🇵🇹 Portugal |
| `TR1` | Süper Lig | 🇹🇷 Türkei |
| `NL1` | Eredivisie | 🇳🇱 Niederlande |
| `BE1` | Jupiler Pro League | 🇧🇪 Belgien |
| `GR1` | Super League 1 | 🇬🇷 Griechenland |
| `DK1` | Superliga | 🇩🇰 Dänemark |
| `A1` | Bundesliga Österreich | 🇦🇹 Österreich |
| `SE1` | Allsvenskan | 🇸🇪 Schweden |
| `NO1` | Eliteserien | 🇳🇴 Norwegen |
| `SC1` | Premiership | 🏴󠁧󠁢󠁳󠁣󠁴󠁿 Schottland |
| `ALL` | **Top 5 Ligen kombiniert** | 🌍 Europa |

---

## 📊 Beispiel-Befehle

### Bundesliga mit 300k+ Followern
```bash
npx tsx scrape-liga.ts L1 300000
```
→ Erstellt Set: **"Bundesliga 300K+"**

### Premier League mit 500k+ Followern
```bash
npx tsx scrape-liga.ts GB1 500000
```
→ Erstellt Set: **"Premier League 500K+"**

### LaLiga mit 1M+ Followern
```bash
npx tsx scrape-liga.ts ES1 1000000
```
→ Erstellt Set: **"LaLiga 1M+"**

### Alle Top-5-Ligen mit 1M+ Followern
```bash
npx tsx scrape-liga.ts ALL 1000000
```
→ Erstellt Set: **"Top Europa 1M+"**

---

## ⏱️ Dauer

| Liga | Geschätzte Dauer |
|------|------------------|
| Eine Liga | 5-15 Minuten |
| TOP 5 Ligen (`ALL`) | 30-60 Minuten |

---

## 📁 Was wird erstellt?

Nach dem Scrape findest du in der **Web-UI**:
- Ein neues Set mit dem Namen `"<Liga> <Follower>+"`
- Alle Spieler mit ihren Instagram-Profilen
- Follower-Zahlen, Profilbilder, Verifizierung-Status

---

## 🔧 Voraussetzungen

1. **Instagram-Session aktiv** (`playwright-session.json` muss existieren)
2. **Turso-Datenbank konfiguriert** (`.env` mit `TURSO_DATABASE_URL` und `TURSO_AUTH_TOKEN`)

---

## 🛠️ Fehlerbehebung

### "Session abgelaufen"
```bash
npx tsx self-healing-agent.ts
```
→ Der Agent meldet sich automatisch neu an.

### "Keine Spieler gefunden"
- Prüfe ob Transfermarkt.de erreichbar ist
- Reduziere das Follower-Limit (z.B. 100000 statt 500000)

---

## 🎯 Workflow für neue Liga hinzufügen

1. **Liga scrapen:**
   ```bash
   npx tsx scrape-liga.ts L1 300000
   ```

2. **UI öffnen** und neues Set überprüfen

3. **Twitter-Account verknüpfen** (in der UI unter Set-Details)

4. **Monitoring aktivieren** → Der Agent überwacht jetzt alle Spieler dieser Liga!

---

## 📝 Beispiel-Output

```
═══════════════════════════════════════════════════════════════
🏆 LIGA INSTAGRAM SCRAPER
═══════════════════════════════════════════════════════════════
📌 Ligen: Bundesliga
📌 Mindest-Follower: 300K
═══════════════════════════════════════════════════════════════

🏟️ === Bundesliga ===

   ⚽ FC Bayern München
      📱 12 Instagram-Accounts gefunden
      ✅ @leroy_sane: 12.5M Follower
      ✅ @jamalmusiala10: 8.2M Follower
      ✅ @harrykane: 6.1M Follower
      ...

   ⚽ Borussia Dortmund
      📱 8 Instagram-Accounts gefunden
      ✅ @marcoreus: 4.2M Follower
      ...

═══════════════════════════════════════════════════════════════
📊 ZUSAMMENFASSUNG
═══════════════════════════════════════════════════════════════
Gefunden: 47 Spieler mit 300K+ Followern

Top 10:
   1. @leroy_sane - 12.5M (Leroy Sané, Bundesliga)
   2. @jamalmusiala10 - 8.2M (Jamal Musiala, Bundesliga)
   3. @harrykane - 6.1M (Harry Kane, Bundesliga)
   ...

🎉 47 Spieler zum Set "Bundesliga 300K+" hinzugefügt!
```
