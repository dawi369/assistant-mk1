import { describe, it, expect } from "vitest";

import { isRecord, parseDataJson, parseJson, json } from "./http";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("parseDataJson", () => {
  it("parses valid JSON object", () => {
    expect(parseDataJson('{"key":"value"}')).toEqual({ key: "value" });
  });

  it("returns empty object for non-object JSON", () => {
    expect(parseDataJson('"string"')).toEqual({});
    expect(parseDataJson("42")).toEqual({});
    expect(parseDataJson("[1,2]")).toEqual({});
    expect(parseDataJson("null")).toEqual({});
  });

  it("returns empty object for invalid JSON", () => {
    expect(parseDataJson("not json")).toEqual({});
    expect(parseDataJson("")).toEqual({});
  });

  it("handles nested objects", () => {
    const input = '{"a":{"b":1},"c":[1,2]}';
    expect(parseDataJson(input)).toEqual({ a: { b: 1 }, c: [1, 2] });
  });
});

describe("parseJson", () => {
  it("parses valid JSON", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseJson('"hello"')).toBe("hello");
    expect(parseJson("42")).toBe(42);
    expect(parseJson("null")).toBeNull();
    expect(parseJson("true")).toBe(true);
  });

  it("returns null for invalid JSON", () => {
    expect(parseJson("not json")).toBeNull();
    expect(parseJson("")).toBeNull();
    expect(parseJson("{broken")).toBeNull();
  });
});

describe("json", () => {
  it("creates a Response with JSON content-type", async () => {
    const resp = json({ ok: true });
    expect(resp.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = await resp.json();
    expect(body).toEqual({ ok: true });
  });

  it("respects custom status in init", async () => {
    const resp = json({ error: "not found" }, { status: 404 });
    expect(resp.status).toBe(404);
  });

  it("merges custom headers with content-type", async () => {
    const resp = json({ data: 1 }, { headers: { "x-custom": "value" } });
    expect(resp.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(resp.headers.get("x-custom")).toBe("value");
  });

  it("serializes various data types", async () => {
    const resp = json([1, 2, 3]);
    const body = await resp.json();
    expect(body).toEqual([1, 2, 3]);
  });
});
