import app from './app.js';
import { env, assertEnv } from './config/env.js';
import { connectDB } from './config/db.js';
assertEnv();
await connectDB();
app.listen(env.port, () => console.log(`HMS API on :${env.port}`));
