const chatElements = {
  dialog: document.querySelector("#chat-dialog"),
  open: document.querySelector("#chat-open"),
  close: document.querySelector("#chat-close"),
  unread: document.querySelector("#chat-unread-count"),
  status: document.querySelector("#chat-status"),
  onlineCount: document.querySelector("#chat-online-count"),
  offlineCount: document.querySelector("#chat-offline-count"),
  onlineUsers: document.querySelector("#chat-online-users"),
  offlineUsers: document.querySelector("#chat-offline-users"),
  messages: document.querySelector("#chat-messages"),
  empty: document.querySelector("#chat-empty"),
  form: document.querySelector("#chat-form"),
  input: document.querySelector("#chat-message-input"),
  send: document.querySelector("#chat-send"),
  emojiButton: document.querySelector("#chat-emoji-button"),
  emojiPicker: document.querySelector("#chat-emoji-picker"),
  friendsOpen: document.querySelector("#friends-open"),
  settingsNotifications: document.querySelector("#settings-notifications"),
  settingsNotificationStatus: document.querySelector("#settings-notification-status"),
  friendsDialog: document.querySelector("#friends-dialog"),
  friendsClose: document.querySelector("#friends-close"),
  directMessageDialog: document.querySelector("#direct-message-dialog"),
  directMessageClose: document.querySelector("#direct-message-close"),
  directMessageTitle: document.querySelector("#direct-message-title"),
  directMessageRecipient: document.querySelector("#direct-message-recipient"),
  directMessageStatus: document.querySelector("#direct-message-status"),
  directMessageList: document.querySelector("#direct-message-list"),
  directMessageEmpty: document.querySelector("#direct-message-empty"),
  directMessageForm: document.querySelector("#direct-message-form"),
  directMessageInput: document.querySelector("#direct-message-input"),
  directMessageSend: document.querySelector("#direct-message-send"),
  friendsIncomingBadge: document.querySelector("#friends-incoming-badge"),
  friendsStatus: document.querySelector("#friends-status"),
  friendsIncoming: document.querySelector("#friends-incoming"),
  friendsIncomingCount: document.querySelector("#friends-incoming-count"),
  friendsIncomingEmpty: document.querySelector("#friends-incoming-empty"),
  friendsList: document.querySelector("#friends-list"),
  friendsCount: document.querySelector("#friends-count"),
  friendsEmpty: document.querySelector("#friends-empty"),
  friendsOutgoing: document.querySelector("#friends-outgoing"),
  friendsOutgoingCount: document.querySelector("#friends-outgoing-count"),
  friendsOutgoingEmpty: document.querySelector("#friends-outgoing-empty"),
  userProfileDialog: document.querySelector("#user-profile-dialog"),
  userProfileClose: document.querySelector("#user-profile-close"),
  userProfileInitial: document.querySelector("#public-profile-initial"),
  userProfileAvatar: document.querySelector("#public-profile-avatar"),
  userProfileName: document.querySelector("#public-profile-name"),
  userProfileUsername: document.querySelector("#public-profile-username"),
  userProfilePresence: document.querySelector("#public-profile-presence"),
  userProfileDiscord: document.querySelector("#public-profile-discord"),
  userProfileActivision: document.querySelector("#public-profile-activision"),
  userProfileStatus: document.querySelector("#user-profile-status"),
  userProfileActions: document.querySelector("#user-profile-actions"),
};

const chatEmojis = ["😀", "😎", "😂", "🤣", "🥹", "😍", "🤔", "😭", "😡", "🔥", "🎮", "🎯", "💀", "👀", "👏", "🤝", "❤️", "💪", "👍", "👎", "✅", "❌", "🏆", "🚀"];
let chatAuthenticated = false;
let chatUsername = "";
let chatUnread = 0;
let lastMessageId = 0;
let hasLoadedChat = false;
let chatRefreshTimer = null;
let chatRefreshInFlight = false;
let selectedProfileUsername = "";
let friendsRefreshCounter = 0;
let directMessageUsername = "";
let directMessageAfterId = 0;
let directMessageRefreshTimer = null;
let directMessageRefreshInFlight = "";
let directMessageUnavailable = false;
let notificationRefreshTimer = null;
let notificationRefreshInFlight = false;
let notificationCursor = 0;
let notificationsPrimed = false;
let notificationGeneration = 0;
let notificationToastStack = null;

