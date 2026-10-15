# OSM EasyFind: Problem Statement and Solution

## 1. Website examined
OpenStreetMap (openstreetmap.org) and its Nominatim search.

## 2. Observed user difficulties and missing capabilities
1. **No "what is around it?" view.** OSM search answers "where is this place?" with a list of addresses. A user who has found a place (a hotel, a college, a park) cannot quickly see which essential services are close by (pharmacy, hospital, ATM, food, bus stop, fuel). They must run several separate searches or read the map by eye.
2. **Results are not tied to the user's location.** Searching a common name such as "pharmacy" or "park" returns places from all over the world, not around the user, so finding something nearby takes extra effort.
3. **Raw, technical results.** Results are long address strings with no distance, opening hours, phone number or directions, and there is no way to keep a shortlist.

## 3. Problem statement
Users of OpenStreetMap can find a location, but they cannot easily discover and compare the essential services around it, get results relevant to where they actually are, or judge how well-served an area is. Everyday and urgent decisions therefore take extra time and effort.

## 4. Proposed solution
**OSM EasyFind** is a lightweight, map-first web application (full-page map with a Google Maps-style sidebar) built on OpenStreetMap data. It turns any searched place, or the user's own location, into a practical decision tool.

| Feature | What it does |
|---|---|
| **Location-aware search** | A "Search area" control (prefer near me / only inside this area / anywhere) uses the browser's location or the current map view to bias or restrict Nominatim results, so results are around the user, not around the world. Each result shows its distance from the user. |
| **Search with autocomplete** | Suggestions appear as the user types; keyboard navigation is supported. |
| **Nearby Essentials** | After selecting a place, the user picks a category (pharmacy, hospital, ATM, food, bus stop, fuel) and a radius (500 m / 1 km / 2 km). Live Overpass API data is shown sorted by distance, with opening hours and phone where available, plus map markers. |
| **Neighbourhood Score** | One combined Overpass query counts essentials within 1 km and converts them into a score out of 100, with a verdict (Excellent / Good / Fair / Limited) and a bar for each category showing the count and distance to the closest one. |
| **Compare two places** | The user selects two saved places and sees their scores side by side, with the better category in each row highlighted and a one-line verdict. |
| **Directions** | A route from the selected place to any nearby result is fetched from the OSRM routing API, drawn on the map, and summarised as distance and time by car. |
| **Saved places** | Places can be saved (stored in the browser with localStorage), reopened, removed, and exported as a JSON file. |
| **Near me** | The Geolocation API centres the map on the user and shows a "You are here" marker. |
| **Dark mode** | A theme toggle (remembers the choice, follows the system theme by default) with darkened map tiles. |
| **Responsive layout** | Sidebar and full-height map on desktop (collapsible); map on top with the sidebar below on phones. |

### Neighbourhood Score method
Each category has a maximum number of points and a target count that earns full points. The score is the sum of the points.

| Category | Max points | Target count (within 1 km) |
|---|---|---|
| Hospital / clinic | 20 | 2 |
| Pharmacy | 20 | 2 |
| Bus stop | 20 | 4 |
| Food (restaurant, cafe, fast food) | 15 | 8 |
| ATM / bank | 15 | 3 |
| Fuel | 10 | 1 |

Points for a category = min(count / target, 1) x max points.

## 5. Technologies and how the requirements are met
| Requirement | Where it is used |
|---|---|
| **HTML** | Semantic structure in `index.html`: sidebar, tabs, forms, labelled controls, ARIA live regions. |
| **CSS** | `style.css`: CSS variables, flexbox/grid layout, responsive media queries, light and dark themes. |
| **JavaScript events** | `submit`, `input` (debounced autocomplete), `keydown` (arrow keys, Enter, Escape), `click` (tabs, chips, buttons, cards), `change` (radius, search area), `resize`/`load` (map size), Geolocation callbacks, and the custom events `place:selected`, `place:save` and `search:start`, which connect the search and nearby modules. |
| **Fetch API** | Nominatim (search and autocomplete, with `viewbox`/`bounded` location bias), Overpass API (POST, nearby places and score), OSRM (routing). Requests use `AbortController` to cancel outdated calls, and failures show friendly messages. |
| **JSON handling** | Responses are parsed with `response.json()`, tags are normalised, distances are computed with the Haversine formula, results are sorted and limited, GeoJSON routes are drawn on the map, and saved places are stored with `JSON.stringify` / `JSON.parse` in localStorage and exported as a downloadable `.json` file. |
| **Deployment** | Static site (no server needed) deployed GitHub Pages.

External services (all free, no API key): OpenStreetMap tiles, Nominatim, Overpass API, OSRM demo server, Leaflet (map library).

## 6. Files
- `index.html`: page structure
- `style.css`: layout, themes and components
- `script.js`: map, search, autocomplete, location bias, result cards
- `nearby.js`: tabs, nearby essentials, score, compare, directions, saved places, location, dark mode

## 7. Limitations
- OpenStreetMap data is community-contributed, so some areas have incomplete listings and scores are indicative, not official.
- The free Nominatim, Overpass and OSRM servers are shared and rate-limited, so requests can occasionally be slow or fail; the app shows an error message and the user can retry.
- Location-biased search prefers nearby results but is not a strict filter unless "Only inside this area" is chosen.
- Directions are by car only (OSRM demo server).

## 8. Future scope
Walking and cycling routes, "open now" filtering using opening hours, a "Search this area" button when the map is panned, more categories (schools, police, parks), sharing a place by link, and accessibility filters (for example wheelchair access).
