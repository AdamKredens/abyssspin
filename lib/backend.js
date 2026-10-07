import { createCipheriv, createDecipheriv, createHash, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import nodemailer from "nodemailer";
import {
  ROTATION_ID_PATTERN,
  USERNAME_PATTERN,
  buildDiscordRotationEmbed,
  isEmail,
  validAppData,
  validDiscordWebhookUrl,
  validProfileData,
  validResetBaseUrl,
} from "./validation.js";

const pbkdf2Async = promisify(pbkdf2);
const COOKIE_NAME = "abyssspin_session";
const SESSION_LIFETIME = 30 * 24 * 60 * 60;
const PASSWORD_RESET_LIFETIME = 30 * 60;
const PASSWORD_ITERATIONS = 600_000;
const MAX_REQUEST_SIZE = 1_000_000;
const MAX_WEBHOOK_IMAGE_SIZE = 6 * 1024 * 1024;
const MAX_WEBHOOK_REQUEST_SIZE = 8_500_000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let pool;

function getPool() {
  if (pool) return pool;
  const value = process.env.DATABASE_URL;
  if (!value) throw new HttpError(503, "Brak konfiguracji DATABASE_URL dla bazy Supabase.");
  let connectionString;
  let local = false;
  try {
    const url = new URL(value);
    local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    for (const key of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(key);
    connectionString = url.toString();
  } catch {
    throw new HttpError(503, "Nieprawidłowa konfiguracja DATABASE_URL.");
  }
  pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
    ssl: local ? false : { rejectUnauthorized: true },
  });
  return pool;
}

async function query(text, values = []) {
  return getPool().query(text, values);
}

async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function httpError(status, message) {
  throw new HttpError(status, message);
}

function requireObject(value, message = "Nieprawidłowe dane formularza.") {
  if (!value || typeof value !== "object" || Array.isArray(value)) httpError(400, message);
  return value;
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    if (!["http:", "https:"].includes(new URL(origin).protocol)
        || new URL(origin).host.toLowerCase() !== String(req.headers.host || "").toLowerCase()) {
      httpError(403, "Żądanie pochodzi z niedozwolonej strony.");
    }
  } catch {
    httpError(403, "Żądanie pochodzi z niedozwolonej strony.");
  }
}

function readCookie(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function tokenHash(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function setSessionCookie(res, token) {
  const secure = process.env.VERCEL === "1" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.VERCEL === "1" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

async function readJson(req, maxSize = MAX_REQUEST_SIZE) {
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength > maxSize) httpError(413, "Nieprawidłowy rozmiar żądania.");
  let payload = req.body;
  if (Buffer.isBuffer(payload)) payload = payload.toString("utf8");
  if (typeof payload === "string") {
    if (Buffer.byteLength(payload, "utf8") > maxSize) httpError(413, "Nieprawidłowy rozmiar żądania.");
    try {
      payload = JSON.parse(payload);
    } catch {
      httpError(400, "Nieprawidłowe dane formularza.");
    }
  }
  if (payload === undefined || payload === null) httpError(400, "Nieprawidłowy rozmiar żądania.");
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > maxSize) httpError(413, "Nieprawidłowy rozmiar żądania.");
  return requireObject(payload);
}

async function authenticatedAccount(req) {
  const token = readCookie(req);
  if (!token) return null;
  const result = await query(
    `SELECT accounts.id, accounts.username, accounts.app_data, accounts.profile_data, accounts.is_admin
       FROM sessions JOIN accounts ON accounts.id = sessions.account_id
      WHERE sessions.token_hash = $1 AND sessions.expires_at > $2 AND accounts.approved = TRUE`,
    [tokenHash(token), nowSeconds()],
  );
  return result.rows[0] || null;
}

async function requireAccount(req) {
  const account = await authenticatedAccount(req);
  if (!account) httpError(401, "Zaloguj się ponownie.");
  return account;
}

async function requireAdmin(req) {
  const account = await requireAccount(req);
  if (!account.is_admin) httpError(403, "Panel administracyjny jest dostępny tylko dla administratora.");
  return account;
}

async function createSession(res, accountId) {
  const token = randomBytes(32).toString("base64url");
  const now = nowSeconds();
  await query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
  await query(
    "INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)",
    [tokenHash(token), accountId, now + SESSION_LIFETIME],
  );
  setSessionCookie(res, token);
}

async function experienceSummary(accountId) {
  const result = await query("SELECT COUNT(*)::int AS count FROM rotation_experience WHERE account_id = $1", [accountId]);
  const total = result.rows[0].count * 5;
  const current = total % 100;
  return {
    total_experience: total,
    level: Math.floor(total / 100) + 1,
    experience_in_level: current,
    experience_to_next_level: 100,
    progress_percent: current,
  };
}

function profileWithExperience(account) {
  return {
    username: account.username,
    ...account.profile_data,
  };
}

function displayName(profile, username) {
  return profile?.discordName?.trim() || username;
}

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : value;
}

async function getSettings() {
  const result = await query(
    "SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'reset_smtp_%' OR setting_key IN ('reset_base_url', 'discord_webhook_url')",
  );
  return Object.fromEntries(result.rows.map((row) => [row.setting_key, row.setting_value]));
}

function publicSmtpSettings(settings) {
  return {
    host: settings.reset_smtp_host || "",
    port: settings.reset_smtp_port || "587",
    security: settings.reset_smtp_security || "starttls",
    username: settings.reset_smtp_username || "",
    sender: settings.reset_smtp_sender || "",
    base_url: settings.reset_base_url || "",
    password_configured: Boolean(settings.reset_smtp_password),
    configured: Boolean(settings.reset_smtp_host && settings.reset_smtp_sender && settings.reset_base_url),
  };
}

