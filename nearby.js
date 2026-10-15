// Sidebar tabs, Nearby Essentials (Overpass), Directions (OSRM) and Saved places (localStorage).
// Relies on `map` and `escapeHTML` from script.js (loaded first on the same page).

const CATEGORIES = [
    { id: "pharmacy", label: "💊 Pharmacy", filter: '["amenity"="pharmacy"]' },
    { id: "hospital", label: "🏥 Hospital", filter: '["amenity"~"hospital|clinic"]' },
    { id: "atm", label: "🏧 ATM", filter: '["amenity"~"atm|bank"]' },
    { id: "food", label: "🍽 Food", filter: '["amenity"~"restaurant|cafe|fast_food"]' },
    { id: "bus", label: "🚌 Bus stop", filter: '["highway"="bus_stop"]' },
    { id: "fuel", label: "⛽ Fuel", filter: '["amenity"="fuel"]' }
];

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const SAVED_KEY = "easyfind.saved";

const sidebar = document.getElementById("sidebar");
const toggleSidebar = document.getElementById("toggleSidebar");
const tabButtons = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
const savedTab = document.getElementById("savedTab");
const nearbyTitle = document.getElementById("nearbyTitle");
const nearbyStatus = document.getElementById("nearbyStatus");
const nearbyResults = document.getElementById("nearbyResults");
const chipsBox = document.getElementById("chips");
const radiusSelect = document.getElementById("radiusSelect");
const nearMeButton = document.getElementById("nearMeButton");
const savedList = document.getElementById("savedList");
const savedStatus = document.getElementById("savedStatus");
const exportSaved = document.getElementById("exportSaved");
const scoreButton = document.getElementById("scoreButton");
const scoreCard = document.getElementById("scoreCard");
const compareButton = document.getElementById("compareButton");
const compareResult = document.getElementById("compareResult");

const nearbyMarkers = L.featureGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
let focus = null;            // { name, lat, lon }
let activeCategory = null;
let nearbyController;
let routeController;

// ---------------- TABS + SIDEBAR ----------------

function setTab(name) {
    tabButtons.forEach((t) => {
        const active = t.dataset.tab === name;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", String(active));
    });
    panels.forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
}

tabButtons.forEach((tab) =>
    tab.addEventListener("click", () => setTab(tab.dataset.tab))
);

toggleSidebar.addEventListener("click", () => {
    const collapsed = sidebar.classList.toggle("collapsed");
    toggleSidebar.setAttribute("aria-expanded", String(!collapsed));
    // Let the CSS transition finish, then tell Leaflet the map size changed.
    setTimeout(() => map.invalidateSize(), 300);
});

window.addEventListener("resize", () => map.invalidateSize());
window.addEventListener("load", () => map.invalidateSize());

// A new search switches back to the Results tab.
document.addEventListener("search:start", () => {
    setTab("results");
    routeLayer.clearLayers();
});

// ---------------- CATEGORY CHIPS ----------------

CATEGORIES.forEach((cat) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.id = cat.id;
    chip.textContent = cat.label;
    chipsBox.appendChild(chip);
});

// Custom event fired by script.js when a result is selected.
document.addEventListener("place:selected", (event) => {
    focus = event.detail;
    nearbyTitle.textContent = `Around ${focus.name}`;
    nearbyMarkers.clearLayers();
    routeLayer.clearLayers();
    nearbyResults.replaceChildren();
    scoreCard.hidden = true;
    setTab("nearby");
    if (activeCategory) {
        loadNearby();
    } else {
        nearbyStatus.textContent = "Choose a category to see what is close by.";
    }
});

chipsBox.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    if (!focus) {
        nearbyStatus.textContent = 'Select a place first: use "View on map" on a result, or tap "Near me".';
        return;
    }
    activeCategory = chip.dataset.id;
    chipsBox.querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("active", c === chip)
    );
    loadNearby();
});

radiusSelect.addEventListener("change", () => {
    if (focus && activeCategory) loadNearby();
});

// ---------------- LOCATION (Geolocation API) ----------------

const userLayer = L.layerGroup().addTo(map);

