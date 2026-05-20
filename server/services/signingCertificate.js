'use strict';
const crypto = require('crypto');
const fs = require('fs');

function formatDT(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  });
}

function hashFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function buildSignatureBlockHTML(session) {
  const sigImg = session.signature_data
    ? `<img src="${session.signature_data}" style="max-width:300px;max-height:80px;display:block;margin-bottom:4px" alt="Electronic Signature">`
    : '<div style="color:#888;font-style:italic;font-size:10px">Signature image on file</div>';

  const docLabel = session.doc_type === 'proposal' ? 'Proposal' : 'Contract';

  return `
<div style="margin-top:48px;padding-top:20px;border-top:2px solid #1B3A6B;font-family:Arial,Helvetica,sans-serif">
  <div style="font-size:10pt;font-weight:700;color:#1B3A6B;margin-bottom:14px;letter-spacing:.3px;text-transform:uppercase">
    Electronic Signature — ${docLabel}
  </div>
  <table style="width:100%;border-collapse:collapse">
    <tr>
      <td style="width:55%;vertical-align:top;padding-right:24px">
        <div style="font-size:7.5pt;font-weight:700;color:#888;margin-bottom:5px;text-transform:uppercase;letter-spacing:.3px">Customer Signature</div>
        <div style="border:1px solid #C8D4E4;border-radius:4px;background:#fafafa;padding:10px;min-height:80px;box-sizing:border-box">
          ${sigImg}
        </div>
        <div style="font-size:8pt;color:#444;margin-top:7px;line-height:1.5">
          <strong>${session.signer_name || '—'}</strong><br>
          Signed electronically: ${formatDT(session.signed_at)}<br>
          IP Address: ${session.signed_ip || '—'}
        </div>
      </td>
      <td style="width:45%;vertical-align:top">
        <div style="font-size:7.5pt;font-weight:700;color:#888;margin-bottom:5px;text-transform:uppercase;letter-spacing:.3px">Contractor</div>
        <div style="border-bottom:1.5px solid #333;width:220px;height:44px;margin-bottom:8px"></div>
        <div style="font-size:8pt;color:#444;line-height:1.5">
          <strong>Jackson Deaquino</strong><br>
          Preferred Builders General Services Inc.<br>
          HIC-197400 &nbsp;·&nbsp; CSL CS-121662
        </div>
      </td>
    </tr>
  </table>
  <div style="margin-top:10px;font-size:7.5pt;color:#888;font-style:italic;line-height:1.5">
    This electronic signature is legally binding under the Electronic Signatures in Global and
    National Commerce Act (E-SIGN), 15 U.S.C. §7001, and the Massachusetts Uniform Electronic
    Transactions Act, M.G.L. c. 110G.
  </div>
</div>`;
}

