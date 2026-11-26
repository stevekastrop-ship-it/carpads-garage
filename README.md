# CARPADS Client Garage (live copy)

This repository publishes the CARPADS client garage web app at
https://stevekastrop-ship-it.github.io/carpads-garage/ using GitHub Pages.

The source lives in the private `CARPADS-ioS` repository, in its `web/` folder. This repo holds a copy of
that folder so it can be hosted for free. It contains no passwords: the app connects to Supabase with its
public key, and the database's access rules decide who can see what.

## Moving to the website later

Copy these files (everything except `.github/` and this README) into the website at `/garage/`, then:
1. Add the new address to `APP_URLS` in `CARPADS-ioS/.github/workflows/supabase-setup.yml` and run that workflow.
2. Update the canonical link in `index.html`.
3. Optionally redirect this GitHub Pages address to the new one.

Clients keep their logins and data: only the address changes. They should add the new address to their home screen.
