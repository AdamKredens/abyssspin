const loginScreen = document.querySelector("#login-screen");
const appShell = document.querySelector(".app-shell");
const authForm = document.querySelector("#auth-form");
const usernameInput = document.querySelector("#auth-username");
const emailInput = document.querySelector("#auth-email");
const emailField = document.querySelector("#auth-email-field");
const passwordInput = document.querySelector("#auth-password");
const authHeading = document.querySelector("#login-heading");
const authDescription = document.querySelector("#login-description");
const authError = document.querySelector("#auth-error");
const authSubmit = document.querySelector("#auth-submit");
const authSwitchLabel = document.querySelector("#auth-switch-label");
const authSwitch = document.querySelector("#auth-switch");
const authSwitchRow = document.querySelector("#auth-switch-row");
const authForgot = document.querySelector("#auth-forgot");
const authForgotButton = document.querySelector("#auth-forgot-button");
const resetRequestForm = document.querySelector("#reset-request-form");
const resetEmailInput = document.querySelector("#reset-email");
const resetRequestStatus = document.querySelector("#reset-request-status");
const resetRequestSubmit = document.querySelector("#reset-request-submit");
const resetPasswordForm = document.querySelector("#reset-password-form");
const resetNewPasswordInput = document.querySelector("#reset-new-password");
const resetConfirmPasswordInput = document.querySelector("#reset-confirm-password");
const resetPasswordStatus = document.querySelector("#reset-password-status");
const resetPasswordSubmit = document.querySelector("#reset-password-submit");
const recoveryBack = document.querySelector("#recovery-back");
const recoveryBackButton = document.querySelector("#recovery-back-button");
const currentUser = document.querySelector("#current-user");
const logoutButton = document.querySelector("#logout-button");
const profileButton = document.querySelector("#profile-button");
const profileDialog = document.querySelector("#profile-dialog");
const profileClose = document.querySelector("#profile-close");
const profileForm = document.querySelector("#profile-form");
const profileError = document.querySelector("#profile-error");
const profileSave = document.querySelector("#profile-save");
const profileAccountName = document.querySelector("#profile-account-name");
const profileLevel = document.querySelector("#profile-level");
const profileXpLabel = document.querySelector("#profile-xp-label");
const profileXpBar = document.querySelector("#profile-xp-bar");
const profileXpProgress = document.querySelector("#profile-xp-progress");
const profileTotalXp = document.querySelector("#profile-total-xp");
const discordNameInput = document.querySelector("#discord-name");
const activisionIdInput = document.querySelector("#activision-id");
const profileEmailInput = document.querySelector("#profile-email");
const avatarFileInput = document.querySelector("#avatar-file");
const profileInitial = document.querySelector("#profile-initial");
const profileAvatarImage = document.querySelector("#profile-avatar-image");
const accountAvatarInitial = document.querySelector("#account-avatar-initial");
const accountAvatarImage = document.querySelector("#account-avatar-image");
const passwordForm = document.querySelector("#password-form");
const currentPasswordInput = document.querySelector("#current-password");
const newPasswordInput = document.querySelector("#new-password");
const confirmPasswordInput = document.querySelector("#confirm-password");
const passwordError = document.querySelector("#password-error");
const passwordSubmit = document.querySelector("#password-submit");
const adminButton = document.querySelector("#admin-button");
const adminPendingBadge = document.querySelector("#admin-pending-badge");
const adminDialog = document.querySelector("#admin-dialog");
const adminClose = document.querySelector("#admin-close");
const adminError = document.querySelector("#admin-error");
const pendingUsers = document.querySelector("#pending-users");
const pendingCount = document.querySelector("#pending-count");
const pendingEmpty = document.querySelector("#pending-empty");
const adminWebhookForm = document.querySelector("#admin-webhook-form");
const adminWebhookUrl = document.querySelector("#admin-webhook-url");
const adminWebhookError = document.querySelector("#admin-webhook-error");
const adminWebhookSave = document.querySelector("#admin-webhook-save");
const adminSmtpForm = document.querySelector("#admin-smtp-form");
const adminSmtpHost = document.querySelector("#admin-smtp-host");
const adminSmtpPort = document.querySelector("#admin-smtp-port");
const adminSmtpSecurity = document.querySelector("#admin-smtp-security");
const adminSmtpUsername = document.querySelector("#admin-smtp-username");
const adminSmtpPassword = document.querySelector("#admin-smtp-password");
const adminSmtpSender = document.querySelector("#admin-smtp-sender");
const adminResetBaseUrl = document.querySelector("#admin-reset-base-url");
const adminSmtpError = document.querySelector("#admin-smtp-error");
const adminSmtpSave = document.querySelector("#admin-smtp-save");
const settingsAdminButton = document.querySelector("#settings-admin");
const bottomNav = document.querySelector("#bottom-nav");

