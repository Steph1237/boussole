# Boussole

Pilotage de patrimoine, sans tableur : patrimoine suivi chaque soir, rang parmi les Français, simulateur acheter ou placer. Chaque personne a un espace privé ; les données ne sortent pas de son compte.

Stack : HTML/CSS/JS vanilla (pas de framework), Supabase (Postgres + RLS, Auth, Edge Functions, pg_cron) pour les données, GitHub Pages pour l'hébergement du front statique.

- `npm test` : tests (`node --test`) des calculs et de la non-régression des moteurs portés.
- `npm run build` : assemble `web/` dans `dist/` (accueil, application, scripts, config).
- Déploiement : `.github/workflows/pages.yml` publie `dist/` sur Pages à chaque push sur `main`.

Spécification : [docs/superpowers/specs/2026-10-05-boussole-design.md](docs/superpowers/specs/2026-10-05-boussole-design.md) · plan : [docs/superpowers/plans/2026-10-05-boussole.md](docs/superpowers/plans/2026-10-05-boussole.md).