function encryptionKey() {
  const raw = process.env.SMTP_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    httpError(503, "Najpierw ustaw SMTP_ENCRYPTION_KEY w środowisku Vercel, aby bezpiecznie zapisać hasło SMTP.");
  }
  return Buffer.from(raw, "hex");
}

function encryptSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `aesgcm:v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

function decryptSecret(value) {
  if (!value.startsWith("aesgcm:v1:")) throw new Error("Unsupported SMTP password format");
  const data = Buffer.from(value.slice("aesgcm:v1:".length), "base64");
  if (data.length < 29) throw new Error("Invalid encrypted SMTP password");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

function validSmtpSettings(payload) {
  const rawValues = [
    payload.reset_smtp_host,
    payload.reset_smtp_port,
    payload.reset_smtp_security,
    payload.reset_smtp_username,
    payload.reset_smtp_password,
    payload.reset_smtp_sender,
    payload.reset_base_url,
  ];
  if (!rawValues.every((item) => typeof item === "string")) {
    httpError(400, "Ustawienia serwera e-mail mają nieprawidłowy format.");
  }
  const host = payload.reset_smtp_host.trim();
  const username = payload.reset_smtp_username.trim();
  const password = payload.reset_smtp_password.trim();
  const sender = payload.reset_smtp_sender.trim();
  const baseUrl = payload.reset_base_url.trim();
  const port = /^\d+$/.test(payload.reset_smtp_port) ? Number(payload.reset_smtp_port) : 0;
  const security = payload.reset_smtp_security;
  if (![host, username, password, sender, baseUrl].some(Boolean)) return null;
  if (!host || host.length > 253 || /[\x00-\x20/@?#]/.test(host)
      || !Number.isInteger(port) || port < 1 || port > 65535
      || !["ssl", "starttls"].includes(security)
      || username.length > 254 || password.length > 512 || sender.length > 254
      || !isEmail(sender) || !validResetBaseUrl(baseUrl) || (password && !username)) {
    httpError(400, "Sprawdź serwer, port, nadawcę i adres aplikacji w ustawieniach SMTP.");
  }
  return {
    reset_smtp_host: host,
    reset_smtp_port: String(port),
    reset_smtp_security: security,
    reset_smtp_username: username,
    reset_smtp_sender: sender,
    reset_base_url: `${baseUrl.replace(/\/+$/, "")}/`,
    password,
  };
}

async function saveAdminSettings(payload) {
  const webhookKeys = ["discord_webhook_url"];
  const smtpKeys = [
    "reset_smtp_host", "reset_smtp_port", "reset_smtp_security", "reset_smtp_username",
    "reset_smtp_password", "reset_smtp_sender", "reset_base_url",
  ];
  const keys = Object.keys(payload).sort();
  const includesSmtp = keys.length === webhookKeys.length + smtpKeys.length
    && [...webhookKeys, ...smtpKeys].every((key) => keys.includes(key));
  if (!includesSmtp && !(keys.length === 1 && keys[0] === webhookKeys[0])) {
    httpError(400, "Żądanie zawiera nieoczekiwane ustawienia.");
  }
  const webhookUrl = payload.discord_webhook_url;
  if (typeof webhookUrl !== "string" || (webhookUrl && !validDiscordWebhookUrl(webhookUrl))) {
    httpError(400, "Wklej prawidłowy adres webhooka Discorda lub zostaw pole puste, aby go usunąć.");
  }
  let smtpValues;
  let encryptedPassword;
  let clearPassword = false;
  if (includesSmtp) {
    smtpValues = validSmtpSettings(payload);
    const existing = await getSettings();
    if (smtpValues) {
      if (smtpValues.reset_smtp_username) {
        if (smtpValues.password) encryptedPassword = encryptSecret(smtpValues.password);
        else if (!existing.reset_smtp_password) httpError(400, "Wpisz hasło do konta SMTP albo usuń login SMTP.");
      } else if (existing.reset_smtp_password) {
        clearPassword = true;
      }
      delete smtpValues.password;
    }
  }
  await transaction(async (client) => {
    if (webhookUrl) {
      await client.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES ('discord_webhook_url', $1)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
        [webhookUrl],
      );
    } else {
      await client.query("DELETE FROM app_settings WHERE setting_key = 'discord_webhook_url'");
    }
    if (includesSmtp) {
      if (!smtpValues) {
        await client.query("DELETE FROM app_settings WHERE setting_key LIKE 'reset_smtp_%' OR setting_key = 'reset_base_url'");
      } else {
        for (const [key, value] of Object.entries(smtpValues)) {
          await client.query(
            `INSERT INTO app_settings (setting_key, setting_value) VALUES ($1, $2)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
            [key, value],
          );
        }
        if (encryptedPassword) {
          await client.query(
            `INSERT INTO app_settings (setting_key, setting_value) VALUES ('reset_smtp_password', $1)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
            [encryptedPassword],
          );
        } else if (clearPassword) {
          await client.query("DELETE FROM app_settings WHERE setting_key = 'reset_smtp_password'");
        }
      }
    }
  });
  const settings = includesSmtp ? await getSettings() : {};
  return {
    saved: true,
    configured: Boolean(webhookUrl),
    password_reset_smtp: publicSmtpSettings(settings),
  };
}

async function register(payload, res) {
  const { username, password, email } = payload;
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    httpError(400, "Login powinien mieć 3–32 znaki: litery, cyfry, kropka, myślnik lub podkreślenie.");
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    httpError(400, "Hasło musi mieć od 8 do 128 znaków.");
  }
  if (typeof email !== "string" || email.length > 254 || !isEmail(email.trim())) {
    httpError(400, "Wpisz prawidłowy adres e-mail.");
  }
  const salt = randomBytes(16);
  const hash = await pbkdf2Async(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
  try {
    const account = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(741852963)");
      const count = await client.query("SELECT COUNT(*)::int AS count FROM accounts");
      const firstAdmin = count.rows[0].count === 0;
      const result = await client.query(
        `INSERT INTO accounts (username, password_salt, password_hash, profile_data, is_admin, approved, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $5, $6) RETURNING id, username, is_admin`,
        [
          username,
          salt,
          hash,
          JSON.stringify({ discordName: "", activisionId: "", email: email.trim(), avatar: "" }),
          firstAdmin,
          nowSeconds(),
        ],
      );
      return result.rows[0];
    });
    if (!account.is_admin) return { status: 202, payload: { authenticated: false, pending_approval: true } };
    await createSession(res, account.id);
    return { status: 201, payload: { authenticated: true, username: account.username, is_admin: true } };
  } catch (error) {
    if (error.code === "23505") httpError(409, "Ten login jest już zajęty.");
    throw error;
  }
}

async function login(payload, res) {
  const { username, password } = payload;
  if (typeof username !== "string" || typeof password !== "string" || password.length > 128) {
    httpError(401, "Nieprawidłowy login lub hasło.");
  }
  const result = await query(
    `SELECT id, username, password_salt, password_hash, approved, is_admin
       FROM accounts WHERE lower(username) = lower($1)`,
    [username.trim()],
  );
  const account = result.rows[0];
  if (!account) httpError(401, "Nieprawidłowy login lub hasło.");
  const candidate = await pbkdf2Async(password, account.password_salt, PASSWORD_ITERATIONS, 32, "sha256");
  if (candidate.length !== account.password_hash.length || !timingSafeEqual(candidate, account.password_hash)) {
    httpError(401, "Nieprawidłowy login lub hasło.");
  }
  if (!account.approved) httpError(403, "Twoje konto oczekuje na zatwierdzenie przez administratora.");
  await createSession(res, account.id);
  return { authenticated: true, username: account.username, is_admin: account.is_admin };
}

async function changePassword(req, payload, account) {
  const { current_password: currentPassword, new_password: newPassword } = payload;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    httpError(400, "Wpisz obecne i nowe hasło.");
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    httpError(400, "Nowe hasło musi mieć od 8 do 128 znaków.");
  }
  const result = await query("SELECT password_salt, password_hash FROM accounts WHERE id = $1", [account.id]);
  const current = result.rows[0];
  const candidate = current && await pbkdf2Async(currentPassword, current.password_salt, PASSWORD_ITERATIONS, 32, "sha256");
  if (!current || candidate.length !== current.password_hash.length || !timingSafeEqual(candidate, current.password_hash)) {
    httpError(401, "Obecne hasło jest nieprawidłowe.");
  }
  const salt = randomBytes(16);
  const hash = await pbkdf2Async(newPassword, salt, PASSWORD_ITERATIONS, 32, "sha256");
  await query("UPDATE accounts SET password_salt = $1, password_hash = $2 WHERE id = $3", [salt, hash, account.id]);
  return { changed: true };
}

async function requestPasswordReset(payload) {
  if (Object.keys(payload).length !== 1 || typeof payload.email !== "string"
      || payload.email.length > 254 || !isEmail(payload.email.trim())) {
    httpError(400, "Wpisz prawidłowy adres e-mail.");
  }
  const email = payload.email.trim();
  const accountResult = await query(
    `SELECT id, username FROM accounts
      WHERE lower(profile_data->>'email') = lower($1) LIMIT 1`,
    [email],
  );
  const settings = await getSettings();
  if (!accountResult.rows[0] || !publicSmtpSettings(settings).configured) {
    return {
      requested: true,
      message: "Jeśli konto z tym adresem istnieje, wyślemy na niego link do zmiany hasła.",
    };
  }
  const account = accountResult.rows[0];
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  const now = nowSeconds();
  const reserved = await transaction(async (client) => {
    const locked = await client.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [account.id]);
    if (!locked.rowCount) return false;
    await client.query("DELETE FROM password_reset_tokens WHERE account_id = $1 AND expires_at <= $2", [account.id, now]);
    const existing = await client.query(
      "SELECT 1 FROM password_reset_tokens WHERE account_id = $1 AND expires_at > $2",
      [account.id, now],
    );
    if (existing.rowCount) return false;
    await client.query(
      "INSERT INTO password_reset_tokens (token_hash, account_id, expires_at) VALUES ($1, $2, $3)",
      [hash, account.id, now + PASSWORD_RESET_LIFETIME],
    );
    return true;
  });
  if (reserved) {
    try {
      const password = settings.reset_smtp_password ? decryptSecret(settings.reset_smtp_password) : "";
      const secure = settings.reset_smtp_security === "ssl";
      const transporter = nodemailer.createTransport({
        host: settings.reset_smtp_host,
        port: Number(settings.reset_smtp_port),
        secure,
        requireTLS: !secure,
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        ...(settings.reset_smtp_username ? {
          auth: { user: settings.reset_smtp_username, pass: password },
        } : {}),
      });
      const resetUrl = `${settings.reset_base_url.replace(/\/+$/, "")}/#reset=${token}`;
      await transporter.sendMail({
        from: settings.reset_smtp_sender,
        to: email,
        subject: "Reset hasła — Abyss Spin",
        text: `Cześć ${account.username},\n\nOtrzymaliśmy prośbę o zmianę hasła do konta Abyss Spin. Aby ustawić nowe hasło, otwórz ten jednorazowy link (ważny przez 30 minut):\n\n${resetUrl}\n\nJeśli nie prosiłeś o zmianę hasła, zignoruj tę wiadomość.\n`,
      });
    } catch (error) {
      console.error("Password reset email delivery failed:", error.name || "Error");
      await query("DELETE FROM password_reset_tokens WHERE token_hash = $1", [hash]);
    }
  }
  return {
    requested: true,
    message: "Jeśli konto z tym adresem istnieje, wyślemy na niego link do zmiany hasła.",
  };
}

