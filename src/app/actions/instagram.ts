'use server';

import { getInstagramClient, loadInstagramCredentials } from '@/lib/instagram-client';
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
// Use centralized loader
async function loadCredentials(): Promise<Credentials | null> {
  return loadInstagramCredentials();
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
export async function fetchFollowing(targetUsername: string): Promise<FetchResult> {
  try {
    const ig = await getInstagramClient();
    if (!ig) {
      return { success: false, error: 'Instagram-Anmeldung fehlgeschlagen. Bitte prüfe die Anmeldedaten.' };
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

      // Get full user info for following count (required for actual list access)
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

      const processItems = (feedItems: any[]) => {
        for (const item of feedItems) {
          following.push({
            pk: item.pk.toString(),
            username: item.username,
            full_name: item.full_name,
            profile_pic_url: item.profile_pic_url,
            is_private: item.is_private,
            is_verified: item.is_verified,
          });
        }
      };

      processItems(items);

      // Fetch all remaining items
      while (followingFeed.isMoreAvailable()) {
        items = await followingFeed.items();
        processItems(items);

        // Safety break if list gets too massive
        if (following.length > 5000) {
          console.log('Safety limit reached (5000)');
          break;
        }
      }
    } catch (fetchError: unknown) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
      return { success: false, error: `Fehler beim Abrufen der Liste: ${errorMessage}`, targetInfo };
    }

    return { success: true, following, targetInfo };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Unerwarteter Fehler: ${errorMessage}` };
  }
}
