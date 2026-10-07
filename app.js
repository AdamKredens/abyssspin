const elements = {
  addForm: document.querySelector("#add-player-form"),
  playerInput: document.querySelector("#player-name"),
  playerList: document.querySelector("#player-list"),
  playerCount: document.querySelector("#player-count"),
  playerCountCopy: document.querySelector("#player-count-copy"),
  teamCount: document.querySelector("#team-count"),
  lastRotation: document.querySelector("#last-rotation"),
  rosterEmpty: document.querySelector("#roster-empty"),
  importButton: document.querySelector("#import-button"),
  importFile: document.querySelector("#import-file"),
  photoImportButton: document.querySelector("#photo-import-button"),
  photoImportFile: document.querySelector("#photo-import-file"),
  cameraImportButton: document.querySelector("#camera-import-button"),
  cameraImportFile: document.querySelector("#camera-import-file"),
  photoImportDialog: document.querySelector("#photo-import-dialog"),
  photoImportClose: document.querySelector("#photo-import-close"),
  photoImportCancel: document.querySelector("#photo-import-cancel"),
  photoImportPreview: document.querySelector("#photo-import-preview"),
  photoImportProgress: document.querySelector("#photo-import-progress"),
  photoImportNames: document.querySelector("#photo-import-names"),
  photoImportAdd: document.querySelector("#photo-import-add"),
  spinButton: document.querySelector("#spin-button"),
  status: document.querySelector("#status-message"),
  teams: document.querySelector("#teams-container"),
  summary: document.querySelector("#result-summary"),
  boardTitle: document.querySelector("#board-title"),
  boardBadge: document.querySelector("#board-badge"),
  rotationFlow: document.querySelector("#rotation-flow-items"),
  exportButton: document.querySelector("#export-button"),
  copyButton: document.querySelector("#copy-button"),
  webhookButton: document.querySelector("#webhook-button"),
  resetHistory: document.querySelector("#reset-history"),
  history: document.querySelector("#history-list"),
  historyEmpty: document.querySelector("#history-empty"),
  teamSize: document.querySelector("#team-size"),
  sizeLabel: document.querySelector("#size-label"),
  bottomNav: document.querySelector("#bottom-nav"),
  homeView: document.querySelector("#home-view"),
  metaView: document.querySelector("#meta-view"),
  metaSearch: document.querySelector("#meta-search"),
  metaFilters: document.querySelector("#meta-filters"),
  metaWeapons: document.querySelector("#meta-weapons"),
  metaEmpty: document.querySelector("#meta-empty"),
  metaBuildCount: document.querySelector("#meta-build-count"),
  metaCategoryCount: document.querySelector("#meta-category-count"),
  metaUpdated: document.querySelector("#meta-updated"),
  chatOpen: document.querySelector("#chat-open"),
  chatDialog: document.querySelector("#chat-dialog"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsClose: document.querySelector("#settings-close"),
  settingsProfile: document.querySelector("#settings-profile"),
  settingsFriends: document.querySelector("#settings-friends"),
  settingsLogout: document.querySelector("#settings-logout"),
  settingsAdmin: document.querySelector("#settings-admin"),
  friendsOpen: document.querySelector("#friends-open"),
  adminButton: document.querySelector("#admin-button"),
  profileButton: document.querySelector("#profile-button"),
};

let state = { players: [], history: [] };
let preferredSize = 4;
let isAuthenticated = false;
let saveTimer = null;
let saveQueue = Promise.resolve();
let ocrLibraryPromise = null;
let photoPreviewUrl = null;
let spinInProgress = false;
let activeView = "home";
let activeMetaFilter = "all";

window.ABYSSSPIN_WEAPON_META = [
  {
    name: "Voyak KT-3",
    category: "ar",
    categoryLabel: "AR · LONG RANGE",
    role: "Karabin na średni i daleki dystans · Black Ops 7",
    rank: "S TIER",
    icon: "⌖",
    updated: "2026-09-25",
    buildCode: "A09-23Y1W-DYN6F-11",
    attachments: [
      { slot: "OPT.", name: "Redwell 30-S 2x" },
      { slot: "MUZZLE", name: "Monolithic Suppressor" },
      { slot: "LUFA", name: '17.6" LTI Grav-4 Barrel' },
      { slot: "MAG.", name: "Slipjoint Flip Mag" },
      { slot: "KOLBA", name: "V-Last Control Pad" },
    ],
  },
  {
    name: "VMP",
    category: "smg",
    categoryLabel: "SMG · CLOSE RANGE",
    role: "Pistolet maszynowy do krótkiego dystansu · Black Ops 7",
    rank: "S TIER",
    icon: "⌁",
    updated: "2026-09-30",
    buildCode: "S14-A11S9-911",
    attachments: [
      { slot: "MUZZLE", name: "LTI Stentorian Brake" },
      { slot: "LUFA", name: '10.9" Gambol Light Barrel' },
      { slot: "MAG.", name: "Erudite Extended Mag" },
      { slot: "CHWYT", name: "MFS Tactical Command Grip" },
      { slot: "KOLBA", name: "Greaves Valour Pad" },
    ],
  },
  {
    name: "Strider 300",
    category: "sniper",
    categoryLabel: "SNAJPERKA · SNIPER",
    role: "Karabin snajperski do walki na daleki dystans · Black Ops 7",
    rank: "S TIER",
    icon: "⊙",
    updated: "2026-06-05",
    buildCode: "R07-2JD6P-5NM5G-6J11",
    attachments: [
      { slot: "MUZZLE", name: "Monolithic Suppressor" },
      { slot: "LUFA", name: '25" Bowen Grooved Barrel' },
      { slot: "MAG.", name: "Carnation Fast Mag" },
      { slot: "CHWYT", name: "Hatch Quick Grip" },
      { slot: "AMUNICJA", name: ".300 WM Overpressured" },
    ],
  },
];

const metaCategories = {
  ar: "Karabin szturmowy",
  smg: "Pistolet maszynowy",
  sniper: "Karabin snajperski",
  other: "Pozostała broń",
};

function isValidRotation(rotation) {
  return rotation && typeof rotation.date === "string" && Array.isArray(rotation.teams)
    && (rotation.id === undefined || typeof rotation.id === "string")
    && rotation.teams.every((team) => Array.isArray(team) && team.every((name) => typeof name === "string"))
    && (rotation.leaders === undefined || (Array.isArray(rotation.leaders)
      && rotation.leaders.length === rotation.teams.length
      && rotation.leaders.every((leader, index) => typeof leader === "string" && rotation.teams[index].includes(leader))));
}

function persistState() {
  const snapshot = JSON.stringify({ ...state, preferredSize });
  const request = saveQueue.catch(() => {}).then(() => window.AbyssSpinAuth.requestJson("/api/data", {
    method: "PUT",
    body: snapshot,
  }));
  saveQueue = request.catch((error) => {
    console.error("Nie udało się zapisać danych na koncie.", error);
    showStatus(error.message || "Nie udało się zapisać danych na koncie.");
  });
  return request;
}

function saveState() {
  if (!isAuthenticated) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistState(), 250);
}