function updateNotificationSettings() {
  if (!("Notification" in window)) {
    chatElements.settingsNotificationStatus.textContent = "Systemowe wymagają localhost lub HTTPS; alerty w aplikacji działają";
    chatElements.settingsNotifications.disabled = true;
    return;
  }
  const permission = Notification.permission;
  if (permission === "granted") {
    chatElements.settingsNotificationStatus.textContent = "Powiadomienia systemowe są włączone";
    chatElements.settingsNotifications.disabled = true;
  } else if (permission === "denied") {
    chatElements.settingsNotificationStatus.textContent = "Zablokowane — zmień uprawnienia strony w przeglądarce";
    chatElements.settingsNotifications.disabled = true;
  } else {
    chatElements.settingsNotificationStatus.textContent = "Włącz alerty systemowe o zaproszeniach i wiadomościach";
    chatElements.settingsNotifications.disabled = false;
  }
}

function openNotificationTarget(type, user) {
  if (type === "friend-request") {
    chatElements.friendsOpen.click();
    return;
  }
  openDirectMessage(user);
}

function showAppNotification(type, user) {
  if (!notificationToastStack) {
    notificationToastStack = document.createElement("div");
    notificationToastStack.className = "app-notification-stack";
    notificationToastStack.setAttribute("role", "status");
    notificationToastStack.setAttribute("aria-live", "polite");
    document.body.append(notificationToastStack);
  }

  const notification = document.createElement("article");
  notification.className = "app-notification";
  const text = document.createElement("p");
  const title = document.createElement("strong");
  const detail = document.createElement("span");
  if (type === "friend-request") {
    title.textContent = "Nowe zaproszenie do znajomych";
    detail.textContent = user.display_name || user.username;
  } else {
    title.textContent = "Nowa prywatna wiadomość";
    detail.textContent = user.display_name || user.username;
  }
  text.append(title, detail);
  const action = document.createElement("button");
  action.type = "button";
  action.textContent = type === "friend-request" ? "ZOBACZ" : "OTWÓRZ";
  action.addEventListener("click", () => {
    openNotificationTarget(type, user);
    notification.remove();
  });
  notification.append(text, action);
  notificationToastStack.append(notification);
  setTimeout(() => notification.remove(), 8000);
}

function deliverNotification(type, user) {
  showAppNotification(type, user);
  if (document.visibilityState === "visible" || !("Notification" in window)
      || Notification.permission !== "granted") return;

  const title = type === "friend-request" ? "Zaproszenie do znajomych" : "Nowa prywatna wiadomość";
  const body = type === "friend-request"
    ? `${user.display_name || user.username} wysłał(a) Ci zaproszenie.`
    : `Nowa wiadomość od ${user.display_name || user.username}.`;
  try {
    const notification = new Notification(title, { body, tag: `${type}-${user.username}` });
    notification.addEventListener("click", () => {
      window.focus();
      openNotificationTarget(type, user);
      notification.close();
    }, { once: true });
  } catch (error) {
    console.error("Nie udało się wyświetlić powiadomienia systemowego.", error);
  }
}

