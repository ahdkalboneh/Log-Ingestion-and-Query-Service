import { app } from "./app.js";
import { db, checkDatabaseConnection } from "./db/index.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { setReady } from "./modules/health/health_handler.js";
import { startRetentionScheduler } from "./services/retention.js";

async function start() {
  try {
    await checkDatabaseConnection();
    console.log("Database connection established.");

    await migrate(db, {
      migrationsFolder: "./drizzle",
    });
    console.log("Database migrations applied.");

    setReady();
    startRetentionScheduler();
    app.listen(8080, "0.0.0.0", () => {
      console.log("Server running on port 8080");
    });

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

start();