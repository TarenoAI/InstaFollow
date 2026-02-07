-- MonitoringLog Tabelle für Scrape-Berichte
-- Führe dieses SQL in Turso Studio aus

CREATE TABLE IF NOT EXISTS MonitoringLog (
  id TEXT PRIMARY KEY NOT NULL,
  
  -- Profil-Referenz
  profileId TEXT NOT NULL,
  profileUsername TEXT NOT NULL,
  
  -- Status: SUCCESS, PARTIAL, FAILED, NO_CHANGE, SKIPPED
  status TEXT NOT NULL,
  
  -- Scraping-Details
  followingCountLive INTEGER,
  followingCountDb INTEGER,
  scrapedCount INTEGER,
  scrapeQuote REAL,
  
  -- Änderungen
  newFollowsCount INTEGER DEFAULT 0,
  unfollowsCount INTEGER DEFAULT 0,
  newFollows TEXT,  -- JSON Array
  unfollows TEXT,   -- JSON Array
  
  -- Fehler
  errorMessage TEXT,
  
  -- Timing
  durationMs INTEGER,
  createdAt TEXT DEFAULT (datetime('now'))
);

-- Indizes für schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_monitoring_log_profile ON MonitoringLog(profileId);
CREATE INDEX IF NOT EXISTS idx_monitoring_log_date ON MonitoringLog(createdAt);
CREATE INDEX IF NOT EXISTS idx_monitoring_log_status ON MonitoringLog(status);
