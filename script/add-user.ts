import "dotenv/config";
import { db } from "../server/db";
import { users, settings } from "../shared/schema";
import { eq } from "drizzle-orm";

async function addUser() {
  try {
    // Check if user already exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, "tkvfiles@gmail.com"));

    if (existingUser) {
      console.log("User already exists:", existingUser);
      return;
    }

    // Create the new user
    const [newUser] = await db
      .insert(users)
      .values({
        email: "tkvfiles@gmail.com",
        name: "Admin User 2",
        passwordHash: "$2b$10$demo_hash_1234", // In production, use bcrypt
      })
      .returning();

    console.log("User created:", newUser);

    // Create default settings for the user
    const [newSettings] = await db
      .insert(settings)
      .values({
        userId: newUser.id,
        anomalySensitivity: "medium",
        alertRefreshInterval: 30,
        theme: "light",
        learningDurationSeconds: 60,
      })
      .returning();

    console.log("Settings created:", newSettings);
    console.log("\n✅ User added successfully!");
    console.log("Email: tkvfiles@gmail.com");
    console.log("Password: 1234");
  } catch (error) {
    console.error("Error adding user:", error);
  } finally {
    process.exit(0);
  }
}

addUser();

