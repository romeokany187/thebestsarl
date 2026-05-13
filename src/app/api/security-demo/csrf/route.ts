/**
 * ⚠️ VULNERABLE ENDPOINT FOR SECURITY DEMONSTRATION ONLY
 * This endpoint demonstrates CSRF vulnerability
 * Form accepts POST without CSRF token validation
 * 
 * For educational purposes in security audit
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>CSRF Vulnerability Demo</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
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
          ⚠️ <strong>Security Demo:</strong> This form has NO CSRF protection. No token validation on POST.
        </div>

        <h1>CSRF (Cross-Site Request Forgery) Vulnerability Demo</h1>

        <p>This form demonstrates a vulnerable endpoint that:</p>
        <ul>
          <li>Accepts POST requests without CSRF tokens</li>
          <li>Doesn't validate request origin</li>
          <li>Can be exploited from external websites</li>
        </ul>

        <h3>Transfer Funds Form (Vulnerable)</h3>
        <form action="/api/security-demo/csrf" method="POST">
          <label>From Account:</label>
          <input type="text" name="fromAccount" value="Your-Account-123" readonly>

          <label>To Account:</label>
          <input type="text" name="toAccount" placeholder="Attacker Account Number" required>

          <label>Amount:</label>
          <input type="number" name="amount" placeholder="1000000" required>

          <label>Reason:</label>
          <input type="text" name="reason" placeholder="Transfer reason" required>

          <button type="submit">Transfer Money</button>
        </form>

        <h3>⚠️ How an attacker would exploit this:</h3>
        <p>Create a hidden form on an external website:</p>
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

        <h3>How to fix:</h3>
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
