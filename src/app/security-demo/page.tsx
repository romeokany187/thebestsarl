import React from 'react';

export default function SecurityDemo() {
  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ background: '#eef8ff', border: '1px solid #9fd0ff', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 10px 0', color: '#0a4a76' }}>Local Security Audit Workspace</h2>
        <p style={{ margin: '0', color: '#0a4a76' }}>
          Environnement de recette local pour reproduire des faiblesses applicatives dans des flux metier proches du systeme reel.
        </p>
      </div>

      <h1>Recette Securite - Parcours Metier</h1>

      <section style={{ marginBottom: '30px' }}>
        <h2>1. Notes ticket - Apercu navigateur</h2>
        <p>
          <strong>Contexte:</strong> Le texte saisi dans une note est renvoye tel quel dans la previsualisation.
        </p>
        <p>
          <strong>Risque observe:</strong> Injection de script cote client si le contenu n'est pas neutralise.
        </p>
        <a href="/api/operations/tickets/note-preview?message=Hello" style={{ display: 'inline-block', padding: '10px 20px', background: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '5px', marginBottom: '10px' }}>
          Ouvrir la previsualisation des notes
        </a>
        <p>
          <strong>Payload de test:</strong>
          <code>&lt;img src=x onerror="alert('XSS Vulnerability')"&gt;</code>
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>2. Fil d'actualites interne - Commentaires</h2>
        <p>
          <strong>Contexte:</strong> Les commentaires sont persistants et affiches dans le flux commun.
        </p>
        <p>
          <strong>Risque observe:</strong> Une charge malveillante en base est executee pour chaque visiteur.
        </p>
        <a href="/api/operations/news/comments" style={{ display: 'inline-block', padding: '10px 20px', background: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '5px', marginBottom: '10px' }}>
          Ouvrir le flux commentaires
        </a>
        <p>
          <strong>Payload de test:</strong>
          <code>&lt;svg onload="alert('Stored XSS')"&gt;&lt;/svg&gt;</code>
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>3. Ordre de transfert - Validation rapide</h2>
        <p>
          <strong>Contexte:</strong> Un formulaire operationnel accepte une soumission sans verification d'intention.
        </p>
        <p>
          <strong>Risque observe:</strong> Un site tiers peut forcer une action si la session est ouverte.
        </p>
        <a href="/api/operations/transfers/quick" style={{ display: 'inline-block', padding: '10px 20px', background: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '5px', marginBottom: '10px' }}>
          Ouvrir le formulaire de transfert
        </a>
        <p>
          <strong>Scenario de test:</strong> Soumission automatique d'un formulaire cache depuis un domaine externe.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>4. Recherche annuaire comptes</h2>
        <p>
          <strong>Contexte:</strong> Le critere de recherche est concatene dans une requete SQL.
        </p>
        <p>
          <strong>Risque observe:</strong> Contournement des filtres et extraction de donnees.
        </p>
        <a href="/api/operations/users/search?username=" style={{ display: 'inline-block', padding: '10px 20px', background: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '5px', marginBottom: '10px' }}>
          Ouvrir la recherche annuaire
        </a>
        <p>
          <strong>Payload de test:</strong>
          <code>' OR '1'='1</code>
        </p>
      </section>

      <section style={{ background: '#e7f3ff', border: '1px solid #b3d9ff', padding: '15px', borderRadius: '5px', marginBottom: '30px' }}>
        <h2>Execution Scan Outils</h2>
        <p>
          <strong>OWASP ZAP:</strong>
        </p>
        <code style={{ display: 'block', background: '#f0f0f0', padding: '10px', overflow: 'auto', borderRadius: '3px', marginBottom: '10px' }}>
          /Applications/ZAP.app/Contents/Java/zap.sh -cmd -config api.disablekey=true -dir /tmp/zap-lab -quickurl http://localhost:3000/operations/controle -quickout /tmp/zap-report-lab.html
        </code>

        <p><strong>Constats attendus:</strong></p>
        <ul>
          <li>✔ Cross Site Scripting (Reflected) - High Risk</li>
          <li>✔ Cross Site Scripting (Stored) - High Risk</li>
          <li>✔ Cross-Site Request Forgery - Medium Risk</li>
          <li>✔ SQL Injection - Critical Risk</li>
        </ul>
      </section>

      <section style={{ background: '#f0f0f0', border: '1px solid #ddd', padding: '15px', borderRadius: '5px' }}>
        <h2>Cadre Academique</h2>
        <p>Cet espace sert a presenter un cycle complet:</p>
        <ul>
          <li>Detection des failles via outils standard du marche</li>
          <li>Analyse technique des causes racines</li>
          <li>Mise en place des contre-mesures</li>
          <li>Verification post-correction</li>
        </ul>
        <p><strong>Note:</strong> execution reservee au clone local de recette.</p>
      </section>
    </div>
  );
}
