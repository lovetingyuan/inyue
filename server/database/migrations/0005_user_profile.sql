CREATE TABLE user_profile (
  userId TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT,
  avatar TEXT
);