async function resetPassword(payload) {
  if (Object.keys(payload).length !== 2 || typeof payload.token !== "string"
      || payload.token.length < 20 || payload.token.length > 128
      || !/^[A-Za-z0-9_-]+$/.test(payload.token)
      || typeof payload.new_password !== "string"
      || payload.new_password.length < 8 || payload.new_password.length > 128) {
    if (typeof payload.new_password === "string"
        && (payload.new_password.length < 8 || payload.new_password.length > 128)) {
      httpError(400, "Hasło musi mieć od 8 do 128 znaków.");
    }
    httpError(400, "Link jest nieprawidłowy lub wygasł. Poproś o nowy.");
  }
  const hash = tokenHash(payload.token);
  const salt = randomBytes(16);
  const passwordHash = await pbkdf2Async(payload.new_password, salt, PASSWORD_ITERATIONS, 32, "sha256");
  const changed = await transaction(async (client) => {
    const deleted = await client.query(
      "DELETE FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > $2 RETURNING account_id",
      [hash, nowSeconds()],
    );
    const accountId = deleted.rows[0]?.account_id;
    if (!accountId) return false;
    await client.query("UPDATE accounts SET password_salt = $1, password_hash = $2 WHERE id = $3", [salt, passwordHash, accountId]);
    await client.query("DELETE FROM password_reset_tokens WHERE account_id = $1", [accountId]);
    await client.query("DELETE FROM sessions WHERE account_id = $1", [accountId]);
    return true;
  });
  if (!changed) httpError(400, "Link jest nieprawidłowy lub wygasł. Poproś o nowy.");
  return { changed: true };
}

