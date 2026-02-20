import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_ATLAS_URI as string

if (!uri) {
  throw new Error('Missing MONGODB_ATLAS_URI in environment variables.')
}

// Tight timeouts: M0 Free Tier needs to fail fast if paused,
// rather than hanging the entire Netlify function.
const options = {
  serverSelectionTimeoutMS: 5000, // fail in 5s if no server found
  connectTimeoutMS: 5000,
  socketTimeoutMS: 10000,
  maxPoolSize: 3,
  minPoolSize: 0,
  retryWrites: true,
  retryReads: true,
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined
}

// Lazy connection: returns a connected client.
// In dev, reuses a global instance across HMR reloads.
// In production, creates one client per Lambda cold-start.
export async function getMongoClient(): Promise<MongoClient> {
  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClient) {
      global._mongoClient = new MongoClient(uri, options)
      await global._mongoClient.connect()
    }
    return global._mongoClient
  }
  const client = new MongoClient(uri, options)
  await client.connect()
  return client
}

// Legacy default export for backward compatibility
export default getMongoClient
