const form = document.getElementById("searchForm");
const input = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const statusText = document.getElementById("status");
const resultsContainer = document.getElementById("results");
const resultCount = document.getElementById("resultCount");
const suggestionsBox = document.getElementById("suggestions");

let suggestionTimer;
let suggestionResults = [];
let activeSuggestion = -1;
let suggestionController;
let searchController;
let latestSuggestionQuery = "";
let userLocation = null; // { lat, lon } once the browser gives us the position

const scopeSelect = document.getElementById("scopeSelect");

// Bias (or restrict) Nominatim results to the user's area instead of the whole world.
function applyScope(params) {
    const mode = scopeSelect ? scopeSelect.value : "any";
    if (mode === "any") return;

    let west, south, east, north;
    if (userLocation) {
        const d = mode === "only" ? 0.25 : 0.6; // degrees, roughly 28 km / 65 km
        west = userLocation.lon - d;
        east = userLocation.lon + d;
        south = userLocation.lat - d;
        north = userLocation.lat + d;
    } else {
        const b = map.getBounds();
        west = b.getWest();
        east = b.getEast();
        south = b.getSouth();
        north = b.getNorth();
    }

    params.set("viewbox", [west, north, east, south].map((n) => n.toFixed(5)).join(","));
    params.set("bounded", mode === "only" ? "1" : "0");
}

// Initialize the map.
const map = L.map("map").setView([12.9716, 77.5946], 11);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
}).addTo(map);

const markers = L.featureGroup().addTo(map);

// ---------------- AUTOCOMPLETE ----------------

function hideSuggestions() {
    suggestionsBox.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeSuggestion = -1;
}

function showSuggestions() {
    suggestionsBox.hidden = false;
    input.setAttribute("aria-expanded", "true");
}

function highlightSuggestion(index) {
    const items = suggestionsBox.querySelectorAll(".suggestion-item");

    if (!items.length) return;

    activeSuggestion = (index + items.length) % items.length;

    items.forEach((item, i) => {
        const active = i === activeSuggestion;

        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));

        if (active) {
            input.setAttribute("aria-activedescendant", item.id);
            item.scrollIntoView({ block: "nearest" });
        }
    });
}