async function refreshNotifications() {
  if (!chatAuthenticated || notificationRefreshInFlight) return;
  notificationRefreshInFlight = true;
  const generation = notificationGeneration;
  try {
    const suffix = notificationCursor ? `?since=${notificationCursor}` : "";
    const result = await chatRequest(`/api/notifications${suffix}`);
    if (!chatAuthenticated || generation !== notificationGeneration) return;
    const events = [
      ...result.friend_requests.map((user) => ({ type: "friend-request", user, id: user.id })),
      ...result.messages.map((user) => ({ type: "message", user, id: user.id })),
    ];
    if (notificationsPrimed) {
      for (const event of events) {
        const key = `${event.type}:${event.id}`;
        if (seenNotifications.has(key)) continue;
        seenNotifications.add(key);
        deliverNotification(event.type, event.user);
      }
    } else {
      for (const event of events) seenNotifications.add(`${event.type}:${event.id}`);
      notificationsPrimed = true;
    }
    notificationCursor = Math.max(notificationCursor, result.server_time);
  } catch (error) {
    console.error("Nie udało się sprawdzić nowych powiadomień.", error);
  } finally {
    notificationRefreshInFlight = false;
  }
}

const seenNotifications = new Set();

function setChatStatus(message = "", isError = false) {
  chatElements.status.textContent = message;
  chatElements.status.hidden = !message;
  chatElements.status.classList.toggle("is-error", isError);
}

function setChatUnread(count) {
  chatUnread = count;
  chatElements.unread.textContent = count > 99 ? "99+" : String(count);
  chatElements.unread.hidden = count === 0;
}

async function chatRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    throw new Error("Nie udało się połączyć z serwerem czatu.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("Serwer czatu zwrócił nieprawidłową odpowiedź.");
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("abyssspin:session-expired"));
    const error = new Error(payload.error || "Nie udało się wykonać operacji na czacie.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function renderChatUsers(users) {
  const online = users.filter((user) => user.is_online);
  const offline = users.filter((user) => !user.is_online);
  chatElements.onlineCount.textContent = String(online.length);
  chatElements.offlineCount.textContent = String(offline.length);
  renderChatUserGroup(chatElements.onlineUsers, online, true);
  renderChatUserGroup(chatElements.offlineUsers, offline, false);
}

function renderChatUserGroup(container, users, isOnline) {
  container.replaceChildren();
  if (!users.length) {
    const empty = document.createElement("li");
    empty.className = "chat-user-empty";
    empty.textContent = isOnline ? "Czekam na graczy..." : "Brak użytkowników";
    container.append(empty);
    return;
  }
  for (const user of users) {
    const item = document.createElement("li");
    item.className = "chat-user";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-user-button";
    button.setAttribute("aria-label", `Pokaż profil użytkownika ${user.display_name || user.username}`);
    button.addEventListener("click", () => showUserProfile(user.username));
    const avatar = document.createElement("span");
    avatar.className = "chat-user-avatar";
    avatar.textContent = (user.display_name || user.username).trim().charAt(0).toLocaleUpperCase("pl-PL");
    const details = document.createElement("span");
    details.className = "chat-user-details";
    const name = document.createElement("strong");
    name.textContent = user.display_name || user.username;
    const state = document.createElement("small");
    state.textContent = user.username.toLocaleLowerCase("pl-PL") === chatUsername.toLocaleLowerCase("pl-PL")
      ? "TY · ONLINE"
      : isOnline ? "DOSTĘPNY" : "NIEAKTYWNY";
    details.append(name, state);
    const indicator = document.createElement("i");
    indicator.className = "chat-user-indicator";
    button.append(avatar, details, indicator);
    item.append(button);
    container.append(item);
  }
}

function setFriendsStatus(message = "", isError = false) {
  chatElements.friendsStatus.textContent = message;
  chatElements.friendsStatus.hidden = !message;
  chatElements.friendsStatus.classList.toggle("is-error", isError);
}

function setUserProfileStatus(message = "", isError = false) {
  chatElements.userProfileStatus.textContent = message;
  chatElements.userProfileStatus.hidden = !message;
  chatElements.userProfileStatus.classList.toggle("is-error", isError);
}

function appendFriendButton(container, label, action, username, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `friend-action-button ${className}`;
  button.textContent = label;
  button.addEventListener("click", () => performFriendAction(action, username, button));
  container.append(button);
  return button;
}

