document.addEventListener('DOMContentLoaded', function() {
  const toggleSwitch = document.getElementById('toggleSwitch');
  const hideHoverLinksSwitch = document.getElementById('hideHoverLinksSwitch');
  const embedInIframeSwitch = document.getElementById('embedInIframeSwitch');
  const wakeLockSwitch = document.getElementById('wakeLockSwitch');
  const modeSelects = document.querySelectorAll('select[data-setting]');
  const publisherNameInput = document.getElementById('publisherName');
  const publisherDomainInput = document.getElementById('publisherDomain');
  const status = document.getElementById('status');

  let isEnabled = false;
  let hideHoverLinks = true;
  let embedInIframe = false;
  let wakeLockEnabled = false;
  let wakeLock = null;

  init();

  toggleSwitch.addEventListener('click', handleToggle);
  hideHoverLinksSwitch.addEventListener('click', handleHideHoverLinksToggle);
  embedInIframeSwitch.addEventListener('click', handleEmbedInIframeToggle);
  wakeLockSwitch.addEventListener('click', handleWakeLockToggle);
  modeSelects.forEach(select => select.addEventListener('change', handleModeChange));
  publisherNameInput.addEventListener('change', handlePublisherChange);
  publisherDomainInput.addEventListener('change', handlePublisherChange);

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLockEnabled && !wakeLock) {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => { wakeLock = null; wakeLockEnabled = false; updateUI(); });
        }
      } catch (e) { /* ignore */ }
    }
  });

  async function init() {
    try {
      const response = await sendMessage({ action: 'getStatus' });
      isEnabled = response.enabled || false;
      hideHoverLinks = response.hideHoverLinks !== false;
      embedInIframe = response.embedInIframe === true;
      wakeLockEnabled = response.wakeLockEnabled || false;
      modeSelects.forEach(select => {
        const value = response[select.dataset.setting];
        if (value) select.value = value;
      });
      publisherNameInput.value = response.publisherName || '';
      publisherDomainInput.value = response.publisherDomain || '';
      updateUI();
    } catch (e) {
      status.textContent = 'Failed to load status';
      status.className = 'status-bar inactive';
    }
  }

  async function handleToggle() {
    const newState = !isEnabled;
    isEnabled = newState;
    updateUI();

    try {
      await sendMessage({ action: 'toggle', enabled: newState });
    } catch (e) {
      isEnabled = !newState;
      updateUI();
    }
  }

  async function handleHideHoverLinksToggle() {
    const newState = !hideHoverLinks;
    hideHoverLinks = newState;
    updateUI();

    try {
      await sendMessage({ action: 'updateHideHoverLinks', enabled: newState });
    } catch (e) {
      hideHoverLinks = !newState;
      updateUI();
    }
  }

  async function handleEmbedInIframeToggle() {
    const newState = !embedInIframe;
    embedInIframe = newState;
    updateUI();

    try {
      await sendMessage({ action: 'updateEmbedInIframe', enabled: newState });
    } catch (e) {
      embedInIframe = !newState;
      updateUI();
    }
  }

  async function handleWakeLockToggle() {
    const newState = !wakeLockEnabled;

    try {
      if (newState) {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => { wakeLock = null; wakeLockEnabled = false; updateUI(); });
          wakeLockEnabled = true;
        }
      } else {
        if (wakeLock) { await wakeLock.release(); wakeLock = null; }
        wakeLockEnabled = false;
      }
      updateUI();
      sendMessage({ action: 'updateWakeLock', enabled: wakeLockEnabled });
    } catch (e) { /* ignore */ }
  }

  async function handleModeChange(event) {
    const setting = event.target.dataset.setting;
    const mode = event.target.value;
    await sendMessage({ action: 'updateMode', setting, mode });

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'updateMode', setting, mode }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  async function handlePublisherChange() {
    const name = publisherNameInput.value.trim();
    const domain = publisherDomainInput.value.trim();
    await sendMessage({ action: 'updatePublisher', name, domain });

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'updatePublisher', name, domain }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  function updateUI() {
    toggleSwitch.classList.toggle('active', isEnabled);
    hideHoverLinksSwitch.classList.toggle('active', hideHoverLinks);
    embedInIframeSwitch.classList.toggle('active', embedInIframe);
    wakeLockSwitch.classList.toggle('active', wakeLockEnabled);
    status.textContent = isEnabled ? 'Active' : 'Inactive';
    status.className = `status-bar ${isEnabled ? 'active' : 'inactive'}`;
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
        resolve(response || {});
      });
    });
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'statusUpdate') {
      isEnabled = request.enabled;
      updateUI();
    }
  });
});
