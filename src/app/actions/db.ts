'use server';

import { prisma } from '@/lib/prisma';
import { IgApiClient } from 'instagram-private-api';
import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

// ============ PROFILE INFO TYPE ============
export interface ProfileInfo {
    id: string;
    username: string;
    fullName: string | null;
    profilePicUrl: string | null;
    isPrivate: boolean;
    isVerified: boolean;
    followerCount: number | null;
    followingCount: number | null;
    lastCheckedAt: Date | null;
}

export interface SetInfo {
    id: string;
    name: string;
    isActive: boolean;
    profiles: ProfileInfo[];
    createdAt: Date;
    updatedAt: Date;
}

// ============ CREDENTIALS ============
interface Credentials {
    username: string;
    password: string;
}

async function loadCredentials(): Promise<Credentials | null> {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

// ============ SETS ============

// Get all sets
export async function getSets(): Promise<SetInfo[]> {
    const sets = await prisma.profileSet.findMany({
        include: { profiles: true },
        orderBy: { createdAt: 'desc' },
    });

    return sets.map((set: any) => ({
        id: set.id,
        name: set.name,
        isActive: set.isActive,
        profiles: set.profiles.map((p: any) => ({
            id: p.id,
            username: p.username,
            fullName: p.fullName,
            profilePicUrl: p.profilePicUrl,
            isPrivate: p.isPrivate,
            isVerified: p.isVerified,
            followerCount: p.followerCount,
            followingCount: p.followingCount,
            lastCheckedAt: p.lastCheckedAt,
        })),
        createdAt: set.createdAt,
        updatedAt: set.updatedAt,
    }));
}

// Create a new set
export async function createSet(name: string): Promise<{ success: boolean; set?: SetInfo; error?: string }> {
    if (!name.trim()) {
        return { success: false, error: 'Bitte gib einen Namen für das Set ein.' };
    }

    try {
        // Check if set already exists
        const existing = await prisma.profileSet.findUnique({ where: { name: name.trim() } });
        if (existing) {
            return { success: false, error: 'Ein Set mit diesem Namen existiert bereits.' };
        }

        const set = await prisma.profileSet.create({
            data: { name: name.trim() },
            include: { profiles: true },
        });

        return {
            success: true,
            set: {
                id: set.id,
                name: set.name,
                isActive: set.isActive,
                profiles: [],
                createdAt: set.createdAt,
                updatedAt: set.updatedAt,
            },
        };
    } catch (error) {
        console.error('Error creating set:', error);
        return { success: false, error: 'Fehler beim Erstellen des Sets.' };
    }
}

// Delete a set
export async function deleteSet(setId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await prisma.profileSet.delete({ where: { id: setId } });
        return { success: true };
    } catch (error) {
        console.error('Error deleting set:', error);
        return { success: false, error: 'Fehler beim Löschen des Sets.' };
    }
}

// Toggle set active status
export async function toggleSetActive(setId: string): Promise<{ success: boolean; isActive?: boolean; error?: string }> {
    try {
        const set = await prisma.profileSet.findUnique({ where: { id: setId } });
        if (!set) {
            return { success: false, error: 'Set nicht gefunden.' };
        }

        const updated = await prisma.profileSet.update({
            where: { id: setId },
            data: { isActive: !set.isActive },
        });

        return { success: true, isActive: updated.isActive };
    } catch (error) {
        console.error('Error toggling set:', error);
        return { success: false, error: 'Fehler beim Aktualisieren.' };
    }
}

// ============ PROFILES ============

