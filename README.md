# Pocket Forest · Tokushima

A small, static browser game inspired by the Miyawaki method. Fixed front elevation, panning, four forest layers, a survey notebook, a nursery, procedural growth, moisture-seeking roots, sunlight raycasts, seasonal litter, pollinators and a three-year review.

## Play locally

From this directory, run `python3 -m http.server 8000 --directory dist` and open http://localhost:8000. No build, package installation, server account or API key is required. Serve over HTTP; JavaScript modules do not work reliably through file:// URLs.

The game saves to localStorage on the same browser and origin. A new origin starts a new forest. Background tabs automatically pause time.

## Controls

Drag the background or use arrow buttons to pan. +/- zoom; Plot centers the bed. Tap plant labels to survey or inspect. Drag seedling pots on the bed and confirm planting. Mulch and water tools apply by dragging or tapping soil patches. Tap ! markers to pluck weeds. Space pauses/resumes during tending. Keyboard arrow keys pan when no dialog is open.

## GitHub Pages

The complete website is in `dist/` and uses relative URLs, including its vendored graphics library. It works under a GitHub repository subpath. The included `.github/workflows/pages.yml` deploys `dist/` with GitHub Actions after the repository's Pages source is set to GitHub Actions. No Sites account is needed for GitHub hosting. `.openai/hosting.json` is only for the current private Sites deployment and can be omitted from an independent fork.

## Educational model

Moisture and nutrients are tracked in 24 soil columns. Establishment has a 1,095-day endpoint; health, native planting, species variety, height layers and nutrients contribute to the review. Growth, rainfall, soil chemistry, density, flowering and animal activity are simplified and are not restoration predictions. Root depth is illustrative and is not a fixed one-meter-in-three-months promise. Adult previews are reference silhouettes, not forecasts. Native/introduced status belongs to the named species, not a verified photo identification.

Species recipes live in `dist/species.js`; rendering, interaction and simulation are in `dist/game.js`; the interface is in `dist/index.html` and `dist/style.css`. Three.js 0.170.0 is vendored with its MIT notice.

## Reference photographs and licensing

Original code is provided under the MIT license. User-supplied photographs in `dist/photos/` are excluded from that license and remain with their respective copyright holder. Before a public open-source release, obtain permission to redistribute those photos or replace/remove them. The game explicitly marks uncertain visual matches. Photos 2–3, 5, 7, 9 and 13 provide structure references; photos 8, 10 and 14 remain unresolved. Source links and educational limits are also available in the in-game About panel.