let authMode = "login";
let passwordResetToken = "";
let activeProfile = {
  username: "",
  discordName: "",
  activisionId: "",
  email: "",
  avatar: "",
  total_experience: 0,
  level: 1,
  experience_in_level: 0,
  experience_to_next_level: 100,
  progress_percent: 0,
};
let selectedAvatar = "";

async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
      throw new Error("Nie udało się połączyć z lokalnym serwerem. Uruchom plik start-abyssspin.bat.");
    }
    throw new Error("Nie udało się połączyć z serwerem Abyss Spin. Sprawdź połączenie i spróbuj ponownie.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("Serwer zwrócił nieprawidłową odpowiedź.");
  }
  if (!response.ok) {
    if (response.status === 401 && (path.startsWith("/api/data") || path.startsWith("/api/profile"))) {
      window.dispatchEvent(new Event("abyssspin:session-expired"));
    }
    throw new Error(payload.error || "Nie udało się wykonać operacji.");
  }
  return payload;
}

function showAuthError(message = "") {
  authError.textContent = message;
  authError.hidden = !message;
}

function setAuthMode(mode) {
  authMode = mode;
  authForgot.hidden = mode !== "login";
  showAuthError("");
  if (mode === "register") {
    emailField.hidden = false;
    emailInput.disabled = false;
    emailInput.required = true;
    authHeading.innerHTML = 'Dołącz <span>do squadu.</span>';
    authDescription.textContent = "Utwórz konto. Administrator zatwierdzi je przed pierwszym logowaniem.";
    authSubmit.textContent = "UTWÓRZ KONTO";
    authSwitchLabel.textContent = "Masz już konto?";
    authSwitch.textContent = "Zaloguj się";
    passwordInput.autocomplete = "new-password";
  } else {
    emailField.hidden = true;
    emailInput.disabled = true;
    emailInput.required = false;
    authHeading.innerHTML = 'Witaj <span>w wirtualnej rotacji.</span>';
    authDescription.textContent = "Zaloguj się, aby zapisać swoje składy i rotacje na koncie.";
    authSubmit.textContent = "ZALOGUJ SIĘ";
    authSwitchLabel.textContent = "Nie masz konta?";
    authSwitch.textContent = "Utwórz je";
    passwordInput.autocomplete = "current-password";
  }
}

async function showApp(username, data, isAdmin = false) {
  loginScreen.hidden = true;
  appShell.hidden = false;
  bottomNav.hidden = false;
  currentUser.textContent = username;
  adminButton.hidden = !isAdmin;
  settingsAdminButton.hidden = !isAdmin;
  activeProfile = { ...activeProfile, username, discordName: "", activisionId: "", email: "", avatar: "", ...data.profile };
  renderProfileExperience();
  updateProfileAvatar();
  window.dispatchEvent(new CustomEvent("abyssspin:authenticated", { detail: { username, data: data.appData, isAdmin } }));
  if (isAdmin) refreshPendingUsers();
}

function renderProfileExperience(experience = activeProfile) {
  const level = Number.isSafeInteger(experience.level) ? experience.level : 1;
  const total = Number.isSafeInteger(experience.total_experience) ? experience.total_experience : 0;
  const current = Number.isSafeInteger(experience.experience_in_level) ? experience.experience_in_level : 0;
  const next = Number.isSafeInteger(experience.experience_to_next_level) ? experience.experience_to_next_level : 100;
  const percent = Number.isSafeInteger(experience.progress_percent) ? experience.progress_percent : 0;
  profileLevel.textContent = String(level);
  profileXpLabel.textContent = `${current} / ${next} EXP`;
  profileXpProgress.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  profileXpBar.setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, percent))));
  profileTotalXp.textContent = `Łącznie zdobyto ${total} EXP`;
}

window.addEventListener("abyssspin:experience-updated", (event) => {
  activeProfile = { ...activeProfile, ...event.detail };
  renderProfileExperience();
});