async function adminUsers() {
  const result = await query(
    `SELECT id, username, created_at, profile_data FROM accounts
      WHERE approved = FALSE ORDER BY created_at, id`,
  );
  return {
    users: result.rows.map((row) => ({
      id: parseId(row.id),
      username: row.username,
      email: row.profile_data.email || "",
      created_at: Number(row.created_at),
    })),
  };
}

async function adminUserAction(path) {
  const match = path.match(/^\/api\/admin\/users\/([1-9][0-9]*)\/(approve|reject)$/);
  if (!match) httpError(404, "Nie znaleziono endpointu.");
  const userId = Number(match[1]);
  return transaction(async (client) => {
    const result = await client.query(
      "SELECT id, username, approved, is_admin FROM accounts WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const user = result.rows[0];
    if (!user) httpError(404, "Nie znaleziono użytkownika.");
    if (user.is_admin) httpError(400, "Nie można zmienić statusu administratora.");
    if (user.approved) httpError(409, "To konto zostało już zatwierdzone.");
    if (match[2] === "approve") await client.query("UPDATE accounts SET approved = TRUE WHERE id = $1", [userId]);
    else await client.query("DELETE FROM accounts WHERE id = $1 AND approved = FALSE", [userId]);
    return { action: match[2], username: user.username };
  });
}

async function chatSnapshot(url) {
  const now = nowSeconds();
  const cutoff = now - 45;
  const rawAfter = url.searchParams.get("after");
  const afterId = rawAfter === null ? null : Number(rawAfter);
  if (afterId !== null && (!Number.isSafeInteger(afterId) || afterId < 0)) {
    httpError(400, "Nieprawidłowy identyfikator wiadomości.");
  }
  await query(
    "DELETE FROM chat_presence WHERE token_hash NOT IN (SELECT token_hash FROM sessions WHERE expires_at > $1)",
    [now],
  );
  const usersResult = await query(
    `SELECT accounts.username, accounts.profile_data,
            (online.account_id IS NOT NULL) AS is_online
       FROM accounts
       LEFT JOIN (
         SELECT DISTINCT chat_presence.account_id
           FROM chat_presence JOIN sessions ON sessions.token_hash = chat_presence.token_hash
          WHERE sessions.expires_at > $1 AND chat_presence.last_seen >= $2
       ) AS online ON online.account_id = accounts.id
      WHERE accounts.approved = TRUE
      ORDER BY (online.account_id IS NOT NULL) DESC, lower(accounts.username)`,
    [now, cutoff],
  );
  const messagesResult = afterId === null
    ? await query(
      `SELECT chat_messages.id, accounts.username, accounts.profile_data,
              chat_messages.message, chat_messages.created_at
         FROM chat_messages JOIN accounts ON accounts.id = chat_messages.account_id
        ORDER BY chat_messages.id DESC LIMIT 100`,
    )
    : await query(
      `SELECT chat_messages.id, accounts.username, accounts.profile_data,
              chat_messages.message, chat_messages.created_at
         FROM chat_messages JOIN accounts ON accounts.id = chat_messages.account_id
        WHERE chat_messages.id > $1 ORDER BY chat_messages.id LIMIT 200`,
      [afterId],
    );
  const messages = messagesResult.rows;
  if (afterId === null) messages.reverse();
  return {
    users: usersResult.rows.map((user) => ({
      username: user.username,
      display_name: displayName(user.profile_data, user.username),
      is_online: user.is_online,
    })),
    messages: messages.map((message) => ({
      id: parseId(message.id),
      username: message.username,
      display_name: displayName(message.profile_data, message.username),
      message: message.message,
      created_at: Number(message.created_at),
    })),
    server_time: now,
  };
}

async function publicUserProfile(account, url) {
  const username = (url.searchParams.get("username") || "").trim();
  if (!USERNAME_PATTERN.test(username)) httpError(400, "Wybierz prawidłowy profil użytkownika.");
  const result = await query(
    `SELECT id, username, profile_data FROM accounts
      WHERE lower(username) = lower($1) AND approved = TRUE`,
    [username],
  );
  const user = result.rows[0];
  if (!user) httpError(404, "Nie znaleziono użytkownika.");
  let relationship = null;
  if (String(user.id) !== String(account.id)) {
    const low = Math.min(Number(account.id), Number(user.id));
    const high = Math.max(Number(account.id), Number(user.id));
    relationship = (await query(
      "SELECT status, requester_id FROM friendships WHERE user_low = $1 AND user_high = $2",
      [low, high],
    )).rows[0] || null;
  }
  const presence = await query(
    `SELECT 1 FROM chat_presence JOIN sessions ON sessions.token_hash = chat_presence.token_hash
      WHERE chat_presence.account_id = $1 AND chat_presence.last_seen >= $2
        AND sessions.expires_at > $3 LIMIT 1`,
    [user.id, nowSeconds() - 45, nowSeconds()],
  );
  let status = "none";
  let direction = null;
  if (relationship?.status === "accepted") status = "friends";
  else if (relationship) {
    status = "pending";
    direction = String(relationship.requester_id) === String(account.id) ? "outgoing" : "incoming";
  }
  return {
    username: user.username,
    display_name: displayName(user.profile_data, user.username),
    activisionId: user.profile_data.activisionId || "",
    avatar: user.profile_data.avatar || "",
    is_online: presence.rowCount > 0,
    is_self: String(user.id) === String(account.id),
    friend_status: status,
    friend_direction: direction,
  };
}

async function friendsSnapshot(account) {
  const result = await query(
    `SELECT friendships.status, friendships.requester_id, friendships.created_at,
            accounts.username, accounts.profile_data
       FROM friendships
       JOIN accounts ON accounts.id = CASE
         WHEN friendships.user_low = $1 THEN friendships.user_high ELSE friendships.user_low END
      WHERE (friendships.user_low = $1 OR friendships.user_high = $1) AND accounts.approved = TRUE
      ORDER BY friendships.created_at DESC, lower(accounts.username)`,
    [account.id],
  );
  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const row of result.rows) {
    const item = {
      username: row.username,
      display_name: displayName(row.profile_data, row.username),
      avatar: row.profile_data.avatar || "",
      created_at: Number(row.created_at),
    };
    if (row.status === "accepted") friends.push(item);
    else if (String(row.requester_id) === String(account.id)) outgoing.push(item);
    else incoming.push(item);
  }
  return { friends, incoming, outgoing };
}

