type DraftComposer = {
  getState: () => { text?: string };
  setText: (text: string) => void;
  send: () => void;
};

export const sendQueuedDraftWhenReady = async ({
  connectionReady,
  draft,
  getComposer,
  isCancelled = () => false,
  waitForCommit = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
}: {
  connectionReady: Promise<void>;
  draft: string;
  getComposer: () => DraftComposer;
  isCancelled?: () => boolean;
  waitForCommit?: () => Promise<void>;
}) => {
  await connectionReady;
  if (isCancelled()) return false;

  const composer = getComposer();
  if (composer.getState().text !== draft) composer.setText(draft);
  await waitForCommit();
  if (isCancelled()) return false;

  const readyComposer = getComposer();
  if (readyComposer.getState().text !== draft) readyComposer.setText(draft);
  readyComposer.send();
  return true;
};