async function awardRotationExperience(rotationId) {
  if (!isAuthenticated) return;
  clearTimeout(saveTimer);
  try {
    await persistState();
    const progress = await window.AbyssSpinAuth.requestJson("/api/experience/rotation", {
      method: "POST",
      body: JSON.stringify({ rotation_id: rotationId }),
    });
    window.dispatchEvent(new CustomEvent("abyssspin:experience-updated", { detail: progress }));
    showStatus(
      `+${progress.earned_experience} EXP · LEVEL ${progress.level} · ${progress.experience_in_level}/${progress.experience_to_next_level} EXP`,
    );
  } catch (error) {
    console.error("Nie udało się przyznać EXP za rotację.", error);
    showStatus(`Rotacja została utworzona, ale nie udało się zapisać EXP: ${error.message}`);
  }
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ");
}

function loadOcrLibrary() {
  if (window.Tesseract?.createWorker) return Promise.resolve();
  if (!ocrLibraryPromise) {
    ocrLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.async = true;
      script.onload = () => {
        if (window.Tesseract?.createWorker) resolve();
        else reject(new Error("Nie udało się uruchomić narzędzia OCR."));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("Nie udało się pobrać narzędzia OCR. Sprawdź połączenie z internetem i spróbuj ponownie."));
      };
      document.head.append(script);
    }).catch((error) => {
      ocrLibraryPromise = null;
      throw error;
    });
  }
  return ocrLibraryPromise;
}

function showStatus(message = "") {
  elements.status.textContent = message;
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      if (!copyWithLegacyClipboard(text)) throw error;
      return;
    }
  }
  if (!copyWithLegacyClipboard(text)) {
    throw new Error("Ta przeglądarka nie pozwala skopiować tekstu do schowka.");
  }
}

function copyWithLegacyClipboard(text) {
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  try {
    input.select();
    return document.execCommand("copy");
  } finally {
    input.remove();
  }
}

function setActiveNavigation(view) {
  for (const button of elements.bottomNav.querySelectorAll("[data-nav]")) {
    const isActive = button.dataset.nav === view;
    button.classList.toggle("is-active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function showAppView(view) {
  activeView = view;
  elements.homeView.hidden = view !== "home";
  elements.metaView.hidden = view !== "meta";
  setActiveNavigation(view);
}

function renderMetaWeapons() {
  if (!elements.metaWeapons) return;
  const query = elements.metaSearch.value.trim().toLocaleLowerCase("pl");
  const weapons = window.ABYSSSPIN_WEAPON_META || [];
  const filtered = weapons.filter((weapon) => {
    const categoryMatches = activeMetaFilter === "all" || weapon.category === activeMetaFilter;
    const searchable = [weapon.name, weapon.role, weapon.categoryLabel, ...weapon.attachments.map((item) => item.name)]
      .join(" ")
      .toLocaleLowerCase("pl");
    return categoryMatches && searchable.includes(query);
  });
  elements.metaWeapons.replaceChildren();
  elements.metaBuildCount.textContent = String(weapons.length);
  elements.metaCategoryCount.textContent = String(new Set(weapons.map((weapon) => weapon.category)).size);
  const lastUpdated = weapons.reduce((latest, weapon) => {
    const date = Date.parse(weapon.updated);
    return Number.isNaN(date) ? latest : Math.max(latest, date);
  }, 0);
  elements.metaUpdated.textContent = lastUpdated
    ? new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "short" }).format(lastUpdated)
    : "—";
  elements.metaEmpty.hidden = filtered.length > 0;

  for (const weapon of filtered) {
    const card = document.createElement("article");
    card.className = "meta-weapon-card";
    const header = document.createElement("div");
    header.className = "meta-weapon-header";
    const emblem = document.createElement("span");
    emblem.className = "meta-weapon-emblem";
    emblem.setAttribute("aria-hidden", "true");
    emblem.textContent = weapon.icon;
    const title = document.createElement("div");
    title.className = "meta-weapon-title";
    const category = document.createElement("span");
    category.className = `meta-weapon-category is-${weapon.category}`;
    category.textContent = weapon.categoryLabel || metaCategories[weapon.category] || "Broń";
    const name = document.createElement("h3");
    name.textContent = weapon.name;
    title.append(category, name);
    const rank = document.createElement("span");
    rank.className = "meta-weapon-rank";
    rank.textContent = weapon.rank;
    header.append(emblem, title, rank);

    const role = document.createElement("p");
    role.className = "meta-weapon-role";
    role.textContent = weapon.role;
    const listHeading = document.createElement("p");
    listHeading.className = "meta-attachment-heading";
    listHeading.textContent = "KONFIGURACJA · 5 DODATKÓW";
    const attachmentList = document.createElement("ol");
    attachmentList.className = "meta-attachments";
    for (const [index, attachment] of weapon.attachments.entries()) {
      const item = document.createElement("li");
      const slot = document.createElement("span");
      slot.textContent = attachment.slot || `0${index + 1}`;
      const value = document.createElement("strong");
      value.textContent = attachment.name;
      item.append(slot, value);
      attachmentList.append(item);
    }
    const footer = document.createElement("div");
    footer.className = "meta-weapon-footer";
    const code = document.createElement("code");
    code.className = "meta-build-code";
    code.textContent = weapon.buildCode;
    const copyButton = document.createElement("button");
    copyButton.className = "meta-copy-code";
    copyButton.type = "button";
    copyButton.dataset.copyCode = weapon.buildCode;
    copyButton.setAttribute("aria-label", `Kopiuj kod zestawu ${weapon.name}`);
    copyButton.innerHTML = '<span aria-hidden="true">⧉</span> KOPIUJ KOD';
    const codeGroup = document.createElement("div");
    codeGroup.className = "meta-code-group";
    codeGroup.append(code, copyButton);
    const updated = document.createElement("span");
    updated.textContent = `AKTUALIZACJA ${new Intl.DateTimeFormat("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(Date.parse(weapon.updated))}`;
    footer.append(codeGroup, updated);
    card.append(header, role, listHeading, attachmentList, footer);
    elements.metaWeapons.append(card);
  }
}

