/**
 * ⚠️ VULNERABLE ENDPOINT FOR SECURITY DEMONSTRATION ONLY
 * This endpoint intentionally demonstrates Reflected XSS vulnerability
 * For educational purposes in security audit
 * 
 * Vulnerability: User input is directly rendered in response without sanitization
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const message = searchParams.get('message') || 'Welcome';
  
  // ❌ VULNERABLE: Direct injection of user input into HTML
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Reflected XSS Demo</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
        .vulnerable { background: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; margin: 10px 0; border-radius: 5px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="warning">
          ⚠️ <strong>Security Demo:</strong> This endpoint is intentionally vulnerable for educational purposes
        </div>
        
        <h1>Reflected XSS Vulnerability Demo</h1>
        
        <p>User message received:</p>
        <div class="vulnerable">
          ${message}
        </div>
        
        <h3>Test XSS Attack:</h3>
        <p>Try one of these payloads in the URL:</p>
        <ul>
          <li><code>?message=&lt;img src=x onerror="alert('XSS')"&gt;</code></li>
          <li><code>?message=&lt;script&gt;alert('XSS Attack')&lt;/script&gt;</code></li>
          <li><code>?message=&lt;svg onload="alert('XSS')"&gt;&lt;/svg&gt;</code></li>
        </ul>
        
        <h3>How to fix:</h3>
        <pre>
// Use HTML escaping library like DOMPurify or escape the content
import { escapeHtml } from 'escape-html';
const safeMessage = escapeHtml(message);
        </pre>
      </div>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
