#!/bin/bash

set -e

# Sourcer le PATH pour avoir gh disponible
source ~/.config/envman/PATH.env 2>/dev/null || true

echo "🔐 Configuration des secrets GitHub pour thebestsarl"
echo ""

# Vérifier gh CLI
if ! command -v gh &> /dev/null; then
  echo "❌ gh CLI non trouvé. Réessaie après avoir sourcé ~/.config/envman/PATH.env"
  exit 1
fi

# Vérifier l'authentification
if ! gh auth status &>/dev/null; then
  echo "🔑 GitHub CLI non authentifié. Lancement de l'authentification..."
  echo ""
  echo "👉 Dans la fenêtre qui va s'ouvrir:"
  echo "   1. Sélectionne 'GitHub.com' (défaut)"
  echo "   2. Sélectionne 'HTTPS' comme protocole"
  echo "   3. Sélectionne 'Y' pour authentification par navigateur"
  echo ""
  gh auth login || {
    echo "❌ Authentification échouée"
    exit 1
  }
fi

echo "✅ Authentification GitHub OK"
echo ""

# Vérifier le repo
REPO_OWNER=$(gh repo view --json owner --jq .owner.login 2>/dev/null)
REPO_NAME=$(gh repo view --json name --jq .name 2>/dev/null)

if [ -z "$REPO_OWNER" ] || [ -z "$REPO_NAME" ]; then
  echo "❌ Impossible de déterminer le propriétaire/repo. Assure-toi d'être dans le repo."
  exit 1
fi

echo "📦 Repo: $REPO_OWNER/$REPO_NAME"
echo ""

# Lire .env.hostinger
ENV_FILE=".env.hostinger"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Fichier $ENV_FILE introuvable"
  exit 1
fi

echo "📝 Lecture de $ENV_FILE..."
ENV_CONTENT=$(cat "$ENV_FILE")

# Ajouter HOSTINGER_ENV (automatique)
echo "⬆️  Ajout du secret HOSTINGER_ENV..."
echo "$ENV_CONTENT" | gh secret set HOSTINGER_ENV --input -

# Ajouter HOSTINGER_PASSWORD (interactif)
echo ""
echo "🔑 HOSTINGER_PASSWORD"
echo "   Saisis le mot de passe SSH Hostinger pour u697417861 @ 82.29.194.219:65002"
echo "   (le texte ne s'affichera pas):"
read -s HOSTINGER_PASSWORD
echo ""

if [ -z "$HOSTINGER_PASSWORD" ]; then
  echo "❌ Mot de passe vide, abandon"
  exit 1
fi

gh secret set HOSTINGER_PASSWORD --body "$HOSTINGER_PASSWORD"

echo ""
echo "✅ Secrets ajoutés avec succès!"
echo ""
echo "🚀 Prochaines étapes:"
echo "   1. Va dans https://github.com/$REPO_OWNER/$REPO_NAME/actions"
echo "   2. Clique sur 'Deploy to Hostinger'"
echo "   3. Clique 'Run workflow' ou Re-run des jobs échoués"
echo "   4. Attends ~2 min et les présences seront créées en production"
echo ""
