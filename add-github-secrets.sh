#!/bin/bash
# Script pour ajouter les secrets GitHub nécessaires à Hostinger deployments

set -e

echo "🔐 Ajout des secrets GitHub pour thebestsarl..."

# Installer gh CLI si absent
if ! command -v gh &> /dev/null; then
  echo "📦 Installation de GitHub CLI..."
  # Essayer avec curl si brew échoue
  curl -sS https://webi.sh/gh | sh || echo "Impossible d'installer gh CLI. Installer manuellement via https://cli.github.com/"
  exit 1
fi

# Vérifier l'authentification
echo "🔑 Vérification de l'authentification GitHub..."
gh auth status || {
  echo "❌ Non authentifié. Exécute: gh auth login"
  exit 1
}

# Lire .env.hostinger
ENV_FILE=".env.hostinger"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Fichier $ENV_FILE introuvable"
  exit 1
fi

echo "📝 Lecture de $ENV_FILE..."
ENV_CONTENT=$(cat "$ENV_FILE")

# Ajouter les secrets
echo "⬆️  Ajout de HOSTINGER_ENV..."
gh secret set HOSTINGER_ENV --body "$ENV_CONTENT"

echo "⬆️  Ajout de HOSTINGER_PASSWORD..."
echo "Saisis le mot de passe SSH Hostinger (u697417861 @ 82.29.194.219:65002):"
read -s HOSTINGER_PASSWORD
gh secret set HOSTINGER_PASSWORD --body "$HOSTINGER_PASSWORD"

echo "✅ Secrets ajoutés avec succès!"
echo ""
echo "🚀 Prochaines étapes:"
echo "  1. Va dans https://github.com/romeokany187/thebestsarl/actions"
echo "  2. Clique sur 'Deploy to Hostinger' en haut"
echo "  3. Clique 'Run workflow' ou 'Re-run all jobs'"
echo "  4. Attends ~2 min et vérifie que le déploiement réussit"