async function restoreSession() {
  try {
    const session = await requestJson("/api/auth/session");
    if (session.authenticated) {
      const [appData, profile] = await Promise.all([
        requestJson("/api/data"),
        requestJson("/api/profile"),
      ]);
      await showApp(session.username, { appData, profile }, session.is_admin);
    }
  } catch (error) {
    showAuthError(error.message);
  }
}

authSwitch.addEventListener("click", () => {
  passwordResetToken = "";
  resetRequestForm.hidden = true;
  resetPasswordForm.hidden = true;
  recoveryBack.hidden = true;
  authForm.hidden = false;
  authSwitchRow.hidden = false;
  authForgot.hidden = false;
  setAuthMode(authMode === "login" ? "register" : "login");
  passwordInput.value = "";
  passwordInput.focus();
});

authForgotButton.addEventListener("click", () => {
  setAuthMode("login");
  authForm.hidden = true;
  authForgot.hidden = true;
  authSwitchRow.hidden = true;
  resetPasswordForm.hidden = true;
  resetRequestForm.hidden = false;
  recoveryBack.hidden = false;
  authHeading.innerHTML = 'Odzyskaj <span>dostęp.</span>';
  authDescription.textContent = "Podaj adres e-mail przypisany do konta. Wyślemy na niego jednorazowy link do zmiany hasła.";
  resetRequestInputClear();
  resetEmailInput.focus();
});

function resetRequestInputClear() {
  resetRequestStatus.textContent = "";
  resetRequestStatus.hidden = true;
  resetRequestStatus.classList.remove("auth-success");
}

function showResetPasswordForm(token) {
  passwordResetToken = token;
  authForm.hidden = true;
  authForgot.hidden = true;
  authSwitchRow.hidden = true;
  resetRequestForm.hidden = true;
  resetPasswordForm.hidden = false;
  resetPasswordSubmit.hidden = false;
  recoveryBack.hidden = false;
  authHeading.innerHTML = 'Ustaw <span>nowe hasło.</span>';
  authDescription.textContent = "Link do zmiany hasła jest jednorazowy i ważny przez 30 minut.";
  resetPasswordStatus.textContent = "";
  resetPasswordStatus.hidden = true;
  resetPasswordStatus.classList.remove("auth-success");
  resetNewPasswordInput.focus();
}

recoveryBackButton.addEventListener("click", () => {
  passwordResetToken = "";
  resetRequestForm.reset();
  resetPasswordForm.reset();
  resetRequestForm.hidden = true;
  resetPasswordForm.hidden = true;
  recoveryBack.hidden = true;
  authForm.hidden = false;
  authSwitchRow.hidden = false;
  authForgot.hidden = false;
  removeResetTokenFromUrl();
  setAuthMode("login");
  usernameInput.focus();
});

function removeResetTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("reset");
  const hashParams = new URLSearchParams(url.hash.slice(1));
  hashParams.delete("reset");
  url.hash = hashParams.size ? hashParams.toString() : "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

resetRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetRequestSubmit.disabled = true;
  resetRequestSubmit.textContent = "WYSYŁANIE...";
  resetRequestInputClear();
  try {
    await requestJson("/api/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email: resetEmailInput.value.trim() }),
    });
    resetRequestStatus.classList.add("auth-success");
    resetRequestStatus.textContent = "Jeśli konto z tym adresem istnieje, wyślemy na niego link do zmiany hasła.";
    resetRequestStatus.hidden = false;
  } catch (error) {
    resetRequestStatus.textContent = error.message;
    resetRequestStatus.hidden = false;
  } finally {
    resetRequestSubmit.disabled = false;
    resetRequestSubmit.textContent = "WYŚLIJ LINK DO ZMIANY HASŁA";
  }
});

resetPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetPasswordStatus.textContent = "";
  resetPasswordStatus.hidden = true;
  resetPasswordStatus.classList.remove("auth-success");
  if (resetNewPasswordInput.value !== resetConfirmPasswordInput.value) {
    resetPasswordStatus.textContent = "Nowe hasła nie są identyczne.";
    resetPasswordStatus.hidden = false;
    resetConfirmPasswordInput.focus();
    return;
  }
  resetPasswordSubmit.disabled = true;
  resetPasswordSubmit.textContent = "ZAPISYWANIE...";
  try {
    await requestJson("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        token: passwordResetToken,
        new_password: resetNewPasswordInput.value,
      }),
    });
    resetPasswordForm.reset();
    passwordResetToken = "";
    resetPasswordStatus.classList.add("auth-success");
    resetPasswordStatus.textContent = "Hasło zostało zmienione. Możesz teraz się zalogować.";
    resetPasswordStatus.hidden = false;
    resetPasswordSubmit.hidden = true;
  } catch (error) {
    resetPasswordStatus.textContent = error.message;
    resetPasswordStatus.hidden = false;
  } finally {
    resetPasswordSubmit.disabled = false;
    if (passwordResetToken) resetPasswordSubmit.textContent = "USTAW NOWE HASŁO";
  }
});

const resetTokenFromUrl = new URLSearchParams(window.location.hash.slice(1)).get("reset");
if (resetTokenFromUrl) {
  removeResetTokenFromUrl();
  showResetPasswordForm(resetTokenFromUrl);
}

function updatePendingBadge(count) {
  adminPendingBadge.textContent = String(count);
  adminPendingBadge.hidden = count === 0;
}

function setAdminError(message = "") {
  adminError.textContent = message;
  adminError.hidden = !message;
}

function renderPendingUsers(users) {
  pendingUsers.replaceChildren();
  pendingCount.textContent = String(users.length);
  pendingEmpty.hidden = users.length > 0;
  updatePendingBadge(users.length);

  for (const user of users) {
    const item = document.createElement("article");
    item.className = "pending-user";
    const details = document.createElement("div");
    details.className = "pending-user-details";
    const username = document.createElement("strong");
    username.textContent = user.username;
    const email = document.createElement("span");
    email.textContent = user.email || "Brak adresu e-mail";
    const registered = document.createElement("small");
    const date = new Date(user.created_at * 1000);
    registered.textContent = `Rejestracja: ${Number.isNaN(date.getTime()) ? "nieznana data" : new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "short" }).format(date)}`;
    details.append(username, email, registered);

    const actions = document.createElement("div");
    actions.className = "pending-user-actions";
    for (const action of ["approve", "reject"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action === "approve" ? "approve-user" : "reject-user";
      button.textContent = action === "approve" ? "ZATWIERDŹ" : "ODRZUĆ";
      button.addEventListener("click", () => updatePendingUser(user.id, action, button));
      actions.append(button);
    }
    item.append(details, actions);
    pendingUsers.append(item);
  }
}

async function refreshPendingUsers() {
  setAdminError("");
  try {
    const result = await requestJson("/api/admin/users");
    renderPendingUsers(result.users);
    await refreshAdminWebhook();
  } catch (error) {
    setAdminError(error.message);
  }
}

async function refreshAdminWebhook() {
  adminWebhookError.textContent = "";
  adminWebhookError.hidden = true;
  adminWebhookError.classList.remove("webhook-admin-saved");
  try {
    const result = await requestJson("/api/admin/settings");
    adminWebhookUrl.value = result.discord_webhook_url || "";
    const smtp = result.password_reset_smtp || {};
    adminSmtpHost.value = smtp.host || "";
    adminSmtpPort.value = smtp.port || "587";
    adminSmtpSecurity.value = smtp.security || "starttls";
    adminSmtpUsername.value = smtp.username || "";
    adminSmtpPassword.value = "";
    adminSmtpPassword.placeholder = smtp.password_configured
      ? "Zapisane hasło — pozostaw puste, aby zachować"
      : "Hasło SMTP";
    adminSmtpSender.value = smtp.sender || "";
    adminResetBaseUrl.value = smtp.base_url || "";
  } catch (error) {
    adminWebhookError.textContent = error.message;
    adminWebhookError.hidden = false;
  }
}

adminWebhookForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminWebhookSave.disabled = true;
  adminWebhookSave.textContent = "ZAPISYWANIE...";
  adminWebhookError.textContent = "";
  adminWebhookError.hidden = true;
  try {
    const result = await requestJson("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({ discord_webhook_url: adminWebhookUrl.value.trim() }),
    });

    adminWebhookError.classList.add("webhook-admin-saved");
    adminWebhookError.textContent = result.configured
      ? "Webhook Discorda został zapisany."
      : "Webhook został usunięty.";
    adminWebhookError.hidden = false;
  } catch (error) {
    adminWebhookError.textContent = error.message;
    adminWebhookError.hidden = false;
  } finally {
    adminWebhookSave.disabled = false;
    adminWebhookSave.textContent = "ZAPISZ WEBHOOK";
  }
});

adminSmtpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminSmtpSave.disabled = true;
  adminSmtpSave.textContent = "ZAPISYWANIE...";
  adminSmtpError.textContent = "";
  adminSmtpError.hidden = true;
  try {
    const result = await requestJson("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({
        discord_webhook_url: adminWebhookUrl.value.trim(),
        reset_smtp_host: adminSmtpHost.value.trim(),
        reset_smtp_port: adminSmtpPort.value,
        reset_smtp_security: adminSmtpSecurity.value,
        reset_smtp_username: adminSmtpUsername.value.trim(),
        reset_smtp_password: adminSmtpPassword.value,
        reset_smtp_sender: adminSmtpSender.value.trim(),
        reset_base_url: adminResetBaseUrl.value.trim(),
      }),
    });
    adminSmtpPassword.value = "";
    adminSmtpPassword.placeholder = result.password_reset_smtp.password_configured
      ? "Zapisane hasło — pozostaw puste, aby zachować"
      : "Hasło SMTP";
    adminSmtpError.classList.add("auth-success");
    adminSmtpError.textContent = result.password_reset_smtp.configured
      ? "Ustawienia wysyłki e-mail zostały zapisane."
      : "Ustawienia wysyłki e-mail zostały usunięte.";
    adminSmtpError.hidden = false;
  } catch (error) {
    adminSmtpError.classList.remove("auth-success");
    adminSmtpError.textContent = error.message;
    adminSmtpError.hidden = false;
  } finally {
    adminSmtpSave.disabled = false;
    adminSmtpSave.textContent = "ZAPISZ USTAWIENIA E-MAIL";
  }
});

async function updatePendingUser(userId, action, button) {
  const buttons = button.closest(".pending-user-actions").querySelectorAll("button");
  buttons.forEach((control) => { control.disabled = true; });
  setAdminError("");
  try {
    await requestJson(`/api/admin/users/${userId}/${action}`, { method: "POST", body: "{}" });
    await refreshPendingUsers();
  } catch (error) {
    setAdminError(error.message);
    buttons.forEach((control) => { control.disabled = false; });
  }
}

adminButton.addEventListener("click", () => {
  adminDialog.showModal();
  refreshPendingUsers();
});
adminClose.addEventListener("click", () => adminDialog.close());
adminDialog.addEventListener("click", (event) => {
  if (event.target === adminDialog) adminDialog.close();
});

function updateProfileAvatar() {
  const initial = (activeProfile.discordName || activeProfile.username || "A").trim().charAt(0).toLocaleUpperCase("pl-PL");
  profileInitial.textContent = initial;
  accountAvatarInitial.textContent = initial;
  profileAccountName.textContent = activeProfile.username;
  for (const [image, avatar] of [[profileAvatarImage, profileInitial], [accountAvatarImage, accountAvatarInitial]]) {
    if (activeProfile.avatar) {
      image.src = activeProfile.avatar;
      image.hidden = false;
      avatar.hidden = true;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      avatar.hidden = false;
    }
  }
}

function resetProfileForm() {
  passwordForm.reset();
  profileError.hidden = true;
  passwordError.hidden = true;
  selectedAvatar = activeProfile.avatar;
  profileForm.reset();
  discordNameInput.value = activeProfile.discordName;
  activisionIdInput.value = activeProfile.activisionId;
  profileEmailInput.value = activeProfile.email;
  updateProfileAvatar();
}

profileButton.addEventListener("click", () => {
  resetProfileForm();
  profileDialog.showModal();
});

profileClose.addEventListener("click", () => profileDialog.close());

profileDialog.addEventListener("click", (event) => {
  if (event.target === profileDialog) profileDialog.close();
});

