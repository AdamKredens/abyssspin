import argparse
import base64
import binascii
import ctypes
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import threading
import time
from http.cookies import CookieError, SimpleCookie
from contextlib import contextmanager
from datetime import datetime
from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


APP_DIRECTORY = Path(__file__).resolve().parent
DATA_DIRECTORY = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "AbyssSpin"
DATABASE_PATH = DATA_DIRECTORY / "abyssspin.sqlite3"
COOKIE_NAME = "abyssspin_session"
SESSION_LIFETIME = 30 * 24 * 60 * 60
PASSWORD_ITERATIONS = 600_000
MAX_REQUEST_SIZE = 1_000_000
MAX_WEBHOOK_IMAGE_SIZE = 6 * 1024 * 1024
MAX_WEBHOOK_REQUEST_SIZE = 8_500_000
PASSWORD_RESET_LIFETIME = 30 * 60
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+")
DISCORD_WEBHOOK_PATTERN = re.compile(
    r"^/api/webhooks/[0-9]{17,20}/[A-Za-z0-9._-]{20,200}/?$"
)
ROTATION_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def valid_discord_webhook_url(value):
    if not isinstance(value, str) or not value or len(value) > 512 or any(char.isspace() for char in value):
        return False
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname == "discord.com"
        and parsed.username is None
        and parsed.password is None
        and port in (None, 443)
        and not parsed.query
        and not parsed.fragment
        and DISCORD_WEBHOOK_PATTERN.fullmatch(parsed.path) is not None
    )


def valid_reset_base_url(value):
    if not isinstance(value, str) or not value or len(value) > 512 or any(char.isspace() for char in value):
        return False
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    try:
        address = ipaddress.ip_address(parsed.hostname) if parsed.hostname else None
    except ValueError:
        address = None
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
        or port is not None and not 1 <= port <= 65535
    ):
        return False
    if parsed.scheme == "http" and not (
        parsed.hostname.lower() == "localhost"
        or parsed.hostname.lower().endswith(".local")
        or address is not None and (address.is_private or address.is_loopback or address.is_link_local)
    ):
        return False
    return True


