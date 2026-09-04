# Guide développeur — THEBEST SARL

Ce document est destiné aux nouveaux développeurs qui rejoignent le projet et doivent pouvoir démarrer rapidement, comprendre l’architecture et exécuter les tâches courantes sans dépendre de la mémoire de l’équipe.

## 1. Objectif du projet

THEBEST SARL est une plateforme web de gestion opérationnelle d’une agence de voyage.

Le système couvre principalement :
- la gestion des présences et des rapports d’employés ;
- la gestion des ventes de billets ;
- le suivi des paiements et des commissions ;
- les tableaux de bord direction ;
- la gestion admin des utilisateurs, équipes, compagnies aériennes et règles de commission ;
- les imports de données depuis Excel.

## 2. Stack technique

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL (base principale)
- MySQL/MariaDB compatible pour l’hébergement Hostinger
- NextAuth v4
- Google OAuth
- Zod pour validation

## 3. Organisation du dépôt

- `src/app` : routes de l’application Next.js (App Router)
- `src/components` : composants UI réutilisables
- `src/lib` : utilitaires, logique métier, helpers
- `src/auth.ts` : configuration NextAuth
- `prisma/` : schéma Prisma et scripts de seed
- `scripts/` : scripts de maintenance, migrations, imports, nettoyage
- `docs/` : documentation projet
- `imports/` : fichiers d’import de données
- `public/` : assets statiques

## 4. Prérequis

Avant de démarrer, il faut avoir installé :
- Node.js 20.x
- npm
- PostgreSQL local ou Docker
- Git
- un compte Google Cloud pour OAuth

Vérifier la version Node :

```bash
node -v
npm -v
```

## 5. Installation locale

### 5.1 Cloner le projet

```bash
git clone <url-du-repo>
cd thebestsarl
```

### 5.2 Installer les dépendances

```bash
npm install
```

### 5.3 Configurer les variables d’environnement

Copier le template :

```bash
cp .env.example .env
```

Le fichier `.env` doit contenir au minimum :

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/thebestsarl?schema=public"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/thebestsarl?schema=public"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="change-me-in-production"
GOOGLE_CLIENT_ID="<your-google-client-id>"
GOOGLE_CLIENT_SECRET="<your-google-client-secret>"
ADMIN_EMAIL="admin@thebestsarl.com"
```

Pour les cibles MySQL, utiliser le fichier `.env.mysql.example` comme référence.

## 6. Base de données

### 6.1 PostgreSQL local

Créer une base locale nommée `thebestsarl`.

Ensuite générer le client Prisma et synchroniser le schéma :

```bash
npm run db:generate
npm run db:push
npm run db:seed
```

### 6.2 Docker

Le dépôt supporte aussi un environnement Docker :

```bash
docker compose up -d
```

### 6.3 Vérification

Pour tester l’état de Prisma :

```bash
npx prisma validate
```

## 7. Démarrage de l’application

```bash
npm run dev
```

Puis ouvrir :

```txt
http://localhost:3000
```

## 8. Authentification Google

Le projet utilise Google OAuth via NextAuth.

### Étapes

1. Créer un projet Google Cloud.
2. Activer l’API OAuth.
3. Configurer l’écran de consentement.
4. Créer des identifiants OAuth Web.
5. Ajouter l’URI de redirection locale :

```txt
http://localhost:3000/api/auth/callback/google
```

6. Remplir les variables `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `.env`.
7. Définir `ADMIN_EMAIL` pour que le compte principal reçoive automatiquement le rôle Admin.

## 9. Architecture métier importante

### 9.1 Authentification

La logique est centralisée dans :
- `src/auth.ts`
- les routes NextAuth de `src/app/api/auth/...`

Le comportement clé :
- les utilisateurs Google sont créés automatiquement lors du premier login ;
- le rôle initial est `EMPLOYEE` ;
- si l’email correspond à `ADMIN_EMAIL`, le rôle est forcé en `ADMIN`.

### 9.2 Modules fonctionnels

Le projet est organisé par grands modules métier dans l’App Router, notamment :
- `attendance` : présence / pointage / retards
- `reports` : rapports journaliers / hebdo / mensuels / annuels
- `tickets` : ventes et suivi de billets
- `payments` : paiements, opérations cash, alertes
- `admin` : gestion d’administration
- `comptabilite` : comptabilité / journaux / comptes
- `sales` : ventes administratives
- `teams` : gestion d’équipes

## 10. Scripts utiles

Voici les commandes courantes :

```bash
npm run dev
npm run build
npm run lint
npm run db:generate
npm run db:push
npm run db:seed
npm run db:migrate:jobtitles
npm run db:import:tickets:excel -- ./imports/<fichier>.xlsx
```

Pour la version MySQL :

```bash
npm run dev:mysql
npm run build:mysql
npm run db:generate:mysql
npm run db:push:mysql
```

## 11. Import de billets depuis Excel

Le projet dispose d’un script d’import de masse pour les billets :

```bash
npm run db:import:tickets:excel -- ./imports/billets.xlsx --dry-run
npm run db:import:tickets:excel -- ./imports/billets.xlsx
```

Le script attend au minimum des colonnes de base comme :
- `ticketNumber` ou `PNR`
- `amount` ou `montant`
- `sellerEmail` ou `sellerName`
- `airlineCode` ou `airlineName`
- `soldAt` / `date vente`
- `travelDate` / `date voyage`

## 12. Bonnes pratiques de développement

- Toujours travailler avec une branche dédiée.
- Vérifier les variables d’environnement avant un lancement local.
- Ne pas faire de `prisma db push --accept-data-loss` en production sans validation.
- Préférer les migrations ou scripts contrôlés pour les changements sensibles de données.
- Avant de déployer, exécuter un build local :

```bash
npm run build
```

- Avant de modifier le schéma Prisma, vérifier l’impact côté application et données.

## 13. Déploiement

Le projet est prévu pour être déployé notamment sur :
- Vercel + PostgreSQL
- Hostinger Node.js + MySQL/MariaDB

Les variables de production doivent inclure :
- `DATABASE_URL`
- `DIRECT_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ADMIN_EMAIL`

## 14. Points de vigilance

- La résolution GPS peut dépendre de services tiers gratuits (OpenStreetMap / BigDataCloud) et peut parfois ne pas retourner de résultat.
- Les identifiants OAuth doivent rester secrets et ne jamais être commités dans le dépôt.
- Les données de production doivent être traitées avec précaution ; les scripts de reset / nettoyage doivent être utilisés uniquement quand cela est explicitement justifié.

## 15. Contact / sources de vérité

Les références de projet les plus utiles sont :
- `README.md`
- `docs/hostinger-phpmyadmin-instructions.md`
- `prisma/schema.prisma`
- `src/auth.ts`
- `package.json`

## 16. Checklist de démarrage rapide

```bash
npm install
cp .env.example .env
# compléter les variables
createdb thebestsarl
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Si tout est bien configuré, l’application doit être accessible sur localhost:3000.
