import { searchLyrics } from '../core/lrclib';

/** Wires up the lyrics search dialog; returns a function that opens it with a starting query. */
export function setupSearchDialog(
  dialog: HTMLDialogElement,
  onPick: (lyrics: string) => void,
): (query: string) => void {
  const input = dialog.querySelector<HTMLInputElement>('#search-query')!;
  const status = dialog.querySelector<HTMLElement>('#search-status')!;
  const results = dialog.querySelector<HTMLElement>('#search-results')!;
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  let abort: AbortController | undefined;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) {
      return;
    }
    abort?.abort();
    abort = new AbortController();
    const { signal } = abort;
    status.textContent = 'Searching...';
    results.replaceChildren();

    try {
      const found = await searchLyrics(query, undefined, signal);
      status.textContent = found.length === 0 ? 'No lyrics found.' : '';
      for (const result of found) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        const album = result.albumName ? ` (${result.albumName})` : '';
        button.textContent = `${result.trackName} - ${result.artistName}${album}`;
        button.addEventListener('click', () => {
          dialog.close();
          onPick(result.lyrics);
        });
        item.append(button);
        results.append(item);
      }
    } catch (error) {
      if (!signal.aborted) {
        status.textContent = error instanceof Error ? error.message : 'Search failed.';
      }
    }
  });

  dialog.querySelector('#search-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => abort?.abort());

  return (query: string) => {
    input.value = query;
    status.textContent = '';
    results.replaceChildren();
    dialog.showModal();
    input.focus();
  };
}
