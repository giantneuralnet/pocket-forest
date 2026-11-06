# Pocket Forest · Tokushima

A full-screen browser game with a fixed, lightly elevated perspective camera inspired by the Miyawaki method. Survey the surrounding woodland, prepare living soil, buy and arrange seedlings, mulch and water the bed, and tend a small forest through a three-year review.

## Run

`python3 -m http.server 8000 --directory dist`, then open http://localhost:8000. The website is entirely static, with a vendored Three.js library and no API keys or runtime network dependencies. Serve through HTTP rather than opening index.html with file://.

## Interaction

- Drag the landscape in any direction. Pinch to zoom with two touch points; a trackpad pinch zooms around the gesture center and a two-finger scroll pans. The page itself does not zoom or scroll. Plot centers the planting bed.
- Hover any plant for its name, health and age. On mobile, one tap highlights and records it; a second opens the detailed notebook entry. Every visible tree, shrub, fern and herb can be surveyed. Weeds are plucked on the first tap.
- The nursery offers surveyed species. Drag pots into position and confirm planting. Selecting a seedling shows mature reference silhouettes for the complete planting.
- Hold/drag the mulch bag or watering can over the soil. Chips and droplets fall from the tool; mulch is applied on contact and the completed bag is automatically put away. Water ponds at the surface and infiltrates gradually.
- Bare red ! marks indicate weeds. Tap to pull a weed up and leave it on the ground to decompose. Unremoved weeds grow roots and compete for resources.
- The time menu offers real time, one day per second, one week per second and one month per second. There is no pause option. Arrow keys pan when a dialog is closed.

## Simulation and rendering

A seeded parent-linked architecture generates irregular trunks, branches, forks and twigs. Branches unfold and extend continuously with maturity. Every leaf blade starts at a petiole attached to a branch; leaf and wood transforms share a continuous global wind value. The same connected architecture is used for mature previews. Species-specific leaf shapes are drawn once to cached canvas textures. Instanced leaf planes reuse those stamps; raycasting uses lightweight volumetric proxies around leafy twig clusters to estimate sun exposure and canopy interception of rain. This is a simplified 2.5D canopy model, not a physically exact light transport simulation.

The wider planting strip has a 64 × 14 soil grid. Each cell tracks moisture, nutrients, drainage, organic matter and biological activity. Surface water infiltrates over real elapsed time, then moves gradually down and sideways. Both the bed and surrounding soil have spatially varied moisture and nutrients. Hovering or tapping the cutaway reads the cell under the pointer. Nutrients increase brown saturation; moisture makes the soil darker. A border identifies the bed. New root tips retain a heading, sample several randomized directions, and steer toward moisture and nutrients. They can extend outside the bed and below its border; root extension slows as plant age increases. Tips fork at varied times and angles. Existing root segments are stored permanently, including across reloads, and never rerouted. Tapered 3D root segments are appended to persistent instance buffers; old transforms are retained. Trunks and branches also use tapered six-sided 3D cylinders.

Partial shade and neighboring plants can benefit establishment through a modest shelter bonus. Deep shade still limits growth, according to each species’ shade tolerance. The model is intended to teach coexistence and competition without claiming every species grows faster in every shade condition.

Mushrooms have individual birth/expiry dates and are spawned sporadically after rain in suitable soil. They do not blink on a repeating global cycle and are not proof of nutrient sharing or forest health. Seasonal litter, mulch and pulled weeds contribute organic matter.

## Review score

- Plant health: 25 points
- Species variety: 25 points (target: seven surviving species)
- Living planting density: 25 points (target: 20 surviving seedlings)
- Forest layers: 10 points
- Native planting: 5 points
- Weed control: 10 points, combining the weeds remaining and average weed load throughout establishment

These targets are game design choices for a strip with compressed planting depth, not a real-world planting prescription. Two healthy trees cannot earn a near-perfect forest score. Review automatically occurs at 1,095 simulated days; unlimited growth can continue afterward.

## Verification

`npm run check` checks module syntax; `npm test` covers fixed root coordinates, delayed infiltration, scoring sensitivity, weeds growing roots, mushroom lifetimes, the shelter bonus, migration of old saves, anchored zoom, vertical/horizontal panning, and sunlight/rain raycasts. Touch gestures are implemented with pointer events; physical-device testing is still recommended before a symposium installation.

## Files and saving

`dist/architecture.js`: seeded branching, progressive growth and leaf attachments. `dist/game.js`: interface and interactions. `dist/forest-view.js`: graphics, leaf stamps, raycasting and animated effects. `dist/ecology.js`: soil, roots, growth and scoring. `dist/species.js`: reference species and educational sources.

Progress is saved locally on the browser/origin. Version-one saves migrate to the wider bed and fine soil grid; the previous save is retained until the player explicitly restarts. Background tabs follow the browser’s animation scheduling.

## GitHub Pages and license

`.github/workflows/pages.yml` deploys `dist/` after the repository's Pages publishing source is set to GitHub Actions. All asset URLs are relative, so the site works under a repository subpath. The `.openai/hosting.json` manifest is only for the current private Sites hosting and is not required for GitHub Pages.

Original game code is MIT licensed. Three.js includes its MIT notice. User-supplied photographs in `dist/photos/` are excluded from the code license; obtain permission to redistribute them publicly or replace/remove them before a public release. Photo identifications remain tentative, with uncertainty shown in the notebook. Southern crabgrass and horseweed are additional named weed references, not identifications from the supplied photos. Southern crabgrass native status is left unassigned here.


## Detail and performance update (0.4)

The camera is now perspective, with a mild downward angle and zoom up to 12×. Trunks, roots, the avatar and tools have real 3D volume. Leaves remain efficient flat, textured instances, with per-leaf green variations, larger blades on mature plants, and extra attached foliage. A shared wind value moves each plant coherently without rebuilding its skeleton each frame.

All interactive controls sit in a single blue tool bin at the bottom. On narrow screens the bin scrolls horizontally. The top has only phase instructions and the establishment progress bar. Soil hover values use the ray’s intersection with the cutaway plane, rather than a perspective-unprojected arbitrary depth. Plant selection includes screen-space padding around branches.

The previous renderer posed all trees together roughly 11 times per second, recreated root geometry on growth updates, and cleared canopy samples in bursts. The revised renderer only changes plant instance matrices when growth or leaf state changes, spreads queued updates across frames, reuses root GPU buffers, and staggers canopy/rain sampling. Raycast volumes are clustered by twig, rather than generated for every individual leaf. Soil cutaway cells use shared plane geometry, while open-ended tapered roots avoid drawing hidden end caps. Only newly added root matrices are uploaded. Water-transfer scratch buffers and leaf color objects are also reused.

Routine saves run in browser idle time; root histories use compact numeric arrays with micrometer coordinate precision to reduce storage usage. No saved root is re-routed. Tests cover a dense 60-plant root history and restoration, along with root-buffer identity across growth. Lightweight frame/pose/buffer counters are available on the scene and world DOM elements for development diagnostics.

Flowering native reference species include Yabutsubaki, Hisakaki, Nezumimochi and Yabukoji. Their seasonal flowers, including those in the surveyed woodland, attract simple cube bees and butterflies. Nursery entries identify flowering species.
