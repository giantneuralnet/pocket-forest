# Pocket Forest · Tokushima

A full-screen, fixed front-elevation browser game inspired by the Miyawaki method. Survey the surrounding woodland, prepare living soil, buy and arrange seedlings, mulch and water the bed, and tend a small forest through a three-year review.

## Run

`python3 -m http.server 8000 --directory dist`, then open http://localhost:8000. The website is entirely static, with a vendored Three.js library and no API keys or runtime network dependencies. Serve through HTTP rather than opening index.html with file://.

## Interaction

- Drag the landscape in any direction. Pinch to zoom with two touch points; a trackpad pinch zooms around the gesture center and a two-finger scroll pans. The page itself does not zoom or scroll. Plot centers the planting bed.
- Hover any plant for its name, health and age. On mobile, one tap highlights and records it; a second opens the detailed notebook entry. Every visible tree, shrub, fern and herb can be surveyed. Weeds are plucked on the first tap.
- The nursery offers surveyed species. Drag pots into position and confirm planting. Selecting a seedling shows mature reference silhouettes for the complete planting.
- Hold/drag the mulch bag or watering can over the soil. Chips and droplets fall from the tool; mulch is applied on contact and the completed bag is automatically put away. Water ponds at the surface and infiltrates gradually.
- Bare red ! marks indicate weeds. Tap to pull a weed up and leave it on the ground to decompose. Unremoved weeds grow roots and compete for resources.
- Space pauses time during tending. Arrow keys pan when a dialog is closed.

## Simulation and rendering

Species-specific leaf shapes are drawn once to cached canvas textures. Instanced leaf planes reuse those stamps; raycasting uses lightweight volumetric proxies around leaf instances to estimate sun exposure and canopy interception of rain. This is a simplified 2.5D canopy model, not a physically exact light transport simulation.

The wider planting strip has a 64 × 14 soil grid. Each cell tracks moisture, nutrients, drainage, organic matter and biological activity. Surface water infiltrates over real elapsed time, then moves gradually down and sideways. New root tips sample moisture and nutrients. Existing root segments are stored permanently, including across reloads, and never rerouted. The visual segment geometry is rebuilt from those fixed coordinates when new segments arrive.

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

`dist/game.js`: interface and interactions. `dist/forest-view.js`: graphics, leaf stamps, raycasting and animated effects. `dist/ecology.js`: soil, roots, growth and scoring. `dist/species.js`: reference species and educational sources.

Progress is saved locally on the browser/origin. Version-one saves migrate to the wider bed and fine soil grid; the previous save is retained until the player explicitly restarts. Background tabs pause time.

## GitHub Pages and license

`.github/workflows/pages.yml` deploys `dist/` after the repository's Pages publishing source is set to GitHub Actions. All asset URLs are relative, so the site works under a repository subpath. The `.openai/hosting.json` manifest is only for the current private Sites hosting and is not required for GitHub Pages.

Original game code is MIT licensed. Three.js includes its MIT notice. User-supplied photographs in `dist/photos/` are excluded from the code license; obtain permission to redistribute them publicly or replace/remove them before a public release. Photo identifications remain tentative, with uncertainty shown in the notebook. Southern crabgrass and horseweed are additional named weed references, not identifications from the supplied photos. Southern crabgrass native status is left unassigned here.