function locateUser(selectPlace) {
    if (!navigator.geolocation) {
        if (selectPlace) alert("Geolocation is not supported in this browser.");
        return;
    }
    nearMeButton.disabled = true;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            nearMeButton.disabled = false;
            const { latitude: lat, longitude: lon } = pos.coords;
            userLocation = { lat, lon }; // used by script.js to bias searches near the user
            userLayer.clearLayers();
            L.circleMarker([lat, lon], { radius: 9, color: "#1a73e8", fillColor: "#1a73e8", fillOpacity: 0.9 })
                .addTo(userLayer)
                .bindPopup("You are here");
            map.setView([lat, lon], 14);
            if (selectPlace) {
                document.dispatchEvent(
                    new CustomEvent("place:selected", {
                        detail: { name: "your location", lat, lon }
                    })
                );
            }
        },
        () => {
            nearMeButton.disabled = false;
            if (selectPlace) alert("Could not get your location. Please allow location access.");
        },
        { timeout: 10000 }
    );
}

nearMeButton.addEventListener("click", () => locateUser(true));

// If permission was already granted, centre the map on the user straight away.
if (navigator.permissions && navigator.geolocation) {
    navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
            if (status.state === "granted") locateUser(false);
        })
        .catch(() => { });
}

// ---------------- DARK MODE ----------------

const themeToggle = document.getElementById("themeToggle");

function updateThemeIcon() {
    const dark = document.documentElement.dataset.theme === "dark";
    themeToggle.textContent = dark ? "☀️" : "🌙";
    themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
        localStorage.setItem("easyfind.theme", next);
    } catch { }
    updateThemeIcon();
});

updateThemeIcon();

// ---------------- HELPERS ----------------

