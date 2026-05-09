const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');
const path = require('path');
const fs = require('fs');

const UPLOADS_BASE = path.resolve(__dirname, '../../uploads/jobs');

const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
];
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:id/photos/file/:filename', requireAuth, (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.resolve(UPLOADS_BASE, req.params.id, safeFilename);
  if (!filePath.startsWith(UPLOADS_BASE) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

router.get('/:id/photos', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const photos = db
      .prepare('SELECT * FROM job_photos WHERE job_id = ? ORDER BY uploaded_at DESC')
      .all(req.params.id);
    res.json({ photos });
  } catch (err) {
    console.error('Get job photos error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/photos', requireAuth, (req, res) => {
  try {
    if (!req.files || !req.files.photo) {
      return res.status(400).json({ error: 'No photo file provided' });
    }

    const db = getDb();
    const jobId = req.params.id;
    const caption = req.body.caption || '';

    const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const jobDir = path.join(UPLOADS_BASE, jobId);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    const file = req.files.photo;
    const ext = path.extname(file.name).toLowerCase() || '.jpg';

    if (!ALLOWED_EXTS.includes(ext)) {
      return res.status(400).json({ error: 'File type not allowed. Please upload an image file.' });
    }

    if (file.mimetype && !ALLOWED_MIMES.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid image type' });
    }

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(jobDir, filename);

    file.mv(filePath, (err) => {
      if (err) {
        console.error('File move error:', err);
        return res.status(500).json({ error: 'Failed to save file' });
      }

      const result = db
        .prepare(
          'INSERT INTO job_photos (job_id, filename, original_name, caption) VALUES (?, ?, ?, ?)',
        )
        .run(jobId, filename, file.name, caption);

      res.json({
        id: result.lastInsertRowid,
        job_id: jobId,
        filename,
        original_name: file.name,
        caption,
        uploaded_at: new Date().toISOString(),
      });
    });
  } catch (err) {
    console.error('Upload job photo error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/photos/:photoId', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const photo = db
      .prepare('SELECT * FROM job_photos WHERE id = ? AND job_id = ?')
      .get(req.params.photoId, req.params.id);

    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    const filePath = path.join(UPLOADS_BASE, req.params.id, photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    db.prepare('DELETE FROM job_photos WHERE id = ?').run(req.params.photoId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete job photo error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/job-files — list all images already on the server for this job ──
router.get('/:id/job-files', requireAuth, (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });
  try {
    const db = getDb();
    const jobId = req.params.id;

    const jobPhotos = db
      .prepare(
        'SELECT id, filename, original_name, caption, uploaded_at FROM job_photos WHERE job_id = ? ORDER BY uploaded_at DESC',
      )
      .all(jobId);

    const fieldPhotos = db
      .prepare(
        'SELECT id, filename, location_label, taken_at as uploaded_at FROM field_photos WHERE job_id = ? ORDER BY taken_at DESC',
      )
      .all(jobId);

    const files = [
      ...jobPhotos.map((p) => ({
        id: `job_${p.id}`,
        type: 'job_photo',
        filename: p.filename,
        label: p.original_name || p.filename,
        caption: p.caption || '',
        uploaded_at: p.uploaded_at,
        url: `/api/jobs/${jobId}/photos/file/${p.filename}`,
      })),
      ...fieldPhotos.map((p) => ({
        id: `field_${p.id}`,
        type: 'field_photo',
        filename: p.filename,
        label: p.location_label || p.filename,
        caption: '',
        uploaded_at: p.uploaded_at,
        url: `/api/field-photos/file/${p.filename}`,
      })),
    ];

    res.json({ files });
  } catch (err) {
    console.error('List job files error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/extract-from-job-files — run AI vision on server-side files ────
router.post('/:id/extract-from-job-files', requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });

  const { selectedFiles } = req.body; // [{ type, filename }]
  if (!Array.isArray(selectedFiles) || !selectedFiles.length) {
    return res.status(400).json({ error: 'No files selected' });
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const FIELD_PHOTOS_DIR = path.resolve(__dirname, '../../uploads/field_photos');
  const SUPPORTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  const extractedParts = [];

  for (const { type, filename } of selectedFiles) {
    try {
      const safeFilename = path.basename(filename);
      let filePath;
      if (type === 'job_photo') {
        filePath = path.resolve(UPLOADS_BASE, req.params.id, safeFilename);
      } else {
        filePath = path.resolve(FIELD_PHOTOS_DIR, safeFilename);
      }

      if (!fs.existsSync(filePath)) {
        extractedParts.push(`[File not found on server: ${safeFilename}]`);
        continue;
      }

      const fileBuffer = fs.readFileSync(filePath);
      const ext = path.extname(safeFilename).toLowerCase();
      const mimeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const mime = mimeMap[ext] || 'image/jpeg';

      if (!SUPPORTED.includes(mime)) {
        extractedParts.push(`[Unsupported format for ${safeFilename} — convert to JPG or PNG]`);
        continue;
      }

      const base64 = fileBuffer.toString('base64');
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4000,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
              {
                type: 'text',
                text: `This is a construction document — blueprint, floor plan, building plan, sketch, or site photo.

Extract ALL technically relevant information:
- Project address or job site address if visible
- Room names and dimensions
- Square footage, linear footage, area measurements
- Materials called out (lumber sizes, concrete, tile, roofing type, etc.)
- Trade work visible (electrical panels, plumbing fixtures, HVAC equipment, etc.)
- Structural elements (beams, walls, footings, etc.)
- Any scope notes or annotations written on the plans
- Quantities and specifications if labeled

Format as a clear, detailed construction scope description. Include the project address at the very top if found, labeled "PROJECT ADDRESS: [address]". Do NOT include owner/client personal information. Focus on the technical scope.`,
              },
            ],
          },
        ],
      });

      const extracted = response.content[0].text.trim();
      if (extracted.length > 10) {
        extractedParts.push(`[From: ${safeFilename}]\n${extracted}`);
      }
    } catch (err) {
      console.error(`[extract-from-job-files] Failed on ${filename}:`, err.message);
      extractedParts.push(`[Could not read: ${filename}]`);
    }
  }

  if (!extractedParts.length) {
    return res.status(400).json({ error: 'No readable content found in the selected files.' });
  }

  res.json({ extractedText: extractedParts.join('\n\n') });
});

module.exports = router;
