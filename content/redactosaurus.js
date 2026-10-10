// VIP Redactosaurus - Chrome Extension for Safe Content Anonymization
// Built for Manifest V3 with zero FOUC (Flash of Unstyled Content)

(function() {
  'use strict';

  // === GLOBAL STATE ===
  let config = null;
  let isEnabled = true;
  let hideHoverLinks = true;
  let embedInIframe = false;
  let embedInstalled = false;
  let isInitialized = false;
  let processedElementsMap = new Map();
  let elementContentHashes = new Map();
  let mutationObserver = null;
  let processTimer = null;
  let detectedCustomer = null;
  let lastDetectedUrl = null;
  let previousFakeDomain = null;
  let previousFakeName = null;
  const reportedSweepIssues = new Set();
  let processingCounter = 0;
  let articles = null;
  let articleIndex = 0;
  let elementArticleMap = new Map();
  let thumbnailPool = null;
  let thumbnailPoolFailed = false;
  const originalHref = new Map();
  let hrefListenersBound = false;

  // Hide customer thumbnails at document_start, before config fetch. Real
  // images stay invisible; local chrome-extension srcs (the stock pool) show.
  setThumbnailHideEnabled(true);

  chrome.storage.local.get(['enabled', 'embedInIframe'], (result) => {
    if (embedInstalled) return;
    isEnabled = result.enabled !== false;
    embedInIframe = result.embedInIframe === true;
    tryEmbedDashboard();
  });

  // === UTILITY FUNCTIONS ===
  
  function log(message, ...args) {
    if (config?.settings?.debug) {
      console.log(`[VIP Redactosaurus] ${message}`, ...args);
    }
  }

  function error(message, ...args) {
    console.error(`[VIP Redactosaurus] ${message}`, ...args);
  }

  // === FAKE PUBLISHER IDENTITIES ===

  let FAKE_IDENTITY = { name: 'Demo Network', domain: 'demosite.test' };

  // Settings the popup can override at runtime; stored values win over config.json defaults.
  const MODE_SETTINGS = ['headlineMode', 'authorMode', 'thumbnailMode'];

  function generateFakeIdentity() {
    return FAKE_IDENTITY;
  }

  // === CUSTOMER DETECTION ===

  function detectCustomerFromUrl() {
    if (!config || !config.urlPatterns) {
      error('No URL patterns configured for customer detection');
      return null;
    }

    const currentUrl = window.location.href;
    log('Customer detection for:', currentUrl);

    for (const [patternName, patternConfig] of Object.entries(config.urlPatterns)) {
      try {
        const regex = new RegExp(patternConfig.pattern);
        const match = currentUrl.match(regex);

        if (match && match[patternConfig.customerIdGroup]) {
          const realId = match[patternConfig.customerIdGroup];
          const fake = generateFakeIdentity(realId);

          const customer = {
            realId,
            name: fake.name,
            domain: fake.domain,
            pattern: patternName
          };

          log('Customer detected:', customer);
          return customer;
        }
      } catch (err) {
        error(`Error processing URL pattern '${patternName}':`, err);
      }
    }

    log('No customer detected from URL');
    return null;
  }

  function getCustomerValue(type) {
    if (!detectedCustomer) return null;

    switch (type) {
      case 'name': return detectedCustomer.name;
      case 'domain': return detectedCustomer.domain;
      case 'realId': return detectedCustomer.realId;
      default: return null;
    }
  }

  // === ELEMENT TRACKING ===

  function getContentHash(element) {
    const content = element.textContent || '';
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  function hasContentChanged(element) {
    const currentHash = getContentHash(element);
    const previousHash = elementContentHashes.get(element);
    if (previousHash === undefined) return true;
    return currentHash !== previousHash;
  }

  function updateContentHash(element) {
    elementContentHashes.set(element, getContentHash(element));
  }

  function hasBeenProcessed(element, transformationName) {
    const processedTransformations = processedElementsMap.get(element);
    if (!processedTransformations || !processedTransformations.has(transformationName)) {
      return false;
    }

    if (hasContentChanged(element)) {
      log(`Content changed in ${getElementSignature(element)}, will reprocess`);
      processedTransformations.delete(transformationName);
      return false;
    }

    return true;
  }

  function markAsProcessed(element, transformationName) {
    if (!processedElementsMap.has(element)) {
      processedElementsMap.set(element, new Set());
    }
    processedElementsMap.get(element).add(transformationName);
    updateContentHash(element);
  }

  function resetProcessedElements() {
    processedElementsMap.clear();
    elementContentHashes.clear();
    elementArticleMap.clear();
    articleIndex = 0;
    log('Reset all element tracking');
  }

  function getElementSignature(element) {
    let sig = element.tagName.toLowerCase();
    if (element.id) sig += `#${element.id}`;
    if (element.className) sig += `.${element.className.split(' ').join('.')}`;
    return sig;
  }

  function getRandomFromArray(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  // === HEADLINE LOADING ===

  async function loadArticles() {
    if (articles) return articles;

    try {
      const url = chrome.runtime.getURL('content/articles.js');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = JSON.parse(await response.text());

      if (Array.isArray(data) && data.length > 0) {
        articles = data;
        log(`Loaded ${articles.length} articles`);
        return articles;
      }
      throw new Error('Invalid articles format');
    } catch (err) {
      error('Failed to load articles:', err);
      articles = [
        { headline: 'Breaking News: Major Development in Technology Sector', section: 'Technology' },
        { headline: 'Global Initiative Promotes Sustainable Development', section: 'Environment' },
        { headline: 'Revolutionary Medical Breakthrough Saves Lives', section: 'Health & Science' }
      ];
      return articles;
    }
  }

  function getArticleForElement(element) {
    const row = element.closest('.post-row');
    const key = row || element;

    if (elementArticleMap.has(key)) {
      return elementArticleMap.get(key);
    }

    const article = articles[articleIndex % articles.length];
    articleIndex++;
    elementArticleMap.set(key, article);
    return article;
  }

  // === REPLACEMENT FUNCTIONS ===

  const replacementFunctions = {
    generateRandomHeadline: async function(args, element) {
      await loadArticles();
      return getArticleForElement(element).headline;
    },

    generateRandomSectionName: async function(args, element) {
      await loadArticles();
      return getArticleForElement(element).section;
    },

    generatePublisherName: function() {
      return FAKE_IDENTITY.name;
    },

    generateRandomAuthorName: function(args) {
      const { firstNames = [], lastNames = [] } = args || {};
      
      if (firstNames.length === 0 || lastNames.length === 0) {
        log('generateRandomAuthorName: Missing firstNames or lastNames arrays');
        return 'Anonymous Author';
      }
      
      const firstName = getRandomFromArray(firstNames);
      const lastName = getRandomFromArray(lastNames);
      
      return `${firstName} ${lastName}`;
    },

  };

  async function executeReplacementFunction(functionName, functionArgs, element) {
    if (!replacementFunctions[functionName]) {
      error(`Unknown replacement function: ${functionName}`);
      return 'Unknown Function';
    }
    
    try {
      const result = await replacementFunctions[functionName](functionArgs, element);
      log(`Executed function ${functionName}:`, result);
      return result;
    } catch (err) {
      error(`Error executing function ${functionName}:`, err);
      return 'Function Error';
    }
  }

  // === TRANSFORMATION FUNCTIONS ===

  function scrambleText(text, options = {}) {
    if (!text || typeof text !== 'string') return text;
    
    const { 
      preserveCase = true, 
      preservePunctuation = true, 
      preserveSpaces = true,
      preserveLength = true,
      preserveEnds = false
    } = options;

    // If preserveEnds is enabled, use word-based scrambling
    if (preserveEnds) {
      return scrambleByWords(text, options);
    }

    // Character-by-character scrambling (original behavior)
    let result = text.split('').map(char => {
      // Handle spaces
      if (/\s/.test(char)) {
        if (preserveSpaces) {
          return char; // Keep original space
        } else {
          // Replace space with random character
          const randomChar = String.fromCharCode(Math.floor(Math.random() * 26) + 97);
          return Math.random() < 0.5 ? randomChar.toUpperCase() : randomChar.toLowerCase();
        }
      }
      
      // Handle punctuation
      if (/[^\w\s]/.test(char)) {
        if (preservePunctuation) {
          return char; // Keep original punctuation
        } else {
          // Replace punctuation with random character
          const randomChar = String.fromCharCode(Math.floor(Math.random() * 26) + 97);
          return Math.random() < 0.5 ? randomChar.toUpperCase() : randomChar.toLowerCase();
        }
      }
      
      // Handle letters
      if (/[a-zA-Z]/.test(char)) {
        const isUpper = char === char.toUpperCase();
        const randomChar = String.fromCharCode(
          Math.floor(Math.random() * 26) + 97 // Always start with lowercase
        );
        
        if (preserveCase) {
          // Preserve original case
          return isUpper ? randomChar.toUpperCase() : randomChar.toLowerCase();
        } else {
          // Randomly mix case
          return Math.random() < 0.5 ? randomChar.toUpperCase() : randomChar.toLowerCase();
        }
      }
      
      // Handle numbers
      if (/[0-9]/.test(char)) {
        return Math.floor(Math.random() * 10).toString();
      }
      
      // Keep other characters as-is
      return char;
    }).join('');

    // If we replaced spaces with characters, inject some random spaces back for readability
    if (!preserveSpaces && result.length > 10) {
      // Count approximate words in original text (spaces + 1)
      const originalWordCount = (text.match(/\s+/g) || []).length + 1;
      const targetSpaces = Math.max(1, Math.floor(originalWordCount * 0.3)); // 30% of original spaces
      
      // Insert random spaces at random positions
      for (let i = 0; i < targetSpaces; i++) {
        const insertPos = Math.floor(Math.random() * (result.length - 2)) + 1; // Not at start/end
        result = result.slice(0, insertPos) + ' ' + result.slice(insertPos);
      }
    }

    // Enforce maximum word length to prevent layout-breaking long strings
    result = enforceMaxWordLength(result, options, text);

    // Handle length preservation
    if (!preserveLength) {
      // Randomly shorten or lengthen the text (10-150% of original length)
      const targetLength = Math.floor(text.length * (0.1 + Math.random() * 1.4));
      
      if (result.length < targetLength) {
        // Add random characters
        while (result.length < targetLength) {
          const randomChar = String.fromCharCode(Math.floor(Math.random() * 26) + 97);
          result += Math.random() < 0.5 ? randomChar.toUpperCase() : randomChar.toLowerCase();
        }
      } else if (result.length > targetLength) {
        // Truncate
        result = result.substring(0, targetLength);
      }
    }

    return result;
  }

  function scrambleByWords(text, options = {}) {
    const { 
      preserveCase = true, 
      preservePunctuation = true, 
      preserveSpaces = true
    } = options;

    // Split text into tokens (words, spaces, punctuation)
    const tokens = [];
    let currentToken = '';
    let tokenType = null; // 'word', 'space', 'punctuation'
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      if (/\s/.test(char)) {
        // Space character
        if (tokenType !== 'space') {
          if (currentToken) tokens.push({ type: tokenType, content: currentToken });
          currentToken = char;
          tokenType = 'space';
        } else {
          currentToken += char;
        }
      } else if (/[^\w\s]/.test(char)) {
        // Punctuation character
        if (tokenType !== 'punctuation') {
          if (currentToken) tokens.push({ type: tokenType, content: currentToken });
          currentToken = char;
          tokenType = 'punctuation';
        } else {
          currentToken += char;
        }
      } else {
        // Word character
        if (tokenType !== 'word') {
          if (currentToken) tokens.push({ type: tokenType, content: currentToken });
          currentToken = char;
          tokenType = 'word';
        } else {
          currentToken += char;
        }
      }
    }
    
    // Don't forget the last token
    if (currentToken) tokens.push({ type: tokenType, content: currentToken });
    
    // Process tokens and scramble words
    let result = tokens.map(token => {
      if (token.type === 'word') {
        return scrambleWord(token.content, options);
      } else if (token.type === 'space') {
        if (preserveSpaces) {
          return token.content; // Keep original spaces
        } else {
          // Replace spaces with random characters
          return token.content.split('').map(() => {
            const randomChar = String.fromCharCode(Math.floor(Math.random() * 26) + 97);
            return Math.random() < 0.5 ? randomChar.toUpperCase() : randomChar.toLowerCase();
          }).join('');
        }
      } else if (token.type === 'punctuation') {
        if (preservePunctuation) {
          return token.content; // Keep original punctuation
        } else {
          // Replace punctuation with random characters
          return token.content.split('').map(() => {
            const randomChar = String.fromCharCode(Math.floor(Math.random() * 26) + 97);
            return Math.random() < 0.5 ? randomChar.toUpperCase() : randomChar.toLowerCase();
          }).join('');
        }
      }
      return token.content;
    }).join('');

    // If we replaced spaces with characters, inject some random spaces back for readability
    if (!preserveSpaces && result.length > 10) {
      // Count original space tokens
      const originalSpaceCount = tokens.filter(token => token.type === 'space').length;
      const targetSpaces = Math.max(1, Math.floor(originalSpaceCount * 0.4)); // 40% of original spaces
      
      // Insert random spaces at random positions
      for (let i = 0; i < targetSpaces; i++) {
        const insertPos = Math.floor(Math.random() * (result.length - 2)) + 1; // Not at start/end
        result = result.slice(0, insertPos) + ' ' + result.slice(insertPos);
      }
    }

    // Enforce maximum word length to prevent layout-breaking long strings
    result = enforceMaxWordLength(result, options, text);

    return result;
  }

  function scrambleWord(word, options = {}) {
    const { preserveCase = true } = options;
    
    if (!word || word.length <= 2) {
      return word; // Can't scramble words with 2 or fewer characters
    }
    
    const chars = word.split('');
    const first = chars[0];
    const last = chars[chars.length - 1];
    const middle = chars.slice(1, -1);
    
    // Scramble middle characters
    const scrambledMiddle = middle.map(char => {
      if (/[a-zA-Z]/.test(char)) {
        const isUpper = char === char.toUpperCase();
        const randomChar = String.fromCharCode(
          Math.floor(Math.random() * 26) + 97 // Always start with lowercase
        );
        
        if (preserveCase) {
          // Preserve original case
          return isUpper ? randomChar.toUpperCase() : randomChar.toLowerCase();
        } else {
          // Randomly mix case
          return Math.random() < 0.5 ? randomChar.toUpperCase() : randomChar.toLowerCase();
        }
      } else if (/[0-9]/.test(char)) {
        return Math.floor(Math.random() * 10).toString();
      }
      return char;
    });
    
    return first + scrambledMiddle.join('') + last;
  }

  function enforceMaxWordLength(text, options = {}, originalText = '') {
    let { maxWordLength = 0 } = options; // Default 0 means "auto" mode
    
    // Auto mode: determine max word length from original content
    if (maxWordLength === 0) {
      const sourceText = originalText || text;
      const originalWords = sourceText.split(/\s+/);
      
      if (originalWords.length > 0) {
        // Find the longest word in the original text
        const longestWordLength = Math.max(...originalWords.map(word => word.length));
        maxWordLength = Math.max(8, longestWordLength); // Minimum of 8 characters
        log(`Auto-detected maxWordLength: ${maxWordLength} (longest original word: ${longestWordLength})`);
      } else {
        maxWordLength = 20; // Fallback if no words found
      }
    }
    
    if (!text || text.length <= maxWordLength) {
      return text;
    }

    // Split text by spaces to get individual words
    const words = text.split(' ');
    
    // Process each word and break it up if it's too long
    const processedWords = words.map(word => {
      if (word.length <= maxWordLength) {
        return word;
      }
      
      // Break long word into chunks
      const chunks = [];
      for (let i = 0; i < word.length; i += maxWordLength) {
        chunks.push(word.slice(i, i + maxWordLength));
      }
      
      // Join chunks with spaces
      return chunks.join(' ');
    });
    
    return processedWords.join(' ');
  }

  // Local JPEGs listed in assets/thumbnails/index.json. Fetched once; missing
  // or empty index logs and leaves thumbs hidden rather than showing customer images.
  async function getThumbnailPool(indexPath) {
    if (thumbnailPoolFailed) return null;
    if (thumbnailPool) return thumbnailPool;

    try {
      const response = await fetch(chrome.runtime.getURL(indexPath));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const files = await response.json();
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('index.json must be a non-empty array of filenames');
      }

      const base = indexPath.replace(/[^/]+$/, '');
      thumbnailPool = files.map(file => chrome.runtime.getURL(base + file));
      log(`Loaded ${thumbnailPool.length} pooled thumbnails from ${indexPath}`);
      return thumbnailPool;
    } catch (err) {
      thumbnailPoolFailed = true;
      error(`Failed to load thumbnail pool from "${indexPath}":`, err);
      return null;
    }
  }

  function previousPooledSrc(element, pool) {
    const thumbs = document.querySelectorAll('img');
    let previous = null;
    for (const img of thumbs) {
      if (img === element) return previous;
      const src = img.getAttribute('src') || '';
      if (pool.includes(src)) previous = src;
      else if (pool.includes(img.src)) previous = img.src;
    }
    return previous;
  }

  function pickFromPool(src, pool, element) {
    let hash = 0;
    for (let i = 0; i < src.length; i++) {
      hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0;
    }
    let index = (hash >>> 0) % pool.length;
    const previous = previousPooledSrc(element, pool);
    if (previous && pool[index] === previous && pool.length > 1) {
      index = (index + 1) % pool.length;
    }
    return pool[index];
  }

  function blurElement(element, blurAmount = '8px') {
    element.style.filter = `blur(${blurAmount})`;
    // Images scale up so the blur does not reveal the backdrop at their edges.
    // Text nodes must not scale or they shift the surrounding layout.
    if (element.tagName === 'IMG') {
      element.style.transform = 'scale(1.02)';
      element.classList.add('redactosaurus-ready');
    }
  }

  // === ELEMENT PROCESSING ===

  // Types that are never marked done and so are re-checked every cycle. Use
  // this only when the app can restore original content after we rewrite it —
  // Vue resets thumbnail srcs, and img textContent hashes do not detect that.
  const CONTINUOUS_TYPES = new Set(['defaultImage']);

  async function processElement(element, transformation) {
    const { type, options = {}, name } = transformation;
    
    if (type === 'injectCSS') {
      if (hasBeenProcessed(document.documentElement, name)) return;
      try {
        log(`Processing "${name}" (${type}) - CSS injection`);
        processInjectCSS(options, name);
        markAsProcessed(document.documentElement, name);
      } catch (err) {
        error(`Error processing CSS transformation "${name}":`, err);
      }
      return;
    }

    if (!element || !transformation) return;
    if (hasBeenProcessed(element, name)) return;
    
    try {
      const elementSig = getElementSignature(element);
      log(`Processing "${name}" (${type}) on ${elementSig}`);

      switch (type) {
        case 'scramble':
          processScramble(element, options);
          break;

        case 'functionReplace':
          await processFunctionReplace(element, options);
          break;

        case 'partialReplace':
          processPartialReplace(element, options);
          break;

        case 'blur':
          processBlur(element, options);
          break;

        case 'defaultImage':
          await processDefaultImage(element, options);
          break;

        case 'sensitiveText':
          processSensitiveText(element, options);
          break;

        default:
          error(`Unknown transformation type: ${type} in transformation "${name}"`);
          return;
      }

      if (!CONTINUOUS_TYPES.has(type)) {
        markAsProcessed(element, name);
      }
      log(`✅ Completed "${name}" (${type}) on ${elementSig}`);

    } catch (err) {
      error(`Error processing transformation "${transformation.name}":`, err);
    }
  }

  // === TRANSFORMATION PROCESSORS ===

  function processScramble(element, options) {
    if (!element.textContent.trim()) return;
    scrambleDirectTextNodes(element, options);
  }

  function scrambleDirectTextNodes(element, options) {
    Array.from(element.childNodes).forEach(node => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        node.textContent = scrambleText(node.textContent, options);
      }
    });
  }

  async function processFunctionReplace(element, options) {
    if (!element.textContent.trim()) return;
    
    const { functionName, functionArgs = {}, preserveChildren = false } = options;
    
    if (!functionName) {
      error('processFunctionReplace: No functionName specified');
      return;
    }
    
    const replacement = await executeReplacementFunction(functionName, functionArgs, element);

    if (preserveChildren) {
      Array.from(element.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          node.textContent = replacement;
        }
      });
    } else {
      element.textContent = replacement;
    }
  }

  function processPartialReplace(element, options) {
    if (!element.textContent.trim()) return;
    
    const { 
      replacements = {},
      caseSensitive = false,
      useRegex = false,
      preserveHtml = true // Default to true since we want to preserve HTML
    } = options;
    
    if (Object.keys(replacements).length === 0) {
      log('processPartialReplace: No replacements specified');
      return;
    }

    const allReplacements = Object.entries(replacements).map(([search, replace]) => ({
      search,
      replace,
      isRegex: useRegex
    }));

    if (allReplacements.length > 0) {
      replaceTextInElement(element, allReplacements, caseSensitive);
    }
  }

  function replaceTextInElement(element, replacements, caseSensitive = false) {
    let hasChanges = false;

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        let text = node.textContent;
        let originalText = text;

        replacements.forEach(({ search, replace, isRegex }) => {
          try {
            const flags = caseSensitive ? 'g' : 'gi';
            const pattern = isRegex ? search : search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const newText = text.replace(new RegExp(pattern, flags), replace);

            if (newText !== text) {
              text = newText;
              log(`Text replacement: "${search}" -> "${replace}"`);
            }
          } catch (err) {
            error(`Error in text replacement for "${search}":`, err);
          }
        });

        if (text !== originalText) {
          node.textContent = text;
          hasChanges = true;
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        Array.from(node.childNodes).forEach(processNode);
      }
    }

    processNode(element);
    return hasChanges;
  }

  function processBlur(element, options) {
    const { blurAmount = '8px' } = options;
    blurElement(element, blurAmount);
  }

  async function processDefaultImage(element, options) {
    if (element.tagName !== 'IMG') return;

    const { poolIndex } = options;
    if (!poolIndex) {
      error('processDefaultImage: No poolIndex specified');
      return;
    }

    const pool = await getThumbnailPool(poolIndex);
    if (!pool) return;

    const currentSrc = element.getAttribute('src') || '';
    if (!currentSrc) return;
    if (pool.includes(currentSrc) || pool.includes(element.src)) return;

    // srcset would keep the customer image on screen after we rewrite src.
    element.removeAttribute('srcset');
    element.src = pickFromPool(currentSrc, pool, element);
    log(`Replaced thumbnail with pooled image`);
  }

  function processInjectCSS(options, transformationName) {
    const { cssRules = [], cssFiles = [] } = options;
    
    log(`Processing CSS injection for "${transformationName}"`);
    
    // Inject CSS rules from config
    if (cssRules.length > 0) {
      injectCSSRules(cssRules, `redactosaurus-${transformationName}`);
    }
    
    // Load and inject external CSS files
    if (cssFiles.length > 0) {
      loadAndInjectCSSFiles(cssFiles, transformationName);
    }
  }

  function injectCSSRules(cssRules, styleId) {
    if (document.getElementById(styleId)) return;

    const cssText = cssRules
      .filter(rule => rule.selector && rule.properties)
      .map(rule => {
        const props = Object.entries(rule.properties)
          .map(([prop, val]) => `  ${prop}: ${val};`)
          .join('\n');
        return `${rule.selector} {\n${props}\n}`;
      })
      .join('\n\n');

    if (!cssText) return;

    const styleElement = document.createElement('style');
    styleElement.id = styleId;
    styleElement.setAttribute('data-redactosaurus', 'true');
    styleElement.textContent = cssText;
    (document.head || document.documentElement).appendChild(styleElement);
    log(`Injected ${cssRules.length} CSS rules for ${styleId}`);
  }

  async function loadAndInjectCSSFiles(cssFiles, transformationName) {
    for (const cssFile of cssFiles) {
      try {
        log(`Loading CSS file: ${cssFile}`);
        const cssUrl = chrome.runtime.getURL(cssFile);
        const response = await fetch(cssUrl);
        
        if (!response.ok) {
          error(`Failed to load CSS file ${cssFile}: ${response.status} ${response.statusText}`);
          continue;
        }
        
        const cssContent = await response.text();
        
        // Create style element for this file
        const styleId = `redactosaurus-${transformationName}-${cssFile.replace(/[^a-zA-Z0-9]/g, '-')}`;
        let styleElement = document.getElementById(styleId);
        
        if (!styleElement) {
          styleElement = document.createElement('style');
          styleElement.id = styleId;
          styleElement.setAttribute('data-redactosaurus', 'true');
          styleElement.setAttribute('data-css-file', cssFile);
          styleElement.textContent = cssContent;
          
          if (document.head) {
            document.head.appendChild(styleElement);
          } else {
            document.documentElement.appendChild(styleElement);
          }
          
          log(`Injected CSS file: ${cssFile}`);
        }
        
      } catch (err) {
        error(`Error loading CSS file ${cssFile}:`, err);
      }
    }
  }

  function processSensitiveText(element, options) {
    if (!element.textContent.trim()) return;

    const { 
      skipElementsContaining = [],
      preserveCase = true,
      preservePunctuation = true,
      preserveSpaces = true,
      preserveLength = true
    } = options;

    const hasImportantChildren = skipElementsContaining.some(tag => 
      element.querySelector(tag)
    );
    if (hasImportantChildren) return;

    element.textContent = scrambleText(element.textContent, {
      preserveCase,
      preservePunctuation,
      preserveSpaces,
      preserveLength
    });
  }

  // === GLOBAL TEXT SWEEP ===

  function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Parse.ly inserts Unicode format characters (ZWSP) around dots in displayed
  // URLs so they can wrap. A literal "gazette.com" misses "gazette​.​com", and
  // the brand token then replaces "gazette" with the publisher name.
  function flexibleDomain(domain) {
    return domain.split('.').map(escapeRegex).join('\\p{Cf}*\\.\\p{Cf}*');
  }

  function domainSweepPatterns(domain) {
    const host = domain.replace(/^www\./i, '');
    return [flexibleDomain(`www.${host}`), flexibleDomain(host)];
  }

  // The customer's brand name is not in the URL, but it is almost always the
  // domain's second-level label ("gazette.com" -> "gazette"), which is what
  // appears in header labels like "The Gazette Sites". Tokens shorter than
  // three characters are too collision-prone to sweep.
  function getBrandToken(realId) {
    const label = realId.replace(/^www\./i, '').split('.')[0];
    return label.length >= 3 ? label : null;
  }

  // A sweep runs every cycle over text it has already rewritten, so every
  // replacement must converge: its own output must not match any active
  // pattern. Otherwise it rewrites its own result forever and the text grows
  // without bound (brand token "gazette" replaced by "The Gazette" yields
  // "The The The ..."). Non-converging replacements are dropped, not applied.
  function buildSweepReplacements(realId, fakeDomain, fakeName) {
    // Domains are swept before names so a brand token cannot match inside a
    // domain that was already swapped.
    const domainPatterns = domainSweepPatterns(realId);
    if (previousFakeDomain && previousFakeDomain !== fakeDomain) {
      domainPatterns.push(...domainSweepPatterns(previousFakeDomain));
    }

    const candidates = [
      { label: 'customer domain', patterns: domainPatterns, value: fakeDomain }
    ];

    const namePatterns = [];
    const brandToken = getBrandToken(realId);
    if (brandToken) {
      namePatterns.push(`\\b${escapeRegex(brandToken)}\\b`);
    }
    if (previousFakeName && previousFakeName !== fakeName) {
      namePatterns.push(escapeRegex(previousFakeName));
    }
    if (namePatterns.length > 0) {
      candidates.push({ label: 'customer name', patterns: namePatterns, value: fakeName });
    }

    const allPatterns = new RegExp(candidates.flatMap(c => c.patterns).join('|'), 'iu');

    return candidates.filter(candidate => {
      if (!allPatterns.test(candidate.value)) return true;
      reportSweepIssue(
        `Sweep for ${candidate.label} disabled: the replacement "${candidate.value}" still matches a redaction pattern ` +
        `(customer id "${realId}"${brandToken ? `, brand token "${brandToken}"` : ''}), so applying it would rewrite ` +
        `its own output on every cycle. Pick a publisher name and domain that do not contain either.`
      );
      return false;
    });
  }

  function reportSweepIssue(message) {
    if (reportedSweepIssues.has(message)) return;
    reportedSweepIssues.add(message);
    error(message);
  }

  function sweepTextNodes() {
    if (!detectedCustomer || !isEnabled || !document.body) return;

    const realId = detectedCustomer.realId;
    if (!realId) return;

    const candidates = buildSweepReplacements(realId, detectedCustomer.domain, detectedCustomer.name);
    if (candidates.length === 0) return;

    const replacements = candidates.map(({ patterns, value }) => ({
      regex: new RegExp(patterns.join('|'), 'giu'),
      value
    }));

    // Non-global so it has no lastIndex state; lets the walk skip untouched nodes.
    const anyPattern = new RegExp(candidates.flatMap(c => c.patterns).join('|'), 'iu');

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.parentElement?.closest('[data-redactosaurus]')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent;
      if (!anyPattern.test(text)) continue;

      let swept = text;
      replacements.forEach(({ regex, value }) => {
        swept = swept.replace(regex, value);
      });
      if (swept !== text) node.textContent = swept;
    }

    previousFakeDomain = detectedCustomer.domain;
    previousFakeName = detectedCustomer.name;
  }

  // Chrome's link-preview status bar reads href on hover and cannot be turned
  // off. A swapped fake domain still leaks path slugs (author names). Every
  // link is shown as the dash origin; the real destination is kept off-DOM.
  // Inline onclick is blocked by the page CSP. Vue can restore href, so this
  // re-runs every cycle.
  const STATUS_BAR_HREF = 'http://dash.parsely.com';

  function sweepAnchorHref(anchor) {
    if (!anchor || !isEnabled || !hideHoverLinks) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('javascript:') || href.charAt(0) === '#') return;
    if (href === STATUS_BAR_HREF) return;
    originalHref.set(anchor, anchor.href);
    anchor.setAttribute('href', STATUS_BAR_HREF);
  }

  function sweepHrefs() {
    if (!isEnabled || !hideHoverLinks || !document.body) return;
    document.querySelectorAll('a[href]').forEach(sweepAnchorHref);
  }

  function restoreHrefs() {
    for (const [anchor, real] of originalHref) {
      if (anchor.isConnected) anchor.setAttribute('href', real);
    }
    originalHref.clear();
  }

  function destinationFromEvent(event) {
    const el = event.target?.nodeType === Node.ELEMENT_NODE
      ? event.target
      : event.target?.parentElement;
    const anchor = el?.closest('a');
    if (!anchor) return null;
    const real = originalHref.get(anchor) || anchor.href;
    if (!real || real.startsWith('javascript:') || real === '#' || real === STATUS_BAR_HREF) return null;
    return { anchor, real };
  }

  function isInternalDashUrl(href) {
    try {
      const host = new URL(href, location.href).hostname;
      return host === 'dash.parsely.com' || host === 'app.parsely.com' || host.endsWith('.parsely.com');
    } catch (err) {
      return false;
    }
  }

  function leaveDashboard(url, newTab) {
    if (newTab) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    window.top.location.assign(url);
  }

  function showLeaveInterstitial(url, newTab) {
    if (document.getElementById('redactosaurus-leave')) return;

    const overlay = document.createElement('div');
    overlay.id = 'redactosaurus-leave';
    overlay.setAttribute('data-redactosaurus', 'true');
    overlay.innerHTML =
      '<div class="redactosaurus-leave-card">' +
      '<p>This opens the real customer site.</p>' +
      '<div class="redactosaurus-leave-actions">' +
      '<button type="button" data-leave="cancel">Stay on dashboard</button>' +
      '<button type="button" data-leave="open">Open customer site</button>' +
      '</div></div>';

    const close = () => overlay.remove();
    overlay.addEventListener('click', (event) => {
      const action = event.target.closest('[data-leave]')?.getAttribute('data-leave');
      if (!action) return;
      close();
      if (action === 'open') leaveDashboard(url, newTab);
    });
    document.addEventListener('keydown', function onKey(event) {
      if (event.key !== 'Escape') return;
      document.removeEventListener('keydown', onKey);
      close();
    });
    (document.body || document.documentElement).appendChild(overlay);
  }

  function navigateOriginalHref(event) {
    if (!isEnabled) return;
    const found = destinationFromEvent(event);
    if (!found) return;

    if (event.type === 'click' && event.button !== 0) return;
    if (event.type === 'auxclick' && event.button !== 1) return;

    const newTab = event.type === 'auxclick' || event.metaKey || event.ctrlKey || event.shiftKey;
    const internal = isInternalDashUrl(found.real);

    if (internal && !hideHoverLinks) return;
    if (internal && !originalHref.has(found.anchor)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (internal) {
      if (newTab) window.open(found.real, '_blank', 'noopener');
      else window.location.assign(found.real);
      return;
    }

    showLeaveInterstitial(found.real, newTab);
  }

  function bindHrefSweepListeners() {
    if (hrefListenersBound) return;
    hrefListenersBound = true;
    document.addEventListener('click', navigateOriginalHref, true);
    document.addEventListener('auxclick', navigateOriginalHref, true);
    document.addEventListener('mouseover', (event) => {
      const el = event.target?.nodeType === Node.ELEMENT_NODE
        ? event.target
        : event.target?.parentElement;
      const anchor = el?.closest('a');
      if (anchor) sweepAnchorHref(anchor);
    }, true);
  }

  // === CONTENT HIDING & REVEALING ===

  function setThumbnailHideEnabled(enabled) {
    const existing = document.getElementById('redactosaurus-thumb-hide');
    if (!enabled) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    const style = document.createElement('style');
    style.id = 'redactosaurus-thumb-hide';
    style.textContent = [
      'div.thumb img { opacity: 0 !important; }',
      'div.thumb img[src^="chrome-extension://"], div.thumb img.redactosaurus-ready { opacity: 1 !important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function hideContentImmediately() {
    if (!config || !config.transformations || !isEnabled) return;

    log('Hiding sensitive content immediately...');

    const hidingCSS = [];
    
    config.transformations.forEach(transformation => {
      if (!transformation.selectors) return;
      
      transformation.selectors.forEach(selector => {
        if (transformation.type === 'blur' || transformation.type === 'defaultImage') {
          hidingCSS.push(`${selector} { opacity: 0 !important; }`);
        } else {
          hidingCSS.push(`${selector} { visibility: hidden !important; }`);
        }
      });
    });

    if (hidingCSS.length > 0) {
      const style = document.createElement('style');
      style.id = 'redactosaurus-hide-style';
      style.textContent = hidingCSS.join('\n');
      
      // Insert as early as possible
      if (document.head) {
        document.head.appendChild(style);
      } else {
        document.documentElement.appendChild(style);
      }
      
      log('Content hidden with CSS');
    }
  }

  function revealAnonymizedContent() {
    const hideStyle = document.getElementById('redactosaurus-hide-style');
    if (hideStyle) {
      hideStyle.remove();
      log('Content revealed');
    }
  }

  function injectGlobalCSS() {
    if (!config || !config.globalCSS || !config.globalCSS.enabled) {
      return;
    }

    log('Injecting global CSS...');

    // Inject global CSS rules
    if (config.globalCSS.rules && config.globalCSS.rules.length > 0) {
      injectCSSRules(config.globalCSS.rules, 'redactosaurus-global-css');
    }

    // Load global CSS files
    if (config.globalCSS.files && config.globalCSS.files.length > 0) {
      loadAndInjectCSSFiles(config.globalCSS.files, 'global');
    }

    // Add demo mode indicator
    showDemoModeIndicator();
  }

  function showDemoModeIndicator() {
    // Check if demo indicator is enabled in config
    if (!config?.settings?.showDemoIndicator) {
      return;
    }

    // Check if indicator already exists
    if (document.getElementById('redactosaurus-demo-indicator')) {
      return;
    }

    // Create demo mode indicator element
    const indicator = document.createElement('div');
    indicator.id = 'redactosaurus-demo-indicator';
    indicator.className = 'redactosaurus-demo-mode';
    indicator.textContent = '🦕 DEMO MODE';
    indicator.title = 'VIP Redactosaurus is actively anonymizing content on this page';

    // Add to page as early as possible
    if (document.body) {
      document.body.appendChild(indicator);
    } else if (document.documentElement) {
      document.documentElement.appendChild(indicator);
    } else {
      // If neither body nor documentElement exist yet, wait a bit
      setTimeout(() => {
        if (document.body) {
          document.body.appendChild(indicator);
        } else if (document.documentElement) {
          document.documentElement.appendChild(indicator);
        }
      }, 100);
    }

    log('Demo mode indicator shown');
  }

  function hideDemoModeIndicator() {
    const indicator = document.getElementById('redactosaurus-demo-indicator');
    if (indicator) {
      indicator.remove();
      log('Demo mode indicator hidden');
    }
  }

  // === MAIN PROCESSING FUNCTIONS ===

  async function processAllElements() {
    if (!config || !config.transformations || !isEnabled) return;

    processingCounter++;
    const cycleStart = performance.now();
    
    log(`=== PROCESSING CYCLE #${processingCounter} START ===`);

    checkForUrlChange();
    sweepHrefs();
    sweepTextNodes();

    let totalElementsFound = 0;
    let totalElementsProcessed = 0;
    let totalElementsSkipped = 0;

    for (const transformation of config.transformations) {
      if (!transformation.selectors) continue;
      
      // Check if transformation is conditionally enabled based on a setting
      if (transformation.enabledSetting) {
        const settingValue = config.settings?.[transformation.enabledSetting];
        const expectedValue = transformation.enabledValue;
        
        if (settingValue !== expectedValue) {
          log(`Skipping transformation "${transformation.name}" (setting ${transformation.enabledSetting} = "${settingValue}", expected "${expectedValue}")`);
          continue;
        }
      }
      
      log(`Processing transformation: ${transformation.name} (${transformation.type})`);
      
      for (const selector of transformation.selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          totalElementsFound += elements.length;
          
          log(`  Selector "${selector}": ${elements.length} elements found`);
          
          if (elements.length === 0) {
            log(`  ⚠️ No elements found for selector "${selector}"`);
          }
          
          for (const element of elements) {
            const elementSig = getElementSignature(element);
            
            if (hasBeenProcessed(element, transformation.name)) {
              totalElementsSkipped++;
              // Only log skipped elements occasionally to reduce noise
              if (processingCounter <= 3 || processingCounter % 10 === 0) {
                log(`  Skipping already processed ${elementSig}`);
              }
            } else {
              totalElementsProcessed++;
              await processElement(element, transformation);
            }
          }
        } catch (err) {
          error(`Invalid selector "${selector}" in transformation "${transformation.name}":`, err);
        }
      }
    }

    const cycleTime = performance.now() - cycleStart;
    
    if (totalElementsProcessed > 0 || processingCounter <= 3 || processingCounter % 10 === 0) {
      log(`=== CYCLE #${processingCounter} COMPLETE ===`);
      log(`  Found: ${totalElementsFound}, Processed: ${totalElementsProcessed}, Skipped: ${totalElementsSkipped}`);
      log(`  Cycle time: ${cycleTime.toFixed(2)}ms`);
    }

    // Clean up orphaned elements from tracking occasionally
    if (processingCounter % 50 === 0) {
      cleanupOrphanedElements();
    }
  }

  function cleanupOrphanedElements() {
    const orphans = new Set();

    for (const [element] of processedElementsMap) {
      if (!document.contains(element)) orphans.add(element);
    }
    for (const [element] of elementContentHashes) {
      if (!document.contains(element)) orphans.add(element);
    }
    for (const [element] of originalHref) {
      if (!document.contains(element)) orphans.add(element);
    }

    orphans.forEach(element => {
      processedElementsMap.delete(element);
      elementContentHashes.delete(element);
      originalHref.delete(element);
    });

    if (orphans.size > 0) {
      log(`Cleaned up ${orphans.size} orphaned elements`);
    }
  }

  function startContinuousProcessing() {
    if (processTimer) return;

    const interval = config?.settings?.processInterval || 100;
    
    processTimer = setInterval(async () => {
      if (!isEnabled) return;
      await processAllElements();
    }, interval);

    log(`Started continuous processing every ${interval}ms`);
  }

  function stopContinuousProcessing() {
    if (processTimer) {
      clearInterval(processTimer);
      processTimer = null;
      log('Stopped continuous processing');
    }
  }

  // === MUTATION OBSERVER ===

  function setupMutationObserver() {
    if (mutationObserver) return;

    mutationObserver = new MutationObserver((mutations) => {
      let hasNewContent = false;

      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              hasNewContent = true;
            }
          });
        }
      });

      if (hasNewContent && isEnabled) {
        // Debounce the processing
        setTimeout(async () => await processAllElements(), 50);
      }
    });

    mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    log('MutationObserver setup complete');
  }

  // === CONFIGURATION & STATE ===

  async function loadConfiguration() {
    const maxRetries = config?.settings?.maxRetries ?? 10;
    let retryCount = 0;

    while (maxRetries === 0 || retryCount < maxRetries) {
      try {
        const configUrl = chrome.runtime.getURL('content/config.json');
        const response = await fetch(configUrl);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        config = await response.json();
        log('Configuration loaded successfully');
        return true;
      } catch (err) {
        retryCount++;
        
        if (maxRetries === 0) {
          error(`Failed to load configuration (attempt ${retryCount}), retrying:`, err);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else if (retryCount >= maxRetries) {
          error(`Failed to load configuration after ${maxRetries} attempts:`, err);
          return false;
        } else {
          error(`Failed to load configuration (attempt ${retryCount}/${maxRetries}), retrying:`, err);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    return false;
  }

  async function loadExtensionState() {
    try {
      const result = await chrome.storage.local.get(['enabled', 'hideHoverLinks', 'embedInIframe', 'publisherName', 'publisherDomain', ...MODE_SETTINGS]);
      isEnabled = result.enabled !== false;
      hideHoverLinks = result.hideHoverLinks !== false;
      embedInIframe = result.embedInIframe === true;
      if (result.publisherName) FAKE_IDENTITY.name = result.publisherName;
      if (result.publisherDomain) FAKE_IDENTITY.domain = result.publisherDomain;
      MODE_SETTINGS.forEach(key => {
        if (result[key]) config.settings[key] = result[key];
      });
      log('Extension state loaded:', { isEnabled, identity: FAKE_IDENTITY, settings: config.settings });
    } catch (err) {
      error('Failed to load extension state:', err);
      isEnabled = true;
    }
  }

  const EMBED_PARAM = 'redactosaurus-embed';
  const EMBED_SRC_KEY = 'redactosaurus-embed-src';
  const EMBED_WRAP_AT_KEY = 'redactosaurus-wrap-at';
  const EMBED_BLOCKED_KEY = 'redactosaurus-wrap-blocked';

  function isParselyDashHost() {
    return location.hostname === 'dash.parsely.com' || location.hostname === 'app.parsely.com';
  }

  function hasEmbedFlag(href = location.href) {
    return new URL(href).searchParams.has(EMBED_PARAM);
  }

  function withEmbedFlag(href) {
    const url = new URL(href);
    url.searchParams.set(EMBED_PARAM, '1');
    return url.href;
  }

  function withoutEmbedFlag(href) {
    const url = new URL(href);
    url.searchParams.delete(EMBED_PARAM);
    return url.href;
  }

  function customerPathSegment() {
    const match = location.pathname.match(/^\/([^/]+)/);
    return match && match[1].includes('.') ? match[1] : null;
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;');
  }

  function notifyEmbedParent() {
    if (window === window.top || !hasEmbedFlag()) return;
    window.parent.postMessage({
      source: 'redactosaurus-embed',
      action: 'url',
      href: withoutEmbedFlag(location.href)
    }, location.origin);
  }

  function signalEmbedReady() {
    if (window === window.top || !hasEmbedFlag()) return;
    window.parent.postMessage({ source: 'redactosaurus-embed', action: 'ready' }, location.origin);
  }

  function restoreEmbeddedDashboard() {
    const stored = sessionStorage.getItem(EMBED_SRC_KEY);
    sessionStorage.removeItem(EMBED_BLOCKED_KEY);
    if (window === window.top && document.getElementById('redactosaurus-frame') && stored) {
      location.replace(stored);
    }
  }

  function installEmbedShell(realSrc) {
    if (embedInstalled) return true;
    embedInstalled = true;
    sessionStorage.setItem(EMBED_SRC_KEY, realSrc);
    sessionStorage.setItem(EMBED_WRAP_AT_KEY, String(Date.now()));

    const framed = withEmbedFlag(realSrc);
    document.open();
    document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Parse.ly</title>' +
      '<style>html,body,#redactosaurus-frame{margin:0;height:100%;width:100%;border:0;display:block;background:#fff}</style>' +
      '</head><body>' +
      `<iframe id="redactosaurus-frame" src="${escapeAttr(framed)}" allow="fullscreen"></iframe>` +
      '</body></html>'
    );
    document.close();
    history.replaceState(null, '', '/');

    const frame = document.getElementById('redactosaurus-frame');
    const timeout = setTimeout(() => {
      error('Address-bar iframe did not load. Parse.ly may block framing. Restoring the real URL.');
      location.replace(realSrc);
    }, 5000);

    window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return;
      if (event.data?.source !== 'redactosaurus-embed') return;
      if (event.data.action === 'ready') {
        clearTimeout(timeout);
        log('Address-bar iframe is live');
      }
      if (event.data.action === 'url' && event.data.href) {
        sessionStorage.setItem(EMBED_SRC_KEY, event.data.href);
      }
    });

    return true;
  }

  function tryEmbedDashboard() {
    if (!embedInIframe || !isEnabled) return false;
    if (window !== window.top) return false;
    if (!isParselyDashHost()) return false;
    if (hasEmbedFlag()) return false;
    if (sessionStorage.getItem(EMBED_BLOCKED_KEY) === '1') return false;

    const lastWrap = Number(sessionStorage.getItem(EMBED_WRAP_AT_KEY) || 0);
    if (customerPathSegment() && lastWrap && Date.now() - lastWrap < 2000) {
      sessionStorage.setItem(EMBED_BLOCKED_KEY, '1');
      error('Address-bar iframe was dismissed (frame-bust). Not wrapping again this session.');
      return false;
    }

    if (customerPathSegment()) {
      return installEmbedShell(withoutEmbedFlag(location.href));
    }

    const stored = sessionStorage.getItem(EMBED_SRC_KEY);
    if (stored && location.pathname === '/') {
      return installEmbedShell(stored);
    }

    return false;
  }

  function checkForUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl === lastDetectedUrl) return;

    lastDetectedUrl = currentUrl;
    const newCustomer = detectCustomerFromUrl();
    if (newCustomer && newCustomer.realId !== detectedCustomer?.realId) {
      log('SPA navigation detected, new customer:', newCustomer);
      detectedCustomer = newCustomer;
      resetProcessedElements();
    }
    notifyEmbedParent();
  }

  // === INITIALIZATION ===

  async function initialize() {
    if (isInitialized) return;

    log('Initializing VIP Redactosaurus...');

    // Load configuration and state
    const configLoaded = await loadConfiguration();
    if (!configLoaded) {
      error('Failed to load configuration, aborting initialization');
      return;
    }

    await loadExtensionState();
    if (tryEmbedDashboard()) {
      isInitialized = true;
      return;
    }
    setThumbnailHideEnabled(isEnabled);

    detectedCustomer = detectCustomerFromUrl();
    lastDetectedUrl = window.location.href;
    log(detectedCustomer ? 'Customer detected:' : 'No customer detected', detectedCustomer);

    if (isEnabled) {
      bindHrefSweepListeners();
      hideContentImmediately();
      injectGlobalCSS();

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', continueInitialization);
      } else {
        continueInitialization();
      }
    }

    isInitialized = true;
    signalEmbedReady();
    log('Initialization complete');
  }

  function continueInitialization() {
    if (!isEnabled) return;

    waitForBody(async () => {
      await processAllElements();
      setupMutationObserver();
      startContinuousProcessing();
      setTimeout(revealAnonymizedContent, 300);
    });
  }

  function waitForBody(callback) {
    const maxRetries = config?.settings?.maxRetries ?? 10;
    let retryCount = 0;

    function checkBody() {
      if (document.body) {
        log('Document body found, proceeding with initialization');
        callback();
        return;
      }

      retryCount++;
      
      if (maxRetries === 0) {
        log(`Document body not ready (attempt ${retryCount}), retrying indefinitely...`);
        setTimeout(checkBody, 50);
      } else if (retryCount >= maxRetries) {
        error(`Document body not ready after ${maxRetries} attempts, giving up`);
        return;
      } else {
        log(`Document body not ready (attempt ${retryCount}/${maxRetries}), retrying...`);
        setTimeout(checkBody, 50);
      }
    }

    checkBody();
  }

  // === MESSAGE HANDLING ===

  chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    log('Received message:', request);

    switch (request.action) {
      case 'toggle':
        isEnabled = request.enabled;
        
        if (isEnabled) {
          bindHrefSweepListeners();
          setThumbnailHideEnabled(true);
          hideContentImmediately();
          await processAllElements();
          setupMutationObserver();
          startContinuousProcessing();
          setTimeout(revealAnonymizedContent, 300);
        } else {
          stopContinuousProcessing();
          restoreHrefs();
          setThumbnailHideEnabled(false);
          revealAnonymizedContent();
          hideDemoModeIndicator();
          resetProcessedElements();
          restoreEmbeddedDashboard();
        }
        
        sendResponse({ success: true, enabled: isEnabled });
        break;

      case 'getStatus':
        sendResponse({ 
          enabled: isEnabled, 
          initialized: isInitialized,
          hasConfig: !!config 
        });
        break;

      case 'updateHideHoverLinks':
        hideHoverLinks = request.enabled !== false;
        if (hideHoverLinks) {
          sweepHrefs();
        } else {
          restoreHrefs();
        }
        sendResponse({ success: true, hideHoverLinks });
        break;

      case 'updateEmbedInIframe':
        embedInIframe = request.enabled === true;
        if (embedInIframe) {
          tryEmbedDashboard();
        } else {
          restoreEmbeddedDashboard();
        }
        sendResponse({ success: true, embedInIframe });
        break;

      case 'updateMode':
        if (config && config.settings) {
          config.settings[request.setting] = request.mode;
          log(`${request.setting} updated to: ${request.mode}`);
          resetProcessedElements();

          if (isEnabled) {
            hideContentImmediately();
            await processAllElements();
            setTimeout(revealAnonymizedContent, 300);
          }

          sendResponse({ success: true, setting: request.setting, mode: request.mode });
        } else {
          sendResponse({ success: false, error: 'Config not loaded' });
        }
        break;

      case 'updatePublisher':
        previousFakeDomain = FAKE_IDENTITY.domain;
        previousFakeName = FAKE_IDENTITY.name;
        reportedSweepIssues.clear();

        FAKE_IDENTITY.name = request.name || 'Demo Network';
        FAKE_IDENTITY.domain = request.domain || 'demosite.test';

        if (detectedCustomer) {
          detectedCustomer.name = FAKE_IDENTITY.name;
          detectedCustomer.domain = FAKE_IDENTITY.domain;
        }

        resetProcessedElements();
        if (isEnabled) {
          hideContentImmediately();
          await processAllElements();
          setTimeout(revealAnonymizedContent, 300);
        }
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    
    return true;
  });

  initialize();

})();