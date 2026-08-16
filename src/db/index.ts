import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { config } from "../config.js";

export const writeConn = postgres(config.db.url, {
  max: 6,                 
  idle_timeout: 20,
  connect_timeout: 10,
  connection: { statement_timeout: 10000 },
});

export const readConn = postgres(config.db.url, {
  max: 7,                 
  idle_timeout: 20,
  connect_timeout: 10,
  connection: { statement_timeout: 5000 }, 
});

export const db = drizzle(readConn, { schema });

export async function checkDatabaseConnection() {
  await readConn`SELECT 1`;
}