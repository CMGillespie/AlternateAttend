// Wordly Secure Viewer Script (Single Player, Lang Select, Header Collapse, Internal Scroll, Font Size, UI Tweaks v3)
document.addEventListener('DOMContentLoaded', () => {

  // --- TEMPORARY Configuration Input Elements ---
  const configInputArea = document.getElementById('config-input-area');
  const tempSessionIdInput = document.getElementById('temp-session-id');
  const tempPasscodeInput = document.getElementById('temp-passcode');
  const tempConnectBtn = document.getElementById('temp-connect-btn');
  const tempStatus = document.getElementById('temp-status');
  // --- End Temporary Elements ---

  // DOM elements for the main app
  const appPage = document.getElementById('app-page');
  const appHeader = document.getElementById('app-header');
  const headerToggleButton = document.getElementById('header-toggle-btn');
  const sessionDisplayHeader = document.getElementById('session-display-header');
  const languageSelect = document.getElementById('language-select');
  const audioToggle = document.getElementById('audio-toggle');
  const themeToggleBtn = document.getElementById('theme-toggle-btn'); // App theme toggle button
  const loginThemeToggleBtn = document.getElementById('login-theme-toggle-btn'); // Login theme toggle button
  const collapseBtn = document.getElementById('collapse-btn'); // "Hide/View Text" button
  const disconnectBtn = document.getElementById('disconnect-btn');
  const transcriptArea = document.getElementById('transcript-area'); // This div now scrolls
  const mainContent = document.getElementById('main-content'); // Parent container
  const connectionStatusLight = document.getElementById('connection-status'); // Now in header
  const statusMessage = document.getElementById('status-message');           // Now in header
  const audioStatus = document.getElementById('audio-status');             // Now in header
  const scrollToBottomBtn = document.getElementById('scroll-to-bottom-btn');
  const newMessageCountSpan = document.getElementById('new-message-count');
  // Font control buttons
  const fontSizeDecreaseBtn = document.getElementById('font-size-decrease-btn');
  const fontSizeIncreaseBtn = document.getElementById('font-size-increase-btn');
  const fontBoldToggleBtn = document.getElementById('font-bold-toggle-btn');
  // const clientLogo = document.getElementById('client-logo');

  // Application state
  const state = {
    sessionId: null,
    passcode: '',
    language: 'en',
    audioEnabled: false,
    headerCollapsed: false,
    headerCollapseTimeout: null,
    contentHidden: false, // Tracks if transcript area is hidden
    websocket: null,
    status: 'disconnected',
    phrases: {},
    audioQueue: [],
    isPlayingAudio: false,
    currentAudioElement: null,
    userScrolledUp: false, // Track scroll within transcriptArea
    newMessagesWhileScrolled: 0,
    // Font settings state
    fontSize: 'normal', // 'normal' or 'large'
    fontBold: false,    // true or false
    // Theme setting
    darkMode: false     // false = light theme, true = dark theme
  };

  // Language Mapping (Unchanged - Keep your full map here)
  const languageMap = {
    'af': 'Afrikaans', 'sq': 'Albanian', 'ar': 'Arabic', 'hy': 'Armenian', 'bn': 'Bengali',
    'bg': 'Bulgarian', 'zh-HK': 'Cantonese', 'ca': 'Catalan', 'zh-CN': 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)', 'hr': 'Croatian', 'cs': 'Czech', 'da': 'Danish',
    'nl': 'Dutch', 'en': 'English (US)', 'en-AU': 'English (AU)', 'en-GB': 'English (UK)',
    'et': 'Estonian', 'fi': 'Finnish', 'fr': 'French (FR)', 'fr-CA': 'French (CA)',
    'ka': 'Georgian', 'de': 'German', 'el': 'Greek', 'gu': 'Gujarati', 'he': 'Hebrew',
    'hi': 'Hindi', 'hu': 'Hungarian', 'is': 'Icelandic', 'id': 'Indonesian', 'ga': 'Irish',
    'it': 'Italian', 'ja': 'Japanese', 'kn': 'Kannada', 'ko': 'Korean', 'lv': 'Latvian',
    'lt': 'Lithuanian', 'mk': 'Macedonian', 'ms': 'Malay', 'mt': 'Maltese', 'no': 'Norwegian',
    'fa': 'Persian', 'pl': 'Polish', 'pt': 'Portuguese (PT)', 'pt-BR': 'Portuguese (BR)',
    'ro': 'Romanian', 'ru': 'Russian', 'sr': 'Serbian', 'sk': 'Slovak', 'sl': 'Slovenian',
    'es': 'Spanish (ES)', 'es-MX': 'Spanish (MX)', 'sv': 'Swedish', 'tl': 'Tagalog',
    'th': 'Thai', 'tr': 'Turkish', 'uk': 'Ukrainian', 'vi': 'Vietnamese', 'cy': 'Welsh',
    'pa': 'Punjabi', 'sw': 'Swahili', 'ta': 'Tamil', 'ur': 'Urdu',
    'zh': 'Chinese'
  };

  // Constants
  const HEADER_AUTO_COLLAPSE_DELAY = 10000; // 10 seconds
  const SCROLL_THRESHOLD = 50; // Pixels from bottom for transcript area

  // Initialize the application
  init();

  // --- Initialization Functions ---
  function init() {
    // Always force light mode first (default for new users)
    state.darkMode = false;
    document.documentElement.setAttribute('data-theme', 'light');

    // Then load saved settings
    loadFontSettings(); // Load saved font settings on initial page load
    loadThemeSettings(); // Load saved theme settings
    applyTheme(); // Apply theme on page load

    // Set up login screen controls
    tempConnectBtn.addEventListener('click', handleTempConnect);
    tempSessionIdInput.addEventListener('input', formatSessionIdInput);
    tempSessionIdInput.addEventListener('keydown', handleTempInputKeydown);
    tempPasscodeInput.addEventListener('keydown', handleTempInputKeydown);
    tempSessionIdInput.focus();

    // Add theme toggle to login screen
    if (loginThemeToggleBtn) {
      loginThemeToggleBtn.addEventListener('click', toggleTheme);
    }
  }

  function handleTempConnect() {
    const formattedSessionId = tempSessionIdInput.value;
    const inputPasscode = tempPasscodeInput.value.trim();
    if (!isValidSessionId(formattedSessionId)) {
      tempStatus.textContent = 'Invalid Session ID format (XXXX-0000).';
      return;
    }
    console.log("Attempting connection with manually entered details.");
    tempStatus.textContent = '';
    state.sessionId = formattedSessionId;
    state.passcode = inputPasscode;
    configInputArea.style.display = 'none';
    appPage.style.display = 'flex';
    initializeApp();
  }

  function formatSessionIdInput(event) {
    const input = event.target;
    let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let formattedValue = "";
    if (value.length > 4) {
      formattedValue = value.slice(0, 4) + '-' + value.slice(4, 8);
    } else {
      formattedValue = value;
    }
    // Avoid disrupting cursor position if possible
    if (input.value !== formattedValue) {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const delta = formattedValue.length - input.value.length;
      input.value = formattedValue;
      try {
        input.setSelectionRange(start + delta, end + delta);
      } catch (e) {
        console.warn("Couldn't set selection range during format.");
      }
    }
  }

  function handleTempInputKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleTempConnect();
    }
  }

  function initializeApp() {
    console.log(`Initializing app for Session ID: ${state.sessionId}`);
    if (sessionDisplayHeader) {
      // Mask the session ID for security
      const maskedSessionId = maskSessionId(state.sessionId);
      sessionDisplayHeader.textContent = `Session: ${maskedSessionId}`;
    }
    populateLanguageSelect(languageSelect, state.language);
    setupAppControls();
    applyFontSettings();
    applyTheme(); // Apply theme settings
    audioToggle.checked = state.audioEnabled;
    audioStatus.textContent = state.audioEnabled ? "Audio Ready" : "Audio Off";
    state.contentHidden = false;
    mainContent.classList.remove('transcript-hidden');
    collapseBtn.textContent = "Hide Text";
    resetHeaderCollapseTimer();
    updateConnectionStatus('connecting', 'Connecting...');
    connectWebSocket();
  }

  function setupAppControls() {
    languageSelect.addEventListener('change', handleLanguageChange);
    audioToggle.addEventListener('change', handleAudioToggle);
    collapseBtn.addEventListener('click', toggleContentVisibility);
    headerToggleButton.addEventListener('click', toggleHeaderCollapseManual);

    // Add theme toggle to app
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', toggleTheme);
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', disconnectSession);
    }
    transcriptArea.addEventListener('scroll', handleTranscriptScroll);
    scrollToBottomBtn.addEventListener('click', handleScrollToTranscriptBottomClick);
    fontSizeDecreaseBtn.addEventListener('click', handleFontSizeDecrease);
    fontSizeIncreaseBtn.addEventListener('click', handleFontSizeIncrease);
    fontBoldToggleBtn.addEventListener('click', handleFontBoldToggle);
  }

  // --- START PRODUCTION DEPLOYMENT NOTE ---
  // Remember to remove temporary inputs and logic, and implement
  // secure session detail retrieval post-MFA as described previously.
  // --- END PRODUCTION DEPLOYMENT NOTE ---

  // --- Control Handlers ---
  function handleLanguageChange(e) {
    const newLanguage = e.target.value;
    if (newLanguage === state.language) return;
    const oldLanguageName = getLanguageName(state.language);
    state.language = newLanguage;
    const newLanguageName = getLanguageName(newLanguage);
    console.log(`Language changed to ${newLanguage} (${newLanguageName})`);
    resetHeaderCollapseTimer();
    if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
      const changeRequest = { type: 'change', languageCode: newLanguage };
      console.log(`Sending language change request:`, JSON.stringify(changeRequest));
      try {
        const wasAudioEnabled = state.audioEnabled;
        if (wasAudioEnabled) sendVoiceRequest(false);
        stopPlayerAudio();
        state.websocket.send(JSON.stringify(changeRequest));
        addSystemMessage(`Language changed to ${newLanguageName}.`);
        if (wasAudioEnabled) {
          setTimeout(() => {
            if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
              sendVoiceRequest(true);
            }
          }, 500);
        }
      } catch (e) {
        console.error(`Error sending language change:`, e);
        addSystemMessage(`Error changing language: ${e.message}`, true);
        languageSelect.value = state.language; // Revert UI on error
      }
    } else {
      console.warn(`WebSocket not open. Language change will apply on next connection.`);
    }
  }

  function handleAudioToggle(e) {
    state.audioEnabled = e.target.checked;
    resetHeaderCollapseTimer();
    if (state.audioEnabled) {
      audioStatus.textContent = 'Audio Ready';
      addSystemMessage('Audio translations enabled.');
      if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
        sendVoiceRequest(true);
      }
      processAudioQueue();
    } else {
      audioStatus.textContent = 'Audio Off';
      addSystemMessage('Audio translations disabled.');
      stopPlayerAudio();
      if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
        sendVoiceRequest(false);
      }
    }
  }

  // Updated function for "Hide/View Text" button
  function toggleContentVisibility() {
    state.contentHidden = !state.contentHidden;
    mainContent.classList.toggle('transcript-hidden', state.contentHidden);
    collapseBtn.textContent = state.contentHidden ? 'View Text' : 'Hide Text';
    collapseBtn.title = state.contentHidden ? 'Show Transcript View' : 'Hide Transcript View';
    resetHeaderCollapseTimer();
  }

  function toggleHeaderCollapseManual() {
    clearTimeout(state.headerCollapseTimeout);
    state.headerCollapsed = !state.headerCollapsed;
    appHeader.classList.toggle('collapsed', state.headerCollapsed);

    // Restart auto-collapse timer if header is expanded manually
    if (!state.headerCollapsed) {
      resetHeaderCollapseTimer();
    }
  }

  function resetHeaderCollapseTimer() {
    clearTimeout(state.headerCollapseTimeout);
    if (state.headerCollapsed) {
      state.headerCollapsed = false;
      appHeader.classList.remove('collapsed');
    }
    state.headerCollapseTimeout = setTimeout(() => {
      if (!state.headerCollapsed) {
        console.log("Auto-collapsing header");
        state.headerCollapsed = true;
        appHeader.classList.add('collapsed');
      }
    }, HEADER_AUTO_COLLAPSE_DELAY);
  }

  function disconnectSession() {
    console.log("Disconnecting session...");
    stopPlayerAudio();
    if (state.websocket && state.websocket.readyState !== WebSocket.CLOSED) {
      try {
        state.websocket.close(1000, "User disconnected");
      } catch (e) {
        console.error("Error closing WebSocket:", e);
      }
    }
    state.websocket = null;
    updateConnectionStatus('disconnected', 'Disconnected by user.');
    // Show login screen again
    configInputArea.style.display = 'block';
    appPage.style.display = 'none';
    tempSessionIdInput.value = '';
    tempPasscodeInput.value = '';
    tempSessionIdInput.focus();
  }

  function isValidSessionId(sessionId) {
    return /^[A-Z0-9]{4}-\d{4}$/.test(sessionId);
  }

  // Mask session ID for security (format: ABCD-1234 -> ABXX-##34)
  function maskSessionId(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      return "Unknown Session";
    }

    const parts = sessionId.split('-');
    if (parts.length !== 2 || parts[0].length !== 4 || parts[1].length !== 4) {
      return sessionId; // Return as is if not in expected format
    }

    const firstPart = parts[0].substring(0, 2) + "XX";
    const secondPart = "##" + parts[1].substring(2, 4);

    return `${firstPart}-${secondPart}`;
  }

  // --- Font Setting Handlers ---
  function loadFontSettings() {
    try {
      const settings = localStorage.getItem('wordlyViewerFontSettings');
      if (settings) {
        const parsed = JSON.parse(settings);
        state.fontSize = parsed.size === 'large' ? 'large' : 'normal';
        state.fontBold = !!parsed.bold;
        console.log("Loaded font settings:", state.fontSize, state.fontBold);
      }
    } catch (e) {
      console.error("Error loading font settings:", e);
      // Reset to defaults on error
      state.fontSize = 'normal';
      state.fontBold = false;
    }
  }

  function applyFontSettings() {
    appPage.classList.remove('font-normal', 'font-large', 'font-bold');
    appPage.classList.add(state.fontSize === 'large' ? 'font-large' : 'font-normal');
    if (state.fontBold) {
      appPage.classList.add('font-bold');
    }
    fontBoldToggleBtn.classList.toggle('active', state.fontBold);
    fontSizeIncreaseBtn.classList.toggle('active', state.fontSize === 'large');
    fontSizeDecreaseBtn.classList.toggle('active', state.fontSize === 'normal');
  }

  function saveFontSettings() {
    try {
      const settings = { size: state.fontSize, bold: state.fontBold };
      localStorage.setItem('wordlyViewerFontSettings', JSON.stringify(settings));
      console.log("Saved font settings:", settings);
    } catch (e) {
      console.error("Error saving font settings:", e);
    }
  }

  function handleFontSizeDecrease() {
    if (state.fontSize !== 'normal') {
      state.fontSize = 'normal';
      applyFontSettings();
      saveFontSettings();
      resetHeaderCollapseTimer();
    }
  }

  function handleFontSizeIncrease() {
    if (state.fontSize !== 'large') {
      state.fontSize = 'large';
      applyFontSettings();
      saveFontSettings();
      resetHeaderCollapseTimer();
    }
  }

  function handleFontBoldToggle() {
    state.fontBold = !state.fontBold;
    applyFontSettings();
    saveFontSettings();
    resetHeaderCollapseTimer();
  }
  // --- End Font Setting Handlers ---

  // --- Theme Setting Handlers ---
  function loadThemeSettings() {
    try {
      const themeSetting = localStorage.getItem('wordlyViewerTheme');
      if (themeSetting) {
        state.darkMode = themeSetting === 'dark';
        console.log("Loaded theme setting:", state.darkMode ? 'dark' : 'light');
      } else {
        // For new users, default to light mode
        state.darkMode = false;
        console.log("Using default light theme for new user");
      }
    } catch (e) {
      console.error("Error loading theme settings:", e);
      state.darkMode = false; // Default to light on error
    }
  }

  function applyTheme() {
    const themeValue = state.darkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', themeValue);

    // Update icons in both login and app screens
    updateThemeIcons(themeToggleBtn);
    updateThemeIcons(loginThemeToggleBtn);
  }

  function updateThemeIcons(button) {
    if (!button) return; // Skip if button doesn't exist

    const moonIcon = button.querySelector('.moon-icon');
    const sunIcon = button.querySelector('.sun-icon');

    if (moonIcon && sunIcon) {
      // Show moon in light mode, sun in dark mode
      if (state.darkMode) {
        moonIcon.style.display = 'none';
        sunIcon.style.display = 'block';
      } else {
        moonIcon.style.display = 'block';
        sunIcon.style.display = 'none';
      }
    }
  }

  function saveThemeSettings() {
    try {
      localStorage.setItem('wordlyViewerTheme', state.darkMode ? 'dark' : 'light');
      console.log("Saved theme setting:", state.darkMode ? 'dark' : 'light');
    } catch (e) {
      console.error("Error saving theme setting:", e);
    }
  }

  function toggleTheme() {
    state.darkMode = !state.darkMode;
    applyTheme();
    saveThemeSettings();

    // Only reset header timer if we're on the app page
    if (appPage.style.display !== 'none') {
      resetHeaderCollapseTimer();
    }

    // Show notification to user
    showNotification(`${state.darkMode ? 'Dark' : 'Light'} mode enabled`, 'info');
  }
  // --- End Theme Setting Handlers ---

  // --- WebSocket Handling ---
  function connectWebSocket() {
    if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
      console.log(`WebSocket already open.`);
      return;
    }
    if (!state.sessionId) {
      showErrorState("Cannot connect: Session ID missing.");
      return;
    }

    updateConnectionStatus('connecting', 'Connecting...');

    try {
      // Ensure any previous socket is fully closed before creating a new one
      if (state.websocket) {
        try { state.websocket.close(); } catch (e) { /* ignore */ }
        state.websocket = null;
      }

      state.websocket = new WebSocket('wss://endpoint.wordly.ai/attend');
      state.websocket.onopen = handleWebSocketOpen;
      state.websocket.onmessage = handleWebSocketMessage;
      state.websocket.onclose = handleWebSocketClose;
      state.websocket.onerror = handleWebSocketError;

    } catch (error) {
      console.error(`Error creating WebSocket:`, error);
      showErrorState('Connection error.');
    }
  }

  function handleWebSocketOpen() {
    console.log(`WebSocket connection established.`);
    const connectRequest = {
      type: 'connect',
      presentationCode: state.sessionId,
      languageCode: state.language,
      identifier: `secure-viewer-${Math.random().toString(16).substring(2, 8)}`
    };
    if (state.passcode) {
      connectRequest.accessKey = state.passcode;
    }
    try {
      state.websocket.send(JSON.stringify(connectRequest));
    } catch (error) {
      console.error(`Error sending connect request:`, error);
      showErrorState('Connection error during handshake.');
    }
  }

  function handleWebSocketMessage(event) {
    try {
      const message = JSON.parse(event.data);
      // console.log("Received message:", message); // Optional: Log all messages

      switch (message.type) {
        case 'status':
          handleStatusMessage(message);
          break;
        case 'phrase':
          handlePhraseMessage(message);
          break;
        case 'speech':
          handleSpeechMessage(message);
          break;
        case 'users':
          handleUsersMessage(message); // Currently does nothing
          break;
        case 'end':
          handleEndMessage(message);
          break;
        case 'error':
          handleErrorMessage(message);
          break;
        case 'echo':
          console.log(`Echo received.`); // Keepalive or test message
          break;
        default:
          console.warn(`Unhandled message type: ${message.type}`, message);
      }
    } catch (error) {
      console.error(`Error processing message:`, error, event.data);
    }
  }

  function handleWebSocketClose(event) {
    console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}, Was Clean: ${event.wasClean}`);
    stopPlayerAudio();
    const status = (event.wasClean || event.code === 1000) ? 'disconnected' : 'error';

    // Avoid overwriting a deliberate disconnect/end status
    if (state.status !== 'disconnected' && state.status !== 'ended') {
      const message = status === 'disconnected' ? 'Disconnected' : `Connection lost (Code: ${event.code})`;
      updateConnectionStatus(status, message);
    }
    state.websocket = null;
    // Optional: Implement reconnection logic here if desired
  }

  function handleWebSocketError(error) {
    console.error(`WebSocket error:`, error);
    stopPlayerAudio();
    if (state.status !== 'disconnected' && state.status !== 'ended') {
      showErrorState('Connection error.');
    }
    // Attempt to close gracefully if possible, might already be closed
    if (state.websocket && state.websocket.readyState !== WebSocket.CLOSED) {
      try {
        state.websocket.close(1011, "WebSocket error");
      } catch (e) { /* ignore */ }
    }
    state.websocket = null;
  }

  // --- Message Handling Logic ---
  function handleStatusMessage(message) {
    if (message.success) {
      updateConnectionStatus('connected', 'Connected');
      addSystemMessage('Connected. Waiting for translations...');
      if (state.audioEnabled) {
        sendVoiceRequest(true); // Re-enable voice if needed on reconnect/connect
      }
    } else {
      const errorMessage = message.message || 'Connection failed';
      showErrorState(errorMessage);
      addSystemMessage(`Connection error: ${errorMessage}`, true);
      // Optional: disconnect or attempt reconnect based on error type
      if (state.websocket) {
        try { state.websocket.close(1011, "Status error received"); } catch(e){}
      }
    }
  }

  function handlePhraseMessage(message) {
    const phraseId = message.phraseId;
    let phraseElement = transcriptArea.querySelector(`#phrase-${phraseId}`);
    const isUserNearBottom = isScrolledToTranscriptBottom(); // Check before adding new content

    if (!phraseElement) {
      phraseElement = document.createElement('div');
      phraseElement.id = `phrase-${phraseId}`;
      phraseElement.className = 'phrase';
      // Sanitize speaker name/ID before inserting? Potentially needed.
      phraseElement.innerHTML = `
        <div class="phrase-header">
          <span class="speaker-name">${message.name || `Speaker ${message.speakerId.slice(-4)}`}</span>
          <span class="phrase-time">${new Date().toLocaleTimeString()}</span>
        </div>
        <div class="phrase-text"></div>`; // Text content set below
      transcriptArea.appendChild(phraseElement);
      limitTranscriptSize(transcriptArea); // Keep transcript from growing infinitely
    }

    // Update text content safely
    const textElement = phraseElement.querySelector('.phrase-text');
    if (textElement) {
      textElement.textContent = message.translatedText;
    }

    state.phrases[phraseId] = message; // Store phrase data

    // Handle scrolling and "New Messages" button
    if (isUserNearBottom) {
      scrollToTranscriptBottom();
      state.userScrolledUp = false; // Redundant if scroll is smooth, but safe
      state.newMessagesWhileScrolled = 0;
      scrollToBottomBtn.style.display = 'none';
    } else {
      // Only increment if user is genuinely scrolled up
      if (state.userScrolledUp) {
        state.newMessagesWhileScrolled++;
        newMessageCountSpan.textContent = `(${state.newMessagesWhileScrolled})`;
        scrollToBottomBtn.style.display = 'flex'; // Show button using flex
        // console.log(`Scroll button visible via display:flex. New count: ${state.newMessagesWhileScrolled}`);
      } else {
        // If user wasn't marked as scrolled up but isn't near bottom (edge case?), scroll anyway
        scrollToTranscriptBottom();
      }
    }
  }

  function limitTranscriptSize(container, maxPhrases = 150) {
    while (container.children.length > maxPhrases) {
      // Consider cleaning up associated state.phrases if memory becomes an issue
      container.removeChild(container.firstChild);
    }
  }

  // --- Scroll Handling Logic for Internal Scroll & Button Visibility ---
  function isScrolledToTranscriptBottom() {
    // Allow for small variations and prevent issues if elements haven't rendered fully
    if (!transcriptArea) return true;
    const { scrollTop, scrollHeight, clientHeight } = transcriptArea;
    // If clientHeight is 0, area is likely hidden, consider it "at bottom"
    if (clientHeight === 0) return true;
    // Calculate proximity to bottom
    return scrollHeight - Math.ceil(scrollTop) - clientHeight < SCROLL_THRESHOLD;
  }

  function scrollToTranscriptBottom() {
    if (transcriptArea) {
      transcriptArea.scrollTo({ top: transcriptArea.scrollHeight, behavior: 'smooth' });
      // Reset state immediately - button might flash, but it's simpler
      state.userScrolledUp = false;
      state.newMessagesWhileScrolled = 0;
      scrollToBottomBtn.style.display = 'none'; // Hide button
    }
  }

  function handleTranscriptScroll() {
    if (!transcriptArea) return;
    const isNearBottom = isScrolledToTranscriptBottom();

    if (!isNearBottom) {
      // Mark user as scrolled up only if they weren't already
      if (!state.userScrolledUp) {
          state.userScrolledUp = true;
          // console.log("User scrolled up.");
          // Button visibility is handled when *new* messages arrive while scrolled up
      }
    } else {
      // User scrolled back to the bottom manually
      if (state.userScrolledUp) {
        // console.log("User scrolled back to bottom manually.");
        state.userScrolledUp = false;
        state.newMessagesWhileScrolled = 0;
        scrollToBottomBtn.style.display = 'none'; // Hide button
      }
    }
  }

  function handleScrollToTranscriptBottomClick() {
    scrollToTranscriptBottom();
  }
  // --- End Scroll Handling Logic ---

  function handleSpeechMessage(message) {
    // console.log(`handleSpeechMessage called. AudioEnabled: ${state.audioEnabled}`);
    if (!state.audioEnabled) {
      // console.log(`Audio is disabled, skipping speech message.`);
      return;
    }
    if (message.synthesizedSpeech && message.synthesizedSpeech.data && message.synthesizedSpeech.data.length > 0) {
      // console.log(`Received valid speech data for phrase ${message.phraseId}.`);
      // Decode base64 data if necessary (check Wordly API docs) - assuming raw bytes here
      const audioData = message.synthesizedSpeech.data; // Use directly if raw bytes
      // If it's base64: const audioData = Uint8Array.from(atob(message.synthesizedSpeech.data), c => c.charCodeAt(0));

      state.audioQueue.push({ data: audioData, phraseId: message.phraseId });
      // console.log(`Queued audio. New queue size: ${state.audioQueue.length}`);
      processAudioQueue();
    } else {
      console.warn(`Received speech message with empty or invalid audio data for phrase ${message.phraseId}.`);
      audioStatus.textContent = 'Received empty audio data';
    }
  }

  function handleUsersMessage(message) {
    // console.log("Users update received:", message); // No display planned
  }

  function handleEndMessage(message) {
    const endReason = message.message ? `Reason: ${message.message}` : 'Session ended.';
    updateConnectionStatus('ended', endReason);
    addSystemMessage('The presentation has ended.');
    stopPlayerAudio();
    if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
      try {
        state.websocket.close(1000, "Presentation ended");
      } catch (e) { /* ignore */ }
    }
    state.websocket = null;
    // Optionally, disable controls or redirect after a delay
  }

  function handleErrorMessage(message) {
    const errorMessage = message.message || 'Unknown error occurred';
    // Avoid showing redundant errors if already disconnected/ended
    if (state.status !== 'disconnected' && state.status !== 'ended') {
      showErrorState(errorMessage);
    }
    addSystemMessage(`Error: ${errorMessage}`, true);
    // Consider disconnecting on critical errors
  }

  // --- Audio Playback & Queuing ---
  function processAudioQueue() {
    // console.log(`Entering processAudioQueue. isPlayingAudio: ${state.isPlayingAudio}, Queue size: ${state.audioQueue.length}`);
    if (state.isPlayingAudio || state.audioQueue.length === 0 || !state.audioEnabled) {
      return;
    }
    state.isPlayingAudio = true;
    const audioItem = state.audioQueue.shift();
    const phraseElement = transcriptArea.querySelector(`#phrase-${audioItem.phraseId}`);

    try {
      // Determine audio type (API should specify, default to wav if unsure)
      const audioType = 'audio/wav'; // Or 'audio/mpeg' for MP3 etc.
      const blob = new Blob([new Uint8Array(audioItem.data)], { type: audioType });
      const audioUrl = URL.createObjectURL(blob);
      // console.log(`Created Blob URL: ${audioUrl} for phrase ${audioItem.phraseId}`);

      const audioElement = new Audio();
      state.currentAudioElement = audioElement; // Keep track of the current element
      audioElement.src = audioUrl;

      // Use Promise-based play for better error handling
      audioElement.play().then(() => {
        // console.log(`Audio playing for phrase ${audioItem.phraseId}`);
        audioStatus.textContent = 'Playing audio...';
        if (phraseElement) phraseElement.classList.add('phrase-playing');
      }).catch(playError => {
        console.error(`Error playing audio:`, playError);
        audioStatus.textContent = 'Audio playback error';
        cleanupAudio(audioUrl, phraseElement); // Cleanup on play error
      });

      audioElement.onended = () => {
        // console.log(`Audio ended for phrase ${audioItem.phraseId}`);
        audioStatus.textContent = 'Audio playback completed';
        cleanupAudio(audioUrl, phraseElement);
      };
      audioElement.onerror = (errorEvent) => {
        console.error(`Audio element error event occurred.`);
        if (audioElement.error) {
          console.error(`  >> Audio Error Code: ${audioElement.error.code}, Message: ${audioElement.error.message}`);
        } else {
          console.error("  >> No specific audioElement.error details available.");
        }
        audioStatus.textContent = 'Audio playback error';
        cleanupAudio(audioUrl, phraseElement);
      };
      // audioElement.onstalled = () => { console.warn(`Audio stalled.`); }; // Optional: handle stalled event

      // No explicit load() needed with src assignment and promise-based play

    } catch (error) {
      console.error(`Error processing audio blob:`, error);
      audioStatus.textContent = 'Error processing audio';
      state.isPlayingAudio = false; // Ensure state allows next item
      processAudioQueue(); // Try next item
    }
  }

  function cleanupAudio(audioUrl, phraseElement) {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl); // Crucial for memory management
    }
    if (phraseElement) {
      phraseElement.classList.remove('phrase-playing');
    }
    state.isPlayingAudio = false;
    state.currentAudioElement = null; // Clear reference
    // Use setTimeout to yield execution, preventing potential stack overflow on rapid queue processing
    setTimeout(processAudioQueue, 0);
  }

  function stopPlayerAudio() {
    console.log(`Stopping audio and clearing queue.`);
    const currentAudio = state.currentAudioElement;
    if (currentAudio) {
      try {
        if (!currentAudio.paused && !currentAudio.ended) {
          currentAudio.pause();
          console.log(`Paused current audio element.`);
        }
        // Remove listeners to prevent memory leaks and unexpected calls
        currentAudio.onended = null;
        currentAudio.onerror = null;
        currentAudio.src = ''; // Release resource
        // No explicit load needed here
      } catch (e) {
        console.error(`Error during explicit audio stop:`, e);
      } finally {
        state.currentAudioElement = null;
      }
    }

    if (state.audioQueue.length > 0) {
      console.log(`Clearing ${state.audioQueue.length} items from audio queue.`);
      state.audioQueue = [];
    }
    state.isPlayingAudio = false;
    // Update status text based on whether audio is *supposed* to be on
    audioStatus.textContent = state.audioEnabled ? "Audio Ready" : "Audio Off";

    // Ensure any visual 'playing' indicators are removed
    const playingPhrase = transcriptArea ? transcriptArea.querySelector('.phrase-playing') : null;
    if (playingPhrase) {
      playingPhrase.classList.remove('phrase-playing');
    }
  }

  // --- UI Updates and Helpers ---
  function updateConnectionStatus(status, message) {
    // console.log(`Updating status: ${status} - ${message}`);
    state.status = status;
    if (connectionStatusLight) {
      connectionStatusLight.className = `status-light ${status}`; // Update class for styling
    }
    if (statusMessage) {
      statusMessage.textContent = message || status; // Update text
    }
  }

  function showErrorState(message) {
    updateConnectionStatus('error', message);
    // Optionally trigger a notification as well
    showNotification(message, 'error');
  }

  function addSystemMessage(message, isError = false) {
    // Currently just logs to console, could be added to transcript later if needed
    if (isError) {
      console.error(`SYSTEM (Error): ${message}`);
    } else {
      console.log(`SYSTEM: ${message}`);
    }
    // Example: Add to transcript (uncomment and style .system-message if desired)
    /*
    const messageDiv = document.createElement('div');
    messageDiv.className = `phrase system-message ${isError ? 'error' : ''}`;
    messageDiv.textContent = message;
    if (transcriptArea) {
      transcriptArea.appendChild(messageDiv);
      scrollToTranscriptBottom(); // Scroll to see system message
    }
    */
  }

  function populateLanguageSelect(selectElement, selectedLanguage) {
    if (!selectElement) return;
    selectElement.innerHTML = ''; // Clear existing options
    Object.entries(languageMap).forEach(([code, name]) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      selectElement.appendChild(option);
    });
    // Set the default/current language
    selectElement.value = selectedLanguage;
  }

  function getLanguageName(code) {
    return languageMap[code] || code; // Fallback to code if name not found
  }

  function sendVoiceRequest(enabled) {
    if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
      try {
        const voiceRequest = { type: 'voice', enabled: enabled };
        state.websocket.send(JSON.stringify(voiceRequest));
        console.log(`Voice request sent (enabled=${enabled})`);
      } catch (e) {
        console.error(`Error sending voice request (enabled=${enabled}):`, e);
      }
    } else {
      console.warn(`Cannot send voice request, WebSocket not open.`);
    }
  }

  // --- Notifications ---
  function showNotification(message, type = 'info') { // Default to 'info'
    // Remove any existing notification first
    const existing = document.querySelector('.notification');
    if (existing) {
      existing.remove();
    }

    const notification = document.createElement('div');
    notification.className = `notification ${type}`; // Types: success, error, info
    notification.textContent = message;
    document.body.appendChild(notification);

    // Trigger fade-in
    requestAnimationFrame(() => {
      notification.classList.add('visible');
    });

    // Set duration and fade-out
    const notificationDuration = 3000; // 3 seconds
    setTimeout(() => {
      notification.classList.remove('visible');
      // Remove element after fade-out transition completes
      setTimeout(() => notification.remove(), 500); // Match transition duration
    }, notificationDuration - 500);
  }

}); // End DOMContentLoaded
