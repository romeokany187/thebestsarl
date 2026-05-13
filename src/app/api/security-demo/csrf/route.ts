/**
 * ⚠️ VULNERABLE ENDPOINT FOR SECURITY DEMONSTRATION ONLY
 * This endpoint demonstrates CSRF vulnerability
 * Form accepts POST without CSRF token validation
 * 
 * For educational purposes in security audit
 */

import { NextRequest, NextResponse } from 'next/server';
import { denyIfLabDisabled } from '@/lib/security-lab-guard';

export async function GET(request: NextRequest) {
  const blocked = denyIfLabDisabled(request);
  if (blocked) return blocked;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Ordre de transfert rapide</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .warning { background: #e8f4ff; border: 1px solid #9fd0ff; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
        .vulnerable { background: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; margin: 10px 0; border-radius: 5px; }
        form { background: #f0f0f0; padding: 15px; border-radius: 5px; }
        input, select { width: 100%; padding: 8px; margin: 10px 0; box-sizing: border-box; }
        button { padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; border-radius: 5px; }
        .code { background: #e9ecef; padding: 10px; border-radius: 5px; overflow-x: auto; font-family: monospace; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="warning">
          <strong>Recette locale:</strong> formulaire de transfert en mode validation rapide.
        </div>

        <h1>Ordre de transfert operationnel</h1>

        <p>Le flux de test reproduit un scenario de traitement simplifie:</p>
        <ul>
          <li>Soumission standard des ordres</li>
          <li>Validation cote serveur minimale</li>
          <li>Execution immediate de la demande</li>
        </ul>

        <h3>Saisie transfert</h3>
        <form action="/api/security-demo/csrf" method="POST">
          <label>From Account:</label>
          <input type="text" name="fromAccount" value="Your-Account-123" readonly>

          <label>To Account:</label>
          <input type="text" name="toAccount" placeholder="Attacker Account Number" required>

          <label>Amount:</label>
          <input type="number" name="amount" placeholder="1000000" required>

          <label>Motif:</label>
          <input type="text" name="reason" placeholder="Motif du transfert" required>

          <button type="submit">Valider le transfert</button>
        </form>

        <h3>Scenario de verification:</h3>
        <p>Soumission forcee depuis une page tierce:</p>
        <div class="code">
&lt;form action="http://localhost:3000/api/security-demo/csrf" method="POST" style="display:none;"&gt;
  &lt;input type="hidden" name="fromAccount" value="Your-Account-123"&gt;
  &lt;input type="hidden" name="toAccount" value="attacker@evil.com"&gt;
  &lt;input type="hidden" name="amount" value="999999"&gt;
  &lt;input type="hidden" name="reason" value="fees"&gt;
  &lt;input type="submit"&gt;
&lt;/form&gt;
&lt;script&gt;document.forms[0].submit();&lt;/script&gt;
        </div>

        <h3>Piste de correction:</h3>
        <div class="code">
// 1. Generate CSRF token on GET
// 2. Store in session/cookie with httpOnly flag
// 3. Validate token on POST
// 4. Check referer/origin headers
        </div>
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
    const fromAccount = formData.get('fromAccount');
    const toAccount = formData.get('toAccount');
    const amount = formData.get('amount');
    const reason = formData.get('reason');

    // ❌ VULNERABLE: No CSRF token validation
    // ❌ VULNERABLE: No origin/referer check
    // ❌ VULNERABLE: No rate limiting

    const response = {
      status: 'success',
      message: `Transfer of ${amount} from ${fromAccount} to ${toAccount} completed.`,
      reason: reason,
      timestamp: new Date().toISOString(),
    };

    // In a real scenario, this would process the transaction
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: 'Transfer failed' }, { status: 500 });
  }
}
