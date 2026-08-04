import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3000),

  db: {
    url: process.env.DATABASE_URL!,
  },
};