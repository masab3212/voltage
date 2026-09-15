# Voltage

Track your electric scooty's charging consumption, split your fair share out of a
shared hostel electricity bill at the marginal rate, and see how much petrol money
you are saving. Static site, no backend, no build step — all data stays in your
browser's localStorage.

## Files

- `index.html`, `style.css`, `app.js` — the whole app
- `sw.js`, `manifest.json`, `icon.svg` — offline support / installable PWA
- `test.js` — unit tests for the calculation module (`node test.js`)

## Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `voltage`).
2. Push these files to the repository root on the `main` branch:
   ```
   git init
   git add .
   git commit -m "Voltage"
   git branch -M main
   git remote add origin https://github.com/<your-username>/voltage.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`. Save.
4. After a minute the app is live at `https://<your-username>.github.io/voltage/`.
5. Open it on your phone and use the browser's **Add to Home Screen** to install it.

## Notes

- Motor wattage is a reference label only; it appears in no formula. Charging
  consumption depends on battery capacity and charger efficiency.
- **Measured mode** (plug-in energy meter reading per charge) is the only mode
  whose numbers are defensible to the hostel owner; the other two modes are
  estimates and are labeled as such everywhere.
- The spec's self-check "20→100% → 1.10 kWh into battery, 1.26 kWh from the meter"
  contradicts its own formulas; the formulas are authoritative here:
  60 V × 20 Ah × 80% = **0.96 kWh into the battery**, ÷ 87% = **1.10 kWh from the meter**.
- "Share summary" encodes one month's numbers into the URL hash; the link opens a
  read-only summary page and never touches the viewer's localStorage.
