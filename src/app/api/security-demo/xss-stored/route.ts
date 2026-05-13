/**
 * ⚠️ VULNERABLE ENDPOINT FOR SECURITY DEMONSTRATION ONLY
 * This endpoint demonstrates Stored XSS vulnerability
 * Payloads are stored and displayed without sanitization
 * 
 * For educational purposes in security audit
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { denyIfLabDisabled } from '@/lib/security-lab-guard';

const dataFile = path.join(process.cwd(), '.tmp', 'xss-stored-comments.json');

function ensureDataFile() {
  const dir = path.dirname(dataFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify([]));
  }
}

function getComments() {
  ensureDataFile();
  const data = fs.readFileSync(dataFile, 'utf-8');
  return JSON.parse(data);
}

function saveComment(comment: string) {
  ensureDataFile();
  const comments = getComments();
  comments.push({
    id: Date.now(),
    content: comment,
    timestamp: new Date().toISOString(),
  });
  fs.writeFileSync(dataFile, JSON.stringify(comments, null, 2));
}

export async function GET(request: NextRequest) {
  const blocked = denyIfLabDisabled(request);
  if (blocked) return blocked;

  const comments = getComments();

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Flux commentaires interne</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .warning { background: #e8f4ff; border: 1px solid #9fd0ff; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
        .vulnerable { background: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; margin: 10px 0; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 10px 0; }
        button { padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; border-radius: 5px; }
        .comment { background: #e9ecef; border-left: 4px solid #007bff; padding: 10px; margin: 10px 0; border-radius: 3px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="warning">
          <strong>Recette locale:</strong> publication de commentaires sur flux interne
        </div>

        <h1>Journal interne - Commentaires</h1>

        <form action="/api/security-demo/xss-stored" method="POST">
          <textarea name="comment" placeholder="Saisir un commentaire operationnel..." rows="4" required></textarea>
          <button type="submit">Publier</button>
        </form>

        <h3>Commentaires recents:</h3>
        ${
          comments.length === 0
            ? '<p>Aucun commentaire pour le moment.</p>'
            : comments.map((c: any) => `<div class="comment"><strong>#${c.id}</strong><p>${c.content}</p><small>${c.timestamp}</small></div>`).join('')
        }

        <h3>Payloads de verification:</h3>
        <ul>
          <li><code>&lt;img src=x onerror="alert('XSS')"&gt;</code></li>
          <li><code>&lt;svg onload="alert('XSS')"&gt;&lt;/svg&gt;</code></li>
          <li><code>&lt;iframe src="javascript:alert('XSS')"&gt;&lt;/iframe&gt;</code></li>
        </ul>
      </div>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const blocked = denyIfLabDisabled(request);
    if (blocked) return blocked;

    const formData = await request.formData();
    const comment = formData.get('comment') as string;

    if (!comment) {
      return NextResponse.json({ error: 'Comment required' }, { status: 400 });
    }

    // ❌ VULNERABLE: Storing without sanitization
    saveComment(comment);

    // Redirect back to GET
    return NextResponse.redirect(new URL('/api/security-demo/xss-stored', request.url));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save comment' }, { status: 500 });
  }
}
