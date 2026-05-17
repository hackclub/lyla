import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../db/schema.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const sql = postgres(process.env.DATABASE_URL, {
  onnotice: () => {},
});
export const db = drizzle(sql, { schema });

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../db/migrations");
export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}
