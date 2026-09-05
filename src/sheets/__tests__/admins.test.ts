import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.SPREADSHEET_ID = 'test-spreadsheet-id';

const getRowObjects = vi.fn();
vi.mock('../client', () => ({ SPREADSHEET_ID: 'test-spreadsheet-id', getRowObjects }));

const { listAdminEmails, isAdminEmail, clearAdminCache } = await import('../admins');

function rows(...emails: string[]) {
  return emails.map((email, i) => ({ rowNumber: i + 2, data: { email } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAdminCache();
});

describe('isAdminEmail', () => {
  it('matches regardless of casing or surrounding whitespace on either side', async () => {
    getRowObjects.mockResolvedValue(rows('  Admin@Example.COM '));

    await expect(isAdminEmail('admin@example.com')).resolves.toBe(true);
    clearAdminCache();
    await expect(isAdminEmail('  ADMIN@example.com  ')).resolves.toBe(true);
  });

  it('rejects an email that is not on the list', async () => {
    getRowObjects.mockResolvedValue(rows('admin@example.com'));
    await expect(isAdminEmail('someone@example.com')).resolves.toBe(false);
  });

  it('rejects everyone when the tab is empty (fails closed)', async () => {
    getRowObjects.mockResolvedValue([]);
    await expect(isAdminEmail('admin@example.com')).resolves.toBe(false);
  });

  it('ignores blank rows rather than treating "" as an admin', async () => {
    getRowObjects.mockResolvedValue(rows('', '   '));
    await expect(listAdminEmails()).resolves.toEqual([]);
    clearAdminCache();
    await expect(isAdminEmail('')).resolves.toBe(false);
  });
});

describe('allowlist caching', () => {
  it('reads the sheet once across repeated checks', async () => {
    getRowObjects.mockResolvedValue(rows('admin@example.com'));

    await isAdminEmail('admin@example.com');
    await isAdminEmail('other@example.com');
    await listAdminEmails();

    expect(getRowObjects).toHaveBeenCalledTimes(1);
  });

  it('re-reads after the cache is cleared', async () => {
    getRowObjects.mockResolvedValue(rows('admin@example.com'));
    await listAdminEmails();

    clearAdminCache();
    getRowObjects.mockResolvedValue(rows('admin@example.com', 'new@example.com'));

    await expect(isAdminEmail('new@example.com')).resolves.toBe(true);
    expect(getRowObjects).toHaveBeenCalledTimes(2);
  });
});