async function notificationsSnapshot(account, url) {
  const rawSince = url.searchParams.get("since");
  const since = rawSince === null ? nowSeconds() : Number(rawSince);
  if (!Number.isSafeInteger(since) || since < 0) httpError(400, "Nieprawidłowy czas powiadomień.");
  const snapshotTime = nowSeconds();
  const [friendResult, messageResult] = await Promise.all([
    query(
      `SELECT friendships.id, friendships.created_at, accounts.username, accounts.profile_data
         FROM friendships JOIN accounts ON accounts.id = friendships.requester_id
        WHERE friendships.status = 'pending' AND friendships.requester_id <> $1
          AND (friendships.user_low = $1 OR friendships.user_high = $1)
          AND friendships.created_at >= $2 AND accounts.approved = TRUE
        ORDER BY friendships.created_at, friendships.id LIMIT 50`,
      [account.id, since],
    ),
    query(
      `SELECT direct_messages.id, direct_messages.created_at, accounts.username, accounts.profile_data
         FROM direct_messages JOIN accounts ON accounts.id = direct_messages.sender_id
        WHERE direct_messages.recipient_id = $1 AND direct_messages.created_at >= $2
          AND accounts.approved = TRUE
          AND EXISTS (
            SELECT 1 FROM friendships
             WHERE friendships.status = 'accepted'
               AND friendships.user_low = LEAST(direct_messages.sender_id, direct_messages.recipient_id)
               AND friendships.user_high = GREATEST(direct_messages.sender_id, direct_messages.recipient_id)
          )
        ORDER BY direct_messages.created_at, direct_messages.id LIMIT 100`,
      [account.id, since],
    ),
  ]);
  const serialize = (row) => ({
    id: parseId(row.id),
    created_at: Number(row.created_at),
    username: row.username,
    display_name: displayName(row.profile_data, row.username),
  });
  return {
    friend_requests: friendResult.rows.map(serialize),
    messages: messageResult.rows.map(serialize),
    server_time: snapshotTime,
  };
}

async function getFriend(account, username) {
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username.trim())) {
    httpError(400, "Wybierz prawidłowego znajomego.");
  }
  const result = await query(
    "SELECT id, username FROM accounts WHERE lower(username) = lower($1) AND approved = TRUE",
    [username.trim()],
  );
  const target = result.rows[0];
  if (!target) httpError(404, "Nie znaleziono tego znajomego.");
  if (String(target.id) === String(account.id)) httpError(400, "Nie możesz wysłać wiadomości do siebie.");
  const relationship = await query(
    `SELECT 1 FROM friendships
      WHERE user_low = LEAST($1::bigint, $2::bigint)
        AND user_high = GREATEST($1::bigint, $2::bigint)
        AND status = 'accepted'`,
    [account.id, target.id],
  );
  if (!relationship.rowCount) httpError(403, "Prywatne wiadomości są dostępne tylko między znajomymi.");
  return target;
}

