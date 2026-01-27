'use server';

import { IgApiClient } from 'instagram-private-api';
import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

interface Credentials {
  username: string;
  password: string;
}

interface FollowingUser {
  pk: string;
  username: string;
  full_name: string;
  profile_pic_url: string;
  is_private: boolean;
  is_verified: boolean;
}

interface FetchResult {
  success: boolean;
  following?: FollowingUser[];
  error?: string;
  targetInfo?: {
    username: string;
    full_name: string;
    profile_pic_url: string;
    following_count: number;
    is_private: boolean;
  };
}

// Load credentials from environment variables (for Vercel) or local fallback
async function loadCredentials(): Promise<Credentials | null> {
  // Priority 1: Environment Variables (Vercel)
  if (process.env.INSTAGRAM_USERNAME && process.env.INSTAGRAM_PASSWORD) {
    return {
      username: process.env.INSTAGRAM_USERNAME,
      password: process.env.INSTAGRAM_PASSWORD
    };
  }

  // Priority 2: Local config.json (Local dev)
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Save credentials to config file
export async function saveCredentials(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  // If we are on Vercel, we can't write to the file system
  if (process.env.VERCEL) {
    return {
      success: false,
      error: 'Auf Vercel können Anmeldedaten nicht über die UI gespeichert werden. Bitte nutze Environment Variables (INSTAGRAM_USERNAME & INSTAGRAM_PASSWORD).'
    };
  }

  try {
    await fs.writeFile(CONFIG_PATH, JSON.stringify({ username, password }), 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Check if credentials are configured
export async function hasCredentials(): Promise<boolean> {
  const creds = await loadCredentials();
  return creds !== null && !!creds.username && !!creds.password;
}

// Fetch following list for a target username
export async function fetchFollowing(targetUsername: string, maxCount: number = 50): Promise<FetchResult> {
  try {
    const credentials = await loadCredentials();

    if (!credentials || !credentials.username || !credentials.password) {
      return { success: false, error: 'Bitte zuerst Instagram-Anmeldedaten in den Einstellungen hinterlegen.' };
    }

    const ig = new IgApiClient();
    ig.state.generateDevice(credentials.username);

    // Login
    try {
      await ig.account.login(credentials.username, credentials.password);
    } catch (loginError: unknown) {
      const errorMessage = loginError instanceof Error ? loginError.message : String(loginError);
      if (errorMessage.includes('challenge_required')) {
        return { success: false, error: 'Instagram erfordert eine Verifizierung. Bitte melde dich zuerst in der Instagram-App an.' };
      }
      if (errorMessage.includes('bad_password')) {
        return { success: false, error: 'Falsches Passwort. Bitte überprüfe deine Anmeldedaten.' };
      }
      if (errorMessage.includes('invalid_user')) {
        return { success: false, error: 'Benutzername nicht gefunden. Bitte überprüfe deine Anmeldedaten.' };
      }
      return { success: false, error: `Login fehlgeschlagen: ${errorMessage}` };
    }

    // Search for target user
    let targetUserId: string;
    let targetInfo: FetchResult['targetInfo'];

    try {
      const searchResults = await ig.user.searchExact(targetUsername);
      targetUserId = searchResults.pk.toString();
      targetInfo = {
        username: searchResults.username,
        full_name: searchResults.full_name,
        profile_pic_url: searchResults.profile_pic_url,
        following_count: 0,
        is_private: searchResults.is_private,
      };

      // Get full user info for following count
      const userInfo = await ig.user.info(searchResults.pk);
      targetInfo.following_count = userInfo.following_count;
      targetInfo.is_private = userInfo.is_private;

    } catch {
      return { success: false, error: `Benutzer "${targetUsername}" wurde nicht gefunden.` };
    }

    // Check if profile is private
    if (targetInfo.is_private) {
      return {
        success: false,
        error: `Das Profil @${targetUsername} ist privat. Abonnierte Konten können nur für öffentliche Profile abgerufen werden.`,
        targetInfo
      };
    }

    // Fetch following
    const followingFeed = ig.feed.accountFollowing(Number(targetUserId));
    const following: FollowingUser[] = [];

    try {
      let items = await followingFeed.items();

      for (const item of items) {
        if (following.length >= maxCount) break;
        following.push({
          pk: item.pk.toString(),
          username: item.username,
          full_name: item.full_name,
          profile_pic_url: item.profile_pic_url,
          is_private: item.is_private,
          is_verified: item.is_verified,
        });
      }

      // Fetch more if needed and available
      while (following.length < maxCount && followingFeed.isMoreAvailable()) {
        items = await followingFeed.items();
        for (const item of items) {
          if (following.length >= maxCount) break;
          following.push({
            pk: item.pk.toString(),
            username: item.username,
            full_name: item.full_name,
            profile_pic_url: item.profile_pic_url,
            is_private: item.is_private,
            is_verified: item.is_verified,
          });
        }
      }
    } catch (fetchError: unknown) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      return { success: false, error: `Fehler beim Abrufen der abonnierten Konten: ${errorMessage}`, targetInfo };
    }

    return { success: true, following, targetInfo };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Unerwarteter Fehler: ${errorMessage}` };
  }
}
