/**
 * ⚠️ VULNERABLE ENDPOINT FOR SECURITY DEMONSTRATION ONLY
 * This endpoint demonstrates SQL Injection vulnerability
 * User input is directly concatenated into SQL queries
 * 
 * For educational purposes in security audit
 */

import { NextRequest, NextResponse } from 'next/server';

// Mock database for demo
const mockDatabase = [
  { id: 1, username: 'admin', email: 'admin@example.com', password: 'hashed_password_123' },
  { id: 2, username: 'user1', email: 'user1@example.com', password: 'hashed_password_456' },
  { id: 3, username: 'user2', email: 'user2@example.com', password: 'hashed_password_789' },
];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const username = searchParams.get('username') || '';

  // ❌ VULNERABLE: Direct string concatenation in "SQL query"
  // This simulates: SELECT * FROM users WHERE username = '${username}'
  const query = `SELECT * FROM users WHERE username = '${username}'`;

  // Simulate SQL injection exploitation
  let results: any[] = [];

  if (username === '') {
    results = mockDatabase;
  } else if (username === "' OR '1'='1") {
    // SQL Injection: Returns all users
    results = mockDatabase;
  } else if (username === "' OR '1'='1' --") {
    results = mockDatabase;
  } else if (username === "admin' --") {
    // Returns admin user
    results = mockDatabase.filter((u) => u.username === 'admin');
  } else {
    // Normal search
    results = mockDatabase.filter((u) => u.username.includes(username));
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>SQL Injection Demo</title>
      <style>
        body { font-family: Arial; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
        .vulnerable { background: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; margin: 10px 0; border-radius: 5px; }
        input { width: 100%; padding: 8px; margin: 10px 0; box-sizing: border-box; }
        button { padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; border-radius: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
        th { background: #007bff; color: white; }
        .code { background: #e9ecef; padding: 10px; border-radius: 5px; overflow-x: auto; font-family: monospace; white-space: pre-wrap; }
        .danger { color: red; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="warning">
          ⚠️ <strong>Security Demo:</strong> This search is vulnerable to SQL Injection attacks
        </div>

        <h1>SQL Injection Vulnerability Demo</h1>

        <h3>Search Users (Vulnerable)</h3>
        <form action="/api/security-demo/sqli" method="GET">
          <input 
            type="text" 
            name="username" 
            placeholder="Search by username..." 
            value="${username.replace(/"/g, '&quot;')}"
          >
          <button type="submit">Search</button>
        </form>

        <h3>Executed Query (Unsafe):</h3>
        <div class="vulnerable">
          <strong>SQL:</strong> <code>${query}</code><br>
          <span class="danger">⚠️ User input directly concatenated!</span>
        </div>

        <h3>Search Results:</h3>
        ${
          results.length === 0
            ? '<p>No users found</p>'
            : `
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Username</th>
                <th>Email</th>
                <th>Password Hash</th>
              </tr>
            </thead>
            <tbody>
              ${results
                .map(
                  (r) => `
              <tr>
                <td>${r.id}</td>
                <td>${r.username}</td>
                <td>${r.email}</td>
                <td><code>${r.password}</code></td>
              </tr>
            `
                )
                .join('')}
            </tbody>
          </table>
        `
        }

        <h3>SQL Injection Payloads to Try:</h3>
        <ul>
          <li><code>' OR '1'='1</code> - Returns all users (bypasses WHERE clause)</li>
          <li><code>' OR '1'='1' --</code> - Comment out rest of query</li>
          <li><code>admin' --</code> - Get specific user</li>
          <li><code>' UNION SELECT * FROM users --</code> - Extract different data</li>
        </ul>

        <h3>How to Fix:</h3>
        <div class="code">
// ✅ SAFE: Use parameterized queries
const query = 'SELECT * FROM users WHERE username = $1';
const result = await db.query(query, [username]);

// OR use an ORM like Prisma
const user = await prisma.user.findUnique({
  where: { username: username }
});
        </div>
      </div>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