avatarFileInput.addEventListener("change", async () => {
  const file = avatarFileInput.files?.[0];
  avatarFileInput.value = "";
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    profileError.textContent = "Wybierz obraz PNG, JPEG lub WEBP o rozmiarze do 10 MB.";
    profileError.hidden = false;
    return;
  }
  try {
    const image = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 256 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Nie można przetworzyć wybranego zdjęcia.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    let avatar = canvas.toDataURL("image/webp", 0.82);
    if (!avatar.startsWith("data:image/webp;")) avatar = canvas.toDataURL("image/jpeg", 0.82);
    if (avatar.length > 700_000) throw new Error("Zdjęcie jest za duże. Wybierz mniejszy plik.");
    selectedAvatar = avatar;
    profileError.hidden = true;
    profileAvatarImage.src = avatar;
    profileAvatarImage.hidden = false;
    profileInitial.hidden = true;
    accountAvatarImage.src = avatar;
    accountAvatarImage.hidden = false;
    accountAvatarInitial.hidden = true;
  } catch (error) {
    console.error("Nie udało się przetworzyć avatara.", error);
    profileError.textContent = error.message || "Nie udało się wczytać avatara.";
    profileError.hidden = false;
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileError.hidden = true;
  profileSave.disabled = true;
  profileSave.textContent = "ZAPISYWANIE...";
  try {
    const updatedProfile = await requestJson("/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        discordName: discordNameInput.value.trim(),
        activisionId: activisionIdInput.value.trim(),
        email: profileEmailInput.value.trim(),
        avatar: selectedAvatar,
      }),
    });
    activeProfile = { ...activeProfile, ...updatedProfile };
    updateProfileAvatar();
    profileDialog.close();
    window.dispatchEvent(new CustomEvent("abyssspin:auth-notice", { detail: { message: "Profil został zapisany." } }));
  } catch (error) {
    profileError.textContent = error.message;
    profileError.hidden = false;
  } finally {
    profileSave.disabled = false;
    profileSave.textContent = "ZAPISZ PROFIL";
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordError.hidden = true;
  if (newPasswordInput.value !== confirmPasswordInput.value) {
    passwordError.textContent = "Nowe hasła nie są identyczne.";
    passwordError.hidden = false;
    confirmPasswordInput.focus();
    return;
  }
  passwordSubmit.disabled = true;
  passwordSubmit.textContent = "ZAPISYWANIE...";
  try {
    await requestJson("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPasswordInput.value,
        new_password: newPasswordInput.value,
      }),
    });
    passwordForm.reset();
    passwordError.hidden = true;
    window.dispatchEvent(new CustomEvent("abyssspin:auth-notice", { detail: { message: "Hasło zostało zmienione." } }));
  } catch (error) {
    passwordError.textContent = error.message;
    passwordError.hidden = false;
  } finally {
    passwordSubmit.disabled = false;
    passwordSubmit.textContent = "ZAPISZ NOWE HASŁO";
  }
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showAuthError("");
  authSubmit.disabled = true;
  authSubmit.textContent = authMode === "register" ? "TWORZENIE KONTA..." : "LOGOWANIE...";
  try {
    const result = await requestJson(`/api/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value,
        ...(authMode === "register" ? { email: emailInput.value.trim() } : {}),
      }),
    });
    if (result.pending_approval) {
      passwordInput.value = "";
      emailInput.value = "";
      setAuthMode("login");
      showAuthError("Konto zostało utworzone. Administrator musi je zatwierdzić przed pierwszym logowaniem.");
      return;
    }
    const [appData, profile] = await Promise.all([
      requestJson("/api/data"),
      requestJson("/api/profile"),
    ]);
    passwordInput.value = "";
    setAuthMode("login");
    await showApp(result.username, { appData, profile }, result.is_admin);
  } catch (error) {
    showAuthError(error.message);
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === "register" ? "UTWÓRZ KONTO" : "ZALOGUJ SIĘ";
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await requestJson("/api/auth/logout", { method: "POST", body: "{}" });
  } catch (error) {
    console.error("Nie udało się wylogować.", error);
    window.dispatchEvent(new CustomEvent("abyssspin:auth-error", { detail: { message: error.message } }));
    logoutButton.disabled = false;
    return;
  }
  appShell.hidden = true;
  bottomNav.hidden = true;
  loginScreen.hidden = false;
  window.dispatchEvent(new Event("abyssspin:logged-out"));
  usernameInput.value = "";
  passwordInput.value = "";
  setAuthMode("login");
  logoutButton.disabled = false;
  usernameInput.focus();
});

window.addEventListener("abyssspin:session-expired", () => {
  appShell.hidden = true;
  bottomNav.hidden = true;
  loginScreen.hidden = false;
  setAuthMode("login");
  showAuthError("Sesja wygasła. Zaloguj się ponownie.");
});

window.AbyssSpinAuth = { requestJson };
if (!resetTokenFromUrl) restoreSession();
