export function embeddingEnvironment(env = process.env) {
  return Object.fromEntries(['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL', 'EMBEDDING_DIMENSION', 'EMBEDDING_BASE_URL', 'EMBEDDING_API_KEY'].filter(key => typeof env[key] === 'string' && env[key].trim()).map(key => [key, env[key]]));
}
