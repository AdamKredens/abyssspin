import { isIP } from "node:net";

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
export const ROTATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/;
const DISCORD_WEBHOOK_PATTERN = /^\/api\/webhooks\/[0-9]{17,20}\/[A-Za-z0-9._-]{20,200}\/?$/;

export function isEmail(value) {
  return typeof value === "string" && EMAIL_PATTERN.test(value);
}

export function validAppData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const { players, history, preferredSize = 4 } = data;
  if (!Array.isArray(players) || players.length > 500
      || !Array.isArray(history) || history.length > 1000
      || ![3, 4].includes(preferredSize)
      || players.some((name) => typeof name !== "string" || !name.trim() || name.length > 32)) return false;
  return history.every((rotation) => {
    if (!rotation || typeof rotation !== "object" || Array.isArray(rotation)
        || typeof rotation.date !== "string" || rotation.date.length > 40
        || ("id" in rotation && (typeof rotation.id !== "string" || !ROTATION_ID_PATTERN.test(rotation.id)))
        || !Array.isArray(rotation.teams) || rotation.teams.length > 200) return false;
    if (rotation.leaders != null && (!Array.isArray(rotation.leaders)
        || rotation.leaders.length !== rotation.teams.length
        || rotation.leaders.some((leader, index) => typeof leader !== "string"
          || leader.length > 32 || !Array.isArray(rotation.teams[index])
          || !rotation.teams[index].includes(leader)))) return false;
    return rotation.teams.every((team) => Array.isArray(team) && team.length <= 4
      && team.every((name) => typeof name === "string" && name.length <= 32));
  });
}

export function validProfileData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const discordName = data.discordName === undefined ? "" : data.discordName;
  const activisionId = data.activisionId === undefined ? "" : data.activisionId;
  const email = data.email === undefined ? "" : data.email;
  const avatar = data.avatar === undefined ? "" : data.avatar;
  if (typeof discordName !== "string" || discordName.length > 48
      || typeof activisionId !== "string" || activisionId.length > 64
      || typeof email !== "string" || email.length > 254
      || (email && !isEmail(email))
      || typeof avatar !== "string" || avatar.length > 700_000) return false;
  if (!avatar) return true;
  const match = avatar.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match) return false;
  let image;
  try {
    image = Buffer.from(match[2], "base64");
    if (image.toString("base64") !== match[2] || image.length === 0 || image.length > 512_000) return false;
  } catch {
    return false;
  }
  if (match[1] === "jpeg") return image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (match[1] === "png") return image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return image.subarray(0, 4).toString() === "RIFF" && image.subarray(8, 12).toString() === "WEBP";
}

export function validDiscordWebhookUrl(value) {
  if (typeof value !== "string" || !value || value.length > 512 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "discord.com"
      && !url.username && !url.password && (!url.port || url.port === "443")
      && !url.search && !url.hash && DISCORD_WEBHOOK_PATTERN.test(url.pathname);
  } catch {
    return false;
  }
}

export function validResetBaseUrl(value) {
  if (typeof value !== "string" || !value || value.length > 512 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname
        || url.username || url.password || url.search || url.hash
        || !["", "/"].includes(url.pathname)
        || (url.port && (+url.port < 1 || +url.port > 65535))) return false;
    if (url.protocol === "http:") {
      const host = url.hostname.toLowerCase();
      const ipVersion = isIP(host);
      const privateAddress = ipVersion === 4
        ? /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
        : ipVersion === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"));
      if (host !== "localhost" && !host.endsWith(".local") && !privateAddress) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function buildDiscordRotationEmbed(rotation) {
  if (!rotation || typeof rotation !== "object" || Array.isArray(rotation)) throw new Error("Nieprawidłowa rotacja.");
  const { teams, leaders, date: dateValue } = rotation;
  if (!Array.isArray(teams) || teams.length < 1 || teams.length > 200) {
    throw new Error("Rotacja musi zawierać od 1 do 200 drużyn.");
  }
  if (leaders !== undefined && (!Array.isArray(leaders) || leaders.length !== teams.length
      || leaders.some((leader) => typeof leader !== "string"))) {
    throw new Error("Nieprawidłowe dane liderów.");
  }
  const seen = new Set();
  for (const [index, team] of teams.entries()) {
    if (!Array.isArray(team) || ![3, 4].includes(team.length)) throw new Error("Każda drużyna musi zawierać 3 lub 4 graczy.");
    if (team.some((player) => typeof player !== "string" || !player.trim() || player.length > 32
        || [...player].some((char) => char.charCodeAt(0) < 32))) throw new Error("Rotacja zawiera nieprawidłową nazwę gracza.");
    const folded = team.map((player) => player.toLocaleLowerCase("und"));
    if (new Set(folded).size !== folded.length || folded.some((player) => seen.has(player))) {
      throw new Error("Gracz może wystąpić tylko raz w rotacji.");
    }
    folded.forEach((player) => seen.add(player));
    const leader = leaders?.[index] ?? team[0];
    if (typeof leader !== "string" || !team.some((player) => player.toLocaleLowerCase("und") === leader.toLocaleLowerCase("und"))) {
      throw new Error("Lider musi należeć do swojej drużyny.");
    }
  }
  if (typeof dateValue !== "string" || Number.isNaN(Date.parse(dateValue))) throw new Error("Rotacja nie zawiera prawidłowej daty.");
  return {
    title: "ROTACJA DRUŻYN",
    description: "Każdy gracz występuje tylko raz w tej rotacji",
    color: 0x5865f2,
    image: { url: "attachment://abyss-spin-rotacja.png" },
    footer: { text: "Abyss Spin · Call of Duty: Warzone" },
    timestamp: new Date(dateValue).toISOString(),
  };
}
