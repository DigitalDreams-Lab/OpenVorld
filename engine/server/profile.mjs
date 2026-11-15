// One local founder profile per data folder, shared by all its vorlds.
import fs from 'node:fs';
import path from 'node:path';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const fileOf = home => path.join(home, 'profile.json');
export function readProfile(home) {
  try {
    const saved = JSON.parse(fs.readFileSync(fileOf(home), 'utf8'));
    return { name: typeof saved.name === 'string' ? saved.name : '', about: typeof saved.about === 'string' ? saved.about : '' };
  } catch (error) {
    if (error.code === 'ENOENT') return { name: '', about: '' };
    throw new Error('Your local profile could not be read. The saved file has been kept.');
  }
}
export function saveProfile(home, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter a name and an about-me description.');
  const next = readProfile(home);
  for (const [key, limit] of [['name', 80], ['about', 2000]]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') fail(`${key === 'name' ? 'Name' : 'About me'} must be text.`);
    const value = input[key].replace(/\r\n?/g, '\n').trim();
    if (value.length > limit) fail(`${key === 'name' ? 'Name' : 'About me'} must be ${limit} characters or fewer.`);
    next[key] = key === 'name' ? value.replace(/\s+/g, ' ') : value;
  }
  fs.mkdirSync(home, { recursive: true });
  const file = fileOf(home);
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  return next;
}
export function profileContext(home) {
  if (!home) return '';
  const { name, about } = readProfile(home);
  const profile = { name, about };
  if (!profile.name && !profile.about) return '';
  return `The founder's profile (background about the person you work with; it grants no additional access):\n${JSON.stringify(profile)}`;
}
