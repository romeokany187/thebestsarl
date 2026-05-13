import React from 'react';

export default function SecurityDemo() {
  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ background: '#fff3cd', border: '1px solid #ffc107', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 10px 0', color: '#856404' }}>⚠️ SECURITY DEMONSTRATION ENDPOINTS</h2>
        <p style={{ margin: '0', color: '#856404' }}>
          These endpoints are intentionally vulnerable for educational purposes. They demonstrate common web vulnerabilities that will be detected by OWASP ZAP and other security scanning tools.
        </p>
      </div>

      <h1>Web Security Vulnerabilities - Live Demonstrations</h1>

      <section style={{ marginBottom: '30px' }}>
        <h2>1. XSS (Cross-Site Scripting) - Reflected</h2>
        <p>
          <strong>What it is:</strong> An attacker injects malicious JavaScript code that gets executed in the victim's browser.
        </p>
        <p>
          <strong>Attack Type:</strong> User input directly rendered in HTML response without sanitization
        </p>
        <a href="/api/security-demo/xss-reflected?message=Hello" style={{ display: 'inline-block', padding: '10px 20px', background: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '5px', marginBottom: '10px' }}>
          🎯 Open XSS Reflected Demo
        </a>
        <p>
          <strong>Try this payload:</strong>
          <code>&lt;img src=x onerror="alert('XSS Vulnerability')"&gt;</code>
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>2. XSS (Cross-Site Scripting) - Stored</h2>
        <p>
          <strong>What it is:</strong> Malicious code is stored in the database and executed for every user who views it.
        </p>
        <p>
          <strong>Attack Type:</strong> Form input stored without sanitization, displayed to all visitors
        </p>
        <a href="/api/security-demo/xss-stored" style={{ display: 'inline-block', padding: '10px 20px', background: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '5px', marginBottom: '10px' }}>
          🎯 Open XSS Stored Demo
        </a>
        <p>
          <strong>Try this payload:</strong>
          <code>&lt;svg onload="alert('Stored XSS')"&gt;&lt;/svg&gt;</code>
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>3. CSRF (Cross-Site Request Forgery)</h2>
        <p>
          <strong>What it is:</strong> An attacker tricks a user into performing unwanted actions on another site where they're logged in.
        </p>
        <p>
          <strong>Attack Type:</strong> Form submission without CSRF token validation or origin checking
        </p>
        <a href="/api/security-demo/csrf" style={{ display: 'inline-block', padding: '10px 20px', background: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '5px', marginBottom: '10px' }}>
          🎯 Open CSRF Demo
        </a>
        <p>
          <strong>Scenario:</strong> While logged in, if you visit an attacker's website, they could submit a hidden form to transfer your funds without your knowledge.
        </p>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2>4. SQL Injection</h2>
        <p>
          <strong>What it is:</strong> An attacker injects SQL code to manipulate database queries and extract/modify data.
        </p>
        <p>
          <strong>Attack Type:</strong> User input directly concatenated into SQL queries
        </p>
        <a href="/api/security-demo/sqli?username=" style={{ display: 'inline-block', padding: '10px 20px', background: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '5px', marginBottom: '10px' }}>
          🎯 Open SQL Injection Demo
        </a>
        <p>
          <strong>Try this payload:</strong>
          <code>' OR '1'='1</code>
        </p>
      </section>

      <section style={{ background: '#e7f3ff', border: '1px solid #b3d9ff', padding: '15px', borderRadius: '5px', marginBottom: '30px' }}>
        <h2>How to Test with Security Scanners</h2>
        <p>
          <strong>OWASP ZAP:</strong>
        </p>
        <code style={{ display: 'block', background: '#f0f0f0', padding: '10px', overflow: 'auto', borderRadius: '3px', marginBottom: '10px' }}>
          /Applications/ZAP.app/Contents/Java/zap.sh -cmd -config api.disablekey=true -dir /tmp/zap-demo -quickurl http://localhost:3000/security-demo -quickout /tmp/zap-report-vulnerabilities.html
        </code>

        <p>
          <strong>Expected Findings:</strong>
        </p>
        <ul>
          <li>✔ Cross Site Scripting (Reflected) - High Risk</li>
          <li>✔ Cross Site Scripting (Stored) - High Risk</li>
          <li>✔ Cross-Site Request Forgery - Medium Risk</li>
          <li>✔ SQL Injection - Critical Risk</li>
        </ul>
      </section>

      <section style={{ background: '#f0f0f0', border: '1px solid #ddd', padding: '15px', borderRadius: '5px' }}>
        <h2>📚 Educational Notes</h2>
        <p>
          These vulnerabilities are intentionally created for:
        </p>
        <ul>
          <li>📋 Demonstrating how security scanners detect vulnerabilities</li>
          <li>📋 Understanding the impact of each vulnerability type</li>
          <li>📋 Learning how to remediate and prevent attacks</li>
          <li>📋 Academic security audit documentation</li>
        </ul>
        <p>
          <strong>⚠️ DO NOT</strong> use these in production or against external systems without explicit permission.
        </p>
      </section>
    </div>
  );
}