elements.metaWeapons.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-code]");
  if (!button) return;
  try {
    await copyToClipboard(button.dataset.copyCode);
    button.classList.add("is-copied");
    button.textContent = "✓ SKOPIOWANO";
    button.setAttribute("aria-label", "Kod zestawu skopiowany");
    setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove("is-copied");
      button.textContent = "⧉ KOPIUJ KOD";
      button.setAttribute("aria-label", `Kopiuj kod zestawu ${button.closest(".meta-weapon-card").querySelector("h3").textContent}`);
    }, 1800);
  } catch (error) {
    console.error("Nie udało się skopiować kodu zestawu.", error);
    showStatus("Nie udało się skopiować kodu — przeglądarka blokuje dostęp do schowka.");
  }
});

elements.metaSearch.addEventListener("input", renderMetaWeapons);
elements.metaFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-meta-filter]");
  if (!button) return;
  activeMetaFilter = button.dataset.metaFilter;
  for (const filter of elements.metaFilters.querySelectorAll("[data-meta-filter]")) {
    const isActive = filter === button;
    filter.classList.toggle("is-active", isActive);
    filter.setAttribute("aria-pressed", String(isActive));
  }
  renderMetaWeapons();
});
renderMetaWeapons();

elements.bottomNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-nav]");
  if (!button) return;
  switch (button.dataset.nav) {
    case "home":
      showAppView("home");
      break;
    case "meta":
      showAppView("meta");
      break;
    case "chat":
      setActiveNavigation("chat");
      elements.chatOpen.click();
      break;
    case "settings":
      setActiveNavigation("settings");
      elements.settingsDialog.showModal();
      break;
    default:
      break;
  }
});

elements.chatDialog.addEventListener("close", () => setActiveNavigation(activeView));
elements.settingsClose.addEventListener("click", () => elements.settingsDialog.close());
elements.settingsDialog.addEventListener("click", (event) => {
  if (event.target === elements.settingsDialog) elements.settingsDialog.close();
});
elements.settingsDialog.addEventListener("close", () => setActiveNavigation(activeView));
elements.settingsProfile.addEventListener("click", () => {
  elements.settingsDialog.close();
  elements.profileButton.click();
});
elements.settingsFriends.addEventListener("click", () => {
  elements.settingsDialog.close();
  elements.friendsOpen.click();
});
elements.settingsLogout.addEventListener("click", () => {
  elements.settingsDialog.close();
  document.querySelector("#logout-button").click();
});
elements.settingsAdmin.addEventListener("click", () => {
  elements.settingsDialog.close();
  elements.adminButton.click();
});

function renderPlayers() {
  elements.playerList.replaceChildren();
  for (const [index, player] of state.players.entries()) {
    const item = document.createElement("li");
    item.className = "player-chip";
    const order = document.createElement("span");
    order.className = "player-order";
    order.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.textContent = player;
    const remove = document.createElement("button");
    remove.className = "remove-player";
    remove.type = "button";
    remove.setAttribute("aria-label", `Usuń gracza ${player}`);
    remove.textContent = "×";
    remove.disabled = spinInProgress;
    remove.addEventListener("click", () => {
      if (spinInProgress) return;
      state.players.splice(index, 1);
      saveState();
      render();
    });
    item.append(order, name, remove);
    elements.playerList.append(item);
  }
  elements.playerCount.textContent = String(state.players.length);
  elements.playerCountCopy.textContent = String(state.players.length);
  elements.rosterEmpty.hidden = state.players.length > 0;
  elements.spinButton.disabled = spinInProgress || state.players.length < 3;
}

function renderTeams(rotation) {
  elements.teams.replaceChildren();
  elements.teamCount.textContent = rotation ? String(rotation.teams.length) : "0";
  elements.lastRotation.textContent = rotation ? new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" }).format(new Date(rotation.date)) : "--:--";
  elements.boardTitle.innerHTML = rotation ? "Rotacja gotowa<span>.</span>" : "Gotowi do gry<span>.</span>";
  elements.boardBadge.classList.toggle("is-waiting", !rotation);
  elements.boardBadge.innerHTML = rotation ? "<i></i> AKTUALNA" : "<i></i> OCZEKIWANIE";
  if (!rotation) {
    const placeholder = document.createElement("div");
    placeholder.className = "result-placeholder";
    placeholder.innerHTML = "<span>✳</span><strong>CZAS ZEBRAĆ SKŁAD</strong><p>Wynik rotacji pojawi się tutaj.</p>";
    elements.teams.append(placeholder);
    elements.summary.textContent = "Dodaj ekipę i wylosuj pierwszą rotację.";
    elements.exportButton.disabled = true;
    elements.copyButton.disabled = true;
    elements.webhookButton.disabled = true;
    elements.rotationFlow.replaceChildren();
    const empty = document.createElement("span");
    empty.textContent = "DODAJ GRACZY";
    elements.rotationFlow.append(empty);
    return;
  }

  elements.exportButton.disabled = false;
  elements.copyButton.disabled = false;
  elements.webhookButton.disabled = false;
  const playerTotal = rotation.teams.reduce((sum, team) => sum + team.length, 0);
  const teamLabel = rotation.teams.length === 1 ? "drużyna"
    : rotation.teams.length % 10 >= 2 && rotation.teams.length % 10 <= 4
      && (rotation.teams.length % 100 < 12 || rotation.teams.length % 100 > 14) ? "drużyny" : "drużyn";
  elements.summary.textContent = `${rotation.teams.length} ${teamLabel} · ${playerTotal} graczy · ${formatDate(rotation.date)}`;

  const teamColors = ["#43dc89", "#ff435c", "#18b8ff", "#a47cff", "#ffb544", "#42d5c5", "#f373db", "#e1d94c"];
  const teamNames = rotation.teams.map((_, teamIndex) => teamDisplayName(rotation, teamIndex));
  rotation.teams.forEach((team, teamIndex) => {
    const card = document.createElement("article");
    card.className = "team-card";
    card.style.setProperty("--team-color", teamColors[teamIndex % teamColors.length]);
    const heading = document.createElement("div");
    heading.className = "team-card-header";
    const index = document.createElement("span");
    index.className = "team-index";
    index.textContent = String(teamIndex + 1).padStart(2, "0");
    const titleWrap = document.createElement("span");
    titleWrap.className = "team-title-wrap";
    const title = document.createElement("strong");
    title.textContent = teamNames[teamIndex];
    const squadLabel = document.createElement("small");
    squadLabel.textContent = `SQUAD / ${String(teamIndex + 1).padStart(2, "0")}`;
    titleWrap.append(title, squadLabel);
    const count = document.createElement("span");
    count.textContent = `${team.length}/4`;
    heading.append(index, titleWrap, count);

    const members = document.createElement("div");
    members.className = "team-members";
    team.forEach((player, playerIndex) => {
      const member = document.createElement("div");
      member.className = "team-member";
      const number = document.createElement("span");
      number.className = "member-number";
      number.textContent = String(playerIndex + 1).padStart(2, "0");
      const name = document.createElement("span");
      name.textContent = player;
      const marker = document.createElement("i");
      member.append(number, name);
      const isLeader = playerKey(player) === playerKey(teamLeader(rotation, teamIndex));
      if (isLeader) {
        member.classList.add("is-leader");
        const leader = document.createElement("span");
        leader.className = "leader-tag";
        leader.textContent = "♛ LIDER";
        member.append(leader);
      }
      member.append(marker);
      members.append(member);
    });
    card.append(heading, members);
    elements.teams.append(card);
  });
  elements.rotationFlow.replaceChildren();
  rotation.teams.forEach((_, index) => {
    const name = document.createElement("span");
    name.textContent = teamNames[index];
    name.style.setProperty("--flow-color", teamColors[index % teamColors.length]);
    elements.rotationFlow.append(name);
    if (index < rotation.teams.length - 1) {
      const arrow = document.createElement("b");
      arrow.textContent = "→";
      elements.rotationFlow.append(arrow);
    }
  });
  if (rotation.teams.length > 1) {
    const arrow = document.createElement("b");
    arrow.textContent = "→";
    elements.rotationFlow.append(arrow);
    const firstTeam = document.createElement("span");
    firstTeam.textContent = teamNames[0];
    firstTeam.style.setProperty("--flow-color", teamColors[0]);
    elements.rotationFlow.append(firstTeam);
  }
}