async function directMessagesSnapshot(account, url) {
  const username = (url.searchParams.get("username") || "").trim();
  const rawAfter = url.searchParams.get("after");
  const after = rawAfter === null ? null : Number(rawAfter);
  if (after !== null && (!Number.isSafeInteger(after) || after < 0)) {
    httpError(400, "Nieprawidłowy identyfikator wiadomości.");
  }
  const target = await getFriend(account, username);
  const params = [account.id, target.id];
  const afterClause = after === null ? "" : "AND direct_messages.id > $3";
  if (after !== null) params.push(after);
  let result = await query(
    `SELECT direct_messages.id, direct_messages.sender_id, direct_messages.message, direct_messages.created_at,
            accounts.username, accounts.profile_data
       FROM direct_messages JOIN accounts ON accounts.id = direct_messages.sender_id
      WHERE ((direct_messages.sender_id = $1 AND direct_messages.recipient_id = $2)
          OR (direct_messages.sender_id = $2 AND direct_messages.recipient_id = $1))
        ${afterClause}
      ORDER BY direct_messages.id ${after === null ? "DESC" : "ASC"} LIMIT ${after === null ? 100 : 200}`,
    params,
  );
  if (after === null) result.rows.reverse();
  return {
    messages: result.rows.map((row) => ({
      id: parseId(row.id),
      username: row.username,
      display_name: displayName(row.profile_data, row.username),
      message: row.message,
      created_at: Number(row.created_at),
    })),
  };
}

async function sendDirectMessage(account, payload) {
  if (Object.keys(payload).length !== 2 || typeof payload.username !== "string") {
    httpError(400, "Wiadomość musi zawierać znajomego i treść.");
  }
  if (typeof payload.message !== "string" || !payload.message.trim() || payload.message.length > 500) {
    httpError(400, "Wiadomość musi zawierać od 1 do 500 znaków.");
  }
  const target = await getFriend(account, payload.username);
  const createdAt = nowSeconds();
  const message = payload.message.trim();
  const result = await transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, message, created_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [account.id, target.id, message, createdAt],
    );
    await client.query(
      `DELETE FROM direct_messages
        WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
          AND id NOT IN (
            SELECT id FROM direct_messages
             WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
             ORDER BY id DESC LIMIT 2000
          )`,
      [account.id, target.id],
    );
    return inserted.rows[0];
  });
  return {
    message: {
      id: parseId(result.id),
      username: account.username,
      display_name: displayName(account.profile_data, account.username),
      message,
      created_at: createdAt,
    },
  };
}

async function friendAction(account, action, payload) {
  if (typeof payload.username !== "string" || !USERNAME_PATTERN.test(payload.username.trim())) {
    httpError(400, "Wybierz prawidłowego użytkownika.");
  }
  const result = await query(
    "SELECT id, username FROM accounts WHERE lower(username) = lower($1) AND approved = TRUE",
    [payload.username.trim()],
  );
  const target = result.rows[0];
  if (!target) httpError(404, "Nie znaleziono użytkownika.");
  if (String(target.id) === String(account.id)) httpError(400, "Nie możesz wysłać zaproszenia do siebie.");
  const low = Math.min(Number(account.id), Number(target.id));
  const high = Math.max(Number(account.id), Number(target.id));
  try {
    return await transaction(async (client) => {
      const relationshipResult = await client.query(
        "SELECT id, requester_id, status FROM friendships WHERE user_low = $1 AND user_high = $2 FOR UPDATE",
        [low, high],
      );
      const relationship = relationshipResult.rows[0];
      if (action === "request") {
        if (relationship) {
          if (relationship.status === "accepted") httpError(409, "Jesteście już znajomymi.");
          if (String(relationship.requester_id) === String(account.id)) httpError(409, "Zaproszenie do tego użytkownika już oczekuje na odpowiedź.");
          httpError(409, "Ten użytkownik wysłał Ci już zaproszenie. Zaakceptuj je w zakładce Znajomi.");
        }
        await client.query(
          `INSERT INTO friendships (user_low, user_high, requester_id, status, created_at)
           VALUES ($1, $2, $3, 'pending', $4)`,
          [low, high, account.id, nowSeconds()],
        );
        return { status: 201, payload: { action, username: target.username } };
      }
      if (!relationship) httpError(404, "Nie ma zaproszenia ani znajomości z tym użytkownikiem.");
      if (action === "accept" || action === "reject") {
        if (relationship.status !== "pending") httpError(409, "Zaproszenie zostało już rozpatrzone.");
        if (action === "accept" && String(relationship.requester_id) === String(account.id)) {
          httpError(403, "Możesz zaakceptować tylko zaproszenie otrzymane od użytkownika.");
        }
        await client.query("DELETE FROM friendships WHERE id = $1", [relationship.id]);
        if (action === "accept") {
          await client.query(
            `INSERT INTO friendships (user_low, user_high, requester_id, status, created_at)
             VALUES ($1, $2, $3, 'accepted', $4)`,
            [low, high, account.id, nowSeconds()],
          );
        }
        return { status: 200, payload: { action, username: target.username } };
      }
      if (action === "remove") {
        if (relationship.status === "pending" && String(relationship.requester_id) !== String(account.id)) {
          httpError(403, "Otrzymane zaproszenie zaakceptuj lub odrzuć.");
        }
        await client.query("DELETE FROM friendships WHERE id = $1", [relationship.id]);
        return { status: 200, payload: { action, username: target.username } };
      }
      httpError(404, "Nieznana operacja na znajomości.");
    });
  } catch (error) {
    if (error.code === "23505" && action === "request") httpError(409, "Zaproszenie do tego użytkownika już oczekuje na odpowiedź.");
    throw error;
  }
}

