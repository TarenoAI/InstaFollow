import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';

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
    // We dynamically require better-sqlite3 to avoid build issues on Vercel Edge/Serverless environments
    // where local SQLite is not used.
    console.log('📂 Connecting to local SQLite...');

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

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
