import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscordRotationEmbed,
  validAppData,
  validDiscordWebhookUrl,
  validProfileData,
  validResetBaseUrl,
} from "../lib/validation.js";
import { handleApiRequest } from "../lib/backend.js";

test("accepts valid team data and rejects malformed rotations", () => {
  assert.equal(validAppData({
    players: ["A", "B", "C"],
    preferredSize: 3,
    history: [{
      id: "c84a06f8-58c0-4c51-b54a-974ce0f57dd5",
      date: "2026-10-07T00:00:00Z",
      teams: [["A", "B", "C"]],
      leaders: ["A"],
    }],
  }), true);
  assert.equal(validAppData({ players: [], preferredSize: 5, history: [] }), false);
  assert.equal(validAppData({ players: [], history: [{ date: "", teams: [], leaders: ["not-a-team-member"] }] }), false);
});

test("validates webhook destinations and rejects URL tricks", () => {
  assert.equal(validDiscordWebhookUrl("https://discord.com/api/webhooks/12345678901234567/abcdefghijklmnopqrst"), true);
  assert.equal(validDiscordWebhookUrl("https://discord.com.evil.example/api/webhooks/12345678901234567/abcdefghijklmnopqrst"), false);
  assert.equal(validDiscordWebhookUrl("https://user@discord.com/api/webhooks/12345678901234567/abcdefghijklmnopqrst"), false);
});

test("accepts secure public reset URLs and localhost development URLs only", () => {
  assert.equal(validResetBaseUrl("https://abyssspin.example"), true);
  assert.equal(validResetBaseUrl("http://localhost:8765/"), true);
  assert.equal(validResetBaseUrl("http://abyssspin.example"), false);
  assert.equal(validResetBaseUrl("https://abyssspin.example/reset?next=evil"), false);
});

test("checks profile avatar format and Discord embed team constraints", () => {
  assert.equal(validProfileData({ discordName: "Player", activisionId: "", email: "", avatar: "" }), true);
  assert.equal(validProfileData({ discordName: "x".repeat(49), activisionId: "", email: "", avatar: "" }), false);
  assert.throws(() => buildDiscordRotationEmbed({
    date: "2026-10-07T00:00:00Z",
    teams: [["A", "B", "C"], ["c", "D", "E"]],
  }), /wystąpić tylko raz/);
  assert.equal(buildDiscordRotationEmbed({
    date: "2026-10-07T00:00:00Z",
    teams: [["A", "B", "C"]],
  }).title, "ROTACJA DRUŻYN");
});

test("reports missing hosted database configuration without exposing internals", async () => {
  delete process.env.DATABASE_URL;
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handleApiRequest({
    method: "GET",
    url: "/api/auth/session",
    headers: { host: "localhost" },
  }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error, "Brak konfiguracji DATABASE_URL dla bazy Supabase.");
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("rejects unknown API paths before connecting to Supabase", async () => {
  delete process.env.DATABASE_URL;
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handleApiRequest({
    method: "POST",
    url: "/api/not-a-route",
    headers: { host: "localhost" },
    body: {},
  }, response);
  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.error, "Nie znaleziono endpointu.");
});