async function sendChatMessage(account, payload) {
  if (typeof payload.message !== "string" || !payload.message.trim() || payload.message.length > 500) {
    httpError(400, "Wiadomość musi zawierać od 1 do 500 znaków.");
  }
  const message = payload.message.trim();
  const createdAt = nowSeconds();
  const inserted = await transaction(async (client) => {
    const result = await client.query(
      "INSERT INTO chat_messages (account_id, message, created_at) VALUES ($1, $2, $3) RETURNING id",
      [account.id, message, createdAt],
    );
    await client.query("DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 2000)");
    return result.rows[0];
  });
  return {
    message: {
      id: parseId(inserted.id),
      username: account.username,
      display_name: displayName(account.profile_data, account.username),
      message,
      created_at: createdAt,
    },
  };
}

async function awardRotationExperience(account, payload) {
  if (Object.keys(payload).length !== 1 || typeof payload.rotation_id !== "string") {
    httpError(400, "Nieprawidłowe dane rotacji.");
  }
  if (!ROTATION_ID_PATTERN.test(payload.rotation_id)) httpError(400, "Nieprawidłowy identyfikator rotacji.");
  const result = await query("SELECT app_data FROM accounts WHERE id = $1", [account.id]);
  const history = result.rows[0]?.app_data?.history || [];
  if (!history.some((rotation) => rotation && rotation.id === payload.rotation_id)) {
    httpError(409, "Zapisz rotację przed odebraniem EXP.");
  }
  const awarded = await query(
    `INSERT INTO rotation_experience (account_id, rotation_id, created_at)
     VALUES ($1, $2, $3) ON CONFLICT (account_id, rotation_id) DO NOTHING RETURNING id`,
    [account.id, payload.rotation_id, nowSeconds()],
  );
  return {
    awarded: awarded.rowCount === 1,
    earned_experience: awarded.rowCount === 1 ? 5 : 0,
    ...(await experienceSummary(account.id)),
  };
}

async function sendRotationWebhook(payload) {
  if (Object.keys(payload).length !== 2 || !("rotation" in payload) || !("image" in payload)) {
    httpError(400, "Żądanie musi zawierać rotację i jej grafikę PNG.");
  }
  const result = await query("SELECT setting_value FROM app_settings WHERE setting_key = 'discord_webhook_url'");
  const webhookUrl = result.rows[0]?.setting_value || "";
  if (!validDiscordWebhookUrl(webhookUrl)) httpError(400, "Administrator nie skonfigurował jeszcze webhooka Discorda.");
  let embed;
  try {
    embed = buildDiscordRotationEmbed(payload.rotation);
  } catch (error) {
    httpError(400, error.message);
  }
  const match = typeof payload.image === "string"
    ? payload.image.match(/^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/)
    : null;
  if (!match) httpError(400, "Wygenerowana grafika nie jest prawidłowym plikiem PNG.");
  const image = Buffer.from(match[1], "base64");
  if (image.toString("base64") !== match[1]) httpError(400, "Nie udało się odczytać grafiki PNG.");
  if (!image.length || image.length > MAX_WEBHOOK_IMAGE_SIZE
      || !image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    httpError(400, "Grafika PNG jest nieprawidłowa albo przekracza limit 6 MB.");
  }
  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    embeds: [embed],
    attachments: [{ id: 0, filename: "abyss-spin-rotacja.png" }],
    allowed_mentions: { parse: [] },
  }));
  form.append("files[0]", new Blob([image], { type: "image/png" }), "abyss-spin-rotacja.png");
  let response;
  try {
    response = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "User-Agent": "AbyssSpin/1.0" },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    httpError(502, "Nie udało się połączyć z Discordem. Sprawdź połączenie z internetem.");
  }
  if (!response.ok) {
    if (response.status === 429) httpError(502, "Discord ograniczył liczbę wiadomości. Odczekaj chwilę i spróbuj ponownie.");
    if (response.status >= 300 && response.status < 400) httpError(502, "Discord nie zaakceptował adresu webhooka.");
    httpError(502, "Discord odrzucił wiadomość. Sprawdź, czy webhook jest aktywny.");
  }
  return { sent: true };
}

async function handleGet(path, url, req) {
  if (path === "/api/auth/session") {
    const account = await authenticatedAccount(req);
    const hasAccounts = await query("SELECT EXISTS (SELECT 1 FROM accounts) AS value");
    return {
      authenticated: Boolean(account),
      username: account?.username || null,
      is_admin: Boolean(account?.is_admin),
      has_accounts: hasAccounts.rows[0].value,
    };
  }
  if (path === "/api/admin/users") {
    await requireAdmin(req);
    return adminUsers();
  }
  if (path === "/api/admin/settings") {
    await requireAdmin(req);
    const settings = await getSettings();
    return {
      discord_webhook_url: settings.discord_webhook_url || "",
      password_reset_smtp: publicSmtpSettings(settings),
    };
  }
  if (![
    "/api/data", "/api/profile", "/api/chat", "/api/friends",
    "/api/notifications", "/api/friends/messages", "/api/user",
  ].includes(path)) {
    httpError(404, "Nie znaleziono endpointu.");
  }
  const account = await requireAccount(req);
  if (path === "/api/data") return account.app_data;
  if (path === "/api/profile") return { ...profileWithExperience(account), ...(await experienceSummary(account.id)) };
  if (path === "/api/chat") return chatSnapshot(url);
  if (path === "/api/friends") return friendsSnapshot(account);
  if (path === "/api/notifications") return notificationsSnapshot(account, url);
  if (path === "/api/friends/messages") return directMessagesSnapshot(account, url);
  if (path === "/api/user") return publicUserProfile(account, url);
  httpError(404, "Nie znaleziono endpointu.");
}

