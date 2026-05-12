/**
 * Build Microsoft Graph fileAttachment objects from local file paths.
 *
 * Inline-attachment path only: total payload capped at 3 MB (Graph's inline
 * ceiling). Files outside ATTACHMENT_ALLOWED_ROOTS are refused.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MAX_TOTAL_BYTES = 3 * 1024 * 1024;

const MIME_MAP = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.log': 'text/plain',
};

class AttachmentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
  }
}

/**
 * @returns {string[]} absolute, normalized allowed-root paths
 */
function getAllowedRoots() {
  const envVal = process.env.ATTACHMENT_ALLOWED_ROOTS;
  if (envVal && envVal.trim()) {
    return envVal
      .split(';')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => path.resolve(p));
  }
  const home = process.env.USERPROFILE || os.homedir() || '/tmp';
  const projectRoot = path.resolve(__dirname, '..', '..');
  return [
    projectRoot,
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
  ].map(p => path.resolve(p));
}

function isUnderAllowedRoot(absPath, roots) {
  return roots.some(root => {
    const rel = path.relative(root, absPath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/**
 * @param {string} filePath
 * @returns {string} MIME type, defaulting to application/octet-stream
 */
function detectMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * Validate a single path and return { absPath, size }. Throws AttachmentError on failure.
 */
function validatePath(raw, allowedRoots) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AttachmentError('INVALID_PATH', 'attachment path must be a non-empty string');
  }
  if (raw.indexOf('\0') !== -1) {
    throw new AttachmentError('INVALID_PATH', 'attachment path contains null byte');
  }
  if (!path.isAbsolute(raw)) {
    throw new AttachmentError('INVALID_PATH', `attachment path must be absolute: ${raw}`);
  }

  const abs = path.resolve(raw);
  if (!isUnderAllowedRoot(abs, allowedRoots)) {
    throw new AttachmentError(
      'PATH_NOT_ALLOWED',
      `attachment path is outside allowed roots: ${abs}`
    );
  }

  let stat;
  try {
    stat = fs.lstatSync(abs);
  } catch (_err) {
    throw new AttachmentError('FILE_NOT_FOUND', `attachment not found: ${abs}`);
  }

  if (stat.isSymbolicLink()) {
    throw new AttachmentError('SYMLINK_REJECTED', `symlinks not allowed as attachments: ${abs}`);
  }
  if (!stat.isFile()) {
    throw new AttachmentError('NOT_A_FILE', `attachment is not a regular file: ${abs}`);
  }

  return { absPath: abs, size: stat.size };
}

/**
 * Build Graph fileAttachment objects from local file paths.
 *
 * @param {string[]} filePaths
 * @param {object} [opts]
 * @param {number} [opts.maxTotalBytes]
 * @param {string[]} [opts.allowedRoots]
 * @returns {Promise<Array<{'@odata.type': string, name: string, contentType: string, contentBytes: string}>>}
 */
async function buildAttachments(filePaths, opts = {}) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new AttachmentError('NO_ATTACHMENTS', 'attachments must be a non-empty array');
  }

  const maxTotalBytes = opts.maxTotalBytes != null ? opts.maxTotalBytes : DEFAULT_MAX_TOTAL_BYTES;
  const allowedRoots = opts.allowedRoots != null ? opts.allowedRoots : getAllowedRoots();

  const validated = filePaths.map(p => validatePath(p, allowedRoots));

  const totalBytes = validated.reduce((acc, v) => acc + v.size, 0);
  if (totalBytes > maxTotalBytes) {
    const mb = (maxTotalBytes / 1024 / 1024).toFixed(1);
    throw new AttachmentError(
      'TOTAL_SIZE_EXCEEDED',
      `attachments total ${totalBytes} bytes; max allowed ${maxTotalBytes} bytes (${mb} MB)`
    );
  }

  return validated.map(({ absPath }) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: path.basename(absPath),
    contentType: detectMime(absPath),
    contentBytes: fs.readFileSync(absPath).toString('base64'),
  }));
}

module.exports = {
  buildAttachments,
  AttachmentError,
  detectMime,
  getAllowedRoots,
  DEFAULT_MAX_TOTAL_BYTES,
};
