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
    screenshotUrl: string | null;
}

export interface TwitterAccountInfo {
    id: string;
    username: string;
    displayName: string | null;
    isActive: boolean;
}

export interface SetInfo {
    id: string;
    name: string;
    isActive: boolean;
    profiles: ProfileInfo[];
    twitterAccount: TwitterAccountInfo | null;
    createdAt: Date;
    updatedAt: Date;
}

// Instagram credentials handled by instagram-client.ts

// ============ SETS ============

// Get all sets
export async function getSets(): Promise<SetInfo[]> {
    const sets = await prisma.profileSet.findMany({
        include: { profiles: true, twitterAccount: true },
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
            screenshotUrl: p.screenshotUrl,
        })),
        twitterAccount: set.twitterAccount ? {
            id: set.twitterAccount.id,
            username: set.twitterAccount.username,
            displayName: set.twitterAccount.displayName,
            isActive: set.twitterAccount.isActive,
        } : null,
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
                twitterAccount: null,
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
// Uses upsert: if profile exists globally, connect it. If not, create it.
export async function addProfileToSet(setId: string, username: string): Promise<{ success: boolean; profile?: ProfileInfo; error?: string }> {
    const cleanUsername = username.trim().replace('@', '').toLowerCase();

    if (!cleanUsername) {
        return { success: false, error: 'Bitte gib einen Benutzernamen ein.' };
    }

    // Basic validation: only letters, numbers, underscores, periods
    if (!/^[a-zA-Z0-9._]+$/.test(cleanUsername)) {
        return { success: false, error: 'Ungültiger Benutzername.' };
    }

    try {
        // Check if profile already exists in THIS set
        const set = await prisma.profileSet.findUnique({
            where: { id: setId },
            include: { profiles: { where: { username: cleanUsername } } }
        });

        if (set?.profiles.length) {
            return { success: false, error: 'Dieses Profil ist bereits im Set.' };
        }

        // Check if profile exists globally
        const existingProfile = await prisma.monitoredProfile.findUnique({
            where: { username: cleanUsername }
        });

        let profile;
        if (existingProfile) {
            // Connect existing profile to set
            profile = await prisma.monitoredProfile.update({
                where: { username: cleanUsername },
                data: {
                    sets: { connect: { id: setId } }
                }
            });
        } else {
            // Create new profile and connect to set
            profile = await prisma.monitoredProfile.create({
                data: {
                    username: cleanUsername,
                    fullName: cleanUsername,
                    profilePicUrl: null,
                    isPrivate: false,
                    isVerified: false,
                    followerCount: 0,
                    followingCount: 0,
                    sets: { connect: { id: setId } }
                },
            });
        }

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
                screenshotUrl: (profile as any).screenshotUrl || null,
            },
        };
    } catch (error: unknown) {
        console.error('Error adding profile:', error);
        return { success: false, error: 'Fehler beim Hinzufügen des Profils.' };
    }
}

// Remove a profile from a set (disconnect, not delete)
export async function removeProfileFromSet(setId: string, username: string): Promise<{ success: boolean; error?: string }> {
    try {
        const profile = await prisma.monitoredProfile.findUnique({
            where: { username: username.toLowerCase() },
            include: { sets: true }
        });

        if (!profile) {
            return { success: false, error: 'Profil nicht gefunden.' };
        }

        // Disconnect from this set
        await prisma.monitoredProfile.update({
            where: { username: username.toLowerCase() },
            data: { sets: { disconnect: { id: setId } } }
        });

        // If profile is no longer in any sets, delete it entirely
        const updatedProfile = await prisma.monitoredProfile.findUnique({
            where: { username: username.toLowerCase() },
            include: { sets: true }
        });

        if (updatedProfile && updatedProfile.sets.length === 0) {
            await prisma.monitoredProfile.delete({
                where: { username: username.toLowerCase() }
            });
        }

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

// Get profile details
export async function getProfileDetails(profileId: string) {
    return await prisma.monitoredProfile.findUnique({
        where: { id: profileId },
        include: { sets: true }
    });
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

// ============ TWITTER ACCOUNTS ============

// Get all Twitter accounts
export async function getTwitterAccounts(): Promise<TwitterAccountInfo[]> {
    try {
        const accounts = await (prisma as any).twitterAccount.findMany({
            orderBy: { username: 'asc' },
        });
        return accounts.map((a: any) => ({
            id: a.id,
            username: a.username,
            displayName: a.displayName,
            isActive: a.isActive,
        }));
    } catch {
        // Table doesn't exist yet
        return [];
    }
}

// Create a new Twitter account
export async function createTwitterAccount(username: string, displayName?: string): Promise<{ success: boolean; error?: string }> {
    try {
        await (prisma as any).twitterAccount.create({
            data: {
                username: username.replace('@', '').toLowerCase(),
                displayName: displayName || username,
            },
        });
        return { success: true };
    } catch (error: any) {
        if (error.code === 'P2002') {
            return { success: false, error: 'Dieser Twitter-Account existiert bereits.' };
        }
        return { success: false, error: 'Fehler beim Erstellen.' };
    }
}

// Delete a Twitter account
export async function deleteTwitterAccount(accountId: string): Promise<{ success: boolean; error?: string }> {
    try {
        await (prisma as any).twitterAccount.delete({ where: { id: accountId } });
        return { success: true };
    } catch {
        return { success: false, error: 'Fehler beim Löschen.' };
    }
}

// Link a Twitter account to a set
export async function linkTwitterAccountToSet(setId: string, twitterAccountId: string | null): Promise<{ success: boolean; error?: string }> {
    try {
        await prisma.profileSet.update({
            where: { id: setId },
            data: { twitterAccountId } as any,
        });
        return { success: true };
    } catch {
        return { success: false, error: 'Fehler beim Verknüpfen.' };
    }
}
