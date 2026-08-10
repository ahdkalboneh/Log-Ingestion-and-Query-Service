import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 8080),

  db: {
    url:   process.env.DATABASE_URL ?? "postgres://postgres:postgres@postgres:5432/logs_db",
  },
};