function formatDate(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "nieznana data";
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function renderHistory() {
  elements.history.replaceChildren();
  elements.historyEmpty.hidden = state.history.length > 0;
  elements.resetHistory.disabled = state.history.length === 0;

  state.history.slice(0, 5).forEach((rotation, index) => {
    const row = document.createElement("article");
    row.className = "history-item";
    const description = document.createElement("div");
    const date = document.createElement("div");
    date.className = "history-date";
    date.textContent = formatDate(rotation.date);
    const detail = document.createElement("div");
    detail.className = "history-detail";
    detail.textContent = rotation.teams
      .map((team, teamIndex) => `${teamDisplayName(rotation, teamIndex)}: ${team.join(", ")}`)
      .join(" · ");
    description.append(date, detail);
    const badge = document.createElement("span");
    badge.className = "history-badge";
    badge.textContent = `${String(state.history.length - index).padStart(2, "0")} ROT`;
    row.append(description, badge);
    elements.history.append(row);
  });
}

function render() {
  renderPlayers();
  renderTeams(state.history[0]);
  renderHistory();
  elements.sizeLabel.textContent = String(preferredSize);
}

function addPlayers(names) {
  if (spinInProgress) return;
  const existing = new Set(state.players.map((name) => name.toLocaleLowerCase("pl-PL")));
  let added = 0;
  for (const rawName of names) {
    const name = normalizeName(rawName);
    if (!name || name.length > 32) continue;
    const key = name.toLocaleLowerCase("pl-PL");
    if (existing.has(key)) continue;
    existing.add(key);
    state.players.push(name);
    added += 1;
  }
  if (added === 0 && names.some((name) => normalizeName(name))) showStatus("Nie dodano graczy — sprawdź, czy nazwy nie są już na liście.");
  else showStatus(added ? `Dodano graczy: ${added}.` : "");
  saveState();
  render();
}

function teamSizes(playerCount, preferred) {
  const candidates = [];
  const maxFours = Math.floor(playerCount / 4);
  if (preferred === 4) {
    for (let fours = maxFours; fours >= 0; fours -= 1) {
      const threes = (playerCount - 4 * fours) / 3;
      if (Number.isInteger(threes)) candidates.push([...Array(fours).fill(4), ...Array(threes).fill(3)]);
    }
  } else {
    for (let fours = 0; fours <= maxFours; fours += 1) {
      const threes = (playerCount - 4 * fours) / 3;
      if (Number.isInteger(threes)) candidates.push([...Array(threes).fill(3), ...Array(fours).fill(4)]);
    }
  }
  return candidates[0] || null;
}

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function playerKey(name) {
  return name.toLocaleLowerCase("pl-PL");
}

function teamLeader(rotation, teamIndex) {
  const team = rotation.teams[teamIndex] || [];
  const leader = rotation.leaders?.[teamIndex];
  return team.find((player) => leader && playerKey(player) === playerKey(leader)) || team[0] || "Lider";
}

function teamDisplayName(rotation, teamIndex) {
  return `Drużyna ${teamLeader(rotation, teamIndex)}`;
}

function teamSignature(team) {
  return team.map(playerKey).sort().join("|");
}

function historicalPatterns() {
  const pairs = new Map();
  const teams = new Map();
  for (const rotation of state.history) {
    for (const team of rotation.teams) {
      const signature = teamSignature(team);
      teams.set(signature, (teams.get(signature) || 0) + 1);
      const keys = team.map(playerKey);
      for (let left = 0; left < keys.length; left += 1) {
        for (let right = left + 1; right < keys.length; right += 1) {
          const pair = [keys[left], keys[right]].sort().join("|");
          pairs.set(pair, (pairs.get(pair) || 0) + 1);
        }
      }
    }
  }
  return { pairs, teams };
}

function setRosterLocked(locked) {
  for (const control of [
    ...elements.addForm.querySelectorAll("textarea, button"),
    elements.importButton,
    elements.teamSize,
    elements.photoImportButton,
    elements.cameraImportButton,
  ]) {
    control.disabled = locked;
  }
}

function animateSpin() {
  const placeholder = document.createElement("div");
  placeholder.className = "result-placeholder spin-placeholder";
  const mark = document.createElement("span");
  mark.className = "spin-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "⟳";
  const heading = document.createElement("strong");
  heading.textContent = "LOSOWANIE SKŁADU";
  const playerName = document.createElement("p");
  playerName.className = "spin-player-name";
  playerName.setAttribute("aria-live", "polite");
  placeholder.append(mark, heading, playerName);
  elements.teams.replaceChildren(placeholder);
  elements.exportButton.disabled = true;
  elements.copyButton.disabled = true;
  elements.boardTitle.innerHTML = "Spin <span>w toku.</span>";
  elements.boardBadge.classList.add("is-waiting");
  elements.boardBadge.innerHTML = "<i></i> LOSOWANIE";
  elements.summary.textContent = "Mieszamy składy i losujemy liderów...";
  showStatus("SPIN...");

  return new Promise((resolve) => {
    const duration = 2300;
    const startedAt = performance.now();
    let nextNameAt = startedAt;
    let lastName = "";
    function update(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      if (now >= nextNameAt) {
        const choices = state.players.filter((name) => name !== lastName);
        lastName = choices[Math.floor(Math.random() * choices.length)] || state.players[0] || "ABYSS SPIN";
        playerName.textContent = lastName;
        nextNameAt = now + 55 + progress * progress * 330;
      }
      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        window.setTimeout(resolve, 180);
      }
    }
    requestAnimationFrame(update);
  });
}

