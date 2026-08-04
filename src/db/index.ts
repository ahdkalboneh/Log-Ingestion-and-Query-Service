import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { config } from "../config.js";

export const conn = postgres(config.db.url);
export const db = drizzle(conn, { schema });

export async function checkDatabaseConnection() {
  await conn`SELECT 1`;
}