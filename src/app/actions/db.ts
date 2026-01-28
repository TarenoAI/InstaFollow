'use server';

import { prisma } from '@/lib/prisma';
import { getInstagramClient, safeApiCall } from '@/lib/instagram-client';
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

// Instagram credentials handled by instagram-client.ts

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
        console.error('Error creating set:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        return { success: false, error: 'Fehler beim Erstellen des Sets. Bitte prüfe die Logs.' };
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
// NOTE: We only add the username to the DB. The VPS worker will fetch full details on next cron run.
export async function addProfileToSet(setId: string, username: string): Promise<{ success: boolean; profile?: ProfileInfo; error?: string }> {
    const cleanUsername = username.trim().replace('@', '').toLowerCase();

    if (!cleanUsername) {
        return { success: false, error: 'Bitte gib einen Benutzernamen ein.' };
    }

    // Basic validation: only letters, numbers, underscores, periods
    if (!/^[a-zA-Z0-9._]+$/.test(cleanUsername)) {
        return { success: false, error: 'Ungültiger Benutzername.' };
    }

    // Check if profile already exists in set
    const existing = await prisma.monitoredProfile.findUnique({
        where: { setId_username: { setId, username: cleanUsername } },
    });

    if (existing) {
        return { success: false, error: 'Dieses Profil ist bereits im Set.' };
    }

    // Simply add to database - VPS worker will fetch details later
    try {
        const profile = await prisma.monitoredProfile.create({
            data: {
                username: cleanUsername,
                fullName: cleanUsername, // Will be updated by VPS
                profilePicUrl: null,
                isPrivate: false,
                isVerified: false,
                followerCount: 0,
                followingCount: 0, // 0 triggers initial full scrape on VPS
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
        console.error('Error adding profile:', error);
        return { success: false, error: 'Fehler beim Hinzufügen des Profils.' };
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