async function performFriendAction(action, username, button) {
  button.disabled = true;
  setFriendsStatus("");
  setUserProfileStatus("");
  try {
    await chatRequest(`/api/friends/${action}`, {
      method: "POST",
      body: JSON.stringify({ username }),
    });
    await Promise.all([
      refreshFriends(),
      chatElements.userProfileDialog.open && selectedProfileUsername
        ? showUserProfile(selectedProfileUsername)
        : Promise.resolve(),
    ]);
    setFriendsStatus(
      action === "request" ? "Zaproszenie zostało wysłane."
        : action === "accept" ? "Zaproszenie zaakceptowane — użytkownik jest już znajomym."
          : action === "remove" ? "Znajomość została usunięta."
            : "Zaproszenie zostało odrzucone.",
    );
    if (chatElements.userProfileDialog.open) {
      setUserProfileStatus(
        action === "request" ? "Zaproszenie zostało wysłane."
          : action === "accept" ? "Zaproszenie zaakceptowane."
            : action === "remove" ? "Znajomość została usunięta."
              : "Zaproszenie zostało odrzucone.",
      );
    }
  } catch (error) {
    console.error("Nie udało się zmienić statusu znajomości.", error);
    setFriendsStatus(error.message, true);
    setUserProfileStatus(error.message, true);
    button.disabled = false;
  }
}

function renderUserProfile(profile) {
  const initial = (profile.display_name || profile.username).trim().charAt(0).toLocaleUpperCase("pl-PL");
  chatElements.userProfileInitial.textContent = initial;
  if (profile.avatar) {
    chatElements.userProfileAvatar.src = profile.avatar;
    chatElements.userProfileAvatar.hidden = false;
    chatElements.userProfileInitial.hidden = true;
  } else {
    chatElements.userProfileAvatar.removeAttribute("src");
    chatElements.userProfileAvatar.hidden = true;
    chatElements.userProfileInitial.hidden = false;
  }
  chatElements.userProfileName.textContent = profile.display_name || profile.username;
  chatElements.userProfileUsername.textContent = `@${profile.username}`;
  chatElements.userProfilePresence.textContent = profile.is_online ? "ONLINE" : "NIEAKTYWNY";
  chatElements.userProfilePresence.classList.toggle("is-online", profile.is_online);
  chatElements.userProfileDiscord.textContent = profile.display_name || "—";
  chatElements.userProfileActivision.textContent = profile.activisionId || "—";
  chatElements.userProfileActions.replaceChildren();
  if (profile.is_self) {
    const note = document.createElement("p");
    note.className = "friends-empty";
    note.textContent = "To jest Twój profil.";
    chatElements.userProfileActions.append(note);
  } else if (profile.friend_status === "friends") {
    appendFriendButton(chatElements.userProfileActions, "USUŃ ZE ZNAJOMYCH", "remove", profile.username, "friend-remove");
  } else if (profile.friend_status === "pending" && profile.friend_direction === "incoming") {
    appendFriendButton(chatElements.userProfileActions, "AKCEPTUJ ZAPROSZENIE", "accept", profile.username, "friend-accept");
    appendFriendButton(chatElements.userProfileActions, "ODRZUĆ", "reject", profile.username, "friend-remove");
  } else if (profile.friend_status === "pending") {
    const note = document.createElement("p");
    note.className = "friends-pending-note";
    note.textContent = "Zaproszenie oczekuje na odpowiedź.";
    chatElements.userProfileActions.append(note);
    appendFriendButton(chatElements.userProfileActions, "ANULUJ ZAPROSZENIE", "remove", profile.username, "friend-remove");
  } else {
    appendFriendButton(chatElements.userProfileActions, "＋ DODAJ DO ZNAJOMYCH", "request", profile.username, "friend-accept");
  }
}

async function showUserProfile(username) {
  if (!chatElements.userProfileDialog.open) chatElements.userProfileDialog.showModal();
  selectedProfileUsername = username;
  setUserProfileStatus("Ładowanie profilu...");
  chatElements.userProfileActions.replaceChildren();
  try {
    const profile = await chatRequest(`/api/user?username=${encodeURIComponent(username)}`);
    if (selectedProfileUsername !== username) return;
    renderUserProfile(profile);
    setUserProfileStatus("");
  } catch (error) {
    console.error("Nie udało się wczytać profilu użytkownika.", error);
    setUserProfileStatus(error.message, true);
  }
}

