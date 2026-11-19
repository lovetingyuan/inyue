import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const userProfiles = sqliteTable("user_profile", {
  userId: text("userId")
    .primaryKey()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text(),
  avatar: text(),
});
