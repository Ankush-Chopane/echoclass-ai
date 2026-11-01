// Generate local self-signed HTTPS certificate for offline classroom LAN access.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CERTS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'certs');
const KEY_PATH = path.join(CERTS_DIR, 'server.key');
const CRT_PATH = path.join(CERTS_DIR, 'server.crt');

function getLocalIps() {
  const ips = ['127.0.0.1', 'localhost'];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

function generateCert() {
  fs.mkdirSync(CERTS_DIR, { recursive: true });

  if (fs.existsSync(KEY_PATH) && fs.existsSync(CRT_PATH)) {
    console.log('[gen-cert] Certificates already exist at:');
    console.log(' - Key:', KEY_PATH);
    console.log(' - Cert:', CRT_PATH);
    return;
  }

  const ips = getLocalIps();
  console.log('[gen-cert] Generating local HTTPS certificate for LAN access...');
  console.log('[gen-cert] Subject Alternative Names (SANs):', ips.join(', '));

  if (process.platform === 'win32') {
    // Generate on Windows using PowerShell PKI cmdlets
    const dnsNames = ips.map(ip => `"${ip}"`).join(',');
    const psScript = `
$cert = New-SelfSignedCertificate -DnsName ${dnsNames} -CertStoreLocation "Cert:\\CurrentUser\\My" -NotAfter (Get-Date).AddYears(2) -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy Exportable
$pwd = ConvertTo-SecureString -String "echoclass" -Force -AsPlainText
$pfxPath = "${path.join(CERTS_DIR, 'temp.pfx').replace(/\\/g, '\\\\')}"
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pwd | Out-Null
`;
    try {
      execSync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, ' ')}"`, { stdio: 'inherit' });
      // Convert PFX to PEM key and cert using Python standard library or certutil/node
      const pyConvert = `
import ssl, os, subprocess
pfx_path = r"${path.join(CERTS_DIR, 'temp.pfx')}"
key_path = r"${KEY_PATH}"
crt_path = r"${CRT_PATH}"
try:
    # Use cryptography or openssl or pyopenssl if available, or write exported cert
    from cryptography.hazmat.primitives.serialization import pkcs12, Encoding, PrivateFormat, NoEncryption
    with open(pfx_path, 'rb') as f:
        pfx_data = f.read()
    key, cert, chain = pkcs12.load_key_and_certificates(pfx_data, b'echoclass')
    with open(key_path, 'wb') as f:
        f.write(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))
    with open(crt_path, 'wb') as f:
        f.write(cert.public_bytes(Encoding.PEM))
    os.remove(pfx_path)
    print("Exported PEM key and certificate successfully.")
except Exception as e:
    print("Cryptography module not available for PFX extraction:", e)
`;
      execSync(`python -c "${pyConvert.replace(/\r?\n/g, ' ')}"`, { stdio: 'pipe' });
    } catch {
      // Fallback: Node self-signed certificate generation using node:crypto
      generateFallbackNodeCert(ips);
    }
  } else {
    // Unix / Linux / macOS: use openssl
    try {
      const sanConfig = ips.map(ip => (/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? `IP:${ip}` : `DNS:${ip}`)).join(',');
      execSync(`openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj "/CN=EchoClass Classroom" -addext "subjectAltName=${sanConfig}" -keyout "${KEY_PATH}" -out "${CRT_PATH}" -days 730`, { stdio: 'inherit' });
    } catch (e) {
      generateFallbackNodeCert(ips);
    }
  }

  if (fs.existsSync(KEY_PATH) && fs.existsSync(CRT_PATH)) {
    console.log('[gen-cert] Success! Key and Certificate created:');
    console.log(' - Key: ', KEY_PATH);
    console.log(' - Cert:', CRT_PATH);
    console.log('\nTo run with HTTPS, set HTTPS_ENABLED=true in .env or run start-classroom.bat');
  } else {
    generateFallbackNodeCert(ips);
  }
}

function generateFallbackNodeCert(ips) {
  const { generateKeyPairSync } = require('crypto');
  // Generate RSA 2048 key pair
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  fs.writeFileSync(KEY_PATH, privateKey);
  // Self-signed X.509 cert PEM wrapper for local dev
  // If openssl/cryptography isn't installed, generate simple self-signed cert
  const pyGen = `
try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.serialization import load_pem_private_key, Encoding
    from cryptography.x509 import IPAddress, DNSName
    import datetime, ipaddress
    with open(r"${KEY_PATH}", "rb") as f:
        key = load_pem_private_key(f.read(), password=None)
    builder = x509.CertificateBuilder()
    builder = builder.subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "EchoClass Local Classroom")]))
    builder = builder.issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "EchoClass Local Classroom")]))
    builder = builder.not_valid_before(datetime.datetime.now(datetime.timezone.utc))
    builder = builder.not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=730))
    builder = builder.serial_number(x509.random_serial_number())
    builder = builder.public_key(key.public_key())
    sans = []
    for ip in ${JSON.stringify(ips)}:
        try:
            sans.append(x509.IPAddress(ipaddress.ip_address(ip)))
        except ValueError:
            sans.append(x509.DNSName(ip))
    builder = builder.add_extension(x509.SubjectAlternativeName(sans), critical=False)
    cert = builder.sign(private_key=key, algorithm=hashes.SHA256())
    with open(r"${CRT_PATH}", "wb") as f:
        f.write(cert.public_bytes(Encoding.PEM))
    print("Generated full X.509 cert via cryptography.")
except Exception as err:
    print("Note on certificate:", err)
`;
  try {
    execSync(`python -c "${pyGen.replace(/\r?\n/g, ' ')}"`, { stdio: 'inherit' });
  } catch (e) {
    // If python cryptography is not present, write notice
    console.log('To generate an HTTPS certificate with custom SANs, run: pip install cryptography, then rerun node scripts/gen-cert.js');
  }
}

if (require.main === module) {
  generateCert();
}

module.exports = { generateCert, KEY_PATH, CRT_PATH, getLocalIps };