function createFriendCard(user, actions = []) {
  const item = document.createElement("article");
  item.className = "friend-card";
  const identity = document.createElement("button");
  identity.type = "button";
  identity.className = "friend-card-identity";
  identity.addEventListener("click", () => showUserProfile(user.username));
  const avatar = document.createElement("span");
  avatar.className = "friend-card-avatar";
  if (user.avatar) {
    const image = document.createElement("img");
    image.src = user.avatar;
    image.alt = "";
    avatar.append(image);
  } else {
    avatar.textContent = (user.display_name || user.username).trim().charAt(0).toLocaleUpperCase("pl-PL");
  }
  const name = document.createElement("span");
  name.className = "friend-card-name";
  const displayName = document.createElement("strong");
  displayName.textContent = user.display_name || user.username;
  const usernameLabel = document.createElement("small");
  usernameLabel.textContent = `@${user.username}`;
  name.append(displayName, usernameLabel);
  identity.append(avatar, name);
  const controls = document.createElement("div");
  controls.className = "friend-card-actions";
  for (const [label, action, className] of actions) {
    if (action === "message") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `friend-action-button ${className}`;
      button.textContent = label;
      button.setAttribute("aria-label", `Napisz prywatną wiadomość do ${user.display_name || user.username}`);
      button.addEventListener("click", () => openDirectMessage(user));
      controls.append(button);
    } else {
      appendFriendButton(controls, label, action, user.username, className);
    }
  }
  item.append(identity, controls);
  return item;
}

async function refreshFriends() {
  if (!chatAuthenticated) return;
  try {
    const result = await chatRequest("/api/friends");
    chatElements.friendsIncoming.replaceChildren();
    chatElements.friendsList.replaceChildren();
    chatElements.friendsOutgoing.replaceChildren();
    chatElements.friendsIncomingCount.textContent = String(result.incoming.length);
    chatElements.friendsCount.textContent = String(result.friends.length);
    chatElements.friendsOutgoingCount.textContent = String(result.outgoing.length);
    chatElements.friendsIncomingEmpty.hidden = result.incoming.length > 0;
    chatElements.friendsEmpty.hidden = result.friends.length > 0;
    chatElements.friendsOutgoingEmpty.hidden = result.outgoing.length > 0;
    chatElements.friendsIncomingBadge.textContent = result.incoming.length > 99 ? "99+" : String(result.incoming.length);
    chatElements.friendsIncomingBadge.hidden = result.incoming.length === 0;
    for (const user of result.incoming) {
      chatElements.friendsIncoming.append(
        createFriendCard(user, [
          ["AKCEPTUJ", "accept", "friend-accept"],
          ["ODRZUĆ", "reject", "friend-remove"],
        ]),
      );
    }
    for (const user of result.friends) {
      chatElements.friendsList.append(
        createFriendCard(user, [
          ["NAPISZ", "message", "friend-accept"],
          ["USUŃ", "remove", "friend-remove"],
        ]),
      );
    }
    for (const user of result.outgoing) {
      chatElements.friendsOutgoing.append(
        createFriendCard(user, [["ANULUJ", "remove", "friend-remove"]]),
      );
    }
    setFriendsStatus("");
  } catch (error) {
    console.error("Nie udało się odświeżyć listy znajomych.", error);
    if (chatElements.friendsDialog.open) setFriendsStatus(error.message, true);
  }
}

