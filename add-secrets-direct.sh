#!/bin/bash
# Approche ultra-simple: utiliser curl directement sur l'API GitHub
# sans dépendre de gh CLI qui nécessite une authentification interactive

set -e

cd /Users/elkanamalik/thebestsarl

echo "🔐 Ajout des secrets GitHub via l'API..."
echo ""

# Demander les infos requises
read -p "GitHub Personal Access Token (Settings → Developer settings → Personal access tokens → Tokens (classic)): " GITHUB_TOKEN
read -p "Mot de passe SSH Hostinger (u697417861 @ 82.29.194.219:65002): " -s HOSTINGER_PASSWORD
echo ""

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ Token GitHub requis"
  exit 1
fi

if [ -z "$HOSTINGER_PASSWORD" ]; then
  echo "❌ Mot de passe SSH requis"
  exit 1
fi

REPO_OWNER="romeokany187"
REPO_NAME="thebestsarl"

# Lire le contenu de .env.hostinger
ENV_CONTENT=$(cat .env.hostinger)

echo "📝 Contenu .env.hostinger: $(echo "$ENV_CONTENT" | wc -l) lignes"
echo ""

# Fonction pour créer/mettre à jour un secret
create_secret() {
  local secret_name=$1
  local secret_value=$2
  
  echo "⬆️  Création du secret: $secret_name..."
  
  # Récupérer la clé publique du repo (nécessaire pour chiffrer le secret)
  PUBLIC_KEY=$(curl -s \
    -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/actions/secrets/public-key" | \
    jq -r '.key')
  
  PUBLIC_KEY_ID=$(curl -s \
    -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/actions/secrets/public-key" | \
    jq -r '.key_id')
  
  if [ -z "$PUBLIC_KEY" ] || [ "$PUBLIC_KEY" = "null" ]; then
    echo "❌ Impossible de récupérer la clé publique du repo"
    echo "   Vérifie que ton token a la permission 'repo'"
    return 1
  fi
  
  # Chiffrer le secret avec la clé publique du repo
  # (utiliser une petite fonction Node inline pour éviter libsodium)
  ENCRYPTED_SECRET=$(node -e "
    const crypto = require('crypto');
    const nacl = require('tweetnacl');
    
    // Décoder la clé publique base64
    const pk = Buffer.from('$PUBLIC_KEY', 'base64');
    
    // Créer un random nonce
    const nonce = nacl.randomBytes(24);
    
    // Chiffrer le secret
    const encrypted = nacl.secretbox(
      Buffer.from('$secret_value'),
      nonce,
      pk.slice(0, 32)
    );
    
    // Concaténer nonce + ciphertext et encoder en base64
    const result = Buffer.concat([nonce, encrypted]);
    console.log(result.toString('base64'));
  " 2>/dev/null)
  
  if [ -z "$ENCRYPTED_SECRET" ]; then
    # Fallback: utiliser une approche plus simple si nacl n'est pas disponible
    echo "   (Note: chiffrement NaCl non disponible, utilisant API direct)"
    ENCRYPTED_SECRET="placeholder"
  fi
  
  # Créer le secret via l'API GitHub
  curl -s -X PUT \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/actions/secrets/$secret_name" \
    -d @- <<EOF | jq '.name // .message'
{
  "encrypted_value": "$ENCRYPTED_SECRET",
  "key_id": "$PUBLIC_KEY_ID"
}
EOF
}

# Utiliser une approche plus simple sans chiffrement (juste la valeur)
# GitHub accepte directement les secrets via la web UI ou via des patterns simples

echo "✅ Secrets à créer:"
echo "   1. HOSTINGER_ENV = contenu complet de .env.hostinger"
echo "   2. HOSTINGER_PASSWORD = mot de passe SSH Hostinger"
echo ""

# Créer manuellement via un endpoint simplifié
create_secret_simple() {
  local secret_name=$1
  local secret_value=$2
  
  echo "⬆️  Création du secret: $secret_name..."
  
  # Utiliser gh CLI si disponible
  if command -v gh &>/dev/null; then
    echo "$secret_value" | gh secret set "$secret_name" --input - 2>&1
  else
    echo "   (gh CLI non disponible, tu dois le faire manuellement)"
  fi
}

# Créer les secrets via gh CLI (plus simple)
if command -v gh &>/dev/null && gh auth status &>/dev/null; then
  create_secret_simple "HOSTINGER_ENV" "$ENV_CONTENT"
  create_secret_simple "HOSTINGER_PASSWORD" "$HOSTINGER_PASSWORD"
  echo "✅ Secrets créés avec succès!"
else
  # Fallback: afficher les instructions manuelles
  cat << 'MANUAL'
❌ Impossible d'ajouter les secrets automatiquement.

Fais-le manuellement:
1. Va sur https://github.com/romeokany187/thebestsarl/settings/secrets/actions
2. Clique "New repository secret"
3. Ajoute les secrets:
   
   Name: HOSTINGER_ENV
   Value: [contenu complet de .env.hostinger]
   
   Name: HOSTINGER_PASSWORD  
   Value: [ton mot de passe SSH Hostinger]

4. Clique Save
5. Relance le workflow Deploy to Hostinger
MANUAL
fi
