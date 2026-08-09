import * as SQLite from "expo-sqlite";

export type PendingTurn = { clientTurnId: string; text: string; createdAt: string };

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

const database = () => {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync("assistant-mk1.db").then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        DROP TABLE IF EXISTS display_cache;
        CREATE TABLE IF NOT EXISTS drafts (
          thread_id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_turn (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          client_turn_id TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      return db;
    });
  }
  return databasePromise;
};

export const mobileStore = {
  async putDraft(threadId: string, text: string) {
    const db = await database();
    if (!text) return db.runAsync("DELETE FROM drafts WHERE thread_id = ?", threadId);
    return db.runAsync(
      `INSERT INTO drafts (thread_id, text, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
      threadId,
      text,
      new Date().toISOString(),
    );
  },
  async getDraft(threadId: string) {
    const db = await database();
    return (
      (
        await db.getFirstAsync<{ text: string }>(
          "SELECT text FROM drafts WHERE thread_id = ?",
          threadId,
        )
      )?.text ?? ""
    );
  },
  async putPendingTurn(turn: PendingTurn) {
    const db = await database();
    await db.runAsync(
      `INSERT INTO pending_turn (singleton, client_turn_id, text, created_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(singleton) DO UPDATE SET client_turn_id = excluded.client_turn_id,
         text = excluded.text, created_at = excluded.created_at`,
      turn.clientTurnId,
      turn.text,
      turn.createdAt,
    );
  },
  async getPendingTurn(): Promise<PendingTurn | null> {
    const db = await database();
    const row = await db.getFirstAsync<{
      client_turn_id: string;
      text: string;
      created_at: string;
    }>("SELECT client_turn_id, text, created_at FROM pending_turn WHERE singleton = 1");
    return row
      ? { clientTurnId: row.client_turn_id, text: row.text, createdAt: row.created_at }
      : null;
  },
  async clearPendingTurn(clientTurnId: string) {
    const db = await database();
    await db.runAsync(
      "DELETE FROM pending_turn WHERE singleton = 1 AND client_turn_id = ?",
      clientTurnId,
    );
  },
  async getSetting(key: string) {
    const db = await database();
    return (
      (
        await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM local_settings WHERE key = ?",
          key,
        )
      )?.value ?? null
    );
  },
  async putSetting(key: string, value: string | null) {
    const db = await database();
    if (value === null) return db.runAsync("DELETE FROM local_settings WHERE key = ?", key);
    return db.runAsync(
      `INSERT INTO local_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      new Date().toISOString(),
    );
  },
  async clearLocalAuthority() {
    const db = await database();
    await db.execAsync(`
      DELETE FROM drafts;
      DELETE FROM pending_turn;
      DELETE FROM local_settings WHERE key != 'notification.installation-id';
    `);
  },
};