function formatMessageTime(timestamp) {
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function setDirectMessageStatus(message = "", isError = false) {
  chatElements.directMessageStatus.textContent = message;
  chatElements.directMessageStatus.hidden = !message;
  chatElements.directMessageStatus.classList.toggle("is-error", isError);
}

function stopDirectMessageRefresh() {
  clearInterval(directMessageRefreshTimer);
  directMessageRefreshTimer = null;
}

function appendDirectMessage(message) {
  if (!Number.isSafeInteger(message.id) || message.id <= directMessageAfterId) return;
  chatElements.directMessageEmpty.hidden = true;
  const shouldScroll = chatElements.directMessageList.scrollHeight
    - chatElements.directMessageList.scrollTop
    - chatElements.directMessageList.clientHeight < 80;
  const item = document.createElement("article");
  item.className = "direct-message";
  if (message.username.toLocaleLowerCase("pl-PL") === chatUsername.toLocaleLowerCase("pl-PL")) {
    item.classList.add("is-mine");
  }
  const meta = document.createElement("div");
  meta.className = "direct-message-meta";
  const author = document.createElement("strong");
  author.textContent = message.display_name || message.username;
  const time = document.createElement("time");
  time.dateTime = new Date(message.created_at * 1000).toISOString();
  time.textContent = formatMessageTime(message.created_at);
  meta.append(author, time);
  const body = document.createElement("p");
  body.textContent = message.message;
  item.append(meta, body);
  chatElements.directMessageList.append(item);
  directMessageAfterId = message.id;
  if (shouldScroll || item.classList.contains("is-mine")) {
    chatElements.directMessageList.scrollTop = chatElements.directMessageList.scrollHeight;
  }
}

async function refreshDirectMessages() {
  if (!chatAuthenticated || !directMessageUsername || directMessageUnavailable
      || directMessageRefreshInFlight === directMessageUsername) return;
  const conversationUsername = directMessageUsername;
  directMessageRefreshInFlight = conversationUsername;
  try {
    const suffix = directMessageAfterId
      ? `&after=${directMessageAfterId}`
      : "";
    const result = await chatRequest(
      `/api/friends/messages?username=${encodeURIComponent(conversationUsername)}${suffix}`,
    );
    if (directMessageUsername !== conversationUsername) return;
    for (const message of result.messages) appendDirectMessage(message);
    chatElements.directMessageSend.disabled = false;
    setDirectMessageStatus("");
  } catch (error) {
    console.error("Nie udało się odświeżyć prywatnej rozmowy.", error);
    if (directMessageUsername === conversationUsername) {
      setDirectMessageStatus(error.message, true);
      if (error.status === 403 || error.status === 404) {
        directMessageUnavailable = true;
        stopDirectMessageRefresh();
        chatElements.directMessageSend.disabled = true;
      }
    }
  } finally {
    if (directMessageRefreshInFlight === conversationUsername) directMessageRefreshInFlight = "";
  }
}

function openDirectMessage(user) {
  chatElements.friendsDialog.close();
  directMessageUsername = user.username;
  directMessageAfterId = 0;
  directMessageUnavailable = false;
  chatElements.directMessageList.replaceChildren(chatElements.directMessageEmpty);
  chatElements.directMessageEmpty.hidden = false;
  chatElements.directMessageTitle.textContent = "Wiadomości";
  chatElements.directMessageRecipient.textContent = `${user.display_name || user.username} · @${user.username}`;
  chatElements.directMessageInput.value = "";
  chatElements.directMessageSend.disabled = false;
  setDirectMessageStatus("Ładowanie wiadomości...");
  chatElements.directMessageDialog.showModal();
  chatElements.directMessageInput.focus();
  stopDirectMessageRefresh();
  refreshDirectMessages();
  directMessageRefreshTimer = setInterval(refreshDirectMessages, 3000);
}

function appendChatMessage(message, isInitial = false) {
  if (!Number.isSafeInteger(message.id) || message.id <= lastMessageId) return;
  chatElements.empty.hidden = true;
  const shouldScroll = chatElements.dialog.open
    && chatElements.messages.scrollHeight - chatElements.messages.scrollTop - chatElements.messages.clientHeight < 80;
  const item = document.createElement("article");
  item.className = "chat-message";
  if (message.username.toLocaleLowerCase("pl-PL") === chatUsername.toLocaleLowerCase("pl-PL")) {
    item.classList.add("is-mine");
  }
  const meta = document.createElement("div");
  meta.className = "chat-message-meta";
  const author = document.createElement("strong");
  author.textContent = message.display_name || message.username;
  const time = document.createElement("time");
  time.dateTime = new Date(message.created_at * 1000).toISOString();
  time.textContent = formatMessageTime(message.created_at);
  meta.append(author, time);
  const body = document.createElement("p");
  body.textContent = message.message;
  item.append(meta, body);
  chatElements.messages.append(item);
  lastMessageId = message.id;
  if (!isInitial && !item.classList.contains("is-mine") && !chatElements.dialog.open) {
    setChatUnread(chatUnread + 1);
  }
  if (shouldScroll || isInitial || chatElements.dialog.open) {
    chatElements.messages.scrollTop = chatElements.messages.scrollHeight;
  }
}

async function refreshChat() {
  if (!chatAuthenticated || chatRefreshInFlight) return;
  chatRefreshInFlight = true;
  try {
    await chatRequest("/api/chat/presence", { method: "POST", body: "{}" });
    const suffix = hasLoadedChat ? `?after=${lastMessageId}` : "?initial=1";
    const snapshot = await chatRequest(`/api/chat${suffix}`);
    renderChatUsers(snapshot.users);
    for (const message of snapshot.messages) appendChatMessage(message, !hasLoadedChat);
    hasLoadedChat = true;
    friendsRefreshCounter += 1;
    if (friendsRefreshCounter >= 3 || chatElements.friendsDialog.open) {
      friendsRefreshCounter = 0;
      refreshFriends();
    }
    setChatStatus("");
  } catch (error) {
    console.error("Nie udało się odświeżyć czatu.", error);
    setChatStatus(`Utracono połączenie: ${error.message}`, true);
  } finally {
    chatRefreshInFlight = false;
  }
}

function startChat(username) {
  stopChat();
  chatAuthenticated = true;
  chatUsername = username;
  notificationCursor = 0;
  notificationsPrimed = false;
  seenNotifications.clear();
  chatUnread = 0;
  lastMessageId = 0;
  hasLoadedChat = false;
  friendsRefreshCounter = 0;
  chatElements.messages.querySelectorAll(".chat-message").forEach((message) => message.remove());
  chatElements.empty.hidden = false;
  renderChatUsers([]);
  setChatUnread(0);
  setChatStatus("");
  updateNotificationSettings();
  refreshNotifications();
  refreshChat();
  chatRefreshTimer = setInterval(refreshChat, 5000);
  notificationRefreshTimer = setInterval(refreshNotifications, 5000);
}

function stopChat() {
  chatAuthenticated = false;
  notificationGeneration += 1;
  clearInterval(chatRefreshTimer);
  chatRefreshTimer = null;
  chatRefreshInFlight = false;
  clearInterval(notificationRefreshTimer);
  notificationRefreshTimer = null;
}

chatEmojis.forEach((emoji) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-emoji";
  button.textContent = emoji;
  button.setAttribute("aria-label", `Wstaw ${emoji}`);
  button.addEventListener("click", () => {
    const input = chatElements.input;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.setRangeText(emoji, start, end, "end");
    input.focus();
    chatElements.emojiPicker.hidden = true;
    chatElements.emojiButton.setAttribute("aria-expanded", "false");
  });
  chatElements.emojiPicker.append(button);
});

