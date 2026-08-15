import { MESSAGE_TYPES } from '../../kernel/shared/constants.js';

const statusEl = document.getElementById('runtime-status');

void chrome.runtime
  .sendMessage({ type: MESSAGE_TYPES.GET_RUNTIME_STATUS })
  .then((response) => {
    statusEl.textContent = JSON.stringify(response, null, 2);
  })
  .catch((error) => {
    statusEl.textContent = JSON.stringify(
      {
        ok: false,
        error: error.message,
      },
      null,
      2,
    );
  });