function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const rad = (d) => (d * Math.PI) / 180;
    const a =
        Math.sin(rad(lat2 - lat1) / 2) ** 2 +
        Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function formatDuration(seconds) {
    const mins = Math.max(1, Math.round(seconds / 60));
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function makeButton(text, secondary, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = secondary ? "view-button secondary" : "view-button";
    btn.textContent = text;
    btn.addEventListener("click", onClick);
    return btn;
}

// ---------------- NEARBY (Overpass API) ----------------

async function loadNearby() {
    const cat = CATEGORIES.find((c) => c.id === activeCategory);
    if (!cat || !focus) return;

    if (nearbyController) nearbyController.abort();
    const controller = new AbortController();
    nearbyController = controller;

    const radius = Number(radiusSelect.value);
    const { lat, lon } = focus;
    const catName = cat.label.slice(2).trim();

    // Overpass QL: nodes and ways with the tag filter around the point.
    const query =
        `[out:json][timeout:20];(` +
        `node${cat.filter}(around:${radius},${lat},${lon});` +
        `way${cat.filter}(around:${radius},${lat},${lon});` +
        `);out center 40;`;

    nearbyResults.replaceChildren();
    nearbyMarkers.clearLayers();
    nearbyStatus.textContent = `Looking for ${catName.toLowerCase()} nearby...`;

    try {
        const response = await fetch(OVERPASS_URL, {
            method: "POST",
            body: new URLSearchParams({ data: query }),
            signal: controller.signal
        });
        if (!response.ok) throw new Error("Overpass error " + response.status);

        const data = await response.json();

        // JSON handling: normalise tags, compute distance, sort, keep the closest.
        const items = (data.elements || [])
            .map((el) => {
                const pLat = el.lat ?? el.center?.lat;
                const pLon = el.lon ?? el.center?.lon;
                if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) return null;
                const tags = el.tags || {};
                return {
                    name: tags.name || tags.operator || tags.brand || `Unnamed ${catName}`,
                    lat: pLat,
                    lon: pLon,
                    hours: tags.opening_hours || "",
                    phone: tags.phone || tags["contact:phone"] || "",
                    distance: distanceMeters(lat, lon, pLat, pLon)
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 15);

        if (!items.length) {
            nearbyStatus.textContent =
                "Nothing found in this radius. Try a larger radius or another category.";
            return;
        }

        nearbyStatus.textContent =
            `${items.length} closest result(s) within ${formatDistance(radius)}.`;

        items.forEach((item) => {
            const marker = L.circleMarker([item.lat, item.lon], {
                radius: 8, color: "#32694b", fillColor: "#32694b", fillOpacity: 0.7
            }).addTo(nearbyMarkers);
            marker.bindPopup(
                `<strong>${escapeHTML(item.name)}</strong><br>${formatDistance(item.distance)} away`
            );

            const card = document.createElement("article");
            card.className = "place-card";

            const title = document.createElement("h3");
            title.textContent = item.name;

            const meta = document.createElement("p");
            const parts = [`${formatDistance(item.distance)} away`];
            if (item.hours) parts.push(`Hours: ${item.hours}`);
            if (item.phone) parts.push(`Phone: ${item.phone}`);
            meta.textContent = parts.join(" · ");

            const actions = document.createElement("div");
            actions.className = "actions";
            actions.append(
                makeButton("Show on map ↗", false, () => {
                    map.setView([item.lat, item.lon], 17);
                    marker.openPopup();
                }),
                makeButton("Directions", true, () => showRoute(item)),
                makeButton("☆ Save", true, () =>
                    document.dispatchEvent(
                        new CustomEvent("place:save", {
                            detail: { name: item.name, lat: item.lat, lon: item.lon }
                        })
                    )
                )
            );

            card.append(title, meta, actions);
            nearbyResults.appendChild(card);
        });

        const group = L.featureGroup([nearbyMarkers, markers]);
        if (group.getLayers().length) {
            map.fitBounds(group.getBounds(), { padding: [30, 30], maxZoom: 16 });
        }
    } catch (error) {
        if (error.name !== "AbortError") {
            console.error("Nearby error:", error);
            nearbyStatus.textContent =
                "Could not load nearby places (the free server may be busy). Please try again.";
        }
    }
}

// ---------------- DIRECTIONS (OSRM API) ----------------

async function showRoute(item) {
    if (!focus) return;

    if (routeController) routeController.abort();
    const controller = new AbortController();
    routeController = controller;

    nearbyStatus.textContent = `Finding route to ${item.name}...`;

    try {
        const url =
            `${OSRM_URL}/${focus.lon},${focus.lat};${item.lon},${item.lat}` +
            `?overview=full&geometries=geojson`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Routing error " + response.status);

        const data = await response.json();
        const route = data.routes && data.routes[0];
        if (data.code !== "Ok" || !route) throw new Error("No route found");

        routeLayer.clearLayers();
        const line = L.geoJSON(route.geometry, {
            style: { color: "#1a73e8", weight: 5, opacity: 0.85 }
        }).addTo(routeLayer);
        map.fitBounds(line.getBounds(), { padding: [40, 40] });

        nearbyStatus.textContent =
            `Route from ${focus.name} to ${item.name}: ` +
            `${formatDistance(route.distance)}, about ${formatDuration(route.duration)} by car.`;
    } catch (error) {
        if (error.name !== "AbortError") {
            console.error("Route error:", error);
            nearbyStatus.textContent =
                "Could not find a route right now. Please try again.";
        }
    }
}

// ---------------- NEIGHBOURHOOD SCORE ----------------
// One combined Overpass query counts essentials within 1 km and turns them into a 0-100 score.

const SCORE_RADIUS = 1000;
const SCORE_LABEL = "📊 Neighbourhood score (1 km)";

// weight = max points; target = how many nearby earns full points.
const SCORE_CATS = [
    { id: "hospital", label: "🏥 Hospital / clinic", weight: 20, target: 2, test: (t) => ["hospital", "clinic"].includes(t.amenity) },
    { id: "pharmacy", label: "💊 Pharmacy", weight: 20, target: 2, test: (t) => t.amenity === "pharmacy" },
    { id: "bus", label: "🚌 Bus stop", weight: 20, target: 4, test: (t) => t.highway === "bus_stop" },
    { id: "food", label: "🍽 Food", weight: 15, target: 8, test: (t) => ["restaurant", "cafe", "fast_food"].includes(t.amenity) },
    { id: "atm", label: "🏧 ATM / bank", weight: 15, target: 3, test: (t) => ["atm", "bank"].includes(t.amenity) },
    { id: "fuel", label: "⛽ Fuel", weight: 10, target: 1, test: (t) => t.amenity === "fuel" }
];

const scoreCache = new Map();
let scoreController;

async function computeScore(lat, lon, signal) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (scoreCache.has(key)) return scoreCache.get(key);

    const parts = CATEGORIES
        .map((c) => `nwr${c.filter}(around:${SCORE_RADIUS},${lat},${lon});`)
        .join("");
    const query = `[out:json][timeout:25];(${parts});out center tags;`;

    const response = await fetch(OVERPASS_URL, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal
    });
    if (!response.ok) throw new Error("Overpass error " + response.status);

    const data = await response.json();
    const elements = data.elements || [];

    const rows = SCORE_CATS.map((cat) => {
        const distances = elements
            .filter((el) => el.tags && cat.test(el.tags))
            .map((el) => {
                const pLat = el.lat ?? el.center?.lat;
                const pLon = el.lon ?? el.center?.lon;
                return Number.isFinite(pLat) && Number.isFinite(pLon)
                    ? distanceMeters(lat, lon, pLat, pLon)
                    : null;
            })
            .filter((d) => d !== null);

        const ratio = Math.min(distances.length / cat.target, 1);
        return {
            id: cat.id,
            label: cat.label,
            weight: cat.weight,
            count: distances.length,
            nearest: distances.length ? Math.min(...distances) : null,
            ratio,
            points: Math.round(ratio * cat.weight)
        };
    });

    const result = { total: rows.reduce((sum, r) => sum + r.points, 0), rows };
    scoreCache.set(key, result);
    return result;
}

