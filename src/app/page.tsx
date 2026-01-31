'use client';

import { useState, useEffect } from 'react';
import {
  getSets,
  createSet,
  deleteSet,
  toggleSetActive,
  addProfileToSet as addToSetDb,
  removeProfileFromSet,
  getProfileFollowing,
  getRecentChanges,
  getProfileDetails,
  SetInfo,
  ProfileInfo,
  getAppConfig,
  saveN8nWebhookUrl,
  getTwitterAccounts,
  createTwitterAccount,
  deleteTwitterAccount,
  linkTwitterAccountToSet,
  TwitterAccountInfo,
} from './actions/db';
import {
  hasCredentials,
  saveCredentials,
  fetchFollowing
} from './actions/instagram';
import { checkAppPassword } from './actions/auth';

// Helper function to proxy Instagram images through our API to avoid CORS issues
function proxyImageUrl(url: string): string {
  if (!url) return '';
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

// ============ SETTINGS MODAL ============
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function TwitterSettings({ onError, onSuccess }: { onError: (msg: string) => void, onSuccess: (success: boolean) => void }) {
  const [accounts, setAccounts] = useState<TwitterAccountInfo[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    const accs = await getTwitterAccounts();
    setAccounts(accs);
  }

  async function handleAddAccount() {
    if (!newUsername.trim()) {
      onError('Bitte Username eingeben');
      return;
    }

    setLoading(true);
    onError('');

    // Einfaches "Dummy" Login Simulieren oder direkt speichern
    // Da wir noch keine Twitter Auth haben, speichern wir es direkt
    const res = await createTwitterAccount(newUsername, newDisplayName);

    if (res.success) {
      setNewUsername('');
      setNewDisplayName('');
      onSuccess(true);
      loadAccounts();
      setTimeout(() => onSuccess(false), 2000);
    } else {
      onError(res.error || 'Fehler beim Erstellen');
    }

    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Diesen Account wirklich entfernen?')) return;

    const res = await deleteTwitterAccount(id);
    if (res.success) {
      loadAccounts();
    } else {
      onError(res.error || 'Fehler beim Löschen');
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-[var(--background)] p-4 rounded-xl border border-[var(--border)]">
        <h3 className="font-medium mb-3">Neuen Account verknüpfen</h3>
        <div className="space-y-3">
          <input
            type="text"
            className="input-field"
            placeholder="@Username (z.B. @BundesligaWatch)"
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
          />
          <input
            type="text"
            className="input-field"
            placeholder="Anzeigename (z.B. Bundesliga Watch 🇩🇪)"
            value={newDisplayName}
            onChange={e => setNewDisplayName(e.target.value)}
          />
          <button
            onClick={handleAddAccount}
            disabled={loading}
            className="btn-primary w-full flex justify-center py-2"
          >
            {loading ? <div className="spinner" /> : 'Hinzufügen'}
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-medium mb-3 text-[var(--text-muted)] text-sm uppercase tracking-wider">Verknüpfte Accounts</h3>
        {accounts.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4 bg-[var(--card)] rounded-xl border border-[var(--border)] border-dashed">
            Keine Twitter Clients eingerichtet.
          </p>
        ) : (
          <div className="space-y-2">
            {accounts.map(acc => (
              <div key={acc.id} className="flex items-center justify-between p-3 bg-[var(--card)] rounded-xl border border-[var(--border)] group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zl-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
                    </svg>
                  </div>
                  <div>
                    <div className="font-bold text-sm">@{acc.username}</div>
                    <div className="text-xs text-[var(--text-muted)]">{acc.displayName}</div>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(acc.id)}
                  className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  title="Account entfernen"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsModal({ isOpen, onClose, onSaved }: SettingsModalProps) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<'instagram' | 'automation' | 'twitter'>('instagram');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Load existing webhook URL when modal opens
  useEffect(() => {
    if (isOpen) {
      getAppConfig().then(config => {
        setWebhookUrl(config.n8nWebhookUrl || '');
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveInstagram = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Bitte beide Felder ausfüllen.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess(false);

    const result = await saveCredentials(username.trim(), password);

    if (result.success) {
      setSuccess(true);
      setUsername('');
      setPassword('');
      setTimeout(() => {
        onSaved();
        onClose();
      }, 1000);
    } else {
      setError(result.error || 'Fehler beim Speichern.');
    }

    setSaving(false);
  };

  const handleSaveWebhook = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);

    const result = await saveN8nWebhookUrl(webhookUrl.trim());

    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
      }, 2000);
    } else {
      setError(result.error || 'Fehler beim Speichern.');
    }

    setSaving(false);
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl.trim()) {
      setError('Bitte gib eine Webhook-URL ein.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const response = await fetch(webhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'TEST',
          message: 'Test-Nachricht von InstaFollows',
          timestamp: new Date().toISOString(),
        }),
      });

      if (response.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(`Webhook-Fehler: Status ${response.status}`);
      }
    } catch (err) {
      setError('Webhook konnte nicht erreicht werden.');
    }

    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass-card p-8 w-full max-w-lg mx-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold mb-4">Einstellungen</h2>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 p-1 bg-[var(--card)] rounded-xl">
          <button
            onClick={() => { setActiveSettingsTab('instagram'); setError(''); setSuccess(false); }}
            className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-all ${activeSettingsTab === 'instagram'
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-muted)] hover:text-white'
              }`}
          >
            📸 Instagram
          </button>
          <button
            onClick={() => { setActiveSettingsTab('automation'); setError(''); setSuccess(false); }}
            className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-all ${activeSettingsTab === 'automation'
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-muted)] hover:text-white'
              }`}
          >
            🔄 Automation
          </button>
          <button
            onClick={() => { setActiveSettingsTab('twitter'); setError(''); setSuccess(false); }}
            className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-all ${activeSettingsTab === 'twitter'
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-muted)] hover:text-white'
              }`}
          >
            🐦 X Accounts
          </button>
        </div>

        {/* Instagram Tab */}
        {activeSettingsTab === 'instagram' && (
          <div className="space-y-4">
            <p className="text-[var(--text-muted)] text-sm mb-4">
              Hinterlege deine Instagram-Anmeldedaten, um abonnierte Konten abzurufen.
            </p>
            <div>
              <label className="block text-sm font-medium mb-2">Dein Instagram Benutzername</label>
              <input
                type="text"
                className="input-field"
                placeholder="dein_username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Dein Instagram Passwort</label>
              <input
                type="password"
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                className="flex-1 py-3 px-4 rounded-xl border border-[var(--border)] hover:bg-[var(--card)] transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleSaveInstagram}
                disabled={saving}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="spinner" />
                    Speichern...
                  </>
                ) : (
                  'Speichern'
                )}
              </button>
            </div>

            <p className="text-xs text-[var(--text-muted)]">
              ⚠️ Deine Daten werden lokal in einer Config-Datei gespeichert.
            </p>
          </div>
        )}

        {/* Automation Tab */}
        {activeSettingsTab === 'automation' && (
          <div className="space-y-4">
            <p className="text-[var(--text-muted)] text-sm mb-4">
              Konfiguriere die n8n Webhook-URL für automatische Benachrichtigungen bei Follow-Änderungen.
            </p>
            <div>
              <label className="block text-sm font-medium mb-2">n8n Webhook URL</label>
              <input
                type="url"
                className="input-field"
                placeholder="https://n8n.example.com/webhook/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleTestWebhook}
                disabled={saving}
                className="flex-1 py-3 px-4 rounded-xl border border-[var(--border)] hover:bg-[var(--card)] transition-colors"
                title="Sende Test-Event"
              >
                🧪 Testen
              </button>
              <button
                onClick={handleSaveWebhook}
                disabled={saving}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {saving ? <div className="spinner" /> : 'Speichern'}
              </button>
            </div>

            <div className="mt-4 p-4 bg-[var(--card)] rounded-xl">
              <h4 className="font-medium mb-2">📋 Cron-Job API</h4>
              <p className="text-sm text-[var(--text-muted)] mb-2">
                Rufe diesen Endpoint regelmäßig auf (z.B. alle 30 Min.):
              </p>
              <code className="block p-2 bg-[var(--background)] rounded text-xs break-all">
                GET /api/cron/monitor
              </code>
            </div>
          </div>
        )}

        {/* Twitter Tab */}
        {activeSettingsTab === 'twitter' && (
          <TwitterSettings onError={setError} onSuccess={setSuccess} />
        )}

        {/* Status Messages */}
        {error && (
          <div className="mt-4 p-3 bg-[var(--error)]/20 border border-[var(--error)] rounded-lg text-[var(--error)] text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 p-3 bg-[var(--success)]/20 border border-[var(--success)] rounded-lg text-[var(--success)] text-sm">
            ✅ Erfolgreich gespeichert!
          </div>
        )}
      </div>
    </div>
  );
}

// ============ CREATE SET MODAL ============
interface CreateSetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateSetModal({ isOpen, onClose, onCreated }: CreateSetModalProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleCreate = async () => {
    setSaving(true);
    setError('');

    const result = await createSet(name);

    if (result.success) {
      setName('');
      onCreated();
      onClose();
    } else {
      setError(result.error || 'Fehler beim Erstellen.');
    }

    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass-card p-8 w-full max-w-md mx-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold mb-2">Neues Set erstellen</h2>
        <p className="text-[var(--text-muted)] mb-6">
          Erstelle eine Sammlung von Instagram-Profilen.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Set Name</label>
            <input
              type="text"
              className="input-field"
              placeholder="z.B. Influencer, Konkurrenz, ..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          {error && (
            <div className="p-3 bg-[var(--error)]/20 border border-[var(--error)] rounded-lg text-[var(--error)] text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl border border-[var(--border)] hover:bg-[var(--card)] transition-colors"
            >
              Abbrechen
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || !name.trim()}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <div className="spinner" />
                  Erstellen...
                </>
              ) : (
                'Erstellen'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ SCRAPE MODAL ============
interface ScrapeModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: ProfileInfo | null;
  setId: string;
  onComplete: () => void;
}

function ScrapeModal({ isOpen, onClose, profile, setId, onComplete }: ScrapeModalProps) {
  const [status, setStatus] = useState<'idle' | 'counting' | 'scraping' | 'saving' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [found, setFound] = useState(0);
  const [estimatedSeconds, setEstimatedSeconds] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const SCRAPE_API_URL = process.env.NEXT_PUBLIC_SCRAPE_API_URL || 'http://localhost:3001';

  useEffect(() => {
    if (isOpen && profile && status === 'idle') {
      startScrape();
    }
  }, [isOpen, profile]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (jobId && status !== 'done' && status !== 'error') {
      interval = setInterval(pollStatus, 2000);
    }
    return () => clearInterval(interval);
  }, [jobId, status]);

  const startScrape = async () => {
    if (!profile) return;

    setStatus('counting');
    setProgress(0);
    setErrorMessage('');

    try {
      const res = await fetch(`${SCRAPE_API_URL}/api/scrape/${profile.username}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: profile.id, setId })
      });

      const data = await res.json();

      if (data.success) {
        setJobId(data.jobId);
      } else {
        setStatus('error');
        setErrorMessage(data.error || 'Scrape konnte nicht gestartet werden');
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage('API nicht erreichbar. Ist der Scrape-Server aktiv?');
    }
  };

  const pollStatus = async () => {
    if (!jobId) return;

    try {
      const res = await fetch(`${SCRAPE_API_URL}/api/scrape/${jobId}/status`);
      const data = await res.json();

      if (data.success) {
        setStatus(data.status);
        setProgress(data.progress);
        setTotal(data.total);
        setFound(data.found);
        setEstimatedSeconds(data.estimatedSeconds);
        setElapsedSeconds(data.elapsedSeconds);

        if (data.status === 'done') {
          setTimeout(() => {
            onComplete();
          }, 1500);
        } else if (data.status === 'error') {
          setErrorMessage(data.error || 'Unbekannter Fehler');
        }
      }
    } catch (err) {
      // Ignore polling errors
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusText = () => {
    switch (status) {
      case 'idle': return 'Vorbereiten...';
      case 'counting': return 'Lade Profil...';
      case 'scraping': return `Scrape Following-Liste... (${found}/${total})`;
      case 'saving': return 'Speichere in Datenbank...';
      case 'done': return '✅ Fertig!';
      case 'error': return '❌ Fehler';
      default: return '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={status === 'done' || status === 'error' ? onClose : undefined}>
      <div
        className="glass-card p-8 w-full max-w-md mx-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-500 flex items-center justify-center">
            {status === 'done' ? (
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : status === 'error' ? (
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <div className="spinner w-8 h-8 border-white" />
            )}
          </div>

          <h2 className="text-xl font-bold mb-2">
            {status === 'done' ? 'Scrape abgeschlossen' : status === 'error' ? 'Scrape fehlgeschlagen' : 'Scrape läuft...'}
          </h2>

          <p className="text-[var(--text-muted)] mb-6">@{profile?.username}</p>

          {/* Progress Bar */}
          {status !== 'done' && status !== 'error' && (
            <div className="mb-6">
              <div className="w-full bg-[var(--card)] rounded-full h-3 mb-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--accent)] to-purple-500 transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="text-sm text-[var(--text-muted)]">{getStatusText()}</p>

              {estimatedSeconds > 0 && (
                <div className="flex justify-between text-xs text-[var(--text-muted)] mt-2">
                  <span>Vergangen: {formatTime(elapsedSeconds)}</span>
                  <span>Geschätzt: ~{formatTime(estimatedSeconds)}</span>
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          {(total > 0 || found > 0) && status !== 'error' && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-[var(--card)] rounded-xl">
                <p className="text-2xl font-bold text-[var(--accent)]">{total.toLocaleString()}</p>
                <p className="text-xs text-[var(--text-muted)]">Following</p>
              </div>
              <div className="p-4 bg-[var(--card)] rounded-xl">
                <p className="text-2xl font-bold text-[var(--success)]">{found.toLocaleString()}</p>
                <p className="text-xs text-[var(--text-muted)]">Gescrapt</p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-4 bg-[var(--error)]/20 border border-[var(--error)] rounded-xl mb-6 text-left">
              <p className="text-sm text-[var(--error)]">{errorMessage}</p>
            </div>
          )}

          {/* Actions */}
          {(status === 'done' || status === 'error') && (
            <button
              onClick={onClose}
              className="btn-primary w-full"
            >
              Schließen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ SET DETAIL VIEW ============
interface SetDetailProps {
  set: SetInfo;
  onBack: () => void;
  onRefresh: () => void;
  onShowDetails: (profileId: string, username: string) => void;
}

interface ScrapeJobStatus {
  status: 'starting' | 'counting' | 'scraping' | 'saving' | 'done' | 'error' | 'queued';
  progress: number;
  total: number;
  found: number;
  estimatedSeconds: number;
  elapsedSeconds: number;
  error?: string;
  jobId: string;
  queuePosition?: number;
}

function SetDetail({ set, onBack, onRefresh, onShowDetails }: SetDetailProps) {
  const [newProfile, setNewProfile] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  // Aktive Scrape-Jobs pro Profil (username -> status)
  const [activeJobs, setActiveJobs] = useState<Map<string, ScrapeJobStatus>>(new Map());

  const SCRAPE_API_URL = process.env.NEXT_PUBLIC_SCRAPE_API_URL || 'http://localhost:3001';

  // Polling für aktive Jobs
  useEffect(() => {
    const interval = setInterval(async () => {
      const newJobs = new Map(activeJobs);
      let hasChanges = false;

      for (const [username, job] of activeJobs) {
        if (job.status === 'done' || job.status === 'error') continue;

        try {
          const res = await fetch(`${SCRAPE_API_URL}/api/scrape/${job.jobId}/status`);
          const data = await res.json();

          if (data.success) {
            newJobs.set(username, {
              ...job,
              status: data.status,
              progress: data.progress,
              total: data.total,
              found: data.found,
              estimatedSeconds: data.estimatedSeconds,
              elapsedSeconds: data.elapsedSeconds,
              error: data.error,
              queuePosition: data.queuePosition
            });
            hasChanges = true;

            // Wenn fertig, nach 3 Sekunden entfernen und refreshen
            if (data.status === 'done') {
              setTimeout(() => {
                setActiveJobs(prev => {
                  const updated = new Map(prev);
                  updated.delete(username);
                  return updated;
                });
                onRefresh();
              }, 3000);
            }

            // Bei Fehler nach 5 Sekunden entfernen
            if (data.status === 'error') {
              setTimeout(() => {
                setActiveJobs(prev => {
                  const updated = new Map(prev);
                  updated.delete(username);
                  return updated;
                });
              }, 5000);
            }
          }
        } catch {
          // Ignore polling errors
        }
      }

      if (hasChanges) {
        setActiveJobs(newJobs);
      }
    }, 2000);

    return () => clearInterval(interval);
    return () => clearInterval(interval);
  }, [activeJobs, SCRAPE_API_URL, onRefresh]);

  // Load Twitter accounts for dropdown
  const [twitterAccounts, setTwitterAccounts] = useState<TwitterAccountInfo[]>([]);
  useEffect(() => {
    getTwitterAccounts().then(setTwitterAccounts);
  }, []);

  const handleTwitterAccountChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const accId = e.target.value || null;
    await linkTwitterAccountToSet(set.id, accId);
    onRefresh(); // Reload Set to show updated account
  };

  const startScrape = async (profile: ProfileInfo) => {
    // Prüfe ob bereits ein Job läuft
    if (activeJobs.has(profile.username)) return;

    // Füge zum aktiven Jobs hinzu
    setActiveJobs(prev => {
      const updated = new Map(prev);
      updated.set(profile.username, {
        status: 'starting',
        progress: 0,
        total: 0,
        found: 0,
        estimatedSeconds: 0,
        elapsedSeconds: 0,
        jobId: ''
      });
      return updated;
    });

    try {
      const res = await fetch(`${SCRAPE_API_URL}/api/scrape/${profile.username}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: profile.id, setId: set.id })
      });

      const data = await res.json();

      if (data.success) {
        setActiveJobs(prev => {
          const updated = new Map(prev);
          updated.set(profile.username, {
            ...prev.get(profile.username)!,
            jobId: data.jobId,
            status: 'counting'
          });
          return updated;
        });
      } else {
        setActiveJobs(prev => {
          const updated = new Map(prev);
          updated.set(profile.username, {
            ...prev.get(profile.username)!,
            status: 'error',
            error: data.error || 'Konnte nicht gestartet werden'
          });
          return updated;
        });
      }
    } catch (err: any) {
      setActiveJobs(prev => {
        const updated = new Map(prev);
        updated.set(profile.username, {
          ...prev.get(profile.username)!,
          status: 'error',
          error: 'API nicht erreichbar'
        });
        return updated;
      });
    }
  };

  const handleAddProfile = async () => {
    if (!newProfile.trim()) return;

    setAdding(true);
    setError('');

    const result = await addToSetDb(set.id, newProfile);

    if (result.success) {
      setNewProfile('');
      onRefresh();
    } else {
      setError(result.error || 'Fehler beim Hinzufügen.');
    }

    setAdding(false);
  };

  const handleRemoveProfile = async (username: string) => {
    const result = await removeProfileFromSet(set.id, username);
    if (result.success) {
      onRefresh();
    }
  };

  const handleDeleteSet = async () => {
    if (confirm(`Möchtest du das Set "${set.name}" wirklich löschen?`)) {
      await deleteSet(set.id);
      onBack();
      onRefresh();
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 hover:bg-[var(--card)] rounded-lg transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{set.name}</h2>

            {/* Twitter Account Selector */}
            <div className="relative group/x">
              <select
                value={set.twitterAccount?.id || ''}
                onChange={handleTwitterAccountChange}
                className="appearance-none pl-8 pr-8 py-1 bg-[var(--card)] border border-[var(--border)] rounded-full text-xs font-medium hover:border-[var(--accent)] transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
              >
                <option value="">Kein X-Account</option>
                {twitterAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    @{acc.username}
                  </option>
                ))}
              </select>
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] group-hover/x:text-[#1DA1F2]">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zl-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
              </div>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
            </div>
          </div>
          <p className="text-[var(--text-muted)] text-sm">{set.profiles.length} Profile</p>
        </div>
        <button
          onClick={handleDeleteSet}
          className="p-2 text-[var(--error)] hover:bg-[var(--error)]/20 rounded-lg transition-colors"
          title="Set löschen"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Add Profile Input */}
      <div className="glass-card p-4 mb-6 bg-[var(--card)]/50">
        <p className="text-sm font-medium mb-3">Profil hinzufügen</p>
        <div className="flex gap-2">
          <input
            type="text"
            className="input-field"
            placeholder="@benutzername"
            value={newProfile}
            onChange={(e) => setNewProfile(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddProfile()}
          />
          <button
            onClick={handleAddProfile}
            disabled={adding}
            className="btn-primary whitespace-nowrap px-6"
          >
            {adding ? <div className="spinner w-4 h-4" /> : '+ Hinzufügen'}
          </button>
        </div>
        {error && (
          <p className="text-[var(--error)] text-sm mt-2">{error}</p>
        )}
      </div>

      {/* Profiles List */}
      {set.profiles.length > 0 ? (
        <div className="space-y-2">
          {set.profiles.map((profile: ProfileInfo) => {
            const job = activeJobs.get(profile.username);
            const isActive = !!job;

            return (
              <div
                key={profile.username}
                className="follower-card group relative overflow-hidden"
              >
                {/* Inline Progress Bar (Hintergrund) */}
                {isActive && job.status !== 'done' && job.status !== 'error' && (
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-[var(--accent)]/20 to-purple-500/20 transition-all duration-500"
                    style={{ width: `${job.progress}%` }}
                  />
                )}

                {/* Done overlay */}
                {isActive && job.status === 'done' && (
                  <div className="absolute inset-0 bg-[var(--success)]/10 animate-pulse" />
                )}

                {/* Error overlay */}
                {isActive && job.status === 'error' && (
                  <div className="absolute inset-0 bg-[var(--error)]/10" />
                )}

                <div className="relative flex items-center gap-4 z-10">
                  <img
                    src={proxyImageUrl(profile.profilePicUrl || '')}
                    alt={profile.username}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <a
                        href={`https://www.instagram.com/${profile.username}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold truncate hover:text-[var(--accent)] transition-colors flex items-center gap-1"
                      >
                        {profile.username}
                        <svg className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                      {profile.isVerified && (
                        <span className="text-[var(--accent)] text-xs">
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                            <path fillRule="evenodd" d="M8.603 3.799A4.49 4.49 0 0112 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 013.498 1.307 4.491 4.491 0 011.307 3.497A4.49 4.49 0 0121.75 12a4.49 4.49 0 01-1.549 3.397 4.491 4.491 0 01-1.307 3.497 4.491 4.491 0 01-3.497 1.307A4.49 4.49 0 0112 21.75a4.49 4.49 0 01-3.397-1.549 4.49 4.49 0 01-3.498-1.306 4.491 4.491 0 01-1.307-3.498A4.49 4.49 0 012.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 011.307-3.497 4.49 4.49 0 013.497-1.307zm7.007 6.387a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm text-[var(--text-muted)] truncate">
                        {profile.fullName || profile.username}
                      </p>

                      {/* Scrape Status inline */}
                      {isActive ? (
                        <div className="flex items-center gap-2">
                          {job.status === 'done' ? (
                            <p className="text-xs text-[var(--success)] flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              {job.found.toLocaleString()} Following gescrapt
                            </p>
                          ) : job.status === 'error' ? (
                            <p className="text-xs text-[var(--error)] flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              {job.error || 'Fehler'}
                            </p>
                          ) : (
                            <p className="text-xs text-[var(--accent)] flex items-center gap-2">
                              <div className="spinner w-3 h-3" />
                              <span>
                                {job.status === 'queued' && `In Warteschlange${job.queuePosition ? ` (Position ${job.queuePosition})` : ''}`}
                                {job.status === 'counting' && 'Lade Profil...'}
                                {job.status === 'scraping' && `${job.found}/${job.total} (${Math.round(job.progress)}%)`}
                                {job.status === 'saving' && 'Speichern...'}
                                {job.status === 'starting' && 'Starte...'}
                              </span>
                              {job.estimatedSeconds > 0 && (
                                <span className="text-[var(--text-muted)]">
                                  ~{Math.max(0, job.estimatedSeconds - job.elapsedSeconds)}s
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-[var(--text-muted)] truncate">
                            {profile.followerCount?.toLocaleString() || 0} Follower • {profile.followingCount?.toLocaleString() || 0} Following
                          </p>
                          {profile.lastCheckedAt && (
                            <p className="text-xs text-[var(--success)] flex items-center gap-1 mt-0.5 animate-fade-in">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                              Geprüft: {new Date(profile.lastCheckedAt).toLocaleString('de-DE', {
                                hour: '2-digit',
                                minute: '2-digit',
                                day: '2-digit',
                                month: '2-digit'
                              })}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Scrape Button */}
                  <button
                    onClick={() => startScrape(profile)}
                    disabled={isActive}
                    className={`p-2 rounded-lg transition-colors ${isActive
                      ? 'opacity-50 cursor-not-allowed text-[var(--text-muted)]'
                      : 'hover:bg-[var(--accent)]/20 text-[var(--text-muted)] hover:text-[var(--accent)]'
                      }`}
                    title={isActive ? 'Scrape läuft...' : 'Jetzt scrapen'}
                  >
                    {isActive && job.status !== 'done' && job.status !== 'error' ? (
                      <div className="spinner w-5 h-5" />
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    )}
                  </button>

                  <button
                    onClick={() => onShowDetails(profile.id, profile.username)}
                    className="p-2 hover:bg-[var(--card-hover)] rounded-lg transition-colors text-[var(--text-muted)] hover:text-[var(--accent)]"
                    title="Details & Verlauf anzeigen"
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <a
                    href={`/api/screenshot/latest?username=${encodeURIComponent(profile.username)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 hover:bg-[var(--card-hover)] rounded-lg transition-colors text-[var(--text-muted)] hover:text-green-400"
                    title="Screenshot anzeigen"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </a>
                  <button
                    onClick={() => handleRemoveProfile(profile.username)}
                    className="p-2 hover:bg-[var(--error)]/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    title="Aus Set entfernen"
                  >
                    <svg className="w-5 h-5 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--card)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">Noch keine Profile</h3>
          <p className="text-[var(--text-muted)]">
            Füge Instagram-Profile zu diesem Set hinzu.
          </p>
        </div>
      )}
    </div>
  );
}


// ============ TYPES ============
interface FollowingUser {
  pk: string;
  username: string;
  full_name: string;
  profile_pic_url: string;
  is_private: boolean;
  is_verified: boolean;
}

interface TargetInfo {
  username: string;
  full_name: string;
  profile_pic_url: string;
  following_count: number;
  is_private: boolean;
}

// ============ PROFILE DETAILS MODAL ============
interface ProfileDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  profileId: string | null;
  username: string;
}

function ProfileDetailsModal({ isOpen, onClose, onRefresh, profileId, username }: ProfileDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'list' | 'history' | 'sets' | 'stats'>('list');
  const [timeRange, setTimeRange] = useState<'week' | 'month'>('week');
  const [profile, setProfile] = useState<any>(null);
  const [allSets, setAllSets] = useState<any[]>([]);
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingSets, setUpdatingSets] = useState(false);

  useEffect(() => {
    if (isOpen && profileId) {
      loadData();
    }
  }, [isOpen, profileId, activeTab]);

  const loadData = async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      if (activeTab === 'list') {
        const [prof, list] = await Promise.all([
          getProfileDetails(profileId),
          getProfileFollowing(profileId)
        ]);
        setProfile(prof);
        setFollowingList(list);
      } else if (activeTab === 'sets') {
        const [prof, sets] = await Promise.all([
          getProfileDetails(profileId),
          getSets()
        ]);
        setProfile(prof);
        setAllSets(sets);
      } else {
        const history = await getRecentChanges(100, profileId);
        setHistoryList(history);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleToggleSet = async (setId: string, isCurrentlyIn: boolean) => {
    if (!profileId) return;
    setUpdatingSets(true);
    try {
      if (isCurrentlyIn) {
        await removeProfileFromSet(setId, username);
      } else {
        await addToSetDb(setId, username);
      }
      // Reload profile data to reflect changes
      const updatedProf = await getProfileDetails(profileId);
      setProfile(updatedProf);
      if (onRefresh) onRefresh();
    } catch (e) {
      console.error(e);
    }
    setUpdatingSets(false);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass-card w-full max-w-2xl h-[85vh] flex flex-col mx-4 animate-scale-in overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header Section */}
        <div className="relative p-8 pb-6 border-b border-[var(--border)] bg-gradient-to-br from-[var(--card)] to-[var(--background)]">
          <button
            onClick={onClose}
            className="absolute top-6 right-6 p-2 hover:bg-[var(--card-hover)] rounded-full transition-colors z-10"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-secondary)] rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
              <img
                src={proxyImageUrl(profile?.profilePicUrl)}
                alt={username}
                className="relative w-24 h-24 rounded-full border-4 border-[var(--background)] shadow-xl object-cover"
                onError={(e) => (e.currentTarget.src = "/placeholder-avatar.png")}
              />
            </div>

            <div className="flex-1 text-center sm:text-left pt-2">
              <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[var(--foreground)] to-[var(--text-muted)]">
                  @{username}
                </h2>
                {profile?.isVerified && (
                  <svg className="w-6 h-6 text-blue-500 fill-current" viewBox="0 0 24 24">
                    <path d="M22.5 12.5c0-1.58-.88-2.95-2.18-3.66.54-1.27.3-2.76-.71-3.77s-2.5-1.25-3.77-.71c-.71-1.3-2.08-2.18-3.66-2.18s-2.95.88-3.66 2.18c-1.27-.54-2.76-.3-3.77.71s-1.25 2.5-.71 3.77c-1.3.71-2.18 2.08-2.18 3.66s.88 2.95 2.18 3.66c-.54 1.27-.3 2.76.71 3.77s2.5 1.25 3.77.71c.71 1.3 2.08-2.18 3.66-2.18s2.95-.88 3.66-2.18c1.27.54 2.76.3 3.77-.71s1.25-2.5.71-3.77c1.3-.71 2.18-2.08 2.18-3.66zM10 17l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                  </svg>
                )}
              </div>
              <p className="text-[var(--text-muted)] mb-4">{profile?.fullName || username}</p>

              <div className="flex items-center justify-center sm:justify-start gap-6">
                <div className="text-center sm:text-left">
                  <p className="font-bold text-lg leading-none">{profile?.followerCount?.toLocaleString() || '0'}</p>
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Follower</p>
                </div>
                <div className="text-center sm:text-left">
                  <p className="font-bold text-lg leading-none">{profile?.followingCount?.toLocaleString() || (followingList.length > 0 ? followingList.length : '0')}</p>
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Abonniert</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-8 border-b border-[var(--border)] bg-[var(--card)]/30">
          <button
            onClick={() => setActiveTab('list')}
            className={`relative py-4 px-2 text-sm font-semibold transition-all ${activeTab === 'list'
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'
              }`}
          >
            📜 Abonniert {(profile?.followingCount || followingList.length) > 0 && <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-[var(--accent)]/20">({profile?.followingCount || followingList.length})</span>}
            {activeTab === 'list' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-secondary)] rounded-t-full"></span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`relative py-4 px-2 ml-8 text-sm font-semibold transition-all ${activeTab === 'history'
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'
              }`}
          >
            🕘 Verlauf {historyList.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-[var(--accent)]/20">({historyList.length})</span>}
            {activeTab === 'history' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-secondary)] rounded-t-full"></span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('sets')}
            className={`relative py-4 px-2 ml-8 text-sm font-semibold transition-all ${activeTab === 'sets'
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'
              }`}
          >
            📁 Ordner
            {activeTab === 'sets' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-secondary)] rounded-t-full"></span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`relative py-4 px-2 ml-8 text-sm font-semibold transition-all ${activeTab === 'stats'
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'
              }`}
          >
            📊 Statistik
            {activeTab === 'stats' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-secondary)] rounded-t-full"></span>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-[var(--background)]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 animate-pulse">
              <div className="spinner w-10 h-10 mb-4" />
              <p className="text-[var(--text-muted)] text-sm">Lade Daten...</p>
            </div>
          ) : (
            <>
              {activeTab === 'list' && (
                <div className="space-y-4">
                  {followingList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-[var(--border)] flex items-center justify-center mb-4 opacity-50">
                        <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold mb-1">Keine Following-Daten</h3>
                      <p className="text-[var(--text-muted)] max-w-xs">
                        Scrape das Profil, um die Liste der abonnierten Accounts zu sehen.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {followingList.map((user) => (
                        <div key={user.username} className="group relative flex items-center gap-4 p-4 rounded-2xl bg-[var(--card)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all hover:shadow-lg hover:shadow-[var(--accent)]/5 transition-colors overflow-hidden">
                          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-[var(--accent)]/5 to-transparent blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>

                          <div className="relative">
                            <img
                              src={proxyImageUrl(user.profilePicUrl)}
                              alt={user.username}
                              className="w-12 h-12 rounded-full object-cover ring-2 ring-[var(--border)] group-hover:ring-[var(--accent)]/30 transition-all"
                              onError={(e) => (e.currentTarget.src = "/placeholder-avatar.png")}
                            />
                          </div>

                          <div className="relative min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <p className="font-semibold truncate text-[var(--foreground)]">@{user.username}</p>
                              {user.isVerified && (
                                <svg className="w-3.5 h-3.5 text-blue-500 fill-current" viewBox="0 0 24 24">
                                  <path d="M22.5 12.5c0-1.58-.88-2.95-2.18-3.66.54-1.27.3-2.76-.71-3.77s-2.5-1.25-3.77-.71c-.71-1.3-2.08-2.18-3.66-2.18s-2.95.88-3.66 2.18c-1.27-.54-2.76-.3-3.77.71s-1.25 2.5-.71 3.77c-1.3.71-2.18 2.08-2.18 3.66s.88 2.95 2.18 3.66c-.54 1.27-.3 2.76.71 3.77s2.5 1.25 3.77.71c.71 1.3 2.08 2.18 3.66 2.18s2.95-.88 3.66-2.18c1.27.54 2.76.3 3.77-.71s1.25-2.5.71-3.77c1.3-.71 2.18-2.08 2.18-3.66zM10 17l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                                </svg>
                              )}
                            </div>
                            <p className="text-xs text-[var(--text-muted)] truncate font-medium">{user.fullName}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-4 text-left">
                  {historyList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-[var(--border)] flex items-center justify-center mb-4 opacity-50">
                        <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold mb-1">Keine Historie</h3>
                      <p className="text-[var(--text-muted)] max-w-xs">
                        Sobald Änderungen erkannt werden, erscheinen sie hier im Verlauf.
                      </p>
                    </div>
                  ) : (
                    historyList.map((change) => (
                      <div key={change.id} className="group flex flex-col gap-3 p-5 rounded-2xl bg-[var(--card)] border border-[var(--border)] hover:border-[var(--accent)]/30 hover:shadow-lg transition-all">
                        <div className="flex items-center gap-5">
                          <div className={`relative p-3 rounded-2xl flex items-center justify-center ${change.type === 'FOLLOW'
                            ? 'bg-[var(--success)]/10 text-[var(--success)] ring-1 ring-[var(--success)]/20 shadow-[0_0_15px_-3px_rgba(var(--success-rgb),0.3)]'
                            : 'bg-[var(--error)]/10 text-[var(--error)] ring-1 ring-[var(--error)]/20 shadow-[0_0_15px_-3px_rgba(var(--error-rgb),0.3)]'
                            }`}>
                            {change.type === 'FOLLOW' ? (
                              <svg className="w-5 h-5 font-bold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5 font-bold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-[var(--foreground)]">
                              <span className={change.type === 'FOLLOW' ? 'text-[var(--success)]' : 'text-[var(--error)]'}>
                                {change.type === 'FOLLOW' ? 'Neuer Follow:' : 'Entfolgt:'}
                              </span>
                              {' '}
                              <span className="font-semibold">@{change.targetUsername}</span>
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {new Date(change.detectedAt).toLocaleString('de-DE')}
                            </p>
                          </div>
                          <img
                            src={proxyImageUrl(change.targetPicUrl)}
                            alt={change.targetUsername}
                            className="w-10 h-10 rounded-full object-cover opacity-80"
                            onError={(e) => (e.currentTarget.src = "/placeholder-avatar.png")}
                          />
                        </div>

                        {/* Screenshot Preview */}
                        {change.screenshotUrl && (
                          <div className="mt-2 rounded-xl overflow-hidden border border-[var(--border)] relative group/screenshot">
                            <img
                              src={`/api/screenshot?path=${encodeURIComponent(change.screenshotUrl)}`}
                              alt="Profil Screenshot"
                              className="w-full h-auto object-cover rounded-xl"
                              onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/screenshot:opacity-100 transition-opacity flex items-center justify-center">
                              <a
                                href={`/api/screenshot?path=${encodeURIComponent(change.screenshotUrl)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-lg text-white text-sm font-medium hover:bg-white/30 transition-colors"
                              >
                                📷 Vollbild öffnen
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'sets' && (
                <div className="space-y-6">
                  <div className="bg-[var(--card)] p-6 rounded-2xl border border-[var(--border)]">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Ordner-Verwaltung
                    </h3>
                    <p className="text-sm text-[var(--text-muted)] mb-6">
                      Hier kannst du festlegen, in welchen Sets @{username} angezeigt werden soll. Ein Profil kann in mehreren Ordnern gleichzeitig sein.
                    </p>

                    <div className="space-y-3">
                      {allSets.map((set) => {
                        const isInSet = profile?.sets?.some((s: any) => s.id === set.id);
                        return (
                          <div
                            key={set.id}
                            className={`flex items-center justify-between p-4 rounded-xl border transition-all ${isInSet
                              ? 'bg-[var(--accent)]/5 border-[var(--accent)]/30'
                              : 'bg-[var(--background)] border-[var(--border)] hover:border-[var(--text-muted)]/30'
                              }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isInSet ? 'bg-[var(--accent)] text-white' : 'bg-[var(--border)] text-[var(--text-muted)]'
                                }`}>
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                </svg>
                              </div>
                              <div>
                                <p className="font-semibold">{set.name}</p>
                                <p className="text-xs text-[var(--text-muted)]">
                                  {set.profiles?.length || 0} Profile enthalten
                                </p>
                              </div>
                            </div>

                            <button
                              disabled={updatingSets}
                              onClick={() => handleToggleSet(set.id, isInSet)}
                              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${isInSet
                                ? 'bg-[var(--error)]/10 text-[var(--error)] hover:bg-[var(--error)]/20'
                                : 'bg-[var(--accent)] text-white hover:opacity-90 shadow-lg shadow-[var(--accent)]/20'
                                } disabled:opacity-50`}
                            >
                              {updatingSets ? '...' : (isInSet ? 'Entfernen' : 'Hinzufügen')}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'stats' && (
                <div className="space-y-6">
                  {/* Stats Header & Time Filter */}
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <svg className="w-5 h-5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      Profil-Analyse
                    </h3>
                    <div className="flex gap-1 p-1 bg-[var(--card)] rounded-xl border border-[var(--border)]">
                      <button
                        onClick={() => setTimeRange('week')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${timeRange === 'week' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'}`}
                      >
                        Woche
                      </button>
                      <button
                        onClick={() => setTimeRange('month')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${timeRange === 'month' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'}`}
                      >
                        Monat
                      </button>
                    </div>
                  </div>

                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-[var(--card)] p-5 rounded-2xl border border-[var(--border)] shadow-sm hover:border-[var(--accent)]/30 transition-all">
                      <p className="text-[var(--text-muted)] text-xs font-bold uppercase tracking-wider mb-1">Total Following</p>
                      <p className="text-3xl font-black text-[var(--foreground)]">{profile?.followingCount || 0}</p>
                      <div className="mt-2 flex items-center gap-1 text-[var(--success)] text-xs font-bold">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                        </svg>
                        Aktueller Stand
                      </div>
                    </div>
                    <div className="bg-[var(--card)] p-5 rounded-2xl border border-[var(--border)] shadow-sm hover:border-[var(--success)]/30 transition-all">
                      <p className="text-[var(--text-muted)] text-xs font-bold uppercase tracking-wider mb-1">Neue Follows</p>
                      <p className="text-3xl font-black text-[var(--success)]">+{historyList.filter(h => h.type === 'FOLLOW').length}</p>
                      <p className="mt-2 text-[var(--text-muted)] text-xs font-medium">Im gewählten Zeitraum</p>
                    </div>
                    <div className="bg-[var(--card)] p-5 rounded-2xl border border-[var(--border)] shadow-sm hover:border-[var(--error)]/30 transition-all">
                      <p className="text-[var(--text-muted)] text-xs font-bold uppercase tracking-wider mb-1">Entfolgt</p>
                      <p className="text-3xl font-black text-[var(--error)]">-{historyList.filter(h => h.type === 'UNFOLLOW').length}</p>
                      <p className="mt-2 text-[var(--text-muted)] text-xs font-medium">Im gewählten Zeitraum</p>
                    </div>
                  </div>

                  {/* Modern Line Chart */}
                  <div className="bg-[var(--card)] p-6 rounded-2xl border border-[var(--border)] shadow-sm">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h4 className="font-bold text-sm">Following Entwicklung</h4>
                        <p className="text-[var(--text-muted)] text-[10px]">Basierend auf detektierten Änderungen</p>
                      </div>
                      <div className="flex gap-4 text-[10px] font-bold uppercase overflow-hidden">
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--accent)]"></span> Trend</span>
                      </div>
                    </div>

                    <div className="h-64 relative">
                      {historyList.length < 1 ? (
                        <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] border-2 border-dashed border-[var(--border)] rounded-xl">
                          <svg className="w-10 h-10 mb-2 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                          <p className="text-xs font-bold">Keine Aktivitätsdaten vorhanden</p>
                        </div>
                      ) : (() => {
                        const days = timeRange === 'week' ? 7 : 30;
                        const dataPoints: { date: string, label: string, followers: number }[] = [];
                        let currentRef = profile?.followingCount || 0;

                        // Create data points for the timeline
                        for (let i = 0; i < days; i++) {
                          const date = new Date();
                          date.setDate(date.getDate() - (days - 1 - i));
                          const dateStr = date.toISOString().split('T')[0];

                          // How many changes happened AFTER this date up to now?
                          // We work backwards to estimate the count at this point
                          const changesSinceThen = historyList.filter(h => {
                            const d = typeof h.detectedAt === 'string' ? h.detectedAt : new Date(h.detectedAt).toISOString();
                            return d > dateStr;
                          });

                          const followsSinceThen = changesSinceThen.filter(h => h.type === 'FOLLOW').length;
                          const unfollowsSinceThen = changesSinceThen.filter(h => h.type === 'UNFOLLOW').length;

                          // Estimate: current - (follows since then) + (unfollows since then)
                          const estimatedCount = currentRef - followsSinceThen + unfollowsSinceThen;

                          dataPoints.push({
                            date: dateStr,
                            label: date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }),
                            followers: estimatedCount
                          });
                        }

                        const minFollowers = Math.min(...dataPoints.map(p => p.followers));
                        const maxFollowers = Math.max(...dataPoints.map(p => p.followers));

                        // Ensure at least 10% range for visibility, or minimum of 5 units
                        const actualRange = maxFollowers - minFollowers;
                        const minPaddingPercent = 0.1; // 10% of current value
                        const minPadding = Math.max(5, currentRef * minPaddingPercent);
                        const range = Math.max(actualRange, minPadding);
                        const padding = range * 0.3; // More padding for better visibility

                        const chartMin = Math.max(0, minFollowers - padding);
                        const chartMax = maxFollowers + padding;
                        const chartRange = chartMax - chartMin || 10; // Prevent division by zero

                        const width = 1000;
                        const height = 400;

                        // Calculate points for the line
                        const points = dataPoints.map((p, i) => {
                          const x = (i / (days - 1)) * width;
                          const y = height - ((p.followers - chartMin) / chartRange) * height;
                          return `${x},${y}`;
                        }).join(' ');

                        // Area path (under the line)
                        const areaPath = `0,${height} ${points} ${width},${height} Z`;

                        return (
                          <div className="w-full h-full relative group">
                            <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                                </linearGradient>
                              </defs>

                              {/* Y-Axis Grid Lines */}
                              {[0, 0.25, 0.5, 0.75, 1].map((p, idx) => (
                                <line
                                  key={idx}
                                  x1="0" y1={height * p} x2={width} y2={height * p}
                                  stroke="var(--border)" strokeWidth="1" strokeDasharray="5,5"
                                />
                              ))}

                              {/* Fill Area */}
                              <path d={areaPath} fill="url(#chartGradient)" className="transition-all duration-700 ease-out" />

                              {/* Main Line */}
                              <polyline
                                fill="none"
                                stroke="var(--accent)"
                                strokeWidth="4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                points={points}
                                className="transition-all duration-700 ease-out"
                              />

                              {/* Dots */}
                              {dataPoints.map((p, i) => {
                                const x = (i / (days - 1)) * width;
                                const y = height - ((p.followers - chartMin) / chartRange) * height;
                                return (
                                  <g key={i} className="cursor-pointer group/point">
                                    <circle
                                      cx={x} cy={y} r="6"
                                      fill="var(--background)" stroke="var(--accent)" strokeWidth="3"
                                      className="transition-all group-hover/point:r-8"
                                    />
                                    {/* Tooltip on hover - Simplified */}
                                    <rect x={x - 40} y={y - 45} width="80" height="35" rx="8" fill="var(--card)" className="opacity-0 group-hover/point:opacity-100 transition-opacity border border-[var(--border)] shadow-xl" />
                                    <text x={x} y={y - 23} textAnchor="middle" fill="var(--foreground)" className="opacity-0 group-hover/point:opacity-100 text-[12px] font-black pointer-events-none">{p.followers}</text>
                                  </g>
                                );
                              })}
                            </svg>

                            {/* X-Axis Labels */}
                            <div className="absolute -bottom-8 left-0 right-0 flex justify-between px-1">
                              {dataPoints.filter((_, i) => i % (timeRange === 'week' ? 1 : 5) === 0).map((p, i) => (
                                <span key={i} className="text-[10px] font-bold text-[var(--text-muted)] rotate-[-15deg] origin-top-left whitespace-nowrap">
                                  {p.label}
                                </span>
                              ))}
                            </div>

                            {/* Y-Axis Labels - 5 evenly spaced */}
                            <div className="absolute -left-14 top-0 bottom-0 flex flex-col justify-between py-1">
                              {[0, 0.25, 0.5, 0.75, 1].map((p, idx) => {
                                const value = Math.round(chartMax - (p * chartRange));
                                return (
                                  <span key={idx} className="text-[10px] font-bold text-[var(--text-muted)] text-right w-12">
                                    {value}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Actions & Sharing */}
                  <div className="flex flex-wrap gap-4 pt-4">
                    <button
                      onClick={() => {
                        const text = `📊 Monitoring Report für @${username}\n\n` +
                          `📈 Entwicklung: von ${profile?.followingCount - (historyList.filter(h => h.type === 'FOLLOW').length - historyList.filter(h => h.type === 'UNFOLLOW').length)} auf ${profile?.followingCount} Following\n` +
                          `✅ Neu gefolgt: ${historyList.filter(h => h.type === 'FOLLOW').length}\n` +
                          `❌ Entfolgt: ${historyList.filter(h => h.type === 'UNFOLLOW').length}\n\n` +
                          `#Instagram #Monitoring #Analytics`;
                        navigator.clipboard.writeText(text);
                        alert('Social Media Report kopiert! ✨');
                      }}
                      className="flex-1 min-w-[200px] flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-secondary)] text-white rounded-2xl font-black text-sm shadow-lg shadow-[var(--accent)]/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.84 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" /></svg>
                      Social Media Post kopieren
                    </button>
                    <button
                      onClick={() => {
                        const csv = [
                          ['Datum', 'Typ', 'Benutzername'],
                          ...historyList.map(h => [h.detectedAt, h.type, h.targetUsername])
                        ].map(e => e.join(',')).join('\n');
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.setAttribute('href', url);
                        a.setAttribute('download', `${username}_stats.csv`);
                        a.click();
                      }}
                      className="px-6 py-4 bg-[var(--card)] border border-[var(--border)] rounded-2xl font-bold text-sm text-[var(--foreground)] hover:bg-[var(--background)] transition-all flex items-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      CSV Export
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ MAIN COMPONENT ============
export default function Home() {
  const [activeTab, setActiveTab] = useState<'search' | 'sets'>('search');
  const [targetUsername, setTargetUsername] = useState('');
  const [following, setFollowing] = useState<FollowingUser[]>([]);
  const [targetInfo, setTargetInfo] = useState<TargetInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [credentialsConfigured, setCredentialsConfigured] = useState(false);

  // Sets state
  const [sets, setSets] = useState<SetInfo[]>([]);
  const [showCreateSet, setShowCreateSet] = useState(false);
  const [selectedSet, setSelectedSet] = useState<SetInfo | null>(null);

  // Profile Details State
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedProfileUsername, setSelectedProfileUsername] = useState('');
  const [showProfileDetails, setShowProfileDetails] = useState(false);

  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [appPassInput, setAppPassInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    // Check if already authenticated in this session
    const savedAuth = sessionStorage.getItem('app_authenticated');
    if (savedAuth === 'true') {
      setIsAuthenticated(true);
    }
    setIsAuthLoading(false);

    checkCredentials();
    loadSets();
  }, []);

  const handleLogin = async () => {
    if (!appPassInput.trim()) return;

    const result = await checkAppPassword(appPassInput);
    if (result.success) {
      setIsAuthenticated(true);
      sessionStorage.setItem('app_authenticated', 'true');
    } else {
      setAuthError('Falsches Passwort.');
    }
  };

  const checkCredentials = async () => {
    const configured = await hasCredentials();
    setCredentialsConfigured(configured);
  };

  const loadSets = async () => {
    const loadedSets = await getSets();
    setSets(loadedSets);
    // Update selected set if it exists
    if (selectedSet) {
      const updated = loadedSets.find(s => s.id === selectedSet.id);
      if (updated) {
        setSelectedSet(updated);
      }
    }
  };

  const handleFetch = async (username?: string) => {
    const usernameToFetch = username || targetUsername;
    if (!usernameToFetch.trim()) {
      setError('Bitte gib einen Benutzernamen ein.');
      return;
    }

    // Switch to search tab and set the username
    setActiveTab('search');
    setTargetUsername(usernameToFetch);
    setSelectedSet(null);

    setLoading(true);
    setError('');
    setFollowing([]);
    setTargetInfo(null);

    try {
      // Dynamic import to avoid server-side issues
      const { fetchFollowing } = await import('./actions/instagram');
      const result = await fetchFollowing(usernameToFetch.trim().replace('@', ''));

      if (result.success && result.following) {
        setFollowing(result.following);
        if (result.targetInfo) {
          setTargetInfo(result.targetInfo);
        }
      } else {
        setError(result.error || 'Unbekannter Fehler');
        if (result.targetInfo) {
          setTargetInfo(result.targetInfo);
        }
      }
    } catch (err) {
      setError('Verbindungsfehler. Bitte versuche es erneut.');
      console.error(err);
    }

    setLoading(false);
  };

  if (isAuthLoading) {
    return <div className="min-h-screen flex items-center justify-center">
      <div className="spinner w-12 h-12" />
    </div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--background)]">
        <div className="glass-card p-10 w-full max-w-md animate-scale-in text-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent)] mx-auto mb-6 flex items-center justify-center shadow-lg shadow-[var(--accent)]/20">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2 gradient-text">InstaFollows</h1>
          <p className="text-[var(--text-muted)] mb-8">Geschützter Bereich. Bitte Passwort eingeben.</p>

          <div className="space-y-4">
            <input
              type="password"
              className="input-field text-center text-lg tracking-widest"
              placeholder="••••••••"
              value={appPassInput}
              onChange={(e) => {
                setAppPassInput(e.target.value);
                setAuthError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              autoFocus
            />

            {authError && (
              <p className="text-[var(--error)] text-sm">{authError}</p>
            )}

            <button
              onClick={handleLogin}
              className="btn-primary w-full py-4 text-lg font-semibold"
            >
              Anmelden
            </button>
          </div>

          <p className="mt-8 text-xs text-[var(--text-muted)]">
            Powered by TarenoAI
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 md:p-12">
      {/* Header */}
      <header className="max-w-4xl mx-auto flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent)]" />
          <h1 className="text-2xl font-bold">
            <span className="gradient-text">InstaFollows</span>
          </h1>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--border)] hover:bg-[var(--card)] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Einstellungen
        </button>
      </header>

      {/* Tab Navigation */}
      <div className="max-w-4xl mx-auto mb-8">
        <div className="flex gap-2 p-1 bg-[var(--card)] rounded-xl w-fit">
          <button
            onClick={() => { setActiveTab('search'); setSelectedSet(null); }}
            className={`px-6 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'search'
              ? 'bg-[var(--accent)] text-white shadow-lg'
              : 'text-[var(--text-muted)] hover:text-white'
              }`}
          >
            🔍 Suche
          </button>
          <button
            onClick={() => { setActiveTab('sets'); setSelectedSet(null); }}
            className={`px-6 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'sets'
              ? 'bg-[var(--accent)] text-white shadow-lg'
              : 'text-[var(--text-muted)] hover:text-white'
              }`}
          >
            📁 Sets ({sets.length})
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto">
        {/* Status Banner */}
        {!credentialsConfigured && (
          <div className="glass-card p-4 mb-8 flex items-center gap-3 border-l-4 border-l-[var(--accent-solid)]">
            <svg className="w-6 h-6 text-[var(--accent-solid)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">
              <span className="font-medium">Instagram nicht verbunden.</span>{' '}
              <button onClick={() => setShowSettings(true)} className="underline hover:text-[var(--accent-solid)]">
                Klicke hier
              </button>{' '}
              um deine Anmeldedaten zu hinterlegen.
            </p>
          </div>
        )}

        {/* ============ SEARCH TAB ============ */}
        {activeTab === 'search' && (
          <>
            {/* Search Section */}
            <div className="glass-card p-8 mb-8">
              <h2 className="text-xl font-semibold mb-6">Abonnierte Konten abrufen</h2>

              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <input
                    type="text"
                    className="input-field"
                    placeholder="@benutzername eingeben"
                    value={targetUsername}
                    onChange={(e) => setTargetUsername(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleFetch()}
                    disabled={loading || !credentialsConfigured}
                    className="btn-primary flex items-center gap-2 whitespace-nowrap"
                  >
                    {loading ? (
                      <>
                        <div className="spinner" />
                        Lädt...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        Abrufen
                      </>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="mt-4 p-4 bg-[var(--error)]/20 border border-[var(--error)] rounded-xl text-sm">
                  {error}
                </div>
              )}
            </div>

            {/* Target Profile Info */}
            {targetInfo && (
              <div className="glass-card p-6 mb-8 flex items-center gap-4 animate-fade-in">
                <img
                  src={proxyImageUrl(targetInfo.profile_pic_url)}
                  alt={targetInfo.username}
                  className="w-16 h-16 rounded-full object-cover"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">@{targetInfo.username}</h3>
                    {targetInfo.is_private && (
                      <span className="px-2 py-0.5 text-xs bg-[var(--card)] border border-[var(--border)] rounded-full">
                        🔒 Privat
                      </span>
                    )}
                  </div>
                  <p className="text-[var(--text-muted)]">{targetInfo.full_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold gradient-text">
                    {targetInfo.following_count.toLocaleString('de-DE')}
                  </p>
                  <p className="text-sm text-[var(--text-muted)]">Folgt</p>
                </div>
              </div>
            )}

            {/* Following List */}
            {following.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  Zeige {following.length} von {targetInfo?.following_count.toLocaleString('de-DE')} abonnierten Konten
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {following.map((user, index) => (
                    <div
                      key={user.pk}
                      className="follower-card animate-fade-in"
                      style={{ animationDelay: `${index * 30}ms` }}
                    >
                      <img
                        src={proxyImageUrl(user.profile_pic_url)}
                        alt={user.username}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="font-medium truncate">@{user.username}</p>
                          {user.is_verified && (
                            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          {user.is_private && (
                            <span className="text-xs text-[var(--text-muted)]">🔒</span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--text-muted)] truncate">{user.full_name || '-'}</p>
                      </div>
                      <a
                        href={`https://instagram.com/${user.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 hover:bg-[var(--card-hover)] rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {!loading && following.length === 0 && !error && (
              <div className="glass-card p-12 text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[var(--card)] flex items-center justify-center">
                  <svg className="w-10 h-10 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold mb-2">Keine abonnierten Konten angezeigt</h3>
                <p className="text-[var(--text-muted)]">
                  Gib einen öffentlichen Instagram-Benutzernamen ein, um zu sehen, wem dieser folgt.
                </p>
              </div>
            )}
          </>
        )}

        {/* ============ SETS TAB ============ */}
        {activeTab === 'sets' && (
          <>
            {selectedSet ? (
              <SetDetail
                set={selectedSet}
                onBack={() => setSelectedSet(null)}
                onRefresh={loadSets}
                onShowDetails={(id, username) => {
                  setSelectedProfileId(id);
                  setSelectedProfileUsername(username);
                  setShowProfileDetails(true);
                }}
              />
            ) : (
              <>
                {/* Create Set Button */}
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-semibold">Deine Sets</h2>
                  <button
                    onClick={() => setShowCreateSet(true)}
                    className="btn-primary flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Neues Set
                  </button>
                </div>

                {/* Sets List */}
                {sets.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {sets.map((set) => (
                      <button
                        key={set.id}
                        onClick={() => setSelectedSet(set)}
                        className="glass-card p-6 text-left hover:border-[var(--accent-solid)] transition-all group"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="w-12 h-12 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white text-xl font-bold">
                            {set.name.charAt(0).toUpperCase()}
                          </div>
                          <svg className="w-5 h-5 text-[var(--text-muted)] group-hover:text-[var(--accent-solid)] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-semibold mb-1">{set.name}</h3>
                        <p className="text-[var(--text-muted)] text-sm">
                          {set.profiles.length} {set.profiles.length === 1 ? 'Profil' : 'Profile'}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="glass-card p-12 text-center">
                    <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[var(--card)] flex items-center justify-center">
                      <svg className="w-10 h-10 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-semibold mb-2">Keine Sets vorhanden</h3>
                    <p className="text-[var(--text-muted)] mb-6">
                      Erstelle dein erstes Set, um Instagram-Profile zu sammeln.
                    </p>
                    <button
                      onClick={() => setShowCreateSet(true)}
                      className="btn-primary"
                    >
                      Erstes Set erstellen
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* Modals */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={checkCredentials}
      />
      <CreateSetModal
        isOpen={showCreateSet}
        onClose={() => setShowCreateSet(false)}
        onCreated={loadSets}
      />
      <ProfileDetailsModal
        isOpen={showProfileDetails}
        onClose={() => setShowProfileDetails(false)}
        onRefresh={loadSets}
        profileId={selectedProfileId}
        username={selectedProfileUsername}
      />
    </div>
  );
}
