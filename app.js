document.addEventListener('DOMContentLoaded', () => {
  // ============================================
  // DOM ELEMENTS
  // ============================================
  const credentialsWarning = document.getElementById('credentials-warning');
  const addAccountBtn = document.getElementById('add-account-btn');
  const resetAllBtn = document.getElementById('reset-all-btn');
  const accountsList = document.getElementById('accounts-list');
  const emptyAccountsState = document.getElementById('empty-accounts-state');
  const accountCountBadge = document.getElementById('account-count-badge');
  const accountCountText = document.getElementById('account-count-text');

  // Upload Form
  const uploadForm = document.getElementById('upload-form');
  const uploadCard = document.getElementById('upload-card');
  const uploadStatusBadge = document.getElementById('upload-status-badge');
  const dropzone = document.getElementById('dropzone');
  const dropzoneContent = document.getElementById('dropzone-content');
  const filePreview = document.getElementById('file-preview');
  const filePreviewName = document.getElementById('file-preview-name');
  const filePreviewSize = document.getElementById('file-preview-size');
  const fileInput = document.getElementById('video-file-input');
  const browseBtn = document.getElementById('browse-btn');
  const removeFileBtn = document.getElementById('remove-file-btn');
  const titleInput = document.getElementById('video-title');
  const descInput = document.getElementById('video-description');
  const titleCharCount = document.getElementById('title-char-count');
  const descCharCount = document.getElementById('desc-char-count');
  const channelSelect = document.getElementById('channel-select');
  const submitUploadBtn = document.getElementById('submit-upload-btn');

  // Console
  const consoleCard = document.getElementById('console-card');
  const consoleStatusBadge = document.getElementById('console-status-badge');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel = document.getElementById('progress-label');
  const terminalBody = document.getElementById('terminal-body');
  const terminalGlow = document.getElementById('terminal-glow');
  const uploadResult = document.getElementById('upload-result');
  const resultDetails = document.getElementById('result-details');
  const resultLink = document.getElementById('result-link');
  const consoleActions = document.getElementById('console-actions');
  const uploadAnotherBtn = document.getElementById('upload-another-btn');

  const toastContainer = document.getElementById('toast-container');

  // State
  let selectedFile = null;
  let isUploading = false;
  // channelAccountMap: { channelId: accountEmail }
  let channelAccountMap = {};

  // ============================================
  // INIT
  // ============================================
  checkStatus();
  loadAccounts();

  // ============================================
  // TOAST NOTIFICATIONS
  // ============================================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 4000);
  }

  // ============================================
  // SERVER STATUS CHECK
  // ============================================
  async function checkStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      if (!data.configured) {
        credentialsWarning.classList.remove('hidden');
      }

      // Check URL params
      const params = new URLSearchParams(window.location.search);
      if (params.get('auth') === 'success') {
        showToast('Google account connected successfully!', 'success');
        // Clean URL
        window.history.replaceState({}, document.title, '/');
        loadAccounts();
      }
      if (params.get('error') === 'env_missing') {
        credentialsWarning.classList.remove('hidden');
      }
      if (params.get('error') === 'auth_failed') {
        showToast(`Authentication failed: ${params.get('msg') || 'Unknown error'}`, 'error');
        window.history.replaceState({}, document.title, '/');
      }
    } catch (err) {
      console.error('Status check failed:', err);
    }
  }

  // ============================================
  // ACCOUNT MANAGEMENT
  // ============================================
  async function loadAccounts() {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      renderAccounts(data.accounts);
      populateChannelSelect(data.accounts);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    }
  }

  function renderAccounts(accounts) {
    // Clear previous account cards (keep empty state)
    const existingCards = accountsList.querySelectorAll('.account-card');
    existingCards.forEach(card => card.remove());

    if (!accounts || accounts.length === 0) {
      emptyAccountsState.classList.remove('hidden');
      accountCountText.textContent = '0 accounts';
      accountCountBadge.classList.remove('connected');
      return;
    }

    emptyAccountsState.classList.add('hidden');
    accountCountText.textContent = `${accounts.length} account${accounts.length > 1 ? 's' : ''}`;
    accountCountBadge.classList.add('connected');

    accounts.forEach(account => {
      const card = document.createElement('div');
      card.className = 'account-card';
      card.id = `account-${account.email.replace(/[^a-zA-Z0-9]/g, '-')}`;

      const initial = account.name ? account.name.charAt(0).toUpperCase() : account.email.charAt(0).toUpperCase();
      const avatarContent = account.picture
        ? `<img src="${account.picture}" alt="${account.name}" referrerpolicy="no-referrer">`
        : initial;

      let channelsHTML = '';
      if (account.channels && account.channels.length > 0) {
        channelsHTML = '<div class="account-channels">';
        account.channels.forEach(ch => {
          const chInitial = ch.name.charAt(0).toUpperCase();
          const chAvatar = ch.avatar
            ? `<img src="${ch.avatar}" alt="${ch.name}" referrerpolicy="no-referrer">`
            : chInitial;
          const subs = formatNumber(ch.subscribers);

          channelsHTML += `
            <div class="channel-chip">
              <div class="channel-chip-avatar">${chAvatar}</div>
              <div class="channel-chip-info">
                <span class="channel-chip-name">${escapeHtml(ch.name)}</span>
                <span class="channel-chip-handle">${escapeHtml(ch.handle)}</span>
              </div>
              <span class="channel-chip-subs">${subs} subs</span>
            </div>
          `;
        });
        channelsHTML += '</div>';
      } else {
        channelsHTML = '<div class="channel-chip"><span class="channel-chip-info"><span class="channel-chip-handle" style="color: var(--text-muted);">No channels found</span></span></div>';
      }

      card.innerHTML = `
        <div class="account-card-header">
          <div class="account-avatar">${avatarContent}</div>
          <div class="account-info">
            <span class="account-name">${escapeHtml(account.name)}</span>
            <span class="account-email">${escapeHtml(account.email)}</span>
          </div>
          <button class="btn-disconnect" data-email="${account.email}" title="Disconnect account">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        ${channelsHTML}
      `;

      accountsList.appendChild(card);

      // Disconnect button listener
      card.querySelector('.btn-disconnect').addEventListener('click', () => {
        disconnectAccount(account.email);
      });
    });
  }

  function populateChannelSelect(accounts) {
    // Reset
    channelSelect.innerHTML = '<option value="" disabled selected>Select a channel...</option>';
    channelAccountMap = {};

    if (!accounts || accounts.length === 0) {
      submitUploadBtn.disabled = true;
      return;
    }

    accounts.forEach(account => {
      if (!account.channels || account.channels.length === 0) return;

      const group = document.createElement('optgroup');
      group.label = account.email;

      account.channels.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.textContent = `${ch.name} (${ch.handle})`;
        opt.dataset.email = account.email;
        group.appendChild(opt);

        channelAccountMap[ch.id] = account.email;
      });

      channelSelect.appendChild(group);
    });

    updateSubmitState();
  }

  async function disconnectAccount(email) {
    if (!confirm(`Disconnect ${email}? You'll need to re-authenticate to use its channels.`)) return;

    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (res.ok) {
        showToast(`${email} disconnected`, 'info');
        loadAccounts();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to disconnect', 'error');
      }
    } catch (err) {
      showToast('Failed to disconnect account', 'error');
    }
  }

  // ============================================
  // ADD ACCOUNT
  // ============================================
  addAccountBtn.addEventListener('click', () => {
    window.location.href = '/auth/google';
  });

  // ============================================
  // RESET ALL
  // ============================================
  resetAllBtn.addEventListener('click', async () => {
    if (!confirm('Reset all connected accounts and data?')) return;
    try {
      await fetch('/api/reset', { method: 'POST' });
      showToast('All data reset', 'info');
      window.history.replaceState({}, document.title, '/');
      loadAccounts();
      resetUploadForm();
    } catch (err) {
      showToast('Reset failed', 'error');
    }
  });

  // ============================================
  // FILE DRAG & DROP
  // ============================================
  dropzone.addEventListener('click', (e) => {
    if (e.target === removeFileBtn || removeFileBtn.contains(e.target)) return;
    if (!selectedFile) fileInput.click();
  });

  browseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      setSelectedFile(fileInput.files[0]);
    }
  });

  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearSelectedFile();
  });

  // Drag events
  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('video/')) {
        setSelectedFile(file);
      } else {
        showToast('Please drop a video file', 'error');
      }
    }
  });

  function setSelectedFile(file) {
    selectedFile = file;
    filePreviewName.textContent = file.name;
    filePreviewSize.textContent = formatFileSize(file.size);
    dropzoneContent.classList.add('hidden');
    filePreview.classList.remove('hidden');
    dropzone.classList.add('has-file');
    updateSubmitState();
  }

  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = '';
    dropzoneContent.classList.remove('hidden');
    filePreview.classList.add('hidden');
    dropzone.classList.remove('has-file');
    updateSubmitState();
  }

  // ============================================
  // CHARACTER COUNTERS
  // ============================================
  titleInput.addEventListener('input', () => {
    titleCharCount.textContent = titleInput.value.length;
    updateSubmitState();
  });

  descInput.addEventListener('input', () => {
    descCharCount.textContent = descInput.value.length;
  });

  channelSelect.addEventListener('change', () => {
    updateSubmitState();
  });

  function updateSubmitState() {
    const hasFile = !!selectedFile;
    const hasTitle = titleInput.value.trim().length > 0;
    const hasChannel = channelSelect.value !== '';
    submitUploadBtn.disabled = !(hasFile && hasTitle && hasChannel) || isUploading;
  }

  // ============================================
  // UPLOAD FORM SUBMISSION
  // ============================================
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (isUploading || !selectedFile) return;

    const channelId = channelSelect.value;
    const accountEmail = channelAccountMap[channelId];

    if (!accountEmail) {
      showToast('Could not determine account for selected channel', 'error');
      return;
    }

    isUploading = true;
    submitUploadBtn.disabled = true;
    uploadStatusBadge.textContent = 'Uploading';
    uploadStatusBadge.className = 'card-badge badge-processing';

    // Show console
    consoleCard.classList.remove('hidden');
    consoleStatusBadge.textContent = 'Uploading';
    consoleStatusBadge.className = 'card-badge badge-processing';
    progressFill.style.width = '0%';
    progressLabel.textContent = '0%';
    terminalBody.innerHTML = '';
    terminalGlow.className = 'terminal-glow active';
    uploadResult.classList.add('hidden');
    consoleActions.classList.add('hidden');

    // Scroll to console
    consoleCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Build FormData
    const formData = new FormData();
    formData.append('video', selectedFile);
    formData.append('title', titleInput.value.trim());
    formData.append('description', descInput.value.trim());
    formData.append('tags', document.getElementById('video-tags').value.trim());
    formData.append('privacyStatus', document.getElementById('privacy-select').value);
    formData.append('categoryId', document.getElementById('category-select').value);
    formData.append('channelId', channelId);
    formData.append('accountEmail', accountEmail);

    try {
      addTerminalLog('[INIT] Preparing upload...');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      addTerminalLog(`[INIT] Upload ID: ${data.uploadId}`);

      // Connect to SSE for progress
      listenToProgress(data.uploadId);

    } catch (err) {
      addTerminalLog(`[ERROR] ${err.message}`);
      finishUpload('error', err.message);
    }
  });

  function listenToProgress(uploadId) {
    const eventSource = new EventSource(`/api/upload/progress/${uploadId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.log) {
        addTerminalLog(data.log);
      }

      if (data.progress !== undefined) {
        progressFill.style.width = `${data.progress}%`;
        progressLabel.textContent = `${data.progress}%`;
      }

      if (data.success) {
        eventSource.close();
        finishUpload('success', null, data);
      }

      if (data.error) {
        eventSource.close();
        finishUpload('error', data.error);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      addTerminalLog('[ERROR] Connection to server lost');
      finishUpload('error', 'Connection lost');
    };
  }

  function addTerminalLog(text) {
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = formatLogLine(text);
    terminalBody.appendChild(line);
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  function formatLogLine(text) {
    return text.replace(/^\[([A-Z]+)\]/, (match, tag) => {
      const tagLower = tag.toLowerCase();
      return `<span class="tag-${tagLower}">${match}</span>`;
    });
  }

  function finishUpload(status, errorMsg, successData) {
    isUploading = false;

    if (status === 'success') {
      uploadStatusBadge.textContent = 'Uploaded';
      uploadStatusBadge.className = 'card-badge badge-done';
      consoleStatusBadge.textContent = 'Complete';
      consoleStatusBadge.className = 'card-badge badge-done';
      terminalGlow.className = 'terminal-glow success';
      progressFill.style.width = '100%';
      progressLabel.textContent = '100%';

      // Show result
      resultDetails.textContent = `Video ID: ${successData.videoId}`;
      resultLink.href = successData.link;
      uploadResult.classList.remove('hidden');
      consoleActions.classList.remove('hidden');

      showToast('Video uploaded successfully!', 'success');
    } else {
      uploadStatusBadge.textContent = 'Error';
      uploadStatusBadge.className = 'card-badge badge-error';
      consoleStatusBadge.textContent = 'Failed';
      consoleStatusBadge.className = 'card-badge badge-error';
      terminalGlow.className = 'terminal-glow error';
      consoleActions.classList.remove('hidden');

      showToast(`Upload failed: ${errorMsg}`, 'error');
    }

    updateSubmitState();
  }

  // Upload Another button
  uploadAnotherBtn.addEventListener('click', () => {
    resetUploadForm();
    consoleCard.classList.add('hidden');
    uploadCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function resetUploadForm() {
    clearSelectedFile();
    titleInput.value = '';
    descInput.value = '';
    document.getElementById('video-tags').value = '';
    document.getElementById('privacy-select').value = 'private';
    document.getElementById('category-select').value = '22';
    titleCharCount.textContent = '0';
    descCharCount.textContent = '0';
    uploadStatusBadge.textContent = 'Ready';
    uploadStatusBadge.className = 'card-badge';
    isUploading = false;
    updateSubmitState();
  }

  // ============================================
  // UTILITY
  // ============================================
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatNumber(num) {
    const n = parseInt(num, 10);
    if (isNaN(n)) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
