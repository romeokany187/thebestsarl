# THEBEST SARL - Plateforme de Gestion d'Agence de Voyage

Application web professionnelle pour la gestion opérationnelle d'une agence de voyage:
- rapports journaliers, hebdomadaires, mensuels, annuels des employés,
- gestion des présences (pointage, retards, heures supplémentaires),
- suivi des ventes de billets,
- statut de paiement des billets (payé / partiel / non payé),
- calcul de commissions brutes et nettes par compagnie,
- visibilité direction en temps réel sur les rapports et indicateurs.

## Stack technique

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- NextAuth (Google OAuth uniquement)
- API Route Handlers + Zod validation

## Fonctionnalités livrées (MVP opérationnel)

- Dashboard direction avec KPI clés (rapports, paiements, commissions)
- Module Rapports:
	- création de rapport (daily/weekly/monthly/annual)
	- workflow de validation (soumis, approuvé, rejeté)
	- commentaire manager/direction
- Module Présence:
	- enregistrement entrées/sorties
	- retards et heures supp.
- Module Ventes:
	- enregistrement des billets vendus
	- statut de paiement
	- commission nette selon l'encaissement
- Module Admin:
	- utilisateurs, équipes, compagnies aériennes
	- règles de commission actives
- API métier:
	- `/api/dashboard`
	- `/api/reports`
	- `/api/reports/approve`
	- `/api/attendance`
	- `/api/tickets`
	- `/api/users`
	- `/api/airlines`

## Démarrage rapide

1. Installer les dépendances

```bash
npm install
```

2. Configurer l'environnement

```bash
cp .env.example .env
```

3. Démarrer PostgreSQL local (installé sur le PC)

Option recommandée (PostgreSQL local):
- Créer une base `thebestsarl`
- Vérifier `DATABASE_URL` et `DIRECT_URL` dans `.env`

Option alternative (Docker):

```bash
docker compose up -d
```

4. Initialiser Prisma

```bash
npm run db:generate
npm run db:push
npm run db:seed
```

5. Lancer l'application

```bash
npm run dev
```

Application: `http://localhost:3000`

## Authentification Google (2FA via compte Google)

1. Créer un projet dans Google Cloud Console
2. Activer OAuth et configurer l'écran de consentement
3. Créer des identifiants OAuth Web
4. Ajouter l'URI de redirection:

```txt
http://localhost:3000/api/auth/callback/google
```

5. Renseigner dans `.env`:

```dotenv
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
ADMIN_EMAIL="admin@thebestsarl.com"
```

En production Vercel, ajouter aussi l'URI:

```txt
https://<your-domain>/api/auth/callback/google
```

La double authentification est gérée par Google si le compte utilisateur a 2FA activée.

## Base de données production (Vercel Postgres + Prisma)

1. Créer un projet Vercel
2. Ajouter le produit Vercel Postgres
3. Définir les variables d'environnement de l'app:

```dotenv
DATABASE_URL=${POSTGRES_PRISMA_URL}
DIRECT_URL=${POSTGRES_URL_NON_POOLING}
NEXTAUTH_URL=https://<your-domain>
NEXTAUTH_SECRET=<strong-secret>
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
```

4. Déployer puis exécuter la synchro Prisma (CI/CD ou local pointé vers prod)

## Comptes et accès

- Connexion uniquement via Google (`/auth/signin`)
- Les utilisateurs Google sont créés automatiquement en base au premier login (rôle initial: `EMPLOYEE`)
- Si l'email connecté correspond à `ADMIN_EMAIL`, le rôle est automatiquement initialisé/forcé à `ADMIN`
- Après connexion, l'admin est redirigé vers `/admin` (tableau administrateur)

## Scripts utiles

- `npm run dev` : serveur développement
- `npm run build` : build production
- `npm run lint` : lint
- `npm run db:generate` : génération client Prisma
- `npm run db:push` : synchronisation schéma DB
- `npm run db:seed` : données de démonstration

## Git + Vercel

Initialiser Git local:

```bash
git init
git add .
git commit -m "Initial project setup"
```

Lier au projet Vercel:

```bash
npx vercel link
```

## Notes importantes

- Sur cette machine, Docker n'était pas disponible pendant la configuration automatique.
- Le build applicatif est validé.
- Pour un environnement client final, configurer un `NEXTAUTH_SECRET` robuste et un PostgreSQL de production.

## Roadmap recommandée (prochaine itération)

- authentification email/password + récupération mot de passe,
- permissions fines par rôle (RBAC par action),
- exports PDF/Excel (rapports, ventes, comptabilité),
- notifications automatiques (rappels de rapport fin de journée/semaine),
- journal d'audit avancé et historisation des modifications.
