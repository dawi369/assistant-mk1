CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_runs_one_running_per_thread
  ON chat_runs (user_id, workspace_id, thread_id)
  WHERE status = 'running';