async function handlePost(path, url, req, res) {
  checkOrigin(req);
  const adminUserPath = path.startsWith("/api/admin/users/");
  const allowedPaths = [
    "/api/auth/register", "/api/auth/login", "/api/auth/logout",
    "/api/auth/change-password", "/api/auth/request-password-reset",
    "/api/auth/reset-password", "/api/admin/settings", "/api/chat/presence",
    "/api/chat/messages", "/api/friends/messages", "/api/friends/request",
    "/api/friends/accept", "/api/friends/reject", "/api/friends/remove",
    "/api/rotation/webhook", "/api/experience/rotation",
  ];
  if (!adminUserPath && !allowedPaths.includes(path)) httpError(404, "Nie znaleziono endpointu.");
  const bodyLimit = path === "/api/rotation/webhook" ? MAX_WEBHOOK_REQUEST_SIZE : MAX_REQUEST_SIZE;
  const payload = await readJson(req, bodyLimit);
  if (path === "/api/auth/register") return register(payload, res);
  if (path === "/api/auth/login") return login(payload, res);
  if (path === "/api/auth/logout") {
    const token = readCookie(req);
    if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
    clearSessionCookie(res);
    return { authenticated: false };
  }
  if (path === "/api/auth/change-password") return changePassword(req, payload, await requireAccount(req));
  if (path === "/api/auth/request-password-reset") return requestPasswordReset(payload);
  if (path === "/api/auth/reset-password") return resetPassword(payload);
  if (path === "/api/admin/settings") {
    await requireAdmin(req);
    return saveAdminSettings(payload);
  }
  if (adminUserPath) {
    await requireAdmin(req);
    return adminUserAction(path);
  }
  const account = await requireAccount(req);
  if (path === "/api/chat/presence") {
    const token = readCookie(req);
    if (!token) httpError(401, "Zaloguj się ponownie.");
    await query(
      `INSERT INTO chat_presence (token_hash, account_id, last_seen) VALUES ($1, $2, $3)
       ON CONFLICT(token_hash) DO UPDATE SET account_id = EXCLUDED.account_id, last_seen = EXCLUDED.last_seen`,
      [tokenHash(token), account.id, nowSeconds()],
    );
    return { online: true };
  }
  if (path === "/api/chat/messages") return { status: 201, payload: await sendChatMessage(account, payload) };
  if (path === "/api/friends/messages") return { status: 201, payload: await sendDirectMessage(account, payload) };
  if (path === "/api/friends/request" || path === "/api/friends/accept"
      || path === "/api/friends/reject" || path === "/api/friends/remove") {
    return friendAction(account, path.split("/").pop(), payload);
  }
  if (path === "/api/rotation/webhook") return sendRotationWebhook(payload);
  if (path === "/api/experience/rotation") return awardRotationExperience(account, payload);
  httpError(404, "Nie znaleziono endpointu.");
}

async function handlePut(path, req) {
  checkOrigin(req);
  if (path !== "/api/data" && path !== "/api/profile") httpError(404, "Nie znaleziono endpointu.");
  const account = await requireAccount(req);
  const payload = await readJson(req);
  if (path === "/api/profile") {
    if (!validProfileData(payload)) httpError(400, "Dane profilu są nieprawidłowe lub avatar jest za duży.");
    const profile = {
      discordName: (payload.discordName ?? "").trim(),
      activisionId: (payload.activisionId ?? "").trim(),
      email: (payload.email ?? "").trim(),
      avatar: payload.avatar ?? "",
    };
    await query("UPDATE accounts SET profile_data = $1::jsonb WHERE id = $2", [JSON.stringify(profile), account.id]);
    return {
      username: account.username,
      ...profile,
      ...(await experienceSummary(account.id)),
    };
  }
  if (!validAppData(payload)) httpError(400, "Dane składu mają nieprawidłowy format.");
  await query("UPDATE accounts SET app_data = $1::jsonb WHERE id = $2", [JSON.stringify(payload), account.id]);
  return { saved: true };
}

export async function handleApiRequest(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "GET") {
      const result = await handleGet(path, url, req);
      return res.status(200).json(await result);
    }
    if (req.method === "POST") {
      const result = await handlePost(path, url, req, res);
      if (result?.status && result?.payload) return res.status(result.status).json(result.payload);
      return res.status(200).json(result);
    }
    if (req.method === "PUT") return res.status(200).json(await handlePut(path, req));
    res.setHeader("Allow", "GET, POST, PUT");
    return res.status(405).json({ error: "Nieobsługiwana metoda żądania." });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error.code === "23505") return res.status(409).json({ error: "Ta operacja nie może zostać wykonana, ponieważ dane już istnieją." });
    if (error.code === "23503") return res.status(409).json({ error: "Nie można wykonać operacji na powiązanym koncie." });
    console.error("Abyss Spin API failure:", error.name || "Error", error.code || "");
    return res.status(500).json({ error: "Wystąpił błąd serwera. Spróbuj ponownie później." });
  }
}
