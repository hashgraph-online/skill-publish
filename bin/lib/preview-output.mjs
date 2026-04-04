import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function sanitizeSegment(value) {
  const sanitized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+/u, '')
    .replace(/-+$/u, '');
  return sanitized || 'unknown';
}

export async function writeSkillPreviewReport(params) {
  const previewsDir = path.join(params.workspaceDir, '.hol', 'previews');
  await mkdir(previewsDir, { recursive: true });
  const previewFileName = `${sanitizeSegment(params.report.name)}-${sanitizeSegment(
    params.report.version,
  )}.skill-preview.v1.json`;
  const previewFilePath = path.join(previewsDir, previewFileName);
  await writeFile(previewFilePath, `${JSON.stringify(params.report, null, 2)}\n`, 'utf8');
  return previewFilePath;
}
