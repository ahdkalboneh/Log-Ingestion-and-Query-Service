import { app } from "./app.js";
import { db, checkDatabaseConnection } from "./db/index.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { setReady } from "./modules/health/health_handler.js";

async function start() {
  try {
    await checkDatabaseConnection();
    console.log("Database connection established.");

    await migrate(db, {
      migrationsFolder: "./drizzle",
    });
    console.log("Database migrations applied.");

    setReady();

    app.listen(3000, () => {
      console.log("Server running on port 3000");
    });

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

start();