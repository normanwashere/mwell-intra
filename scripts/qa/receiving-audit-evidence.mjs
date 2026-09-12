// Deliberately synthetic 1x1 PNG, also used by the receiving camera QA fixture.
const photo = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const filenamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.png$/;

export function createReceivingAuditEvidence(client, marker) {
  if (typeof marker !== 'string' || !/^QA-[0-9]{8}-[A-F0-9]{8}-(desktop-1440|mobile-390)$/.test(marker)) {
    throw new Error('Invalid receiving evidence marker');
  }
  const folder = `audit/${marker}/receiving`;
  const storage = client.storage.from('evidence');
  const attempted = new Set();
  const seeds = new Map();
  let closing = false;

  async function upload(path) {
    // Keep uncertain writes discoverable even when the upload response is lost.
    attempted.add(path);
    const { data, error } = await storage.upload(path, Buffer.from(photo), {
      contentType: 'image/png', upsert: false,
    });
    if (error || data?.path !== path) {
      throw new Error(`Receiving evidence upload failed for ${path}: ${error?.message ?? 'missing or mismatched path'}`);
    }
    // This verifies seeding, not browser authorization. The UI still signs and
    // loads evidence with its own session under the normal strict audit checks.
    const downloaded = await storage.download(path);
    if (downloaded.error || !downloaded.data || downloaded.data.type !== 'image/png' ||
        typeof downloaded.data.arrayBuffer !== 'function') {
      throw new Error(`Receiving evidence readback failed for ${path}: ${downloaded.error?.message ?? 'missing PNG body'}`);
    }
    if (!Buffer.from(await downloaded.data.arrayBuffer()).equals(photo)) {
      throw new Error(`Receiving evidence readback byte mismatch for ${path}`);
    }
    return path;
  }

  async function listPaths() {
    const paths = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await storage.list(folder, {
        offset, limit: 100, sortBy: { column: 'name', order: 'asc' },
      });
      if (error || !Array.isArray(data)) {
        throw new Error(`Receiving evidence storage discovery failed for ${folder}: ${error?.message ?? 'missing list'}`);
      }
      for (const object of data) {
        if (!object?.id || typeof object.name !== 'string' || !filenamePattern.test(object.name)) {
          throw new Error(`Receiving evidence storage discovery found an unsafe or nested object in ${folder}`);
        }
        paths.push(`${folder}/${object.name}`);
      }
      if (data.length < 100) return paths;
    }
  }

  return {
    async seed(filename) {
      if (closing) throw new Error('Receiving evidence fixture is closing');
      if (typeof filename !== 'string' || !filenamePattern.test(filename)) {
        throw new Error('Unsafe receiving evidence filename');
      }
      const path = `${folder}/${filename}`;
      // Replays and concurrent consumers share one verified upload, including
      // its rejection. A failed seed must never turn into a successful path.
      if (!seeds.has(path)) seeds.set(path, upload(path));
      return seeds.get(path);
    },
    async cleanup() {
      closing = true;
      await Promise.allSettled(seeds.values());
      const paths = [...new Set([...await listPaths(), ...attempted])];
      for (let offset = 0; offset < paths.length; offset += 100) {
        const { error } = await storage.remove(paths.slice(offset, offset + 100));
        if (error) throw new Error(`Receiving evidence storage cleanup failed for ${folder}: ${error.message}`);
      }
      if ((await listPaths()).length) {
        throw new Error(`Receiving evidence storage cleanup left objects in ${folder}`);
      }
      attempted.clear();
      return { entity: 'storage.evidence', marker, storagePaths: paths, removed: paths.length, remaining: 0 };
    },
  };
}
