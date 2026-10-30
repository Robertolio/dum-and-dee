export interface Db {
  kind: 'sqlite' | 'pg' | 'memory';
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  close(): Promise<void>;
}

/** SQL uses `?` placeholders and portable types only (TEXT, BIGINT, INTEGER). */
export const MIGRATIONS: Array<{ v: number; sql: string[] }> = [
  {
    v: 1,
    sql: [
      `CREATE TABLE players (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        blocked INTEGER NOT NULL DEFAULT 0,
        created BIGINT NOT NULL,
        last_seen BIGINT NOT NULL
      )`,
      `CREATE TABLE friendships (
        a TEXT NOT NULL,
        b TEXT NOT NULL,
        state TEXT NOT NULL,
        requester TEXT NOT NULL,
        created BIGINT NOT NULL,
        PRIMARY KEY (a, b)
      )`,
      `CREATE TABLE blocks (
        blocker TEXT NOT NULL,
        blocked TEXT NOT NULL,
        created BIGINT NOT NULL,
        PRIMARY KEY (blocker, blocked)
      )`,
      `CREATE TABLE teams (
        a TEXT NOT NULL,
        b TEXT NOT NULL,
        name TEXT,
        pending_name TEXT,
        proposer TEXT,
        updated BIGINT NOT NULL,
        PRIMARY KEY (a, b)
      )`,
      `CREATE TABLE invites (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        room TEXT NOT NULL,
        created BIGINT NOT NULL,
        expires BIGINT NOT NULL
      )`,
      `CREATE TABLE push_subscriptions (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created BIGINT NOT NULL
      )`,
      `CREATE INDEX invites_to ON invites (to_id)`,
      `CREATE INDEX push_player ON push_subscriptions (player_id)`,
    ],
  },
  {
    v: 2,
    sql: [`CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)`],
  },
];

export async function migrate(db: Db): Promise<void> {
  await db.run('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = await db.get<{ v: number | string | null }>('SELECT MAX(v) AS v FROM schema_version');
  const cur = Number(row?.v ?? 0);
  for (const m of MIGRATIONS) {
    if (m.v <= cur) continue;
    for (const sql of m.sql) await db.run(sql);
    await db.run('INSERT INTO schema_version (v) VALUES (?)', [m.v]);
  }
}

/** node:sqlite (built in, no native build). `:memory:` or a file path. */
export async function openSqlite(file: string): Promise<Db> {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') {
    const { mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(file), { recursive: true });
  }
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL');
  type P = Array<string | number | null>;
  const db: Db = {
    kind: file === ':memory:' ? 'memory' : 'sqlite',
    async run(sql, params = []) {
      d.prepare(sql).run(...(params as P));
    },
    async all(sql, params = []) {
      return d.prepare(sql).all(...(params as P)) as never;
    },
    async get(sql, params = []) {
      return d.prepare(sql).get(...(params as P)) as never;
    },
    async close() {
      d.close();
    },
  };
  await migrate(db);
  return db;
}

interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export function wrapPg(pool: PgLike): Db {
  const conv = (sql: string): string => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  return {
    kind: 'pg',
    async run(sql, params = []) {
      await pool.query(conv(sql), params);
    },
    async all(sql, params = []) {
      return (await pool.query(conv(sql), params)).rows as never;
    },
    async get(sql, params = []) {
      return (await pool.query(conv(sql), params)).rows[0] as never;
    },
    async close() {
      await pool.end();
    },
  };
}

export async function openPg(url: string): Promise<Db> {
  const pg = (await import('pg')).default;
  // BIGINT columns come back as numbers (ms timestamps fit easily).
  pg.types.setTypeParser(20, (v: string) => Number(v));
  const local = /localhost|127\.0\.0\.1|\.railway\.internal/.test(url);
  const pool = new pg.Pool({ connectionString: url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
  const db = wrapPg(pool as unknown as PgLike);
  await migrate(db);
  return db;
}

/** DATABASE_URL (Postgres) when set, otherwise a SQLite file in ./data (or memory if node:sqlite is missing). */
export async function openStore(env: Record<string, string | undefined> = process.env): Promise<Db> {
  if (env.DATABASE_URL) return openPg(env.DATABASE_URL);
  try {
    return await openSqlite(env.SQLITE_FILE ?? './data/dd.sqlite');
  } catch (e) {
    console.error('SQLite unavailable, using a memory store (data is lost on restart):', (e as Error).message);
    return openSqlite(':memory:');
  }
}