def protect_smtp_password(password):
    if os.name != "nt":
        raise OSError("Szyfrowanie hasła SMTP wymaga Windows.")
    raw = password.encode("utf-8")
    source_buffer = ctypes.create_string_buffer(raw)
    source = _DataBlob(len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)))
    encrypted = _DataBlob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(_DataBlob),
        ctypes.c_wchar_p,
        ctypes.POINTER(_DataBlob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.POINTER(_DataBlob),
    ]
    crypt32.CryptProtectData.restype = ctypes.c_int
    if not crypt32.CryptProtectData(
        ctypes.byref(source), "Abyss Spin SMTP password", None, None, None, 1, ctypes.byref(encrypted)
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        protected = ctypes.string_at(encrypted.pbData, encrypted.cbData)
        return "dpapi:" + base64.b64encode(protected).decode("ascii")
    finally:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p
        kernel32.LocalFree(encrypted.pbData)


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def unprotect_smtp_password(value):
    if not value.startswith("dpapi:") or os.name != "nt":
        raise OSError("Nie można odszyfrować hasła SMTP zapisanego przez Windows.")
    encrypted_bytes = base64.b64decode(value[6:], validate=True)
    source_buffer = ctypes.create_string_buffer(encrypted_bytes)
    source = _DataBlob(
        len(encrypted_bytes), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte))
    )
    decrypted = _DataBlob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(_DataBlob),
        ctypes.POINTER(ctypes.c_wchar_p),
        ctypes.POINTER(_DataBlob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.POINTER(_DataBlob),
    ]
    crypt32.CryptUnprotectData.restype = ctypes.c_int
    if not crypt32.CryptUnprotectData(
        ctypes.byref(source), None, None, None, None, 1, ctypes.byref(decrypted)
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(decrypted.pbData, decrypted.cbData).decode("utf-8")
    finally:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p
        kernel32.LocalFree(decrypted.pbData)


def load_password_reset_smtp_settings():
    with connect_database() as connection:
        rows = connection.execute(
            """
            SELECT setting_key, setting_value FROM app_settings
            WHERE setting_key LIKE 'reset_smtp_%' OR setting_key = 'reset_base_url'
            """
        ).fetchall()
    return {row["setting_key"]: row["setting_value"] for row in rows}


def public_password_reset_smtp_settings(settings):
    return {
        "host": settings.get("reset_smtp_host", ""),
        "port": settings.get("reset_smtp_port", "587"),
        "security": settings.get("reset_smtp_security", "starttls"),
        "username": settings.get("reset_smtp_username", ""),
        "sender": settings.get("reset_smtp_sender", ""),
        "base_url": settings.get("reset_base_url", ""),
        "password_configured": bool(settings.get("reset_smtp_password")),
        "configured": bool(
            settings.get("reset_smtp_host")
            and settings.get("reset_smtp_sender")
            and settings.get("reset_base_url")
        ),
    }


def send_password_reset_email(settings, email, username, token):
    password = settings.get("reset_smtp_password", "")
    if password:
        password = unprotect_smtp_password(password)
    message = EmailMessage()
    message["Subject"] = "Reset hasła — Abyss Spin"
    message["From"] = settings["reset_smtp_sender"]
    message["To"] = email
    reset_url = f"{settings['reset_base_url'].rstrip('/')}#reset={token}"
    message.set_content(
        f"Cześć {username},\n\n"
        "Otrzymaliśmy prośbę o zmianę hasła do konta Abyss Spin. "
        f"Aby ustawić nowe hasło, otwórz ten jednorazowy link (ważny przez 30 minut):\n\n"
        f"{reset_url}\n\n"
        "Jeśli nie prosiłeś o zmianę hasła, zignoruj tę wiadomość.\n"
    )
    host = settings["reset_smtp_host"]
    port = int(settings["reset_smtp_port"])
    context = ssl.create_default_context()
    smtp_class = smtplib.SMTP_SSL if settings["reset_smtp_security"] == "ssl" else smtplib.SMTP
    connection = (
        smtp_class(host, port, timeout=20, context=context)
        if smtp_class is smtplib.SMTP_SSL
        else smtp_class(host, port, timeout=20)
    )
    with connection as smtp:
        if settings["reset_smtp_security"] == "starttls":
            smtp.starttls(context=context)
            smtp.ehlo()
        username = settings.get("reset_smtp_username", "")
        if username:
            smtp.login(username, password)
        smtp.send_message(message)


def deliver_password_reset_email(settings, email, username, token, token_hash):
    try:
        send_password_reset_email(settings, email, username, token)
    except (OSError, smtplib.SMTPException, ValueError, UnicodeError) as error:
        print(f"Password reset email delivery failed: {type(error).__name__}")
        with connect_database() as connection:
            connection.execute(
                "DELETE FROM password_reset_tokens WHERE token_hash = ?", (token_hash,)
            )


def build_discord_rotation_embed(rotation):
    if not isinstance(rotation, dict):
        raise ValueError("Nieprawidłowa rotacja.")
    teams = rotation.get("teams")
    if not isinstance(teams, list) or not 1 <= len(teams) <= 200:
        raise ValueError("Rotacja musi zawierać od 1 do 200 drużyn.")
    leaders = rotation.get("leaders")
    if leaders is not None and (
        not isinstance(leaders, list)
        or len(leaders) != len(teams)
        or any(not isinstance(leader, str) for leader in leaders)
    ):
        raise ValueError("Nieprawidłowe dane liderów.")

    seen_players = set()
    for index, team in enumerate(teams):
        if not isinstance(team, list) or len(team) not in (3, 4):
            raise ValueError("Każda drużyna musi zawierać 3 lub 4 graczy.")
        if any(
            not isinstance(player, str)
            or not player.strip()
            or len(player) > 32
            or any(ord(char) < 32 for char in player)
            for player in team
        ):
            raise ValueError("Rotacja zawiera nieprawidłową nazwę gracza.")
        team_players = {player.casefold() for player in team}
        if len(team_players) != len(team) or any(player in seen_players for player in team_players):
            raise ValueError("Gracz może wystąpić tylko raz w rotacji.")
        seen_players.update(team_players)

        leader = leaders[index] if leaders else team[0]
        matching_leader = next((player for player in team if player.casefold() == leader.casefold()), None)
        if matching_leader is None:
            raise ValueError("Lider musi należeć do swojej drużyny.")

    date_value = rotation.get("date")
    if not isinstance(date_value, str):
        raise ValueError("Rotacja nie zawiera prawidłowej daty.")
    try:
        date = datetime.fromisoformat(date_value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Rotacja nie zawiera prawidłowej daty.") from None

    return {
        "title": "ROTACJA DRUŻYN",
        "description": "Każdy gracz występuje tylko raz w tej rotacji",
        "color": 0x5865F2,
        "image": {"url": "attachment://abyss-spin-rotacja.png"},
        "footer": {"text": "Abyss Spin · Call of Duty: Warzone"},
        "timestamp": date.isoformat(),
    }


@contextmanager
def connect_database():
    connection = sqlite3.connect(DATABASE_PATH, timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database():
    DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
    with connect_database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                app_data TEXT NOT NULL DEFAULT '{"players":[],"history":[],"preferredSize":4}',
                profile_data TEXT NOT NULL DEFAULT '{"discordName":"","activisionId":"","email":"","avatar":""}',
                is_admin INTEGER NOT NULL DEFAULT 0,
                approved INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL
            )
            """
        )
        account_columns = {row["name"] for row in connection.execute("PRAGMA table_info(accounts)")}
        if "profile_data" not in account_columns:
            connection.execute(
                """ALTER TABLE accounts ADD COLUMN profile_data TEXT NOT NULL
                DEFAULT '{"discordName":"","activisionId":"","email":"","avatar":""}'"""
            )
        else:
            connection.execute(
                """UPDATE accounts
                SET profile_data = json_set(profile_data, '$.email', '')
                WHERE json_valid(profile_data) AND json_type(profile_data, '$.email') IS NULL"""
            )
        if "is_admin" not in account_columns:
            connection.execute("ALTER TABLE accounts ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        if "approved" not in account_columns:
            connection.execute("ALTER TABLE accounts ADD COLUMN approved INTEGER NOT NULL DEFAULT 1")
        connection.execute("UPDATE accounts SET is_admin = 1 WHERE username = 'admin' COLLATE NOCASE")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                token_hash TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry ON password_reset_tokens(expires_at)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_presence (
                token_hash TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL,
                last_seen INTEGER NOT NULL
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS chat_presence_account ON chat_presence(account_id, last_seen)")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS chat_messages_created ON chat_messages(id)")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS rotation_experience (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                rotation_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE (account_id, rotation_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS direct_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                recipient_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                message TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS direct_messages_sender_recipient ON direct_messages(sender_id, recipient_id, id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS direct_messages_recipient_sender ON direct_messages(recipient_id, sender_id, id)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS friendships (
                id INTEGER PRIMARY KEY,
                user_low INTEGER NOT NULL,
                user_high INTEGER NOT NULL,
                requester_id INTEGER NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
                created_at INTEGER NOT NULL,
                CHECK (user_low < user_high),
                CHECK (requester_id = user_low OR requester_id = user_high),
                UNIQUE (user_low, user_high)
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS friendships_user_low ON friendships(user_low, status)")
        connection.execute("CREATE INDEX IF NOT EXISTS friendships_user_high ON friendships(user_high, status)")
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
        connection.execute(
            "DELETE FROM password_reset_tokens WHERE expires_at <= ?", (int(time.time()),)
        )


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)

def experience_summary(connection, account_id):
    completed_rotations = connection.execute(
        "SELECT COUNT(*) FROM rotation_experience WHERE account_id = ?",
        (account_id,),
    ).fetchone()[0]
    total_experience = completed_rotations * 5
    experience_in_level = total_experience % 100
    return {
        "total_experience": total_experience,
        "level": total_experience // 100 + 1,
        "experience_in_level": experience_in_level,
        "experience_to_next_level": 100,
        "progress_percent": experience_in_level,
    }


def valid_app_data(data):
    if not isinstance(data, dict):
        return False
    players = data.get("players")
    history = data.get("history")
    preferred_size = data.get("preferredSize", 4)
    if not isinstance(players, list) or len(players) > 500 or not isinstance(history, list) or len(history) > 1000:
        return False
    if preferred_size not in (3, 4) or any(not isinstance(name, str) or not name.strip() or len(name) > 32 for name in players):
        return False
    for rotation in history:
        if not isinstance(rotation, dict) or not isinstance(rotation.get("date"), str) or len(rotation["date"]) > 40:
            return False
        if "id" in rotation and (
            not isinstance(rotation["id"], str) or not ROTATION_ID_PATTERN.fullmatch(rotation["id"])
        ):
            return False
        teams = rotation.get("teams")
        if not isinstance(teams, list) or len(teams) > 200:
            return False
        leaders = rotation.get("leaders")
        if leaders is not None and (
            not isinstance(leaders, list)
            or len(leaders) != len(teams)
            or any(
                not isinstance(leader, str)
                or len(leader) > 32
                or leader not in team
                for leader, team in zip(leaders, teams)
            )
        ):
            return False
        for team in teams:
            if not isinstance(team, list) or len(team) > 4:
                return False
            if any(not isinstance(name, str) or len(name) > 32 for name in team):
                return False
    return True


def valid_profile_data(data):
    if not isinstance(data, dict):
        return False
    discord_name = data.get("discordName", "")
    activision_id = data.get("activisionId", "")
    email = data.get("email", "")
    avatar = data.get("avatar", "")
    if not isinstance(discord_name, str) or len(discord_name) > 48:
        return False
    if not isinstance(activision_id, str) or len(activision_id) > 64:
        return False
    if not isinstance(email, str) or len(email) > 254:
        return False
    if email and not re.fullmatch(r"[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+", email):
        return False
    if not isinstance(avatar, str) or len(avatar) > 700_000:
        return False
    if not avatar:
        return True
    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})", avatar)
    if not match:
        return False
    try:
        image_data = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        return False
    if not image_data or len(image_data) > 512_000:
        return False
    mime = match.group(1)
    if mime == "jpeg":
        return image_data.startswith(b"\xff\xd8\xff")
    if mime == "png":
        return image_data.startswith(b"\x89PNG\r\n\x1a\n")
    return image_data.startswith(b"RIFF") and image_data[8:12] == b"WEBP"


class AbyssSpinHandler(SimpleHTTPRequestHandler):
    server_version = "AbyssSpinLocal/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIRECTORY), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/auth/session":
            account = self.authenticated_account()
            with connect_database() as connection:
                has_accounts = connection.execute("SELECT 1 FROM accounts LIMIT 1").fetchone() is not None
            self.send_json(
                200,
                {
                    "authenticated": account is not None,
                    "username": account["username"] if account else None,
                    "is_admin": bool(account["is_admin"]) if account else False,
                    "has_accounts": has_accounts,
                },
            )
            return
        if path == "/api/admin/users":
            account = self.require_admin()
            if account is None:
                return
            with connect_database() as connection:
                rows = connection.execute(
                    """
                    SELECT accounts.id, accounts.username, accounts.created_at, accounts.profile_data
                    FROM accounts
                    WHERE accounts.approved = 0
                    ORDER BY accounts.created_at, accounts.id
                    """
                ).fetchall()
            users = []
            for row in rows:
                profile = json.loads(row["profile_data"])
                users.append(
                    {
                        "id": row["id"],
                        "username": row["username"],
                        "email": profile.get("email", ""),
                        "created_at": row["created_at"],
                    }
                )
            self.send_json(200, {"users": users})
            return
        if path == "/api/admin/settings":
            if self.require_admin() is None:
                return
            with connect_database() as connection:
                row = connection.execute(
                    "SELECT setting_value FROM app_settings WHERE setting_key = 'discord_webhook_url'"
                ).fetchone()
            smtp_settings = load_password_reset_smtp_settings()
            self.send_json(
                200,
                {
                    "discord_webhook_url": row["setting_value"] if row else "",
                    "password_reset_smtp": public_password_reset_smtp_settings(smtp_settings),
                },
            )
            return
        if path == "/api/data":
            account = self.authenticated_account()
            if account is None:
                self.send_json(401, {"error": "Zaloguj się ponownie."})
                return
            self.send_json(200, json.loads(account["app_data"]))
            return
        if path == "/api/profile":
            account = self.authenticated_account()
            if account is None:
                self.send_json(401, {"error": "Zaloguj się ponownie."})
                return
            with connect_database() as connection:
                experience = experience_summary(connection, account["id"])
            self.send_json(
                200,
                {"username": account["username"], **json.loads(account["profile_data"]), **experience},
            )
            return
        if path == "/api/chat":
            account = self.authenticated_account()
            if account is None:
                self.send_json(401, {"error": "Zaloguj się ponownie."})
                return
            self.chat_snapshot()
            return
        if path == "/api/friends":
            account = self.authenticated_account()
            if account is None:
                self.send_json(401, {"error": "Zaloguj się ponownie."})
                return
            self.friends_snapshot(account)
            return
        if path == "/api/notifications":
            account = self.authenticated_account()
            if account is None:
                self.send_json(401, {"error": "Zaloguj się ponownie."})
                return
            self.notifications_snapshot(account)
            return
        if path == "/api/friends/messages":
            account = self.authenticated_account()
            if account is None:
                self.send_json(401, {"error": "Zaloguj się ponownie."})
                return
            self.direct_messages_snapshot(account)
            return
        if path == "/api/user":
            account = self.authenticated_account()
            if account is None:
                self.send_json(401, {"error": "Zaloguj się ponownie."})
                return
            self.public_user_profile(account)
            return
        if path.startswith("/api/"):
            self.send_json(404, {"error": "Nie znaleziono endpointu."})
            return
        if path.endswith((".py", ".sqlite", ".sqlite3", ".db")) or path == "/start-abyssspin.bat":
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self):
        if not self.valid_origin():
            self.send_json(403, {"error": "Żądanie pochodzi z niedozwolonej strony."})
            return
        path = urlsplit(self.path).path
        if path.startswith("/api/admin/users/"):
            if self.read_json() is None:
                return
            self.admin_user_action(path)
            return
        if path not in (
            "/api/auth/register",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/auth/change-password",
            "/api/auth/request-password-reset",
            "/api/auth/reset-password",
            "/api/chat/presence",
            "/api/chat/messages",
            "/api/friends/messages",
            "/api/friends/request",
            "/api/friends/accept",
            "/api/friends/reject",
            "/api/friends/remove",
            "/api/admin/settings",
            "/api/rotation/webhook",
            "/api/experience/rotation",
        ):
            self.send_json(404, {"error": "Nie znaleziono endpointu."})
            return
        if path == "/api/admin/settings":
            payload = self.read_json()
            if payload is None or self.require_admin() is None:
                return
            self.save_admin_settings(payload)
            return
        if path in (
            "/api/chat/presence",
            "/api/chat/messages",
            "/api/friends/messages",
            "/api/friends/request",
            "/api/friends/accept",
            "/api/friends/reject",
            "/api/friends/remove",
            "/api/rotation/webhook",
            "/api/experience/rotation",
        ):
            account = self.authenticated_account()
            if account is None:
                self.send_json(401, {"error": "Zaloguj się ponownie."})
                return
            payload = self.read_json(
                MAX_WEBHOOK_REQUEST_SIZE if path == "/api/rotation/webhook" else MAX_REQUEST_SIZE
            )
            if payload is None:
                return
            if path == "/api/chat/presence":
                self.update_chat_presence(account)
            elif path == "/api/chat/messages":
                self.send_chat_message(account, payload)
            elif path == "/api/friends/messages":
                self.send_direct_message(account, payload)
            elif path == "/api/rotation/webhook":
                self.send_rotation_webhook(payload)
            elif path == "/api/experience/rotation":
                self.award_rotation_experience(account, payload)
            else:
                self.friend_action(account, path.rsplit("/", 1)[-1], payload)
            return
        if path == "/api/auth/logout":
            self.logout()
            return
        if path == "/api/auth/change-password":
            self.change_password()
            return
        if path in ("/api/auth/request-password-reset", "/api/auth/reset-password"):
            payload = self.read_json()
            if payload is None:
                return
            if path == "/api/auth/request-password-reset":
                self.request_password_reset(payload)
            else:
                self.reset_password(payload)
            return

        payload = self.read_json()
        if payload is None:
            return
        if path == "/api/auth/register":
            self.register(payload)
        else:
            self.login(payload)

    def do_PUT(self):
        if not self.valid_origin():
            self.send_json(403, {"error": "Żądanie pochodzi z niedozwolonej strony."})
            return
        path = urlsplit(self.path).path
        if path not in ("/api/data", "/api/profile"):
            self.send_json(404, {"error": "Nie znaleziono endpointu."})
            return
        account = self.authenticated_account()
        if account is None:
            self.send_json(401, {"error": "Zaloguj się ponownie."})
            return
        payload = self.read_json()
        if payload is None:
            return
        if path == "/api/profile":
            if not valid_profile_data(payload):
                self.send_json(400, {"error": "Dane profilu są nieprawidłowe lub avatar jest za duży."})
                return
            profile = {
                "discordName": payload.get("discordName", "").strip(),
                "activisionId": payload.get("activisionId", "").strip(),
                "email": payload.get("email", "").strip(),
                "avatar": payload.get("avatar", ""),
            }
            with connect_database() as connection:
                connection.execute(
                    "UPDATE accounts SET profile_data = ? WHERE id = ?",
                    (json.dumps(profile, ensure_ascii=False, separators=(",", ":")), account["id"]),
                )
                experience = experience_summary(connection, account["id"])
            self.send_json(200, {"username": account["username"], **profile, **experience})
            return
        if not valid_app_data(payload):
            self.send_json(400, {"error": "Dane składu mają nieprawidłowy format."})
            return
        with connect_database() as connection:
            connection.execute(
                "UPDATE accounts SET app_data = ? WHERE id = ?",
                (json.dumps(payload, ensure_ascii=False, separators=(",", ":")), account["id"]),
            )
        self.send_json(200, {"saved": True})

    def award_rotation_experience(self, account, payload):
        if set(payload) != {"rotation_id"}:
            self.send_json(400, {"error": "Nieprawidłowe dane rotacji."})
            return
        rotation_id = payload.get("rotation_id")
        if not isinstance(rotation_id, str) or not ROTATION_ID_PATTERN.fullmatch(rotation_id):
            self.send_json(400, {"error": "Nieprawidłowy identyfikator rotacji."})
            return

        with connect_database() as connection:
            account_row = connection.execute(
                "SELECT app_data FROM accounts WHERE id = ?",
                (account["id"],),
            ).fetchone()
            app_data = json.loads(account_row["app_data"]) if account_row else {}
            rotations = app_data.get("history", []) if isinstance(app_data, dict) else []
            if not any(
                isinstance(rotation, dict) and rotation.get("id") == rotation_id
                for rotation in rotations
            ):
                self.send_json(409, {"error": "Zapisz rotację przed odebraniem EXP."})
                return
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO rotation_experience (account_id, rotation_id, created_at)
                VALUES (?, ?, ?)
                """,
                (account["id"], rotation_id, int(time.time())),
            )
            experience = experience_summary(connection, account["id"])

        self.send_json(
            200,
            {
                "awarded": cursor.rowcount == 1,
                "earned_experience": 5 if cursor.rowcount == 1 else 0,
                **experience,
            },
        )

    def send_rotation_webhook(self, payload):
        if set(payload) != {"rotation", "image"}:
            self.send_json(400, {"error": "Żądanie musi zawierać rotację i jej grafikę PNG."})
            return
        with connect_database() as connection:
            row = connection.execute(
                "SELECT setting_value FROM app_settings WHERE setting_key = 'discord_webhook_url'"
            ).fetchone()
        webhook_url = row["setting_value"] if row else ""
        if not valid_discord_webhook_url(webhook_url):
            self.send_json(400, {"error": "Administrator nie skonfigurował jeszcze webhooka Discorda."})
            return
        try:
            embed = build_discord_rotation_embed(payload.get("rotation"))
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return

        image_value = payload.get("image")
        image_match = re.fullmatch(r"data:image/png;base64,([A-Za-z0-9+/]*={0,2})", image_value) if isinstance(image_value, str) else None
        if image_match is None:
            self.send_json(400, {"error": "Wygenerowana grafika nie jest prawidłowym plikiem PNG."})
            return
        try:
            image_data = base64.b64decode(image_match.group(1), validate=True)
        except (binascii.Error, ValueError):
            self.send_json(400, {"error": "Nie udało się odczytać grafiki PNG."})
            return
        if not image_data or len(image_data) > MAX_WEBHOOK_IMAGE_SIZE or not image_data.startswith(b"\x89PNG\r\n\x1a\n"):
            self.send_json(400, {"error": "Grafika PNG jest nieprawidłowa albo przekracza limit 6 MB."})
            return

        filename = "abyss-spin-rotacja.png"
        payload_json = json.dumps(
            {
                "embeds": [embed],
                "attachments": [{"id": 0, "filename": filename}],
                "allowed_mentions": {"parse": []},
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        boundary = f"----AbyssSpin{secrets.token_hex(16)}"
        body = b"".join((
            f"--{boundary}\r\n".encode("ascii"),
            b'Content-Disposition: form-data; name="payload_json"\r\n',
            b"Content-Type: application/json; charset=utf-8\r\n\r\n",
            payload_json.encode("utf-8"),
            b"\r\n",
            f"--{boundary}\r\n".encode("ascii"),
            f'Content-Disposition: form-data; name="files[0]"; filename="{filename}"\r\n'.encode("ascii"),
            b"Content-Type: image/png\r\n\r\n",
            image_data,
            b"\r\n",
            f"--{boundary}--\r\n".encode("ascii"),
        ))
        request = Request(
            f"{webhook_url}?wait=true",
            data=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "User-Agent": "AbyssSpin/1.0",
            },
            method="POST",
        )
        try:
            with build_opener(NoRedirectHandler()).open(request, timeout=12) as response:
                status = response.status
        except HTTPError as error:
            if error.code == 429:
                self.send_json(502, {"error": "Discord ograniczył liczbę wiadomości. Odczekaj chwilę i spróbuj ponownie."})
            elif 300 <= error.code < 400:
                self.send_json(502, {"error": "Discord nie zaakceptował adresu webhooka."})
            else:
                self.send_json(502, {"error": "Discord odrzucił wiadomość. Sprawdź, czy webhook jest aktywny."})
            return
        except (URLError, TimeoutError, OSError):
            self.send_json(502, {"error": "Nie udało się połączyć z Discordem. Sprawdź połączenie z internetem."})
            return
        if status not in (200, 204):
            self.send_json(502, {"error": "Discord nie potwierdził wysłania wiadomości."})
            return
        self.send_json(200, {"sent": True})

    def save_admin_settings(self, payload):
        webhook_keys = {"discord_webhook_url"}
        smtp_keys = {
            "reset_smtp_host",
            "reset_smtp_port",
            "reset_smtp_security",
            "reset_smtp_username",
            "reset_smtp_password",
            "reset_smtp_sender",
            "reset_base_url",
        }
        if set(payload) not in (webhook_keys, webhook_keys | smtp_keys):
            self.send_json(400, {"error": "Żądanie zawiera nieoczekiwane ustawienia."})
            return
        webhook_url = payload.get("discord_webhook_url")
        if not isinstance(webhook_url, str) or (webhook_url and not valid_discord_webhook_url(webhook_url)):
            self.send_json(400, {"error": "Wklej prawidłowy adres webhooka Discorda lub zostaw pole puste, aby go usunąć."})
            return
        smtp_values = None
        protected_password = None
        clear_password = False
        includes_smtp = set(payload) == webhook_keys | smtp_keys
        if includes_smtp:
            host = payload.get("reset_smtp_host")
            port_value = payload.get("reset_smtp_port")
            security = payload.get("reset_smtp_security")
            username = payload.get("reset_smtp_username")
            password = payload.get("reset_smtp_password")
            sender = payload.get("reset_smtp_sender")
            base_url = payload.get("reset_base_url")
            if any(
                not isinstance(value, str)
                for value in (host, port_value, security, username, password, sender, base_url)
            ):
                self.send_json(400, {"error": "Ustawienia serwera e-mail mają nieprawidłowy format."})
                return
            host, username, password, sender, base_url = (
                value.strip() for value in (host, username, password, sender, base_url)
            )
            if not any((host, username, password, sender, base_url)):
                smtp_values = None
            else:
                try:
                    port = int(port_value)
                except ValueError:
                    port = 0
                if (
                    not host
                    or len(host) > 253
                    or any(ord(char) <= 32 or char in "/@?#" for char in host)
                    or not 1 <= port <= 65535
                    or security not in ("ssl", "starttls")
                    or len(username) > 254
                    or len(password) > 512
                    or len(sender) > 254
                    or not EMAIL_PATTERN.fullmatch(sender)
                    or not valid_reset_base_url(base_url)
                    or bool(password and not username)
                ):
                    self.send_json(400, {"error": "Sprawdź serwer, port, nadawcę i adres aplikacji w ustawieniach SMTP."})
                    return
                existing_settings = load_password_reset_smtp_settings()
                existing_password = existing_settings.get("reset_smtp_password", "")
                if username:
                    if password:
                        try:
                            protected_password = protect_smtp_password(password)
                        except OSError:
                            self.send_json(500, {"error": "Nie udało się bezpiecznie zaszyfrować hasła SMTP."})
                            return
                    elif not existing_password:
                        self.send_json(400, {"error": "Wpisz hasło do konta SMTP albo usuń login SMTP."})
                        return
                elif existing_password:
                    clear_password = True
                smtp_values = {
                    "reset_smtp_host": host,
                    "reset_smtp_port": str(port),
                    "reset_smtp_security": security,
                    "reset_smtp_username": username,
                    "reset_smtp_sender": sender,
                    "reset_base_url": base_url.rstrip("/") + "/",
                }
        with connect_database() as connection:
            if webhook_url:
                connection.execute(
                    """
                    INSERT INTO app_settings (setting_key, setting_value)
                    VALUES ('discord_webhook_url', ?)
                    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
                    """,
                    (webhook_url,),
                )
            else:
                connection.execute(
                    "DELETE FROM app_settings WHERE setting_key = 'discord_webhook_url'"
                )
            if includes_smtp:
                if smtp_values is None:
                    connection.execute(
                        "DELETE FROM app_settings WHERE setting_key LIKE 'reset_smtp_%' OR setting_key = 'reset_base_url'"
                    )
                else:
                    for key, value in smtp_values.items():
                        connection.execute(
                            """
                            INSERT INTO app_settings (setting_key, setting_value)
                            VALUES (?, ?)
                            ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
                            """,
                            (key, value),
                        )
                    if protected_password:
                        connection.execute(
                            """
                            INSERT INTO app_settings (setting_key, setting_value)
                            VALUES ('reset_smtp_password', ?)
                            ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
                            """,
                            (protected_password,),
                        )
                    elif clear_password:
                        connection.execute(
                            "DELETE FROM app_settings WHERE setting_key = 'reset_smtp_password'"
                        )
        smtp_settings = load_password_reset_smtp_settings() if includes_smtp else {}
        self.send_json(
            200,
            {
                "saved": True,
                "configured": bool(webhook_url),
                "password_reset_smtp": public_password_reset_smtp_settings(smtp_settings),
            },
        )

    def read_json(self, max_size=MAX_REQUEST_SIZE):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Nieprawidłowe żądanie."})
            return None
        if content_length <= 0 or content_length > max_size:
            self.send_json(413 if content_length > max_size else 400, {"error": "Nieprawidłowy rozmiar żądania."})
            return None
        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Nieprawidłowe dane formularza."})
            return None
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "Nieprawidłowe dane formularza."})
            return None
        return payload

    def request_password_reset(self, payload):
        if set(payload) != {"email"}:
            self.send_json(400, {"error": "Nieprawidłowe dane formularza."})
            return
        email = payload.get("email")
        if (
            not isinstance(email, str)
            or len(email) > 254
            or not EMAIL_PATTERN.fullmatch(email.strip())
        ):
            self.send_json(400, {"error": "Wpisz prawidłowy adres e-mail."})
            return
        email = email.strip()
        with connect_database() as connection:
            accounts = connection.execute("SELECT id, username, profile_data FROM accounts").fetchall()
        account = None
        for row in accounts:
            profile = json.loads(row["profile_data"])
            stored_email = profile.get("email", "") if isinstance(profile, dict) else ""
            if isinstance(stored_email, str) and stored_email.strip().casefold() == email.casefold():
                account = row
                break
        smtp_settings = load_password_reset_smtp_settings()
        smtp_config = public_password_reset_smtp_settings(smtp_settings)
        if account is None or not smtp_config["configured"]:
            self.send_json(
                200,
                {
                    "requested": True,
                    "message": "Jeśli konto z tym adresem istnieje, wyślemy na niego link do zmiany hasła.",
                },
            )
            return

        token_hash = None
        now = int(time.time())
        with connect_database() as connection:
            connection.execute(
                "DELETE FROM password_reset_tokens WHERE account_id = ? AND expires_at <= ?",
                (account["id"], now),
            )
            existing = connection.execute(
                "SELECT 1 FROM password_reset_tokens WHERE account_id = ? AND expires_at > ?",
                (account["id"], now),
            ).fetchone()
            if existing is None:
                token = secrets.token_urlsafe(32)
                token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
                connection.execute(
                    "INSERT INTO password_reset_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
                    (token_hash, account["id"], now + PASSWORD_RESET_LIFETIME),
                )
        if token_hash:
            threading.Thread(
                target=deliver_password_reset_email,
                args=(smtp_settings, email, account["username"], token, token_hash),
                daemon=True,
            ).start()
        self.send_json(
            200,
            {
                "requested": True,
                "message": "Jeśli konto z tym adresem istnieje, wyślemy na niego link do zmiany hasła.",
            },
        )

    def reset_password(self, payload):
        if set(payload) != {"token", "new_password"}:
            self.send_json(400, {"error": "Nieprawidłowe dane formularza."})
            return
        token = payload.get("token")
        new_password = payload.get("new_password")
        if not isinstance(token, str) or not 20 <= len(token) <= 128:
            self.send_json(400, {"error": "Link jest nieprawidłowy lub wygasł. Poproś o nowy."})
            return
        if not isinstance(new_password, str) or not 8 <= len(new_password) <= 128:
            self.send_json(400, {"error": "Hasło musi mieć od 8 do 128 znaków."})
            return
        token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()
        now = int(time.time())
        with connect_database() as connection:
            reset = connection.execute(
                """
                SELECT account_id FROM password_reset_tokens
                WHERE token_hash = ? AND expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()
            if reset is None:
                self.send_json(400, {"error": "Link jest nieprawidłowy lub wygasł. Poproś o nowy."})
                return
            deleted = connection.execute(
                "DELETE FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?",
                (token_hash, now),
            ).rowcount
            if deleted != 1:
                self.send_json(400, {"error": "Link jest nieprawidłowy lub wygasł. Poproś o nowy."})
                return
            salt = secrets.token_bytes(16)
            connection.execute(
                "UPDATE accounts SET password_salt = ?, password_hash = ? WHERE id = ?",
                (salt, hash_password(new_password, salt), reset["account_id"]),
            )
            connection.execute(
                "DELETE FROM password_reset_tokens WHERE account_id = ?", (reset["account_id"],)
            )
            connection.execute("DELETE FROM sessions WHERE account_id = ?", (reset["account_id"],))
        self.send_json(200, {"changed": True})

    def register(self, payload):
        username = payload.get("username")
        password = payload.get("password")
        email = payload.get("email")
        if not isinstance(username, str) or not USERNAME_PATTERN.fullmatch(username):
            self.send_json(400, {"error": "Login powinien mieć 3–32 znaki: litery, cyfry, kropka, myślnik lub podkreślenie."})
            return
        if not isinstance(password, str) or not 8 <= len(password) <= 128:
            self.send_json(400, {"error": "Hasło musi mieć od 8 do 128 znaków."})
            return
        if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+", email.strip()):
            self.send_json(400, {"error": "Wpisz prawidłowy adres e-mail."})
            return
        salt = secrets.token_bytes(16)
        password_hash = hash_password(password, salt)
        try:
            with connect_database() as connection:
                account_count = connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
                is_first_admin = account_count == 0
                cursor = connection.execute(
                    """
                    INSERT INTO accounts (username, password_salt, password_hash, profile_data, is_admin, approved, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        username,
                        salt,
                        password_hash,
                        json.dumps(
                            {"discordName": "", "activisionId": "", "email": email.strip(), "avatar": ""},
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ),
                        int(is_first_admin),
                        int(is_first_admin),
                        int(time.time()),
                    ),
                )
                account_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Ten login jest już zajęty."})
            return
        if not is_first_admin:
            self.send_json(202, {"authenticated": False, "pending_approval": True})
            return
        self.create_session(account_id)
        self.send_json(201, {"authenticated": True, "username": username, "is_admin": True})

    def login(self, payload):
        username = payload.get("username")
        password = payload.get("password")
        if not isinstance(username, str) or not isinstance(password, str) or len(password) > 128:
            self.send_json(401, {"error": "Nieprawidłowy login lub hasło."})
            return
        with connect_database() as connection:
            account = connection.execute(
                "SELECT id, username, password_salt, password_hash, approved, is_admin FROM accounts WHERE username = ? COLLATE NOCASE",
                (username.strip(),),
            ).fetchone()
        if account is None or not hmac.compare_digest(hash_password(password, account["password_salt"]), account["password_hash"]):
            self.send_json(401, {"error": "Nieprawidłowy login lub hasło."})
            return
        if not account["approved"]:
            self.send_json(403, {"error": "Twoje konto oczekuje na zatwierdzenie przez administratora."})
            return
        self.create_session(account["id"])
        self.send_json(200, {"authenticated": True, "username": account["username"], "is_admin": bool(account["is_admin"])})

    def require_admin(self):
        account = self.authenticated_account()
        if account is None:
            self.send_json(401, {"error": "Zaloguj się ponownie."})
            return None
        if not account["is_admin"]:
            self.send_json(403, {"error": "Panel administracyjny jest dostępny tylko dla administratora."})
            return None
        return account

    def admin_user_action(self, path):
        if not self.valid_origin():
            self.send_json(403, {"error": "Żądanie pochodzi z niedozwolonej strony."})
            return
        if self.require_admin() is None:
            return
        match = re.fullmatch(r"/api/admin/users/([1-9][0-9]*)/(approve|reject)", path)
        if not match:
            self.send_json(404, {"error": "Nie znaleziono endpointu."})
            return
        user_id = int(match.group(1))
        action = match.group(2)
        with connect_database() as connection:
            user = connection.execute(
                "SELECT id, username, approved, is_admin FROM accounts WHERE id = ?",
                (user_id,),
            ).fetchone()
            if user is None:
                self.send_json(404, {"error": "Nie znaleziono użytkownika."})
                return
            if user["is_admin"]:
                self.send_json(400, {"error": "Nie można zmienić statusu administratora."})
                return
            if user["approved"]:
                self.send_json(409, {"error": "To konto zostało już zatwierdzone."})
                return
            if action == "approve":
                connection.execute("UPDATE accounts SET approved = 1 WHERE id = ?", (user_id,))
            else:
                connection.execute("DELETE FROM sessions WHERE account_id = ?", (user_id,))
                connection.execute(
                    "DELETE FROM friendships WHERE user_low = ? OR user_high = ?",
                    (user_id, user_id),
                )
                connection.execute("DELETE FROM chat_presence WHERE account_id = ?", (user_id,))
                connection.execute("DELETE FROM accounts WHERE id = ? AND approved = 0", (user_id,))
        self.send_json(200, {"action": action, "username": user["username"]})

    def chat_snapshot(self):
        now = int(time.time())
        cutoff = now - 45
        query = parse_qs(urlsplit(self.path).query)
        try:
            after_id = int(query["after"][0]) if query.get("after") else None
            if after_id is not None and after_id < 0:
                raise ValueError
        except ValueError:
            self.send_json(400, {"error": "Nieprawidłowy identyfikator wiadomości."})
            return

        with connect_database() as connection:
            connection.execute(
                """DELETE FROM chat_presence
                WHERE token_hash NOT IN (SELECT token_hash FROM sessions WHERE expires_at > ?)""",
                (now,),
            )
            users = connection.execute(
                """
                SELECT accounts.id, accounts.username, accounts.profile_data,
                       CASE WHEN online.account_id IS NULL THEN 0 ELSE 1 END AS is_online
                FROM accounts
                LEFT JOIN (
                    SELECT DISTINCT chat_presence.account_id
                    FROM chat_presence
                    JOIN sessions ON sessions.token_hash = chat_presence.token_hash
                    WHERE sessions.expires_at > ? AND chat_presence.last_seen >= ?
                ) AS online ON online.account_id = accounts.id
                WHERE accounts.approved = 1
                ORDER BY is_online DESC, accounts.username COLLATE NOCASE
                """,
                (now, cutoff),
            ).fetchall()
            if after_id is None:
                message_rows = connection.execute(
                    """
                    SELECT id, account_id, message, created_at FROM chat_messages
                    ORDER BY id DESC LIMIT 100
                    """
                ).fetchall()
                message_rows = list(reversed(message_rows))
            else:
                message_rows = connection.execute(
                    """
                    SELECT id, account_id, message, created_at FROM chat_messages
                    WHERE id > ? ORDER BY id LIMIT 200
                    """,
                    (after_id,),
                ).fetchall()
            messages = []
            if message_rows:
                account_ids = {row["account_id"] for row in message_rows}
                placeholders = ",".join("?" for _ in account_ids)
                authors = connection.execute(
                    f"SELECT id, username, profile_data FROM accounts WHERE id IN ({placeholders})",
                    tuple(account_ids),
                ).fetchall()
                author_by_id = {
                    author["id"]: (
                        author["username"],
                        json.loads(author["profile_data"]).get("discordName", "").strip() or author["username"],
                    )
                    for author in authors
                }
                messages = [
                    {
                        "id": row["id"],
                        "username": author_by_id[row["account_id"]][0],
                        "display_name": author_by_id[row["account_id"]][1],
                        "message": row["message"],
                        "created_at": row["created_at"],
                    }
                    for row in message_rows
                    if row["account_id"] in author_by_id
                ]

        serialized_users = []
        for user in users:
            profile = json.loads(user["profile_data"])
            serialized_users.append(
                {
                    "username": user["username"],
                    "display_name": profile.get("discordName", "").strip() or user["username"],
                    "is_online": bool(user["is_online"]),
                }
            )
        self.send_json(200, {"users": serialized_users, "messages": messages, "server_time": now})

    def public_user_profile(self, account):
        query = parse_qs(urlsplit(self.path).query)
        username = query.get("username", [""])[0].strip()
        if not USERNAME_PATTERN.fullmatch(username):
            self.send_json(400, {"error": "Wybierz prawidłowy profil użytkownika."})
            return
        with connect_database() as connection:
            user = connection.execute(
                """
                SELECT id, username, profile_data FROM accounts
                WHERE username = ? COLLATE NOCASE AND approved = 1
                """,
                (username,),
            ).fetchone()
            if user is None:
                self.send_json(404, {"error": "Nie znaleziono użytkownika."})
                return
            relationship = None
            if user["id"] != account["id"]:
                relationship = connection.execute(
                    """
                    SELECT status, requester_id FROM friendships
                    WHERE user_low = ? AND user_high = ?
                    """,
                    (min(account["id"], user["id"]), max(account["id"], user["id"])),
                ).fetchone()
            presence = connection.execute(
                """
                SELECT 1 FROM chat_presence
                JOIN sessions ON sessions.token_hash = chat_presence.token_hash
                WHERE chat_presence.account_id = ? AND chat_presence.last_seen >= ?
                    AND sessions.expires_at > ? LIMIT 1
                """,
                (user["id"], int(time.time()) - 45, int(time.time())),
            ).fetchone()
        profile = json.loads(user["profile_data"])
        if relationship is None:
            status, direction = "none", None
        elif relationship["status"] == "accepted":
            status, direction = "friends", None
        else:
            status = "pending"
            direction = "outgoing" if relationship["requester_id"] == account["id"] else "incoming"
        self.send_json(
            200,
            {
                "username": user["username"],
                "display_name": profile.get("discordName", "").strip() or user["username"],
                "activisionId": profile.get("activisionId", ""),
                "avatar": profile.get("avatar", ""),
                "is_online": presence is not None,
                "is_self": user["id"] == account["id"],
                "friend_status": status,
                "friend_direction": direction,
            },
        )

    def friends_snapshot(self, account):
        with connect_database() as connection:
            rows = connection.execute(
                """
                SELECT friendships.status, friendships.requester_id, friendships.created_at,
                       CASE WHEN friendships.user_low = ? THEN friendships.user_high ELSE friendships.user_low END AS other_id,
                       accounts.username, accounts.profile_data
                FROM friendships
                JOIN accounts ON accounts.id = CASE
                    WHEN friendships.user_low = ? THEN friendships.user_high ELSE friendships.user_low END
                WHERE (friendships.user_low = ? OR friendships.user_high = ?)
                    AND accounts.approved = 1
                ORDER BY friendships.created_at DESC, accounts.username COLLATE NOCASE
                """,
                (account["id"], account["id"], account["id"], account["id"]),
            ).fetchall()
        friends = []
        incoming = []
        outgoing = []
        for row in rows:
            profile = json.loads(row["profile_data"])
            item = {
                "username": row["username"],
                "display_name": profile.get("discordName", "").strip() or row["username"],
                "avatar": profile.get("avatar", ""),
                "created_at": row["created_at"],
            }
            if row["status"] == "accepted":
                friends.append(item)
            elif row["requester_id"] == account["id"]:
                outgoing.append(item)
            else:
                incoming.append(item)
        self.send_json(200, {"friends": friends, "incoming": incoming, "outgoing": outgoing})

    def notifications_snapshot(self, account):
        query = parse_qs(urlsplit(self.path).query)
        try:
            since = int(query.get("since", [str(int(time.time()))])[0])
            if since < 0:
                raise ValueError
        except ValueError:
            self.send_json(400, {"error": "Nieprawidłowy czas powiadomień."})
            return

        snapshot_time = int(time.time())
        with connect_database() as connection:
            friend_rows = connection.execute(
                """
                SELECT friendships.id, friendships.created_at, accounts.username, accounts.profile_data
                FROM friendships
                JOIN accounts ON accounts.id = friendships.requester_id
                WHERE friendships.status = 'pending'
                  AND friendships.requester_id != ?
                  AND (friendships.user_low = ? OR friendships.user_high = ?)
                  AND friendships.created_at >= ?
                  AND accounts.approved = 1
                ORDER BY friendships.created_at, friendships.id
                LIMIT 50
                """,
                (account["id"], account["id"], account["id"], since),
            ).fetchall()
            message_rows = connection.execute(
                """
                SELECT direct_messages.id, direct_messages.created_at,
                       accounts.username, accounts.profile_data
                FROM direct_messages
                JOIN accounts ON accounts.id = direct_messages.sender_id
                WHERE direct_messages.recipient_id = ?
                  AND direct_messages.created_at >= ?
                  AND accounts.approved = 1
                  AND EXISTS (
                    SELECT 1 FROM friendships
                    WHERE friendships.status = 'accepted'
                      AND friendships.user_low = MIN(direct_messages.sender_id, direct_messages.recipient_id)
                      AND friendships.user_high = MAX(direct_messages.sender_id, direct_messages.recipient_id)
                  )
                ORDER BY direct_messages.created_at, direct_messages.id
                LIMIT 100
                """,
                (account["id"], since),
            ).fetchall()

        friend_requests = []
        for row in friend_rows:
            profile = json.loads(row["profile_data"])
            friend_requests.append(
                {
                    "id": row["id"],
                    "created_at": row["created_at"],
                    "username": row["username"],
                    "display_name": profile.get("discordName", "").strip() or row["username"],
                }
            )
        messages = []
        for row in message_rows:
            profile = json.loads(row["profile_data"])
            messages.append(
                {
                    "id": row["id"],
                    "created_at": row["created_at"],
                    "username": row["username"],
                    "display_name": profile.get("discordName", "").strip() or row["username"],
                }
            )
        self.send_json(
            200,
            {
                "server_time": snapshot_time,
                "friend_requests": friend_requests,
                "messages": messages,
            },
        )

    def direct_message_friend(self, account, username):
        if not isinstance(username, str) or not USERNAME_PATTERN.fullmatch(username.strip()):
            self.send_json(400, {"error": "Wybierz prawidłowego znajomego."})
            return None
        with connect_database() as connection:
            target = connection.execute(
                "SELECT id, username, profile_data FROM accounts WHERE username = ? COLLATE NOCASE AND approved = 1",
                (username.strip(),),
            ).fetchone()
            if target is None:
                self.send_json(404, {"error": "Nie znaleziono tego znajomego."})
                return None
            if target["id"] == account["id"]:
                self.send_json(400, {"error": "Nie możesz wysłać wiadomości do siebie."})
                return None
            relationship = connection.execute(
                """
                SELECT 1 FROM friendships
                WHERE user_low = ? AND user_high = ? AND status = 'accepted'
                """,
                (min(account["id"], target["id"]), max(account["id"], target["id"])),
            ).fetchone()
        if relationship is None:
            self.send_json(403, {"error": "Prywatne wiadomości są dostępne tylko między znajomymi."})
            return None
        return target

    def direct_messages_snapshot(self, account):
        query = parse_qs(urlsplit(self.path).query)
        username = query.get("username", [""])[0].strip()
        after_value = query.get("after", [None])[0]
        try:
            after_id = int(after_value) if after_value is not None else None
            if after_id is not None and after_id < 0:
                raise ValueError
        except ValueError:
            self.send_json(400, {"error": "Nieprawidłowy identyfikator wiadomości."})
            return
        target = self.direct_message_friend(account, username)
        if target is None:
            return
        participant_ids = (account["id"], target["id"])
        with connect_database() as connection:
            if after_id is None:
                rows = connection.execute(
                    """
                    SELECT id, sender_id, message, created_at FROM direct_messages
                    WHERE (sender_id = ? AND recipient_id = ?)
                       OR (sender_id = ? AND recipient_id = ?)
                    ORDER BY id DESC LIMIT 100
                    """,
                    (participant_ids[0], participant_ids[1], participant_ids[1], participant_ids[0]),
                ).fetchall()
                rows = list(reversed(rows))
            else:
                rows = connection.execute(
                    """
                    SELECT id, sender_id, message, created_at FROM direct_messages
                    WHERE ((sender_id = ? AND recipient_id = ?)
                       OR (sender_id = ? AND recipient_id = ?))
                       AND id > ?
                    ORDER BY id LIMIT 200
                    """,
                    (participant_ids[0], participant_ids[1], participant_ids[1], participant_ids[0], after_id),
                ).fetchall()
            authors = {}
            if rows:
                author_ids = {row["sender_id"] for row in rows}
                placeholders = ",".join("?" for _ in author_ids)
                author_rows = connection.execute(
                    f"SELECT id, username, profile_data FROM accounts WHERE id IN ({placeholders})",
                    tuple(author_ids),
                ).fetchall()
                authors = {
                    row["id"]: (
                        row["username"],
                        json.loads(row["profile_data"]).get("discordName", "").strip() or row["username"],
                    )
                    for row in author_rows
                }
        messages = [
            {
                "id": row["id"],
                "username": authors[row["sender_id"]][0],
                "display_name": authors[row["sender_id"]][1],
                "message": row["message"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]
        self.send_json(200, {"messages": messages})

    def send_direct_message(self, account, payload):
        if set(payload) != {"username", "message"}:
            self.send_json(400, {"error": "Wiadomość musi zawierać znajomego i treść."})
            return
        message = payload.get("message")
        if not isinstance(message, str) or not message.strip() or len(message) > 500:
            self.send_json(400, {"error": "Wiadomość musi zawierać od 1 do 500 znaków."})
            return
        target = self.direct_message_friend(account, payload.get("username"))
        if target is None:
            return
        created_at = int(time.time())
        message = message.strip()
        with connect_database() as connection:
            cursor = connection.execute(
                """
                INSERT INTO direct_messages (sender_id, recipient_id, message, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (account["id"], target["id"], message, created_at),
            )
            message_id = cursor.lastrowid
            connection.execute(
                """
                DELETE FROM direct_messages
                WHERE ((sender_id = ? AND recipient_id = ?)
                   OR (sender_id = ? AND recipient_id = ?))
                  AND id NOT IN (
                    SELECT id FROM direct_messages
                    WHERE (sender_id = ? AND recipient_id = ?)
                       OR (sender_id = ? AND recipient_id = ?)
                    ORDER BY id DESC LIMIT 2000
                  )
                """,
                (
                    account["id"], target["id"], target["id"], account["id"],
                    account["id"], target["id"], target["id"], account["id"],
                ),
            )
        profile = json.loads(account["profile_data"])
        self.send_json(
            201,
            {
                "message": {
                    "id": message_id,
                    "username": account["username"],
                    "display_name": profile.get("discordName", "").strip() or account["username"],
                    "message": message,
                    "created_at": created_at,
                }
            },
        )

    def friend_action(self, account, action, payload):
        username = payload.get("username")
        if not isinstance(username, str) or not USERNAME_PATTERN.fullmatch(username.strip()):
            self.send_json(400, {"error": "Wybierz prawidłowego użytkownika."})
            return
        with connect_database() as connection:
            target = connection.execute(
                "SELECT id, username FROM accounts WHERE username = ? COLLATE NOCASE AND approved = 1",
                (username.strip(),),
            ).fetchone()
            if target is None:
                self.send_json(404, {"error": "Nie znaleziono użytkownika."})
                return
            if target["id"] == account["id"]:
                self.send_json(400, {"error": "Nie możesz wysłać zaproszenia do siebie."})
                return
            low, high = sorted((account["id"], target["id"]))
            relationship = connection.execute(
                "SELECT id, requester_id, status FROM friendships WHERE user_low = ? AND user_high = ?",
                (low, high),
            ).fetchone()

            if action == "request":
                if relationship is not None:
                    if relationship["status"] == "accepted":
                        self.send_json(409, {"error": "Jesteście już znajomymi."})
                    elif relationship["requester_id"] == account["id"]:
                        self.send_json(409, {"error": "Zaproszenie do tego użytkownika już oczekuje na odpowiedź."})
                    else:
                        self.send_json(409, {"error": "Ten użytkownik wysłał Ci już zaproszenie. Zaakceptuj je w zakładce Znajomi."})
                    return
                connection.execute(
                    """
                    INSERT INTO friendships (user_low, user_high, requester_id, status, created_at)
                    VALUES (?, ?, ?, 'pending', ?)
                    """,
                    (low, high, account["id"], int(time.time())),
                )
                self.send_json(201, {"action": action, "username": target["username"]})
                return

            if relationship is None:
                self.send_json(404, {"error": "Nie ma zaproszenia ani znajomości z tym użytkownikiem."})
                return
            if action in ("accept", "reject"):
                if relationship["status"] != "pending":
                    self.send_json(409, {"error": "Zaproszenie zostało już rozpatrzone."})
                    return
                if action == "accept" and relationship["requester_id"] == account["id"]:
                    self.send_json(403, {"error": "Możesz zaakceptować tylko zaproszenie otrzymane od użytkownika."})
                    return
                connection.execute("DELETE FROM friendships WHERE id = ?", (relationship["id"],))
                if action == "accept":
                    connection.execute(
                        "INSERT INTO friendships (user_low, user_high, requester_id, status, created_at) VALUES (?, ?, ?, 'accepted', ?)",
                        (low, high, account["id"], int(time.time())),
                    )
                self.send_json(200, {"action": action, "username": target["username"]})
                return

            if action == "remove":
                if relationship["status"] == "pending" and relationship["requester_id"] != account["id"]:
                    self.send_json(403, {"error": "Otrzymane zaproszenie zaakceptuj lub odrzuć."})
                    return
                connection.execute("DELETE FROM friendships WHERE id = ?", (relationship["id"],))
                self.send_json(200, {"action": action, "username": target["username"]})
                return

            self.send_json(404, {"error": "Nieznana operacja na znajomości."})

    def update_chat_presence(self, account):
        token = self.session_token()
        if not token:
            self.send_json(401, {"error": "Zaloguj się ponownie."})
            return
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with connect_database() as connection:
            connection.execute(
                """
                INSERT INTO chat_presence (token_hash, account_id, last_seen) VALUES (?, ?, ?)
                ON CONFLICT(token_hash) DO UPDATE SET account_id = excluded.account_id, last_seen = excluded.last_seen
                """,
                (token_hash, account["id"], int(time.time())),
            )
        self.send_json(200, {"online": True})

    def send_chat_message(self, account, payload):
        message = payload.get("message")
        if not isinstance(message, str) or not message.strip() or len(message) > 500:
            self.send_json(400, {"error": "Wiadomość musi zawierać od 1 do 500 znaków."})
            return
        message = message.strip()
        created_at = int(time.time())
        with connect_database() as connection:
            cursor = connection.execute(
                "INSERT INTO chat_messages (account_id, message, created_at) VALUES (?, ?, ?)",
                (account["id"], message, created_at),
            )
            message_id = cursor.lastrowid
            connection.execute(
                """DELETE FROM chat_messages
                WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 2000)"""
            )
        profile = json.loads(account["profile_data"])
        self.send_json(
            201,
            {
                "message": {
                    "id": message_id,
                    "username": account["username"],
                    "display_name": profile.get("discordName", "").strip() or account["username"],
                    "message": message,
                    "created_at": created_at,
                }
            },
        )

    def logout(self):
        token = self.session_token()
        if token:
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            with connect_database() as connection:
                connection.execute("DELETE FROM chat_presence WHERE token_hash = ?", (token_hash,))
                connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
        self.send_json(200, {"authenticated": False}, clear_cookie=True)

    def change_password(self):
        account = self.authenticated_account()
        if account is None:
            self.send_json(401, {"error": "Zaloguj się ponownie, aby zmienić hasło."})
            return
        payload = self.read_json()
        if payload is None:
            return
        current_password = payload.get("current_password")
        new_password = payload.get("new_password")
        if not isinstance(current_password, str) or not isinstance(new_password, str):
            self.send_json(400, {"error": "Wpisz obecne i nowe hasło."})
            return
        if not 8 <= len(new_password) <= 128:
            self.send_json(400, {"error": "Nowe hasło musi mieć od 8 do 128 znaków."})
            return
        with connect_database() as connection:
            credentials = connection.execute(
                "SELECT password_salt, password_hash FROM accounts WHERE id = ?",
                (account["id"],),
            ).fetchone()
            if credentials is None or not hmac.compare_digest(
                hash_password(current_password, credentials["password_salt"]),
                credentials["password_hash"],
            ):
                self.send_json(401, {"error": "Obecne hasło jest nieprawidłowe."})
                return
            new_salt = secrets.token_bytes(16)
            new_hash = hash_password(new_password, new_salt)
            connection.execute(
                "UPDATE accounts SET password_salt = ?, password_hash = ? WHERE id = ?",
                (new_salt, new_hash, account["id"]),
            )
        self.send_json(200, {"changed": True})

    def create_session(self, account_id):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        expires_at = int(time.time()) + SESSION_LIFETIME
        with connect_database() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
            connection.execute(
                "INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
                (token_hash, account_id, expires_at),
            )
        self.send_header_cookie(token)

    def authenticated_account(self):
        token = self.session_token()
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with connect_database() as connection:
            return connection.execute(
                """
                SELECT accounts.id, accounts.username, accounts.app_data, accounts.profile_data, accounts.is_admin
                FROM sessions
                JOIN accounts ON accounts.id = sessions.account_id
                WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND accounts.approved = 1
                """,
                (token_hash, int(time.time())),
            ).fetchone()

    def session_token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get(COOKIE_NAME)
        return morsel.value if morsel else None

    def valid_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlsplit(origin)
        request_host = self.headers.get("Host", "").lower()
        return parsed.scheme in ("http", "https") and parsed.netloc.lower() == request_host

    def send_header_cookie(self, token):
        self._session_cookie = f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_LIFETIME}"

    def send_json(self, status, payload, clear_cookie=False):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        cookie = getattr(self, "_session_cookie", None)
        if cookie:
            self.send_header("Set-Cookie", cookie)
            del self._session_cookie
        if clear_cookie:
            self.send_header("Set-Cookie", f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        print(f"{self.log_date_time_string()} {self.client_address[0]} {format_string % args}")


def main():
    parser = argparse.ArgumentParser(description="Uruchamia lokalny serwer aplikacji Abyss Spin.")
    parser.add_argument("--host", default="127.0.0.1", help="Adres nasłuchiwania (domyślnie localhost).")
    parser.add_argument("--port", type=int, default=8765, help="Port serwera (domyślnie 8765).")
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "localhost", "::1", "0.0.0.0"):
        parser.error("Dozwolone adresy nasłuchiwania: localhost lub 0.0.0.0 (sieć lokalna).")
    initialize_database()
    server = ThreadingHTTPServer((args.host, args.port), AbyssSpinHandler)
    if args.host == "0.0.0.0":
        print(f"Abyss Spin działa w sieci lokalnej na porcie {args.port}.")
        print(f"Na tym komputerze: http://localhost:{args.port}/")
        print(f"Na telefonie użyj adresu IP tego komputera, np. http://192.168.18.125:{args.port}/")
    else:
        print(f"Abyss Spin działa lokalnie: http://localhost:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nZamykanie serwera Abyss Spin.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
