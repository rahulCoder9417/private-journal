import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const journalMetadata = pgTable(
  "journal_metadata",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    wordCount: integer("word_count").notNull().default(0),
    salt: text("salt").notNull(), // hex-encoded PBKDF2 salt
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("journal_metadata_user_date_idx").on(t.userId, t.date)]
);

export const journalContent = pgTable("journal_content", {
  id: text("id").primaryKey(),
  metadataId: text("metadata_id")
    .notNull()
    .unique()
    .references(() => journalMetadata.id, { onDelete: "cascade" }),
  encryptedData: text("encrypted_data").notNull(), // base64 AES-GCM ciphertext
  iv: text("iv").notNull(), // hex-encoded IV
});

// One row per user. Holds the single PBKDF2 salt shared by every finance blob —
// written once and NEVER rotated, so the whole ledger costs one key derivation per
// session and the "new salt / old ciphertext" desync class of bug can't happen.
// Reusing a salt across blobs is safe: AES-GCM needs a unique IV, and encrypt()
// draws a fresh random one on every call.
export const financeVault = pgTable("finance_vault", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  salt: text("salt").notNull(), // hex-encoded PBKDF2 salt — write once
  encryptedSettings: text("encrypted_settings").notNull(), // opening balances
  iv: text("iv").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// One encrypted blob per month: { transactions: FinanceTx[] }. Deliberately no
// transaction-count column — it would leak spending activity for no benefit, since
// the client always has the decrypted blob before it needs a count.
export const financeMonth = pgTable(
  "finance_month",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // YYYY-MM
    encryptedData: text("encrypted_data").notNull(),
    iv: text("iv").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("finance_month_user_month_idx").on(t.userId, t.month)]
);
