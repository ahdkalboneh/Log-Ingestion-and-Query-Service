import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { config } from "../config.js";

export const conn = postgres(config.db.url, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(conn, { schema });

export async function checkDatabaseConnection() {
  await conn`SELECT 1`;
}