// Add a profile to a set
export async function addProfileToSet(setId: string, username: string): Promise<{ success: boolean; profile?: ProfileInfo; error?: string }> {
    const cleanUsername = username.trim().replace('@', '').toLowerCase();

    if (!cleanUsername) {
        return { success: false, error: 'Bitte gib einen Benutzernamen ein.' };
    }

    // Check if profile already exists in set
    const existing = await prisma.monitoredProfile.findUnique({
        where: { setId_username: { setId, username: cleanUsername } },
    });

    if (existing) {
        return { success: false, error: 'Dieses Profil ist bereits im Set.' };
    }

    // Fetch profile info from Instagram
    const credentials = await loadCredentials();
    if (!credentials) {
        return { success: false, error: 'Keine Instagram-Anmeldedaten konfiguriert.' };
    }

    try {
        const ig = new IgApiClient();
        ig.state.generateDevice(credentials.username);
        await ig.account.login(credentials.username, credentials.password);

        const searchResult = await ig.user.searchExact(cleanUsername);
        const userInfo = await ig.user.info(searchResult.pk);

        const profile = await prisma.monitoredProfile.create({
            data: {
                username: userInfo.username,
                fullName: userInfo.full_name,
                profilePicUrl: userInfo.profile_pic_url,
                isPrivate: userInfo.is_private,
                isVerified: userInfo.is_verified,
                followerCount: userInfo.follower_count,
                followingCount: userInfo.following_count,
                setId,
            },
        });

        return {
            success: true,
            profile: {
                id: profile.id,
                username: profile.username,
                fullName: profile.fullName,
                profilePicUrl: profile.profilePicUrl,
                isPrivate: profile.isPrivate,
                isVerified: profile.isVerified,
                followerCount: profile.followerCount,
                followingCount: profile.followingCount,
                lastCheckedAt: profile.lastCheckedAt,
            },
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('User not found')) {
            return { success: false, error: `Benutzer "${cleanUsername}" nicht gefunden.` };
        }
        console.error('Error adding profile:', error);
        return { success: false, error: `Fehler beim Abrufen: ${errorMessage}` };
    }
}

// Remove a profile from a set
export async function removeProfileFromSet(setId: string, username: string): Promise<{ success: boolean; error?: string }> {
    try {
        await prisma.monitoredProfile.delete({
            where: { setId_username: { setId, username: username.toLowerCase() } },
        });
        return { success: true };
    } catch (error) {
        console.error('Error removing profile:', error);
        return { success: false, error: 'Fehler beim Entfernen des Profils.' };
    }
}

// ============ APP CONFIG ============

// Get app config
export async function getAppConfig() {
    let config = await prisma.appConfig.findUnique({ where: { id: 'app_config' } });

    if (!config) {
        config = await prisma.appConfig.create({
            data: { id: 'app_config' },
        });
    }

    return {
        n8nWebhookUrl: config.n8nWebhookUrl,
        checkIntervalMs: config.checkIntervalMs,
        delayBetweenProfilesMs: config.delayBetweenProfilesMs,
    };
}

// Save n8n webhook URL
export async function saveN8nWebhookUrl(url: string): Promise<{ success: boolean; error?: string }> {
    try {
        await prisma.appConfig.upsert({
            where: { id: 'app_config' },
            update: { n8nWebhookUrl: url },
            create: { id: 'app_config', n8nWebhookUrl: url },
        });
        return { success: true };
    } catch (error) {
        console.error('Error saving webhook URL:', error);
        return { success: false, error: 'Fehler beim Speichern.' };
    }
}

// ============ CHANGES ============

// Get recent changes
export async function getRecentChanges(limit: number = 50, profileId?: string) {
    const whereClause = profileId ? { profileId } : {};

    const changes = await prisma.changeEvent.findMany({
        where: whereClause,
        include: { profile: true },
        orderBy: { detectedAt: 'desc' },
        take: limit,
    });

    return changes.map((c: any) => ({
        id: c.id,
        type: c.type as 'FOLLOW' | 'UNFOLLOW',
        sourceUsername: c.profile.username,
        sourceFullName: c.profile.fullName,
        sourcePicUrl: c.profile.profilePicUrl,
        targetUsername: c.targetUsername,
        targetFullName: c.targetFullName,
        targetPicUrl: c.targetPicUrl,
        detectedAt: c.detectedAt,
        processed: c.processed,
    }));
}

// Get following list for a profile
export async function getProfileFollowing(profileId: string) {
    const following = await prisma.followingEntry.findMany({
        where: { profileId },
        orderBy: { username: 'asc' },
    });

    return following.map((f: any) => ({
        username: f.username,
        fullName: f.fullName,
        profilePicUrl: f.profilePicUrl,
        isPrivate: f.isPrivate,
        isVerified: f.isVerified,
    }));
}