function hasRepeatedPairs(teams, historicalPairs) {
  const pairs = new Set();
  for (const team of teams) {
    for (let left = 0; left < team.length; left += 1) {
      for (let right = left + 1; right < team.length; right += 1) {
        const pair = [playerKey(team[left]), playerKey(team[right])].sort().join("|");
        if (historicalPairs.has(pair) || pairs.has(pair)) return true;
        pairs.add(pair);
      }
    }
  }
  return false;
}

function buildUniqueTeams(sizes, historicalPairs) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const shuffledSizes = shuffled(sizes);
    const players = shuffled(state.players);
    const teams = [];
    let cursor = 0;
    for (const size of shuffledSizes) {
      teams.push(players.slice(cursor, cursor + size));
      cursor += size;
    }
    if (!hasRepeatedPairs(teams, historicalPairs)) return teams;
  }

  const remaining = new Set(state.players);
  const sizeCounts = new Map();
  for (const size of sizes) sizeCounts.set(size, (sizeCounts.get(size) || 0) + 1);
  const teams = [];
  let visitedNodes = 0;
  const maxVisitedNodes = 10000;
  const candidatesPerBranch = 48;

  function findTeams() {
    if (remaining.size === 0) return [...sizeCounts.values()].every((count) => count === 0);
    if (visitedNodes >= maxVisitedNodes) return false;
    visitedNodes += 1;

    let anchor = null;
    let anchorOptions = [];
    let anchorSizes = [];
    let minOptions = Infinity;
    const availableSizes = [...sizeCounts.entries()].filter(([, count]) => count > 0).map(([size]) => size);
    for (const player of remaining) {
      const compatible = [...remaining].filter((other) => {
        if (other === player) return false;
        const pair = [playerKey(player), playerKey(other)].sort().join("|");
        return !historicalPairs.has(pair);
      });
      const possibleSizes = availableSizes.filter((size) => compatible.length >= size - 1);
      if (possibleSizes.length === 0) continue;
      if (compatible.length < minOptions) {
        anchor = player;
        anchorOptions = compatible;
        anchorSizes = possibleSizes;
        minOptions = compatible.length;
      }
    }
    if (anchor === null) return false;

    for (const size of shuffled(anchorSizes.sort((left, right) => right - left))) {
      if (anchorOptions.length < size - 1) continue;
      const candidates = new Map();
      const generationLimit = candidatesPerBranch * 20;
      for (let attempt = 0; attempt < generationLimit && candidates.size < candidatesPerBranch; attempt += 1) {
        const team = [anchor];
        for (const other of shuffled(anchorOptions)) {
          if (team.every((member) => {
            const pair = [playerKey(member), playerKey(other)].sort().join("|");
            return !historicalPairs.has(pair);
          })) team.push(other);
          if (team.length === size) break;
        }
        if (team.length === size) candidates.set(teamSignature(team), team);
      }

      for (const candidate of shuffled([...candidates.values()])) {
        const keys = new Set(candidate.map(playerKey));
        if (keys.size !== candidate.length || hasRepeatedPairs([candidate], historicalPairs)) continue;
        for (const player of candidate) remaining.delete(player);
        sizeCounts.set(size, sizeCounts.get(size) - 1);
        teams.push(candidate);
        if (findTeams()) return true;
        teams.pop();
        sizeCounts.set(size, sizeCounts.get(size) + 1);
        for (const player of candidate) remaining.add(player);
        if (visitedNodes >= maxVisitedNodes) return false;
      }
    }
    return false;
  }

  return findTeams() ? teams : null;
}

function buildBestAvailableTeams(sizes, history) {
  let bestTeams = null;
  let bestScore = null;
  const attempts = 2500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const shuffledSizes = shuffled(sizes);
    const players = shuffled(state.players);
    const candidate = [];
    let cursor = 0;
    for (const size of shuffledSizes) {
      candidate.push(players.slice(cursor, cursor + size));
      cursor += size;
    }

    let repeatedPairs = 0;
    let previousPairOccurrences = 0;
    let repeatedTeams = 0;
    for (const team of candidate) {
      const signature = teamSignature(team);
      repeatedTeams += history.teams.get(signature) || 0;
      const keys = team.map(playerKey);
      for (let left = 0; left < keys.length; left += 1) {
        for (let right = left + 1; right < keys.length; right += 1) {
          const pair = [keys[left], keys[right]].sort().join("|");
          const occurrences = history.pairs.get(pair) || 0;
          if (occurrences > 0) repeatedPairs += 1;
          previousPairOccurrences += occurrences;
        }
      }
    }

    const score = [repeatedPairs, previousPairOccurrences, repeatedTeams];
    const isBetter = !bestScore || score[0] < bestScore[0]
      || (score[0] === bestScore[0] && score[1] < bestScore[1])
      || (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2]);
    if (isBetter) {
      bestTeams = candidate;
      bestScore = score;
      if (repeatedPairs === 0 && repeatedTeams === 0) break;
    }
  }
  return bestTeams;
}

function createRotation() {
  const sizes = teamSizes(state.players.length, preferredSize);
  if (!sizes) {
    showStatus("Nie da się podzielić tej liczby graczy na drużyny po 3 lub 4 osoby. Dodaj albo usuń gracza.");
    return;
  }

  const history = historicalPatterns();
  const teams = buildUniqueTeams(sizes, history.pairs) || buildBestAvailableTeams(sizes, history);
  const repeatedPairs = hasRepeatedPairs(teams, history.pairs);

  const leaders = teams.map((team) => shuffled(team)[0]);
  const rotation = { id: crypto.randomUUID(), date: new Date().toISOString(), teams, leaders };
  state.history.unshift(rotation);
  showStatus(repeatedPairs
    ? "Rotacja gotowa. Przy mniejszej liczbie graczy składy mogą się powtarzać."
    : "Gotowe — żadna para graczy nie powtarza się z wcześniejszych rotacji.");
  saveState();
  render();
  void awardRotationExperience(rotation.id);
  return true;
}