function scoreVerdict(total) {
    if (total >= 80) return "Excellent";
    if (total >= 60) return "Good";
    if (total >= 40) return "Fair";
    return "Limited";
}

function barColor(ratio) {
    if (ratio >= 0.75) return "#32694b";
    if (ratio >= 0.4) return "#d9a31a";
    return "#c0504d";
}

function renderScoreCard(placeName, result) {
    scoreCard.replaceChildren();

    const top = document.createElement("div");
    top.className = "score-top";

    const num = document.createElement("span");
    num.className = "score-num";
    num.textContent = result.total;
    const small = document.createElement("small");
    small.textContent = " / 100";
    num.appendChild(small);

    const verdict = document.createElement("span");
    verdict.className = "score-verdict";
    verdict.textContent = `${scoreVerdict(result.total)} for essentials · ${placeName}`;

    top.append(num, verdict);
    scoreCard.appendChild(top);

    result.rows.forEach((row) => {
        const wrap = document.createElement("div");
        wrap.className = "bar-row";

        const label = document.createElement("div");
        label.className = "bar-label";
        const left = document.createElement("span");
        left.textContent = row.label;
        const right = document.createElement("span");
        right.textContent = row.count
            ? `${row.count} nearby · closest ${formatDistance(row.nearest)}`
            : "none within 1 km";
        label.append(left, right);

        const track = document.createElement("div");
        track.className = "bar-track";
        const fill = document.createElement("div");
        fill.className = "bar-fill";
        fill.style.width = `${Math.max(row.ratio * 100, 3)}%`;
        fill.style.background = barColor(row.ratio);
        track.appendChild(fill);

        wrap.append(label, track);
        scoreCard.appendChild(wrap);
    });

    const note = document.createElement("p");
    note.className = "score-note";
    note.textContent =
        "Score = hospitals, pharmacies, bus stops, food, ATMs and fuel within 1 km, " +
        "based on OpenStreetMap data (which may be incomplete in some areas).";
    scoreCard.appendChild(note);
    scoreCard.hidden = false;
}

scoreButton.addEventListener("click", async () => {
    if (!focus) {
        nearbyStatus.textContent = 'Select a place first: use "View on map" on a result, or tap "Near me".';
        return;
    }

    if (scoreController) scoreController.abort();
    const controller = new AbortController();
    scoreController = controller;

    scoreButton.disabled = true;
    scoreButton.textContent = "Calculating...";
    nearbyStatus.textContent = `Scoring the area around ${focus.name}...`;

    try {
        const result = await computeScore(focus.lat, focus.lon, controller.signal);
        renderScoreCard(focus.name, result);
        nearbyStatus.textContent = "";
    } catch (error) {
        if (error.name !== "AbortError") {
            console.error("Score error:", error);
            nearbyStatus.textContent =
                "Could not calculate the score (the free server may be busy). Please try again.";
        }
    } finally {
        if (scoreController === controller) {
            scoreButton.disabled = false;
            scoreButton.textContent = SCORE_LABEL;
        }
    }
});

// ---------------- COMPARE TWO SAVED PLACES ----------------

let compareSel = [];

function updateCompareUI() {
    const saved = readSaved();
    compareSel = compareSel.filter((s) => saved.some((p) => isSame(p, s)));
    compareButton.textContent = `Compare selected (${compareSel.length}/2)`;
    compareButton.disabled = compareSel.length !== 2;
}

function toggleCompare(place) {
    const index = compareSel.findIndex((s) => isSame(s, place));
    if (index >= 0) {
        compareSel.splice(index, 1);
    } else {
        compareSel.push(place);
        if (compareSel.length > 2) compareSel.shift();
    }
    renderSaved();
}

function gridCell(text, className) {
    const cell = document.createElement("div");
    if (className) cell.className = className;
    cell.textContent = text;
    return cell;
}