async function fetchSuggestions(query) {
    if (suggestionController) {
        suggestionController.abort();
    }

    const controller = new AbortController();
    suggestionController = controller;
    latestSuggestionQuery = query;

    const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        addressdetails: "1",
        limit: "6",
        "accept-language": "en"
    });
    applyScope(params);

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?${params}`,
            { signal: controller.signal }
        );

        if (!response.ok) {
            throw new Error("Unable to retrieve suggestions.");
        }

        const places = await response.json();

        // Ignore outdated responses.
        if (
            controller.signal.aborted ||
            input.value.trim() !== query ||
            latestSuggestionQuery !== query
        ) {
            return;
        }

        suggestionResults = Array.isArray(places) ? places : [];
        renderSuggestions(suggestionResults);

    } catch (error) {
        if (error.name !== "AbortError") {
            console.error("Suggestion error:", error);

            if (input.value.trim() === query) {
                suggestionsBox.replaceChildren();

                const message = document.createElement("div");
                message.className = "suggestion-item";
                message.textContent = "Suggestions unavailable. Try Search.";
                suggestionsBox.appendChild(message);
                showSuggestions();
            }
        }
    }
}

function renderSuggestions(places) {
    suggestionsBox.replaceChildren();
    activeSuggestion = -1;
    input.removeAttribute("aria-activedescendant");

    if (!places.length) {
        const message = document.createElement("div");
        message.className = "suggestion-item";
        message.textContent = "No matching places found. Try another spelling.";
        suggestionsBox.appendChild(message);
        showSuggestions();
        return;
    }

    places.forEach((place, index) => {
        const item = document.createElement("button");

        item.type = "button";
        item.id = `suggestion-${index}`;
        item.className = "suggestion-item";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");

        const icon = document.createElement("span");
        icon.className = "suggestion-icon";
        icon.textContent = "📍";

        const text = document.createElement("span");
        text.className = "suggestion-text";

        const name = document.createElement("span");
        name.className = "suggestion-name";
        name.textContent =
            place.name || place.display_name.split(",")[0];

        const address = document.createElement("span");
        address.className = "suggestion-address";
        address.textContent = place.display_name;

        text.append(name, address);
        item.append(icon, text);

        item.addEventListener("click", () => {
            selectSuggestion(index);
        });

        item.addEventListener("mouseenter", () => {
            highlightSuggestion(index);
        });

        suggestionsBox.appendChild(item);
    });

    showSuggestions();
}

function selectSuggestion(index) {
    const place = suggestionResults[index];

    if (!place) return;

    input.value = place.name || place.display_name;
    hideSuggestions();

    // Search the exact selected location.
    searchPlaces(place.display_name);
}

// Listen for typing.
input.addEventListener("input", () => {
    const query = input.value.trim();

    clearTimeout(suggestionTimer);

    // Cancel any previous request immediately.
    if (suggestionController) {
        suggestionController.abort();
    }

    if (query.length < 3) {
        suggestionResults = [];
        suggestionsBox.replaceChildren();
        hideSuggestions();
        return;
    }

    // Debounce to avoid sending a request for every keystroke.
    suggestionTimer = setTimeout(() => {
        fetchSuggestions(query);
    }, 700);
});

// Keyboard navigation.
input.addEventListener("keydown", (event) => {
    const isOpen = !suggestionsBox.hidden;
    const count = suggestionResults.length;

    if (event.key === "ArrowDown" && isOpen && count) {
        event.preventDefault();
        highlightSuggestion(activeSuggestion + 1);
    } else if (event.key === "ArrowUp" && isOpen && count) {
        event.preventDefault();
        highlightSuggestion(
            activeSuggestion === -1 ? count - 1 : activeSuggestion - 1
        );
    } else if (
        event.key === "Enter" &&
        isOpen &&
        activeSuggestion >= 0
    ) {
        event.preventDefault();
        selectSuggestion(activeSuggestion);
    } else if (event.key === "Escape") {
        hideSuggestions();
    }
});

// Close the dropdown when clicking outside it.
document.addEventListener("click", (event) => {
    if (
        !event.target.closest(".search-wrapper") &&
        !event.target.closest("#searchButton")
    ) {
        hideSuggestions();
    }
});

// ---------------- MAIN SEARCH ----------------

form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(suggestionTimer);
    hideSuggestions();
    searchPlaces(input.value.trim());
});

// Example searches.
document.querySelectorAll(".example").forEach((button) => {
    button.addEventListener("click", () => {
        input.value = button.dataset.query;
        hideSuggestions();
        searchPlaces(input.value);
    });
});

async function searchPlaces(query) {
    if (!query) {
        statusText.textContent = "Please enter a place to search.";
        return;
    }

    if (searchController) {
        searchController.abort();
    }

    const controller = new AbortController();
    searchController = controller;

    document.dispatchEvent(new Event("search:start"));
    resultsContainer.replaceChildren();
    markers.clearLayers();
    resultCount.textContent = "0 places";
    statusText.textContent = "Searching for places...";
    searchButton.disabled = true;
    searchButton.textContent = "Searching...";

    try {
        const params = new URLSearchParams({
            q: query,
            format: "jsonv2",
            limit: "8",
            addressdetails: "1"
        });
        applyScope(params);

        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?${params}`,
            { signal: controller.signal }
        );

        if (!response.ok) {
            throw new Error("The location service returned an error.");
        }

        const places = await response.json();

        if (!Array.isArray(places)) {
            throw new Error("Unexpected response from the location service.");
        }

        if (places.length === 0) {
            statusText.textContent =
                "No results found. Try a different spelling or a nearby city.";
            return;
        }

        let validCount = 0;

        places.forEach((place, index) => {
            const lat = Number(place.lat);
            const lon = Number(place.lon);

            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                return;
            }

            validCount++;

            const name =
                place.name ||
                place.display_name.split(",")[0] ||
                "Unnamed place";

            const marker = L.marker([lat, lon]).addTo(markers);

            marker.bindPopup(
                `<strong>${escapeHTML(name)}</strong><br>${lat.toFixed(5)}, ${lon.toFixed(5)}`
            );

            const card = document.createElement("article");
            card.className = "place-card";

            const title = document.createElement("h3");
            title.textContent = name;

            const address = document.createElement("p");
            address.textContent = userLocation
                ? `${formatDistance(distanceMeters(userLocation.lat, userLocation.lon, lat, lon))} from you · ${place.display_name}`
                : place.display_name;

            const viewButton = document.createElement("button");
            viewButton.type = "button";
            viewButton.className = "view-button";
            viewButton.textContent = "View on map ↗";

            const announce = () =>
                document.dispatchEvent(
                    new CustomEvent("place:selected", { detail: { name, lat, lon } })
                );

            viewButton.addEventListener("click", () => {
                map.setView([lat, lon], 16);
                marker.openPopup();
                selectCard(card);
                announce();
            });

            marker.on("click", () => {
                map.setView([lat, lon], 16);
                selectCard(card);
                announce();
            });

            const saveButton = document.createElement("button");
            saveButton.type = "button";
            saveButton.className = "view-button secondary";
            saveButton.textContent = "☆ Save";
            saveButton.addEventListener("click", () => {
                document.dispatchEvent(
                    new CustomEvent("place:save", { detail: { name, lat, lon } })
                );
            });

            const actions = document.createElement("div");
            actions.className = "actions";
            actions.append(viewButton, saveButton);

            card.append(title, address, actions);
            resultsContainer.appendChild(card);
        });

        resultCount.textContent = `${validCount} places`;
        statusText.textContent = validCount
            ? `Found ${validCount} matching place(s) for "${query}".`
            : "The results did not contain usable coordinates.";

        if (markers.getLayers().length > 0) {
            map.fitBounds(markers.getBounds(), {
                padding: [30, 30],
                maxZoom: 14
            });
        }

    } catch (error) {
        if (error.name !== "AbortError") {
            console.error("Search error:", error);
            statusText.textContent =
                "Unable to load results. Check your internet connection and try again.";
        }
    } finally {
        if (searchController === controller) {
            searchButton.disabled = false;
            searchButton.textContent = "Search places ↗";
        }
    }
}

function selectCard(selectedCard) {
    document.querySelectorAll(".place-card").forEach((card) => {
        card.classList.toggle("selected", card === selectedCard);
    });
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[character];
    });
}