import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_ATLAS_URI as string // your mongodb connection string

// M0 Free Tier clusters pause after inactivity — these options ensure
// we don't hang indefinitely while the cluster wakes up.
const options = {
  serverSelectionTimeoutMS: 10000, // max 10s to find a server
  connectTimeoutMS: 10000, // max 10s to establish connection
  socketTimeoutMS: 20000, // max 20s per socket operation
  maxPoolSize: 5, // keep pool small for serverless
  minPoolSize: 0, // don't keep idle connections
  retryWrites: true,
  retryReads: true,
}

let client: MongoClient
let mongoClientPromise: Promise<MongoClient>

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined
}

if (!uri) {
  throw new Error('Missing MONGODB_ATLAS_URI in environment variables. Please configure it in .env.local or Netlify environment settings.')
}

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options)
    global._mongoClientPromise = client.connect()
  }
  mongoClientPromise = global._mongoClientPromise
} else {
  // In production mode, it's best to not use a global variable.
  client = new MongoClient(uri, options)
  mongoClientPromise = client.connect()
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export { mongoClientPromise }
export default mongoClientPromise
