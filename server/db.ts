import * as schema from "@shared/schema";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-serverless";
import { Pool as PgPool } from "pg";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import ws from "ws";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is not set. Please create a .env file in the project root with DATABASE_URL=your_connection_string",
  );
}

const dbUrl = process.env.DATABASE_URL;

// Detect if this is a local PostgreSQL connection or Neon connection
// Neon connection strings typically contain "neon.tech"
const isNeonConnection = dbUrl.includes("neon.tech");

let db: ReturnType<typeof neonDrizzle> | ReturnType<typeof pgDrizzle>;

if (isNeonConnection) {
  // Use Neon serverless driver for Neon databases
  neonConfig.webSocketConstructor = ws;
  
  const pool = new NeonPool({ connectionString: dbUrl });
  
  pool.on("error", (err) => {
    console.error("❌ Neon database connection error:", err.message);
  });
  
  db = neonDrizzle(pool, { schema });
  console.log("✓ Using Neon serverless driver");
} else {
  // Use standard PostgreSQL driver for local databases
  const pool = new PgPool({ connectionString: dbUrl });
  
  pool.on("error", (err) => {
    console.error("❌ PostgreSQL connection error:", err.message);
  });
  
  db = pgDrizzle(pool, { schema });
  console.log("✓ Using standard PostgreSQL driver");
}

// Test connection on startup (non-blocking)
setTimeout(async () => {
  try {
    await db.execute(sql`SELECT 1`);
    console.log("✓ Database connection successful");
  } catch (err: any) {
    console.error("\n❌ Failed to connect to database:", err.message);
    if (err.message?.includes("ECONNREFUSED") || err.message?.includes("1006") || err.code === "ECONNREFUSED") {
      console.error("   This usually means:");
      console.error("   1. PostgreSQL server is not running locally");
      console.error("   2. The database doesn't exist");
      console.error("   3. Wrong credentials or connection string");
      console.error("\n   To fix:");
      console.error("   - For local PostgreSQL: Make sure PostgreSQL is running and the database exists");
      console.error("   - For Neon: Use a Neon connection string from https://console.neon.tech");
      console.error("   - Current DATABASE_URL:", dbUrl.replace(/:[^:@]+@/, ":****@"));
    }
    console.error("   The application may not function correctly without a valid database connection.\n");
  }
}, 1000);

export { db };