chatElements.open.addEventListener("click", () => {
  chatElements.dialog.showModal();
  setChatUnread(0);
  chatElements.messages.scrollTop = chatElements.messages.scrollHeight;
  chatElements.input.focus();
});
chatElements.friendsOpen.addEventListener("click", () => {
  chatElements.friendsDialog.showModal();
  setFriendsStatus("");
  refreshFriends();
});
chatElements.settingsNotifications.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    updateNotificationSettings();
    return;
  }
  try {
    await Notification.requestPermission();
    updateNotificationSettings();
  } catch (error) {
    console.error("Nie udało się uzyskać zgody na powiadomienia.", error);
    chatElements.settingsNotificationStatus.textContent = "Nie udało się zmienić uprawnień powiadomień";
  }
});
chatElements.friendsClose.addEventListener("click", () => chatElements.friendsDialog.close());
chatElements.directMessageClose.addEventListener("click", () => chatElements.directMessageDialog.close());
chatElements.directMessageDialog.addEventListener("click", (event) => {
  if (event.target === chatElements.directMessageDialog) chatElements.directMessageDialog.close();
});
chatElements.directMessageDialog.addEventListener("close", stopDirectMessageRefresh);
chatElements.friendsDialog.addEventListener("click", (event) => {
  if (event.target === chatElements.friendsDialog) chatElements.friendsDialog.close();
});
chatElements.userProfileClose.addEventListener("click", () => chatElements.userProfileDialog.close());
chatElements.userProfileDialog.addEventListener("click", (event) => {
  if (event.target === chatElements.userProfileDialog) chatElements.userProfileDialog.close();
});
chatElements.userProfileDialog.addEventListener("close", () => {
  selectedProfileUsername = "";
});
chatElements.friendsDialog.addEventListener("close", () => setFriendsStatus(""));
chatElements.close.addEventListener("click", () => chatElements.dialog.close());
chatElements.dialog.addEventListener("click", (event) => {
  if (event.target === chatElements.dialog) chatElements.dialog.close();
});
chatElements.dialog.addEventListener("close", () => {
  chatElements.emojiPicker.hidden = true;
  chatElements.emojiButton.setAttribute("aria-expanded", "false");
});
chatElements.emojiButton.addEventListener("click", () => {
  chatElements.emojiPicker.hidden = !chatElements.emojiPicker.hidden;
  chatElements.emojiButton.setAttribute("aria-expanded", String(!chatElements.emojiPicker.hidden));
});
chatElements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatElements.form.requestSubmit();
  }
});
chatElements.directMessageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatElements.directMessageForm.requestSubmit();
  }
});
chatElements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatElements.input.value.trim();
  if (!message || !chatAuthenticated || chatElements.send.disabled) return;
  chatElements.send.disabled = true;
  setChatStatus("");
  try {
    await chatRequest("/api/chat/messages", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    chatElements.input.value = "";
    refreshChat();
  } catch (error) {
    console.error("Nie udało się wysłać wiadomości czatu.", error);
    setChatStatus(error.message, true);
  } finally {
    chatElements.send.disabled = false;
  }
});
chatElements.directMessageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatElements.directMessageInput.value.trim();
  if (!message || !directMessageUsername || directMessageUnavailable || chatElements.directMessageSend.disabled) return;
  chatElements.directMessageSend.disabled = true;
  setDirectMessageStatus("");
  try {
    await chatRequest("/api/friends/messages", {
      method: "POST",
      body: JSON.stringify({ username: directMessageUsername, message }),
    });
    chatElements.directMessageInput.value = "";
    directMessageAfterId = 0;
    chatElements.directMessageList.replaceChildren(chatElements.directMessageEmpty);
    chatElements.directMessageEmpty.hidden = true;
    await refreshDirectMessages();
  } catch (error) {
    console.error("Nie udało się wysłać prywatnej wiadomości.", error);
    setDirectMessageStatus(error.message, true);
    if (error.status === 403 || error.status === 404) {
      directMessageUnavailable = true;
      stopDirectMessageRefresh();
    }
  } finally {
    if (directMessageUsername && !directMessageUnavailable) chatElements.directMessageSend.disabled = false;
  }
});

window.addEventListener("abyssspin:authenticated", (event) => startChat(event.detail.username));
window.addEventListener("abyssspin:logged-out", () => {
  stopChat();
  stopDirectMessageRefresh();
  if (chatElements.directMessageDialog.open) chatElements.directMessageDialog.close();
});
window.addEventListener("abyssspin:session-expired", () => {
  stopChat();
  stopDirectMessageRefresh();
  if (chatElements.directMessageDialog.open) chatElements.directMessageDialog.close();
});

updateNotificationSettings();
