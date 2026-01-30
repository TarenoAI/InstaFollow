
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;
    const localUrl = process.env.DATABASE_URL || 'file:dev.db';

    // Verwende Turso wenn URL gesetzt ist (unabhängig von Vercel)
    const hasTurso = !!(tursoUrl && tursoUrl !== 'undefined' && tursoUrl.length > 0 && tursoUrl.includes('turso'));

    if (hasTurso) {
        console.log(`🚀 [Prisma] Connecting to Turso: ${tursoUrl?.substring(0, 30)}...`);
        const { PrismaLibSql } = require('@prisma/adapter-libsql');

        // Pass the config object to the factory
        const adapter = new PrismaLibSql({
            url: tursoUrl!,
            authToken: tursoAuthToken
        });
        return new PrismaClient({ adapter });
    }

    console.log(`📂 [Prisma] Connecting to local SQLite [${localUrl}]`);
    const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

    // Pass the config object to the factory
    const adapter = new PrismaBetterSqlite3({ url: localUrl });
    return new PrismaClient({ adapter });
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClientSingleton | undefined;
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
