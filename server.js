import app from './app.js';
import { env, assertEnv } from './config/env.js';
import { connectDB } from './config/db.js';
import { Role } from './models/index.js';
import { DEFAULT_ROLES } from './config/permissions.js';

assertEnv();
await connectDB();

try {
  const rec = DEFAULT_ROLES.find((r) => r.name === 'Receptionist');
  if (rec) {
    await Role.updateOne({ name: 'Receptionist' }, { $addToSet: { permissions: { $each: rec.permissions } } });
  }
} catch (e) {
  console.warn('Role sync note:', e.message);
}

app.listen(env.port, () => console.log(`HMS API on :${env.port}`));

