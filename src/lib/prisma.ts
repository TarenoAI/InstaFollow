import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';

const prismaClientSingleton = () => {
    // Check if we are running with Turso (Production/Vercel)
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

    if (tursoUrl && tursoUrl.includes('libsql')) {
        console.log('🔌 Connecting to Turso Database...');
        const libsql = createClient({
            url: tursoUrl,
            authToken: tursoAuthToken,
        });
        const adapter = new PrismaLibSQL(libsql);
        return new PrismaClient({ adapter });
    }

    // Fallback to local SQLite (Development)
    console.log('📂 Connecting to local SQLite...');
    const sqlite = new Database('dev.db');
    const adapter = new PrismaBetterSqlite3(sqlite);
    return new PrismaClient({ adapter });
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClientSingleton | undefined;
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
