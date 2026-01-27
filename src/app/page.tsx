'use client';

import { useState, useEffect } from 'react';
import {
  getSets,
  createSet,
  deleteSet,
  addProfileToSet as addToSetDb,
  removeProfileFromSet,
  SetInfo,
  ProfileInfo,
  getAppConfig,
  saveN8nWebhookUrl,
  getRecentChanges,
  getProfileFollowing
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

function SettingsModal({ isOpen, onClose, onSaved }: SettingsModalProps) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<'instagram' | 'automation'>('instagram');
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
              >
                🧪 Testen
              </button>
              <button
                onClick={handleSaveWebhook}
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

// ============ SET DETAIL VIEW ============
interface SetDetailProps {
  set: SetInfo;
  onBack: () => void;
  onRefresh: () => void;
  onShowDetails: (profileId: string, username: string) => void;
}

function SetDetail({ set, onBack, onRefresh, onShowDetails }: SetDetailProps) {
  const [newProfile, setNewProfile] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

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
          <h2 className="text-2xl font-bold">{set.name}</h2>
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
          {set.profiles.map((profile: ProfileInfo) => (
            <div
              key={profile.username}
              className="follower-card group"
            >
              <img
                src={proxyImageUrl(profile.profilePicUrl || '')}
                alt={profile.username}
                className="w-12 h-12 rounded-full object-cover"
              />
              <div className="flex-1 min-w-0 ml-4">
                <div className="flex items-center gap-1.5">
                  <h4 className="font-semibold truncate">{profile.username}</h4>
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
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {profile.followerCount?.toLocaleString() || 0} Follower
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
                </div>
              </div>
              <button
                onClick={() => onShowDetails(profile.id, profile.username)}
                className="p-2 hover:bg-[var(--card-hover)] rounded-lg transition-colors text-[var(--text-muted)] hover:text-[var(--accent)]"
                title="Details & Verlauf anzeigen"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
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
          ))}
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
  profileId: string | null;
  username: string;
}

function ProfileDetailsModal({ isOpen, onClose, profileId, username }: ProfileDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'list' | 'history'>('list');
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

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
        const list = await getProfileFollowing(profileId);
        setFollowingList(list);
      } else {
        const history = await getRecentChanges(100, profileId);
        setHistoryList(history);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass-card w-full max-w-2xl h-[80vh] flex flex-col mx-4 animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
          <h2 className="text-xl font-bold">Details für @{username}</h2>
          <button onClick={onClose} className="p-2 hover:bg-[var(--card-hover)] rounded-full">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-[var(--border)]">
          <button
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-4 text-sm font-medium transition-colors ${activeTab === 'list'
              ? 'border-b-2 border-[var(--accent)] text-[var(--foreground)]'
              : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'
              }`}
          >
            📜 Abonniert ({followingList.length > 0 ? followingList.length : '...'})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-4 text-sm font-medium transition-colors ${activeTab === 'history'
              ? 'border-b-2 border-[var(--accent)] text-[var(--foreground)]'
              : 'text-[var(--text-muted)] hover:text-[var(--foreground)]'
              }`}
          >
            🕒 Verlauf
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="spinner w-8 h-8" />
            </div>
          ) : (
            <>
              {activeTab === 'list' && (
                <div className="space-y-4">
                  {followingList.length === 0 ? (
                    <p className="text-center text-[var(--text-muted)] py-8">Noch keine Daten geladen.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {followingList.map((user) => (
                        <div key={user.username} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--card)] border border-[var(--border)]">
                          <img
                            src={proxyImageUrl(user.profilePicUrl)}
                            alt={user.username}
                            className="w-10 h-10 rounded-full object-cover"
                            onError={(e) => (e.currentTarget.src = "/placeholder-avatar.png")}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <p className="font-medium truncate">{user.username}</p>
                              {user.isVerified && (
                                <span className="text-[var(--accent)] text-[10px]">✓</span>
                              )}
                            </div>
                            <p className="text-xs text-[var(--text-muted)] truncate">{user.fullName}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-4">
                  {historyList.length === 0 ? (
                    <p className="text-center text-[var(--text-muted)] py-8">Keine Änderungen im Verlauf.</p>
                  ) : (
                    historyList.map((change) => (
                      <div key={change.id} className="flex items-center gap-4 p-4 rounded-xl bg-[var(--card)] border border-[var(--border)]">
                        <div className={`p-2 rounded-full ${change.type === 'FOLLOW' ? 'bg-[var(--success)]/20 text-[var(--success)]' : 'bg-[var(--error)]/20 text-[var(--error)]'
                          }`}>
                          {change.type === 'FOLLOW' ? (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm">
                            <span className={change.type === 'FOLLOW' ? 'text-[var(--success)]' : 'text-[var(--error)]'}>
                              {change.type === 'FOLLOW' ? 'Gefolgt:' : 'Entfolgt:'}
                            </span>
                            {' '}
                            <span className="font-semibold">{change.targetUsername}</span>
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
                    ))
                  )}
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
        profileId={selectedProfileId}
        username={selectedProfileUsername}
      />
    </div>
  );
}
