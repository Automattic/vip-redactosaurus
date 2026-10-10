// VIP Redactosaurus - Background Service Worker
// Handles extension state management and cross-tab communication

console.log('[VIP Redactosaurus] Background service worker started');

const MODE_DEFAULTS = { headlineMode: 'replace', authorMode: 'replace', thumbnailMode: 'replace' };
const MODE_SETTINGS = Object.keys(MODE_DEFAULTS);

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[VIP Redactosaurus] Extension installed/updated:', details.reason);
  
  if (details.reason === 'install') {
    // Set default enabled state
    chrome.storage.local.set({
      enabled: true,
      hideHoverLinks: true,
      wakeLockEnabled: true,
      ...MODE_DEFAULTS,
      publisherName: '',
      publisherDomain: '',
      installDate: Date.now()
    });
    console.log('[VIP Redactosaurus] Default settings initialized');
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[VIP Redactosaurus] Extension started');
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[VIP Redactosaurus] Message received:', request);

  switch (request.action) {
    case 'toggle':
      handleToggle(request, sendResponse);
      return true; // Keep message channel open

    case 'getStatus':
      handleGetStatus(sendResponse);
      return true; // Keep message channel open

    case 'updateState':
      handleUpdateState(request, sendResponse);
      return true; // Keep message channel open

    case 'updateHideHoverLinks':
      handleUpdateHideHoverLinks(request, sendResponse);
      return true;

    case 'updateEmbedInIframe':
      handleUpdateEmbedInIframe(request, sendResponse);
      return true;

    case 'updateWakeLock':
      handleUpdateWakeLock(request, sendResponse);
      return true; // Keep message channel open

    case 'updateMode':
      handleUpdateMode(request, sendResponse);
      return true;

    case 'updatePublisher':
      handleUpdatePublisher(request, sendResponse);
      return true;

    default:
      console.warn('[VIP Redactosaurus] Unknown action:', request.action);
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

// Handle toggle requests from popup
async function handleToggle(request, sendResponse) {
  try {
    const enabled = request.enabled;
    
    // Store the new state
    await chrome.storage.local.set({ enabled });
    console.log('[VIP Redactosaurus] State toggled to:', enabled);
    
    // Notify all active tabs
    const tabs = await chrome.tabs.query({});
    const notifications = tabs.map(tab => {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        return chrome.tabs.sendMessage(tab.id, {
          action: 'toggle',
          enabled: enabled
        }).catch(err => {
          // Tab might not have content script loaded, that's OK
          console.log(`[VIP Redactosaurus] Could not notify tab ${tab.id}:`, err.message);
        });
      }
      return Promise.resolve();
    });

    await Promise.allSettled(notifications);
    
    sendResponse({ 
      success: true, 
      enabled: enabled,
      tabsNotified: tabs.length 
    });
    
  } catch (error) {
    console.error('[VIP Redactosaurus] Error handling toggle:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

// Handle status requests from popup
async function handleGetStatus(sendResponse) {
  try {
    const result = await chrome.storage.local.get(['enabled', 'hideHoverLinks', 'embedInIframe', 'wakeLockEnabled', ...MODE_SETTINGS, 'publisherName', 'publisherDomain', 'installDate']);

    sendResponse({
      success: true,
      enabled: result.enabled !== false,
      hideHoverLinks: result.hideHoverLinks !== false,
      embedInIframe: result.embedInIframe === true,
      wakeLockEnabled: result.wakeLockEnabled || false,
      headlineMode: result.headlineMode || MODE_DEFAULTS.headlineMode,
      authorMode: result.authorMode || MODE_DEFAULTS.authorMode,
      thumbnailMode: result.thumbnailMode || MODE_DEFAULTS.thumbnailMode,
      publisherName: result.publisherName || '',
      publisherDomain: result.publisherDomain || '',
      installDate: result.installDate,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('[VIP Redactosaurus] Error getting status:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      enabled: true, // Safe default
      wakeLockEnabled: false,
      ...MODE_DEFAULTS
    });
  }
}

// Handle state update requests
async function handleUpdateState(request, sendResponse) {
  try {
    const updates = request.updates || {};
    await chrome.storage.local.set(updates);
    
    console.log('[VIP Redactosaurus] State updated:', updates);
    
    sendResponse({ 
      success: true,
      updated: Object.keys(updates)
    });
    
  } catch (error) {
    console.error('[VIP Redactosaurus] Error updating state:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

async function handleUpdateHideHoverLinks(request, sendResponse) {
  try {
    const hideHoverLinks = request.enabled;
    await chrome.storage.local.set({ hideHoverLinks });

    const tabs = await chrome.tabs.query({});
    const notifications = tabs.map(tab => {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        return chrome.tabs.sendMessage(tab.id, {
          action: 'updateHideHoverLinks',
          enabled: hideHoverLinks
        }).catch(() => {});
      }
      return Promise.resolve();
    });
    await Promise.allSettled(notifications);

    sendResponse({ success: true, hideHoverLinks });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// Handle wake lock update requests
async function handleUpdateEmbedInIframe(request, sendResponse) {
  try {
    const embedInIframe = request.enabled === true;
    await chrome.storage.local.set({ embedInIframe });

    const tabs = await chrome.tabs.query({});
    const notifications = tabs.map(tab => {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        return chrome.tabs.sendMessage(tab.id, {
          action: 'updateEmbedInIframe',
          enabled: embedInIframe
        }).catch(() => {});
      }
      return Promise.resolve();
    });
    await Promise.allSettled(notifications);

    sendResponse({ success: true, embedInIframe });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleUpdateWakeLock(request, sendResponse) {
  try {
    const wakeLockEnabled = request.enabled;
    
    // Store the new wake lock state
    await chrome.storage.local.set({ wakeLockEnabled });
    console.log('[VIP Redactosaurus] Wake lock state updated to:', wakeLockEnabled);
    
    sendResponse({ 
      success: true, 
      wakeLockEnabled: wakeLockEnabled
    });
    
  } catch (error) {
    console.error('[VIP Redactosaurus] Error updating wake lock state:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

// Handle mode update requests (headlineMode, authorMode)
async function handleUpdateMode(request, sendResponse) {
  try {
    const { setting, mode } = request;

    if (!MODE_SETTINGS.includes(setting)) {
      sendResponse({ success: false, error: `Unknown mode setting: ${setting}` });
      return;
    }

    await chrome.storage.local.set({ [setting]: mode });
    console.log(`[VIP Redactosaurus] ${setting} updated to:`, mode);

    sendResponse({ success: true, setting, mode });

  } catch (error) {
    console.error('[VIP Redactosaurus] Error updating mode:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

async function handleUpdatePublisher(request, sendResponse) {
  try {
    await chrome.storage.local.set({
      publisherName: request.name || '',
      publisherDomain: request.domain || ''
    });
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    console.log(`[VIP Redactosaurus] Tab ${tabId} loaded:`, tab.url);
    // Content script will auto-inject via manifest
  }
});

// Keep service worker alive (Manifest V3 requirement)
chrome.action.onClicked.addListener((tab) => {
  // This keeps the service worker active when the extension icon is clicked
  console.log('[VIP Redactosaurus] Extension icon clicked on tab:', tab.id);
});