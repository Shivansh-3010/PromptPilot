-- Enable the pgvector extension in Supabase
CREATE EXTENSION IF NOT EXISTS vector;

-- Create an HNSW index on the ProjectMemory vector column once table exists
-- (Run this after `prisma db push` or migration execution)
-- CREATE INDEX IF NOT EXISTS project_memory_embedding_idx ON "ProjectMemory" USING hnsw (embedding vector_cosine_ops);

-- Create semantic memory matching SQL function for zero-cost similarity queries directly inside Postgres
CREATE OR REPLACE FUNCTION match_project_memory (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  target_project_id text
)
RETURNS TABLE (
  id text,
  key text,
  value text,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    pm.id,
    pm.key,
    pm.value,
    1 - (pm.embedding <=> query_embedding) AS similarity
  FROM "ProjectMemory" pm
  WHERE pm."projectId" = target_project_id
    AND pm.embedding IS NOT NULL
    AND 1 - (pm.embedding <=> query_embedding) > match_threshold
  ORDER BY pm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
