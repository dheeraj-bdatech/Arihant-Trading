import { Module, Global, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '@arihant/shared';

const { Pool } = pg;

export const KYSELY_DB = 'KYSELY_DB';

@Global()
@Module({
  providers: [
    {
      provide: KYSELY_DB,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Kysely<Database> => {
        const connectionString =
          configService.get<string>('DATABASE_URL') ||
          'postgresql://postgres:postgres@localhost:5432/postgres';

        const pool = new Pool({
          connectionString,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 15000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
          ssl:
            process.env.DATABASE_SSL === 'true' ||
            ((connectionString.includes('supabase') ||
              process.env.NODE_ENV === 'production') &&
              !connectionString.includes('localhost') &&
              !connectionString.includes('127.0.0.1'))
              ? { rejectUnauthorized: false }
              : undefined,
        });

        pool.on('error', (err) => {
          // Prevent unhandled errors from disconnected idle pool clients
          console.warn('[DatabaseModule] Idle client pool warning:', err.message);
        });

        return new Kysely<Database>({
          dialect: new PostgresDialect({
            pool,
          }),
        });
      },
    },
  ],
  exports: [KYSELY_DB],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(private readonly configService: ConfigService) {}

  async onModuleDestroy() {
    // Graceful teardown handled by Kysely dialect pool
  }
}
