import { describe, expect, it } from "vitest";

import { validateD1MigrationFiles } from "./d1-migration-policy";

describe("validateD1MigrationFiles", () => {
  it("accepts ordered, forward-only migration files", () => {
    expect(
      validateD1MigrationFiles([
        { name: "0001_initial.sql", sql: "CREATE TABLE users (id TEXT PRIMARY KEY);" },
        { name: "0002_add_status.sql", sql: "ALTER TABLE users ADD COLUMN status TEXT;" },
        { name: "0003_add_triggers.sql", sql: "CREATE TABLE triggers (id TEXT PRIMARY KEY);" },
        { name: "0004_add_webhooks.sql", sql: "ALTER TABLE triggers ADD COLUMN secret_hash TEXT;" },
      ]),
    ).toEqual([]);
  });

  it("rejects reset SQL in the retained migration path", () => {
    expect(
      validateD1MigrationFiles([
        {
          name: "0001_initial.sql",
          sql: "DROP TABLE IF EXISTS users; CREATE TABLE users (id TEXT PRIMARY KEY);",
        },
      ]),
    ).toEqual([expect.stringContaining("keep destructive resets in schema.sql")]);
  });

  it("requires stable numbered filenames in lexical order", () => {
    const errors = validateD1MigrationFiles([
      { name: "0002_second.sql", sql: "SELECT 1;" },
      { name: "0001_initial.sql", sql: "SELECT 1;" },
      { name: "initial.sql", sql: "SELECT 1;" },
    ]);

    expect(errors).toContain("D1 migrations must be read in filename order.");
    expect(errors).toContain(
      "initial.sql must use the numbered migration format 0001_description.sql.",
    );
  });

  it("rejects gaps, duplicate numbers, and empty migrations", () => {
    const errors = validateD1MigrationFiles([
      { name: "0001_initial.sql", sql: "SELECT 1;" },
      { name: "0001_duplicate.sql", sql: "SELECT 1;" },
      { name: "0003_empty.sql", sql: "  \n" },
    ]);

    expect(errors).toContain(
      "0001_duplicate.sql has migration number 1; expected contiguous number 2.",
    );
    expect(errors).toContain("0003_empty.sql must not be empty.");
  });
});