function renderRotationCanvas(rotation) {
  if (!rotation) return null;

  const width = 1400;
  const padding = 78;
  const gap = 26;
  const columns = rotation.teams.length > 1 ? 2 : 1;
  const cardWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const rows = Math.ceil(rotation.teams.length / columns);
  const teamColors = ["#43dc89", "#ff435c", "#18b8ff", "#a47cff", "#ffb544", "#42d5c5", "#f373db", "#e1d94c"];
  const teamNames = rotation.teams.map((_, teamIndex) => teamDisplayName(rotation, teamIndex));
  const cardHeights = rotation.teams.map((team) => 88 + team.length * 49);
  const rowHeights = Array.from(
    { length: rows },
    (_, row) => Math.max(...cardHeights.slice(row * columns, (row + 1) * columns)),
  );
  const cardsTop = 230;
  const cardsHeight = rowHeights.reduce((sum, value) => sum + value, 0) + gap * Math.max(rows - 1, 0);
  const flowHeadingY = cardsTop + cardsHeight + 58;
  const flowFontSize = rotation.teams.length > 5 ? 16 : 20;
  const flowItems = [];
  rotation.teams.forEach((_, index) => {
    const label = teamNames[index];
    flowItems.push({ type: "team", label, color: teamColors[index % teamColors.length] });
    if (index < rotation.teams.length - 1 || rotation.teams.length > 1) {
      flowItems.push({ type: "arrow", label: "→" });
    }
  });
  if (rotation.teams.length > 1) {
    flowItems.push({ type: "team", label: teamNames[0], color: teamColors[0] });
  }

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) {
    throw new Error("Nie udało się przygotować grafiki PNG.");
  }
  measure.font = `700 ${flowFontSize}px Arial`;
  const flowRows = [];
  let flowRow = [];
  let flowRowWidth = 0;
  const flowAvailable = width - padding * 2;
  for (const item of flowItems) {
    const itemWidth = item.type === "team"
      ? Math.ceil(measure.measureText(item.label).width) + 42
      : 48;
    const nextWidth = flowRowWidth + (flowRow.length ? 12 : 0) + itemWidth;
    if (nextWidth > flowAvailable && flowRow.length) {
      flowRows.push({ items: flowRow, width: flowRowWidth });
      flowRow = [];
      flowRowWidth = 0;
    }
    flowRow.push({ ...item, width: itemWidth });
    flowRowWidth += (flowRow.length > 1 ? 12 : 0) + itemWidth;
  }
  if (flowRow.length) flowRows.push({ items: flowRow, width: flowRowWidth });
  const flowTop = flowHeadingY + 35;
  const flowHeight = flowRows.length * 62;
  const footerTop = flowTop + flowHeight + 24;
  const height = footerTop + 72;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Nie udało się przygotować grafiki PNG.");
  }

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#080b13");
  background.addColorStop(.52, "#0b101c");
  background.addColorStop(1, "#090c14");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(width / 2, 160, 30, width / 2, 160, width * .62);
  glow.addColorStop(0, "rgba(40,85,118,.15)");
  glow.addColorStop(1, "rgba(8,11,19,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, Math.min(height, 390));

  context.textBaseline = "middle";
  context.textAlign = "center";
  context.fillStyle = "#f3f5fa";
  context.font = "800 62px Arial";
  context.fillText("ROTACJA DRUŻYN", width / 2, 76);
  const titleUnderline = context.createLinearGradient(padding + 285, 0, width - padding - 285, 0);
  titleUnderline.addColorStop(0, "rgba(67,220,137,0)");
  titleUnderline.addColorStop(.22, "#43dc89");
  titleUnderline.addColorStop(.5, "#b7c6d8");
  titleUnderline.addColorStop(.78, "#ff435c");
  titleUnderline.addColorStop(1, "rgba(255,67,92,0)");
  context.fillStyle = titleUnderline;
  context.fillRect(padding + 285, 126, width - 2 * (padding + 285), 3);
  context.fillStyle = "#9aa5b6";
  context.font = "500 20px Arial";
  context.fillText("Każdy gracz występuje tylko raz w tej rotacji", width / 2, 161);

  const playerTotal = rotation.teams.reduce((sum, team) => sum + team.length, 0);
  context.textAlign = "right";
  context.fillStyle = "#aeb7c5";
  context.font = "600 17px Arial";
  context.fillText(`${playerTotal} GRACZY`, width - padding, 203);

  const drawRoundRect = (x, y, rectWidth, rectHeight, radius) => {
    context.beginPath();
    context.roundRect(x, y, rectWidth, rectHeight, radius);
  };
  const drawClippedText = (text, x, y, maxWidth) => {
    let output = text;
    while (output.length > 1 && context.measureText(output).width > maxWidth) {
      output = `${output.slice(0, -2)}…`;
    }
    context.fillText(output, x, y, maxWidth);
  };

  let y = cardsTop;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const teamIndex = row * columns + column;
      const team = rotation.teams[teamIndex];
      if (!team) continue;
      const x = padding + column * (cardWidth + gap);
      const cardHeight = cardHeights[teamIndex];
      const teamColor = teamColors[teamIndex % teamColors.length];
      const cardGradient = context.createLinearGradient(x, y, x + cardWidth, y + cardHeight);
      cardGradient.addColorStop(0, "#141a25");
      cardGradient.addColorStop(1, "#0d111a");
      drawRoundRect(x, y, cardWidth, cardHeight, 15);
      context.fillStyle = cardGradient;
      context.fill();
      context.save();
      context.shadowColor = teamColor;
      context.shadowBlur = 19;
      context.strokeStyle = `${teamColor}8a`;
      context.lineWidth = 2;
      context.stroke();
      context.restore();

      context.save();
      context.beginPath();
      context.rect(x + 2, y + 2, cardWidth - 4, 4);
      context.clip();
      const accent = context.createLinearGradient(x, y, x + cardWidth, y);
      accent.addColorStop(0, teamColor);
      accent.addColorStop(1, `${teamColor}28`);
      context.fillStyle = accent;
      context.fillRect(x, y, cardWidth, 8);
      context.restore();

      context.save();
      context.globalAlpha = .2;
      context.fillStyle = teamColor;
      context.beginPath();
      context.moveTo(x + 2, y + 27);
      context.lineTo(x + 30, y + 2);
      context.lineTo(x + 70, y + 2);
      context.lineTo(x + 2, y + 65);
      context.closePath();
      context.fill();
      context.restore();

      context.textAlign = "left";
      context.fillStyle = teamColor;
      context.font = `800 ${cardWidth < 500 ? 23 : 31}px Arial`;
      drawClippedText(teamNames[teamIndex], x + 36, y + 52, cardWidth - 180);
      context.textAlign = "right";
      context.fillStyle = "#d5dbe6";
      context.font = "700 27px Arial";
      context.fillText(`${team.length}/${team.length}`, x + cardWidth - 33, y + 52);

      context.strokeStyle = "rgba(194,207,224,.24)";
      context.beginPath();
      context.lineWidth = 1;
      context.moveTo(x + 34, y + 83);
      context.lineTo(x + cardWidth - 34, y + 83);
      context.stroke();

      team.forEach((player, index) => {
        const isLeader = playerKey(player) === playerKey(teamLeader(rotation, teamIndex));
        const memberY = y + 111 + index * 49;
        context.textAlign = "left";
        context.fillStyle = "#a5afbf";
        context.font = "700 21px Arial";
        context.fillText(`${index + 1}.`, x + 36, memberY);
        context.fillStyle = isLeader ? "#ffe3a3" : "#f1f3f7";
        context.font = `600 ${cardWidth < 500 ? 17 : 23}px Arial`;
        const tagWidth = isLeader ? 125 : 0;
        drawClippedText(player, x + 91, memberY, cardWidth - 178 - tagWidth);
        if (isLeader) {
          context.textAlign = "left";
          context.fillStyle = "#ffc65b";
          context.font = "700 13px Arial";
          context.fillText("♛ LIDER", x + cardWidth - 145, memberY);
        }
        context.beginPath();
        context.fillStyle = teamColor;
        context.shadowColor = teamColor;
        context.shadowBlur = 12;
        context.arc(x + cardWidth - 31, memberY, 7, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;

        if (index < team.length - 1) {
          context.strokeStyle = "rgba(194,207,224,.16)";
          context.beginPath();
          context.moveTo(x + 34, memberY + 24);
          context.lineTo(x + cardWidth - 34, memberY + 24);
          context.stroke();
        }
      });
    }
    y += rowHeights[row] + gap;
  }

  context.textAlign = "center";
  context.fillStyle = "#9aa5b6";
  context.font = "600 16px Arial";
  context.fillText("KOLEJNOŚĆ ROTACJI", width / 2, flowHeadingY);
  flowRows.forEach((row, rowIndex) => {
    let x = (width - row.width) / 2;
    const centerY = flowTop + rowIndex * 62 + 21;
    for (const item of row.items) {
      if (item.type === "team") {
        drawRoundRect(x, centerY - 22, item.width, 44, 5);
        context.fillStyle = `${item.color}25`;
        context.fill();
        context.strokeStyle = `${item.color}df`;
        context.lineWidth = 2;
        context.stroke();
        context.textAlign = "center";
        context.fillStyle = item.color;
        context.font = `800 ${flowFontSize}px Arial`;
        context.fillText(item.label, x + item.width / 2, centerY + 1);
      } else {
        context.textAlign = "center";
        context.fillStyle = "#dce2ed";
        context.font = "700 27px Arial";
        context.fillText(item.label, x + item.width / 2, centerY + 1);
      }
      x += item.width + 12;
    }
  });

  context.strokeStyle = "rgba(194,207,224,.22)";
  context.beginPath();
  context.moveTo(0, footerTop);
  context.lineTo(width, footerTop);
  context.stroke();
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillStyle = "#c9cfda";
  context.font = "600 20px Arial";
  context.fillText(new Intl.DateTimeFormat("pl-PL", { dateStyle: "short" }).format(new Date(rotation.date)), padding, footerTop + 38);
  context.textAlign = "center";
  context.fillStyle = "#9ba6b6";
  context.font = "700 19px Arial";
  context.fillText("ABYSS SPIN  •  PLAY  •  ROTATE  •  IMPROVE", width / 2, footerTop + 38);
  context.textAlign = "right";
  context.fillStyle = "#c9cfda";
  context.font = "600 20px Arial";
  context.fillText(`${playerTotal} GRACZY AKTYWNYCH`, width - padding, footerTop + 38);

  return canvas;
}

