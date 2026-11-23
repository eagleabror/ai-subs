import mongoose from 'mongoose';
import * as models from '../models/index.js';

export async function connectDatabase(uri) {
  mongoose.set('bufferCommands', false);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.info(JSON.stringify({ event: 'database_connected' }));
  // Ensure unique indexes exist before accepting bot updates.
  await Promise.all(Object.values(models).map((model) => model.init()));
  console.info(JSON.stringify({ event: 'database_indexes_ready' }));
}
