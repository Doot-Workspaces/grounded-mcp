const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildAttachments,
  AttachmentError,
  detectMime,
  DEFAULT_MAX_TOTAL_BYTES,
} = require('../email/build-attachments');

const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'grounded-attach-'));

const fixture = (name, contents) => {
  const p = path.join(FIXTURE_DIR, name);
  fs.writeFileSync(p, contents);
  return p;
};

let txtFile;
let pdfFile;
let unknownExtFile;
let bigFile;

beforeAll(() => {
  txtFile = fixture('hello.txt', 'hello world');
  pdfFile = fixture('doc.pdf', 'fake-pdf-bytes');
  unknownExtFile = fixture('mystery.qqq', 'opaque');
  bigFile = path.join(FIXTURE_DIR, 'big.bin');
  fs.writeFileSync(bigFile, Buffer.alloc(4 * 1024 * 1024, 0x41));
});

afterAll(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

const roots = () => [FIXTURE_DIR];

describe('detectMime', () => {
  it('returns text/plain for .txt', () => {
    expect(detectMime('/tmp/foo.txt')).toBe('text/plain');
  });

  it('returns application/pdf for .pdf', () => {
    expect(detectMime('/tmp/foo.pdf')).toBe('application/pdf');
  });

  it('returns image/jpeg for .jpg and .jpeg', () => {
    expect(detectMime('/tmp/a.jpg')).toBe('image/jpeg');
    expect(detectMime('/tmp/a.jpeg')).toBe('image/jpeg');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(detectMime('/tmp/foo.qqq')).toBe('application/octet-stream');
    expect(detectMime('/tmp/noext')).toBe('application/octet-stream');
  });

  it('is case-insensitive on extension', () => {
    expect(detectMime('/tmp/FOO.TXT')).toBe('text/plain');
  });
});

describe('buildAttachments — validation', () => {
  it('rejects empty array', async () => {
    await expect(buildAttachments([], { allowedRoots: roots() }))
      .rejects.toMatchObject({ name: 'AttachmentError', code: 'NO_ATTACHMENTS' });
  });

  it('rejects non-array input', async () => {
    await expect(buildAttachments(null, { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'NO_ATTACHMENTS' });
    await expect(buildAttachments('a-string', { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'NO_ATTACHMENTS' });
  });

  it('rejects non-string path entries', async () => {
    await expect(buildAttachments([123], { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(buildAttachments([''], { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('rejects path containing null byte', async () => {
    await expect(buildAttachments(['C:\\foo\0bar.txt'], { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('rejects relative paths', async () => {
    await expect(buildAttachments(['relative/path.txt'], { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('rejects paths outside allowed roots', async () => {
    const outside = path.join(os.tmpdir(), 'definitely-not-under-fixture-dir.txt');
    fs.writeFileSync(outside, 'x');
    try {
      await expect(buildAttachments([outside], { allowedRoots: roots() }))
        .rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' });
    } finally {
      fs.unlinkSync(outside);
    }
  });

  it('rejects traversal that resolves outside roots', async () => {
    const traversal = path.join(FIXTURE_DIR, '..', 'escape.txt');
    await expect(buildAttachments([traversal], { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' });
  });

  it('rejects missing files', async () => {
    const ghost = path.join(FIXTURE_DIR, 'does-not-exist.txt');
    await expect(buildAttachments([ghost], { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  it('rejects directories', async () => {
    await expect(buildAttachments([FIXTURE_DIR], { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'NOT_A_FILE' });
  });

  it('enforces total size cap (default 3 MB)', async () => {
    expect(DEFAULT_MAX_TOTAL_BYTES).toBe(3 * 1024 * 1024);
    await expect(buildAttachments([bigFile], { allowedRoots: roots() }))
      .rejects.toMatchObject({ code: 'TOTAL_SIZE_EXCEEDED' });
  });

  it('enforces custom maxTotalBytes', async () => {
    await expect(buildAttachments([txtFile], { allowedRoots: roots(), maxTotalBytes: 5 }))
      .rejects.toMatchObject({ code: 'TOTAL_SIZE_EXCEEDED' });
  });
});

describe('buildAttachments — happy path', () => {
  it('builds a Graph fileAttachment for a single text file', async () => {
    const result = await buildAttachments([txtFile], { allowedRoots: roots() });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'hello.txt',
      contentType: 'text/plain',
      contentBytes: Buffer.from('hello world').toString('base64'),
    });
  });

  it('builds attachments for multiple files in order', async () => {
    const result = await buildAttachments([txtFile, pdfFile], { allowedRoots: roots() });

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('hello.txt');
    expect(result[0].contentType).toBe('text/plain');
    expect(result[1].name).toBe('doc.pdf');
    expect(result[1].contentType).toBe('application/pdf');
  });

  it('defaults unknown extensions to application/octet-stream', async () => {
    const result = await buildAttachments([unknownExtFile], { allowedRoots: roots() });
    expect(result[0].contentType).toBe('application/octet-stream');
  });

  it('does not include the size field in the Graph payload', async () => {
    const result = await buildAttachments([txtFile], { allowedRoots: roots() });
    expect(result[0]).not.toHaveProperty('size');
  });

  it('produces base64 that round-trips to original bytes', async () => {
    const result = await buildAttachments([txtFile], { allowedRoots: roots() });
    const decoded = Buffer.from(result[0].contentBytes, 'base64').toString('utf8');
    expect(decoded).toBe('hello world');
  });
});

describe('AttachmentError', () => {
  it('is an Error with a .code property', () => {
    const err = new AttachmentError('SOME_CODE', 'some message');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AttachmentError');
    expect(err.code).toBe('SOME_CODE');
    expect(err.message).toBe('some message');
  });
});
