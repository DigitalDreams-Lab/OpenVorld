// The data format of a vorld (vorld.yaml and the files beside it), kept apart from the app version so a user can update OpenVorld
// without their data being touched, and so an old OpenVorld never writes over data from a newer one.
//
//   schema 1  every vorld made before the format was stamped (OpenVorld before 0.3.0)
//   schema 2  stamped: `schema: 2` in vorld.yaml
//
// Rules for changing the format (see docs/UPGRADING.md):
//  - Prefer a new optional field with a default over a migration: old data then needs nothing.
//  - A migration only ever adds or renames fields in vorld.yaml; it never deletes a user's files, and it runs after vorld.yaml was copied
//    to <vorld>/backups/. Add it to MIGRATIONS, raise DATA_SCHEMA, bump the app's minor version and say so in CHANGELOG.md.
//  - A vorld whose schema is NEWER than DATA_SCHEMA is never opened or changed: the user is told to update OpenVorld.
export const DATA_SCHEMA = 2;

/** { to, note, run(doc) }: bring a vorld.yaml document from schema `to - 1` to `to`. */
export const MIGRATIONS = [
  { to: 2, note: 'stamp the data format', run() { /* nothing to change: the format only gets a version number */ } },
];

export const schemaOf = (doc) => (Number.isInteger(doc?.schema) && doc.schema >= 1 ? doc.schema : 1);
export const isNewer = (doc) => schemaOf(doc) > DATA_SCHEMA;

/** Migrate a vorld.yaml document in memory. Returns the steps that ran (empty when it was up to date). */
export function migrateDoc(doc) {
  const from = schemaOf(doc), steps = [];
  if (from > DATA_SCHEMA) return steps;
  for (const m of MIGRATIONS) if (m.to > from) { m.run(doc); steps.push(m); }
  if (steps.length || doc.schema !== DATA_SCHEMA) doc.schema = DATA_SCHEMA;
  return steps;
}

export const newerMessage = (doc) => `This vorld was saved by a newer OpenVorld (data format ${schemaOf(doc)}, this one reads up to ${DATA_SCHEMA}). Update OpenVorld to open it; nothing was changed.`;