function renderCompare(a, ra, b, rb) {
    compareResult.replaceChildren();

    const grid = document.createElement("div");
    grid.className = "compare-grid";

    const winA = ra.total > rb.total;
    const winB = rb.total > ra.total;

    grid.append(
        gridCell(""),
        gridCell(a.name, "head"),
        gridCell(b.name, "head"),
        gridCell("Score"),
        gridCell(`${ra.total}/100`, `total${winA ? " win" : ""}`),
        gridCell(`${rb.total}/100`, `total${winB ? " win" : ""}`)
    );

    ra.rows.forEach((rowA, i) => {
        const rowB = rb.rows[i];
        const text = (r) =>
            r.count ? `${r.count} · ${formatDistance(r.nearest)}` : "none";
        grid.append(
            gridCell(rowA.label),
            gridCell(text(rowA), rowA.count > rowB.count ? "win" : ""),
            gridCell(text(rowB), rowB.count > rowA.count ? "win" : "")
        );
    });

    const verdict = document.createElement("p");
    verdict.className = "compare-verdict";
    if (ra.total === rb.total) {
        verdict.textContent = `It's a tie: both areas score ${ra.total}/100 for nearby essentials.`;
    } else {
        const [best, bestScore, other, otherScore] = winA
            ? [a.name, ra.total, b.name, rb.total]
            : [b.name, rb.total, a.name, ra.total];
        verdict.textContent =
            `${best} is better for essentials (${bestScore} vs ${otherScore} for ${other}).`;
    }

    const note = document.createElement("p");
    note.className = "score-note";
    note.textContent = "Each cell shows how many are within 1 km and the distance to the closest one.";

    compareResult.append(grid, verdict, note);
    compareResult.hidden = false;
}

compareButton.addEventListener("click", async () => {
    if (compareSel.length !== 2) return;
    const [a, b] = compareSel;

    compareButton.disabled = true;
    savedStatus.textContent = "Comparing the two areas...";

    try {
        // Sequential requests keep us within the free Overpass server's limits.
        const ra = await computeScore(a.lat, a.lon);
        const rb = await computeScore(b.lat, b.lon);
        renderCompare(a, ra, b, rb);
        savedStatus.textContent = "";
    } catch (error) {
        console.error("Compare error:", error);
        savedStatus.textContent =
            "Could not compare right now (the free server may be busy). Please try again.";
    } finally {
        updateCompareUI();
    }
});

// ---------------- SAVED PLACES (localStorage + JSON) ----------------

function readSaved() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeSaved(list) {
    try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch (error) {
        console.error("Could not save:", error);
    }
}

function isSame(a, b) {
    return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
}

function renderSaved() {
    const list = readSaved();
    savedTab.textContent = `Saved (${list.length})`;
    savedList.replaceChildren();
    savedStatus.textContent = list.length
        ? `${list.length} saved place(s), stored in this browser.`
        : "Nothing saved yet. Use the ☆ Save button on any result.";

    list.forEach((place) => {
        const card = document.createElement("article");
        card.className = "place-card";

        const title = document.createElement("h3");
        title.textContent = place.name;

        const meta = document.createElement("p");
        meta.textContent = `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;

        const actions = document.createElement("div");
        actions.className = "actions";
        actions.append(
            makeButton("Open ↗", false, () => {
                map.setView([place.lat, place.lon], 16);
                document.dispatchEvent(new CustomEvent("place:selected", { detail: place }));
            }),
            (() => {
                const picked = compareSel.some((s) => isSame(s, place));
                const btn = makeButton(picked ? "✓ Selected" : "Compare", true, () => toggleCompare(place));
                btn.classList.toggle("picked", picked);
                return btn;
            })(),
            makeButton("Remove", true, () => {
                writeSaved(readSaved().filter((p) => !isSame(p, place)));
                renderSaved();
            })
        );

        card.append(title, meta, actions);
        savedList.appendChild(card);
    });

    updateCompareUI();
}

document.addEventListener("place:save", (event) => {
    const place = event.detail;
    const list = readSaved();
    if (list.some((p) => isSame(p, place))) {
        savedStatus.textContent = `"${place.name}" is already saved.`;
    } else {
        list.unshift({ name: place.name, lat: place.lat, lon: place.lon });
        writeSaved(list);
    }
    renderSaved();
});

// Export saved places as a downloadable JSON file.
exportSaved.addEventListener("click", () => {
    const list = readSaved();
    if (!list.length) {
        savedStatus.textContent = "Nothing to export yet.";
        return;
    }
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "easyfind-saved-places.json";
    link.click();
    URL.revokeObjectURL(url);
});

renderSaved();