function buildCertificatePageHTML(session, job) {
  const docLabel =
    session.doc_type === 'proposal'
      ? 'Scope of Work Proposal'
      : 'Home Improvement Construction Contract';

  const rawUA = session.signer_user_agent || '';
  const shortUA = rawUA
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  const auditRows = [
    { event: 'Document sent to customer', dt: session.email_sent_at, ip: '—' },
    {
      event: 'Document link opened by customer',
      dt: session.opened_at,
      ip: session.opened_ip || '—',
    },
    {
      event: 'E-SIGN consent checkbox accepted',
      dt: session.signed_at,
      ip: session.signed_ip || '—',
    },
    {
      event: 'Electronic signature submitted',
      dt: session.signed_at,
      ip: session.signed_ip || '—',
    },
  ]
    .map(
      (r) => `
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;font-size:7.5pt">${r.event}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;font-size:7.5pt;white-space:nowrap">${formatDT(r.dt)}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;font-size:7.5pt;font-family:monospace">${r.ip}</td>
    </tr>`,
    )
    .join('');

  const hashBlock = session.document_hash
    ? `<div style="font-family:monospace;font-size:7pt;word-break:break-all;color:#555;background:#f5f5f5;padding:6px 8px;border-radius:4px;margin-top:4px;line-height:1.4">${session.document_hash}</div>`
    : '<div style="font-size:7.5pt;color:#aaa;font-style:italic">Not available</div>';

  const deliveredTo = session.signer_email || job.customer_email || '—';
  const projectLine = [job.project_address, job.project_city].filter(Boolean).join(', ') || '—';

  return `
<div style="page-break-before:always;font-family:Arial,Helvetica,sans-serif;padding:32px 40px;max-width:680px;margin:0 auto">

  <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #1B3A6B">
    <div style="font-size:13pt;font-weight:700;color:#1B3A6B;letter-spacing:.5px;text-transform:uppercase">
      Certificate of Electronic Signature
    </div>
    <div style="font-size:8pt;color:#666;margin-top:5px">
      E-SIGN Act &nbsp;15 U.S.C. §7001 &nbsp;·&nbsp; Massachusetts UETA &nbsp;M.G.L. c. 110G
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <tr>
      <td style="width:50%;vertical-align:top;padding-right:20px">
        <div style="font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:3px">Document Type</div>
        <div style="font-size:9pt;color:#222;margin-bottom:12px">${docLabel}</div>
        <div style="font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:3px">Signer Name</div>
        <div style="font-size:9pt;color:#222;margin-bottom:12px">${session.signer_name || '—'}</div>
        <div style="font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:3px">Delivered To</div>
        <div style="font-size:9pt;color:#222;margin-bottom:12px">${deliveredTo}</div>
      </td>
      <td style="width:50%;vertical-align:top">
        <div style="font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:3px">Property Address</div>
        <div style="font-size:9pt;color:#222;margin-bottom:12px">${projectLine}</div>
        <div style="font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:3px">Issued By</div>
        <div style="font-size:9pt;color:#222;margin-bottom:12px;line-height:1.5">
          Preferred Builders General Services Inc.<br>
          HIC-197400 &nbsp;·&nbsp; CSL CS-121662<br>
          37 Duck Mill Rd, Fitchburg MA 01420
        </div>
      </td>
    </tr>
  </table>

  <div style="font-size:8pt;font-weight:700;color:#1B3A6B;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">
    Audit Trail
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <thead>
      <tr style="background:#1B3A6B;color:white">
        <th style="padding:6px 8px;border:1px solid #1B3A6B;font-size:7.5pt;text-align:left;font-weight:600">Event</th>
        <th style="padding:6px 8px;border:1px solid #1B3A6B;font-size:7.5pt;text-align:left;font-weight:600">Date / Time (ET)</th>
        <th style="padding:6px 8px;border:1px solid #1B3A6B;font-size:7.5pt;text-align:left;font-weight:600">IP Address</th>
      </tr>
    </thead>
    <tbody>${auditRows}</tbody>
  </table>

  <div style="background:#f8f9ff;border-left:3px solid #1B3A6B;padding:10px 14px;margin-bottom:20px;border-radius:0 6px 6px 0">
    <div style="font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:4px">Consent Statement Accepted</div>
    <div style="font-size:8pt;color:#444;font-style:italic;line-height:1.6">
      "I confirm that I have read and reviewed this ${session.doc_type === 'proposal' ? 'proposal' : 'contract'} and my
      electronic signature constitutes a legally binding agreement under the Electronic Signatures
      in Global and National Commerce Act (E-SIGN)."
    </div>
  </div>

  ${
    shortUA
      ? `
  <div style="margin-bottom:16px">
    <div style="font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:3px">Signing Device</div>
    <div style="font-size:8pt;color:#555">${shortUA}</div>
  </div>`
      : ''
  }

  <div style="margin-bottom:8px">
    <div style="font-size:7pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:3px">
      Document Fingerprint (SHA-256)
    </div>
    <div style="font-size:7.5pt;color:#777;margin-bottom:4px;line-height:1.4">
      Hash of the signed document computed at time of execution.
      Any alteration to the document after signing will produce a different hash value.
    </div>
    ${hashBlock}
  </div>

  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #ddd;font-size:7pt;color:#bbb;text-align:center;line-height:1.5">
    This certificate was generated automatically by the Preferred Builders AI Contract System.<br>
    Records are maintained in accordance with M.G.L. c. 110G and the federal E-SIGN Act (15 U.S.C. §7001).
  </div>

</div>`;
}

module.exports = { buildSignatureBlockHTML, buildCertificatePageHTML, hashFile };