function exportPng() {
  const rotation = state.history[0];
  if (!rotation) return;
  try {
    const canvas = renderRotationCanvas(rotation);
    if (!canvas) throw new Error("Brak rotacji do wyeksportowania.");
    const link = document.createElement("a");
    link.download = `abyss-spin-rotacja-${new Date(rotation.date).toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (error) {
    console.error("Nie udało się wygenerować grafiki rotacji.", error);
    showStatus(error.message || "Nie udało się przygotować grafiki PNG.");
  }
}

function canvasToPngDataUrl(canvas) {
  const maximumBlobSize = 3 * 1024 * 1024;
  let scale = 1;
  const exportCanvas = document.createElement("canvas");
  const exportPng = () => new Promise((resolve, reject) => {
    exportCanvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Nie udało się utworzyć pliku PNG z rotacją."));
      if (blob.size > maximumBlobSize) {
        scale *= 0.8;
        if (scale < 0.4) return reject(new Error("Grafika rotacji jest za duża, aby wysłać ją na Discorda."));
        exportCanvas.width = Math.max(1, Math.round(canvas.width * scale));
        exportCanvas.height = Math.max(1, Math.round(canvas.height * scale));
        const context = exportCanvas.getContext("2d");
        if (!context) return reject(new Error("Nie udało się przygotować grafiki PNG."));
        context.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
        exportPng().then(resolve, reject);
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result !== "string" || !reader.result.startsWith("data:image/png;base64,")) {
          reject(new Error("Przeglądarka zwróciła nieprawidłową grafikę PNG."));
          return;
        }
        resolve(reader.result);
      }, { once: true });
      reader.addEventListener("error", () => reject(new Error("Nie udało się odczytać wygenerowanej grafiki.")), { once: true });
      reader.readAsDataURL(blob);
    }, "image/png");
  });
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const context = exportCanvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Nie udało się przygotować grafiki PNG."));
  context.drawImage(canvas, 0, 0);
  return exportPng();
}

elements.addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addPlayers(elements.playerInput.value.split(/[\r\n,;]+/));
  elements.playerInput.value = "";
  elements.playerInput.focus();
});

elements.importButton.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", async () => {
  const file = elements.importFile.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const names = text.split(/\r?\n/).map((line) => line.split(/[;,]/, 1)[0].replace(/^["']|["']$/g, ""));
    addPlayers(names);
  } catch (error) {
    console.error("Nie udało się wczytać pliku z graczami.", error);
    showStatus("Nie udało się odczytać pliku. Wybierz plik TXT lub CSV.");
  }
  elements.importFile.value = "";
});

elements.photoImportButton.addEventListener("click", () => elements.photoImportFile.click());
elements.cameraImportButton.addEventListener("click", () => elements.cameraImportFile.click());
async function openPhotoImport(file, input) {
  input.value = "";
  if (!file) return;
  const supportedImage = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
  if (!supportedImage || file.size > 20 * 1024 * 1024) {
    showStatus("Wybierz zdjęcie PNG, JPEG lub WEBP o rozmiarze do 20 MB.");
    return;
  }

  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  elements.photoImportPreview.src = photoPreviewUrl;
  elements.photoImportNames.value = "";
  elements.photoImportProgress.textContent = "Przygotowywanie rozpoznawania tekstu...";
  elements.photoImportAdd.disabled = true;
  elements.photoImportDialog.showModal();

  let worker;
  try {
    await loadOcrLibrary();
    worker = await window.Tesseract.createWorker("eng", 1, {
      logger: ({ status, progress }) => {
        const percent = Number.isFinite(progress) ? ` ${Math.round(progress * 100)}%` : "";
        elements.photoImportProgress.textContent = `${status || "Analizowanie zdjęcia"}${percent}`;
      },
    });
    const { data } = await worker.recognize(file);
    const lines = (data.lines?.length ? data.lines.map((line) => line.text) : data.text.split(/\r?\n/))
      .map(normalizeName)
      .filter((name) => name.length > 0 && name.length <= 32 && /[A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(name))
      .slice(0, 100);
    elements.photoImportNames.value = lines.join("\n");
    elements.photoImportProgress.textContent = lines.length
      ? `Rozpoznano ${lines.length} wierszy. Popraw nicki i usuń zbędny tekst.`
      : "Nie rozpoznano nicków. Możesz wpisać je ręcznie w polu poniżej.";
  } catch (error) {
    console.error("Nie udało się rozpoznać tekstu ze zdjęcia.", error);
    elements.photoImportProgress.textContent = error.message || "Nie udało się odczytać zdjęcia. Spróbuj ponownie.";
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (error) {
        console.error("Nie udało się zamknąć narzędzia OCR.", error);
      }
    }
    elements.photoImportAdd.disabled = false;
  }
}
elements.photoImportFile.addEventListener("change", () => openPhotoImport(elements.photoImportFile.files?.[0], elements.photoImportFile));
elements.cameraImportFile.addEventListener("change", () => openPhotoImport(elements.cameraImportFile.files?.[0], elements.cameraImportFile));
elements.photoImportAdd.addEventListener("click", () => {
  const names = elements.photoImportNames.value.split(/\r?\n/);
  elements.photoImportDialog.close();
  addPlayers(names);
});
elements.photoImportClose.addEventListener("click", () => elements.photoImportDialog.close());
elements.photoImportCancel.addEventListener("click", () => elements.photoImportDialog.close());
elements.photoImportDialog.addEventListener("close", () => {
  elements.photoImportPreview.removeAttribute("src");
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = null;
});

elements.spinButton.addEventListener("click", async () => {
  if (spinInProgress) return;
  if (!teamSizes(state.players.length, preferredSize)) {
    createRotation();
    return;
  }
  spinInProgress = true;
  setRosterLocked(true);
  elements.spinButton.disabled = true;
  elements.spinButton.classList.add("is-spinning");
  elements.spinButton.innerHTML = "<span>⟳</span> LOSOWANIE...";
  try {
    await animateSpin();
    if (!createRotation()) render();
  } finally {
    spinInProgress = false;
    setRosterLocked(false);
    elements.spinButton.classList.remove("is-spinning");
    elements.spinButton.innerHTML = "<span>⟳</span> LOSUJ ROTACJĘ";
    renderPlayers();
  }
});
elements.exportButton.addEventListener("click", exportPng);
elements.webhookButton.addEventListener("click", async () => {
  const rotation = state.history[0];
  if (!rotation) return;
  elements.webhookButton.disabled = true;
  showStatus("Wysyłanie rotacji na Discorda...");
  elements.webhookButton.querySelector("span").textContent = "WYSYŁANIE...";
  try {
    const canvas = renderRotationCanvas(rotation);
    if (!canvas) throw new Error("Nie udało się przygotować grafiki rotacji.");
    const image = await canvasToPngDataUrl(canvas);
    await window.AbyssSpinAuth.requestJson("/api/rotation/webhook", {
      method: "POST",
      body: JSON.stringify({ rotation, image }),
    });
    showStatus("Grafika rotacji została wysłana na Discorda.");
  } catch (error) {
    console.error("Nie udało się wygenerować lub wysłać grafiki rotacji.", error);
    showStatus(error.message || "Nie udało się wysłać grafiki rotacji na Discorda.");
  } finally {
    elements.webhookButton.disabled = !state.history[0];
    elements.webhookButton.querySelector("span").textContent = "WYŚLIJ NA DISCORDA";
  }
});
elements.copyButton.addEventListener("click", async () => {
  const rotation = state.history[0];
  if (!rotation) return;
  const text = rotation.teams
    .map((team, index) => `${teamDisplayName(rotation, index)}: ${team.join(", ")}`)
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showStatus("Skład skopiowany do schowka.");
  } catch (error) {
    console.error("Nie udało się skopiować składu.", error);
    showStatus("Nie udało się skopiować — przeglądarka blokuje dostęp do schowka.");
  }
});
elements.resetHistory.addEventListener("click", () => {
  if (!state.history.length) return;
  state.history = [];
  showStatus("Historia rotacji została wyczyszczona.");
  saveState();
  render();
});

elements.teamSize.addEventListener("change", () => {
  preferredSize = Number(elements.teamSize.value);
  elements.sizeLabel.textContent = String(preferredSize);
  saveState();
});

window.addEventListener("abyssspin:authenticated", (event) => {
  const data = event.detail.data;
  elements.bottomNav.hidden = false;
  elements.settingsAdmin.hidden = !event.detail.isAdmin;
  showAppView("home");
  state = {
    players: Array.isArray(data.players) ? data.players.filter((name) => typeof name === "string") : [],
    history: Array.isArray(data.history) ? data.history.filter(isValidRotation) : [],
  };
  preferredSize = data.preferredSize === 3 ? 3 : 4;
  elements.teamSize.value = String(preferredSize);
  isAuthenticated = true;
  render();
});

window.addEventListener("abyssspin:session-expired", () => {
  isAuthenticated = false;
  clearTimeout(saveTimer);
});

window.addEventListener("abyssspin:logged-out", () => {
  isAuthenticated = false;
  clearTimeout(saveTimer);
});

window.addEventListener("abyssspin:auth-error", (event) => showStatus(event.detail.message));
window.addEventListener("abyssspin:auth-notice", (event) => showStatus(event.detail.message));
