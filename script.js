const stops = [
  ["Queens SU", "No first names", "No first names.", 54.5847, -5.9347],
  ["Lavertys", "Doubles Match", "Everyone pairs up; losers in the doubles match take a shot (1 game per double).", 54.5897, -5.9327],
  ["Points", "Floor is Lava", "Can't set your drink down once lifted until finished. Penalty: shot.", 54.5919, -5.9325],
  ["Spoons (The Bridge House)", "Buy your partner a drink", "Buy your partner any drink of your choice.", 54.5944, -5.9307],
  ["Pug Uglies", "Walkie-Talkie", 'Say "Over" after every sentence. Max 1 shot penalty.', 54.5968, -5.9264],
  ["Granny Annies", "Watering Hole", "Everyone takes at least 1 shot + mandatory water break (Halftime).", 54.5981, -5.9255],
  ["The National", "Buffalo", "Drink with your left hand only.", 54.5986, -5.9252],
  ["Whites Tavern", "Mime Time", "No speaking to the bartender, no pointing, and no phones. Penalty: shot.", 54.5991, -5.9242],
  ["Kelly's Cellars", "No swearing", "No swearing.", 54.6006, -5.9287],
  ["Duke of York", "Accents only", "If caught breaking character, take a shot.", 54.6014, -5.9270],
  ["Thirsty Goat", "Buddy System", "Have a mate feed you your drink (no straws).", 54.6032, -5.9261],
  ["The Dirty Onion", "Final Official Stop", "Survive and celebrate.", 54.5995, -5.9236],
  ["Kremlin (Bonus / Optional)", "Last Ones Standing", "Bonus stop: last ones standing.", 54.5966, -5.9250, "optional"]
].map((s, index) => ({ number: index + 1, venue: s[0], rule: s[1], detail: s[2], lat: s[3], lng: s[4], role: s[5] || "official" }));

const officialStops = stops.filter(stop => stop.role === "official");
const routeStops = stops;

const KEY = "twelve-pubs-state";
const SUPABASE_URL = "https://agdanbbollpglxtqjkst.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_0PB50UC4NEJFLOSSGdUTMg_ULEejcAp";
const defaultState = { onboarded: false, name: "", partner: "", attire: false, completed: [], counters: { pints: 0, shots: 0, penalties: 0 } };
let state = loadState();
let map;
let roomParticipants = [];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...defaultState, ...saved, counters: { ...defaultState.counters, ...(saved.counters || {}) } };
  }
  catch { return { ...defaultState, counters: { ...defaultState.counters } }; }
}
function saveState() { localStorage.setItem(KEY, JSON.stringify(state)); }
function $(id) { return document.getElementById(id); }
function initials(name) { return name ? name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase() : "?"; }
function showToast(message) { const toast = $("toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 3300); }
function directions(stop) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stop.venue}, Belfast`)}`; }

function renderHeader() {
  const completed = state.completed.filter(number => officialStops.some(stop => stop.number === number)).length;
  $("progressNumber").textContent = completed;
  $("progressLabel").textContent = `${completed} / ${officialStops.length} completed`;
  $("progressBar").style.width = `${completed / officialStops.length * 100}%`;
  $("welcomeName").textContent = state.name ? `Hi ${state.name}` : "Welcome, traveller";
  $("partnerName").textContent = state.partner ? `Partner: ${state.partner}` : "Choose your pub partner";
  $("avatarInitials").textContent = initials(state.name);
  $("meetupSpot").textContent = state.meetupSpot || "Set by the organiser";
  ["pints", "shots", "penalties"].forEach(key => { $(`${key}Count`).textContent = state.counters[key]; });
}

function renderRoute() {
  const next = officialStops.find(stop => !state.completed.includes(stop.number));
  $("routeList").innerHTML = routeStops.map(stop => {
    const complete = state.completed.includes(stop.number);
    const isOptional = stop.role === "optional";
    return `<article class="stop-card ${complete ? "completed" : ""} ${next?.number === stop.number ? "current" : ""}">
      <div class="stop-main"><span class="stop-number">${isOptional ? "+" : String(officialStops.indexOf(stop) + 1).padStart(2, "0")}</span><div class="stop-title"><h3>${stop.venue}</h3><small>${isOptional ? "Bonus stop · optional" : complete ? "Completed · nice work" : next?.number === stop.number ? "Up next" : "On the route"}</small></div><input class="stop-check" type="checkbox" aria-label="Mark ${stop.venue} complete" data-stop="${stop.number}" ${complete ? "checked" : ""}></div>
      <div class="stop-rule"><b>RULE</b>${stop.rule}</div>
      <div class="stop-detail">${stop.detail}</div>
      <div class="stop-actions"><a class="directions" href="${directions(stop)}" target="_blank" rel="noopener">⌖ Directions</a></div>
    </article>`;
  }).join("");
  document.querySelectorAll(".stop-check").forEach(input => input.addEventListener("change", () => toggleStop(Number(input.dataset.stop), input.checked)));
}

function toggleStop(number, complete) {
  state.completed = complete ? [...new Set([...state.completed, number])] : state.completed.filter(item => item !== number);
  saveState(); renderRoute(); renderHeader(); updateMap();
  if (complete) showToast("Did you get in the group photo? If not, take a shot!");
}
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }

function setupTabs() {
  document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === `${tab}Panel`));
    if (tab === "map") { initMap(); setTimeout(() => map?.invalidateSize(), 50); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
}
function updateMap() {
  if (!map) return;
  map.eachLayer(layer => { if (layer.stopNumber) map.removeLayer(layer); });
  stops.forEach(addMarker);
}
function addMarker(stop) {
  if (!map || !window.L) return;
  const routeNumber = stop.role === "optional" ? "+" : String(officialStops.indexOf(stop) + 1);
  const markerIcon = L.divIcon({ className: "numbered-marker", html: `<span>${routeNumber}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  const marker = L.marker([stop.lat, stop.lng], { icon: markerIcon }).addTo(map);
  marker.stopNumber = stop.number;
  marker.bindPopup(`<strong>${routeNumber}. ${stop.venue}</strong><br><span>${stop.rule}</span><br><br><a href="${directions(stop)}" target="_blank">Get directions →</a>`);
}
function initMap() {
  if (map || !window.L) { if (!window.L) $("map").innerHTML = "<p style='padding:1rem;color:#aeb9aa'>Map unavailable offline. Use the Directions buttons on each stop.</p>"; return; }
  map = L.map("map", { scrollWheelZoom: false }).setView([54.596, -5.929], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map);
  stops.forEach(addMarker);
}
function currentStop() { return officialStops.find(stop => !state.completed.includes(stop.number)) || officialStops[officialStops.length - 1]; }
async function copyLocation() {
  const stop = currentStop();
  const text = `I'm at ${stop.venue}, Belfast — 12 Pubs of Christmas.`;
  try { await navigator.clipboard.writeText(text); showToast(`Copied: ${stop.venue}`); } catch { showToast(text); }
}
async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? null : response.json();
}
async function supabaseRpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
function roomCode() { return state.roomCode?.trim().toUpperCase(); }
function reportRoomError(error, fallback) {
  let message = error?.message || "";
  try { message = JSON.parse(message).message || JSON.parse(message).details || message; } catch {}
  if (message.includes("Could not find the function") || message.includes("Searched for the function")) {
    message = "Supabase room setup is out of date. Run the latest supabase.sql, then wait 30 seconds and refresh.";
  }
  message = message.replace(/^"|"$/g, "").slice(0, 180);
  showToast(message || fallback);
}
function inviteLink() {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("room", roomCode());
  url.searchParams.set("key", state.roomKey);
  return url.toString();
}
function deterministicPairings(names) {
  const shuffled = [...names];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const groups = [];
  while (shuffled.length) groups.push(shuffled.splice(0, 2));
  if (groups.length > 1 && groups.at(-1).length === 1) groups.at(-2).push(groups.pop()[0]);
  return Object.fromEntries(groups.flatMap(group => group.map(name => [name, group.filter(member => member !== name)])));
}
async function loadRoom() {
  if (!roomCode()) return;
  const room = state.ownerKey
    ? await supabaseRpc("get_pub_room_owner", { room_code: roomCode(), owner_key: state.ownerKey })
    : await supabaseRpc("get_pub_room", { room_code: roomCode(), invite_key: state.roomKey });
  roomParticipants = room.participants || [];
  state.roomName = room.room_name || state.roomName || roomCode();
  state.meetupSpot = room.meetup_spot || state.meetupSpot || "";
  saveState();
  const pairing = room.pairings?.[state.name];
  if (pairing) { state.partner = pairing.join(" & "); saveState(); renderHeader(); }
  renderRoomStatus(pairing ? room.pairings : null);
}
function renderRoomStatus(pairings) {
  const isOwner = Boolean(state.ownerKey);
  $("roomStatus").innerHTML = roomCode() ? `<strong>${state.roomName || roomCode()}</strong><br><span>${roomCode()}${isOwner ? ` · ${roomParticipants.length} joined` : ""}</span>${isOwner ? `<br><span>${roomParticipants.map(person => person.name).join(" · ") || "No attendees yet."}</span>` : ""}${pairings?.[state.name] ? `<br><b>Your group: ${pairings[state.name].join(" & ") || "solo"}</b>` : ""}` : "";
  $("generatePairingsButton").classList.toggle("hidden", !isOwner || roomParticipants.length < 2);
  $("copyInviteButton").classList.toggle("hidden", !roomCode() || !state.roomKey);
}
async function joinRoom() {
  const code = $("roomCodeInput").value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const key = $("roomKeyInput").value.trim();
  if (!code || !key || !state.name) return showToast("Enter your name, room code, and invite key.");
  try {
    await supabaseRpc("join_pub_room", { room_code: code, invite_key: key, attendee_name: state.name });
    state.roomCode = code; state.roomKey = key; state.ownerKey = ""; saveState(); await loadRoom(); showToast(`Joined private room ${code}.`);
  } catch (error) { reportRoomError(error, "Could not join. Check the room code, invite key, and Supabase migration."); }
}
async function generatePairings() {
  try {
    const names = roomParticipants.map(person => person.name);
    const pairings = deterministicPairings(names);
    if (!state.ownerKey) return showToast("Only the organiser can randomise this room.");
    await supabaseRpc("update_pub_pairings", { room_code: roomCode(), owner_key: state.ownerKey, new_pairings: pairings });
    await loadRoom(); showToast("Shared partners randomised for everyone.");
  } catch (error) { reportRoomError(error, "Could not randomise this room right now."); }
}

function wireForms() {
  $("attireInput").addEventListener("change", event => $("attireWarning").classList.toggle("hidden", event.target.checked));
  $("onboardingForm").addEventListener("submit", event => {
    event.preventDefault(); state.name = $("nameInput").value.trim(); state.partner = $("partnerInput").value.trim(); state.attire = $("attireInput").checked; state.onboarded = true; saveState(); closeModal("onboardingModal"); renderHeader(); renderRoute(); showToast("You're on the list. Merry Christmas!");
  });
  $("profileForm").addEventListener("submit", event => { event.preventDefault(); state.name = $("profileName").value.trim(); state.partner = $("profilePartner").value.trim(); state.attire = $("profileAttire").checked; saveState(); closeModal("profileModal"); renderHeader(); showToast("Profile updated."); });
  $("editPartnerButton").addEventListener("click", () => { $("profileName").value = state.name; $("profilePartner").value = state.partner; $("profileAttire").checked = state.attire; openModal("profileModal"); });
  $("randomizePartnerButton").addEventListener("click", () => {
    const options = ["The Designated Legend", "Festive Buddy", "The Night Shift", "Your Pub MVP", "Santa's Little Helper"];
    const available = options.filter(option => option !== state.partner);
    state.partner = available[Math.floor(Math.random() * available.length)];
    saveState(); renderHeader(); showToast(`Partner for the next stop: ${state.partner}`);
  });
  $("profileButton").addEventListener("click", () => { $("profileName").value = state.name; $("profilePartner").value = state.partner; $("profileAttire").checked = state.attire; openModal("profileModal"); });
  $("roomCodeInput").value = state.roomCode || "";
  $("roomKeyInput").value = state.roomKey || state.ownerKey || "";
  $("joinRoomButton").addEventListener("click", joinRoom);
  $("generatePairingsButton").addEventListener("click", generatePairings);
  $("copyInviteButton").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(inviteLink()); showToast("Attendee invite link copied."); } catch { showToast(inviteLink()); }
  });
  $("createRoomButton").addEventListener("click", async () => {
    if (!state.name) return showToast("Enter your name first.");
    const roomName = $("newRoomName").value.trim();
    const code = $("newRoomCode").value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const inviteKey = $("newInviteKey").value.trim();
    const ownerKey = $("newOwnerKey").value.trim();
    if (!roomName || !code || !inviteKey || !ownerKey) return showToast("Room creation cancelled.");
    try {
      const meetupSpot = $("newMeetupSpot").value.trim();
      if (!meetupSpot) return showToast("Add a meetup spot for the room.");
      await supabaseRpc("create_pub_room", { room_code: code, room_name: roomName, meetup_spot: meetupSpot, invite_key: inviteKey, owner_key: ownerKey, attendee_name: state.name });
      state.roomCode = code; state.roomName = roomName; state.meetupSpot = meetupSpot; state.roomKey = inviteKey; state.ownerKey = ownerKey; saveState(); $("roomCodeInput").value = code; $("roomKeyInput").value = inviteKey; await loadRoom(); showToast(`"${roomName}" created. Copy the attendee invite link.`);
    } catch (error) { reportRoomError(error, "Could not create room. The code may already be in use, or the migration is not installed."); }
  });
  $("resetButton").addEventListener("click", () => { if (confirm("Reset your route, counters and profile?")) { localStorage.removeItem(KEY); state = { ...defaultState, counters: { ...defaultState.counters } }; closeModal("profileModal"); renderHeader(); renderRoute(); openModal("onboardingModal"); } });
  document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => closeModal(button.dataset.close)));
  $("sosButton").addEventListener("click", () => openModal("sosModal")); $("copyLocationButton").addEventListener("click", copyLocation); $("sosCopyButton").addEventListener("click", copyLocation);
  document.querySelectorAll("[data-counter]").forEach(button => button.addEventListener("click", () => { const key = button.dataset.counter; state.counters[key] = Math.max(0, state.counters[key] + Number(button.dataset.change)); saveState(); renderHeader(); }));
}

function applyInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("room");
  const key = params.get("key");
  if (!code || !key) return;
  state.roomCode = code.toUpperCase();
  state.roomKey = key;
  saveState();
  $("roomCodeInput").value = state.roomCode;
  $("roomKeyInput").value = state.roomKey;
  showToast("Invite loaded. Enter your name, then select Join.");
  window.history.replaceState({}, "", window.location.pathname);
}

applyInviteFromUrl(); setupTabs(); wireForms(); renderHeader(); renderRoute();
if (state.roomCode) loadRoom().catch(error => reportRoomError(error, "Shared room is not configured yet."));
if (state.onboarded) closeModal("onboardingModal");
else openModal("onboardingModal");
