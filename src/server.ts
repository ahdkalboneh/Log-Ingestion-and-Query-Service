import { app } from "./app.js";
import { db, checkDatabaseConnection } from "./db/index.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { setReady } from "./modules/health/health_handler.js";
import { startRetentionScheduler } from "./services/retention.js";

async function waitForDatabase(maxRetries = 30, delayMs = 1000) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await checkDatabaseConnection();
      console.log("Database connection established.");
      return;
    } catch (err) {
      console.log(`Database not ready (attempt ${i}/${maxRetries}). Retrying...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Could not connect to database after maximum retries");
}

async function start() {
  try {
    await waitForDatabase();
    
    await migrate(db, {
      migrationsFolder: "./drizzle",
    });

    console.log("Database migrations applied.");

    app.listen(8080, "0.0.0.0", () => {
      setReady();
      startRetentionScheduler();

      console.log("Server running on port 8080");
    });

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

start();